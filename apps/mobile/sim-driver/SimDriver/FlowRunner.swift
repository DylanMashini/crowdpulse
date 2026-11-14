import XCTest

/// Runs one flow file against the installed Crowdpulse development build, by its bundle id.
/// The flow language and the environment variables are described in `apps/mobile/sim-flows/README.md`.
///
/// The test runner is a simulator process and shares the Mac's file system, so the flow is read
/// from, and screenshots are written to, ordinary paths on the Mac.
final class FlowRunner: XCTestCase {
  private var app: XCUIApplication!
  private let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
  private var environment: [String: String] { ProcessInfo.processInfo.environment }
  private var outDirectory = URL(fileURLWithPath: NSTemporaryDirectory())
  private var prefix = "flow"
  private var log: [String] = []
  private let started = Date()

  override func setUp() {
    continueAfterFailure = false
  }

  func testFlow() throws {
    guard let flowPath = environment["SIM_FLOW"] else {
      throw FlowError("SIM_FLOW is not set. Run flows through apps/mobile/scripts/sim-qa.sh.")
    }
    if let out = environment["SIM_OUT"] { outDirectory = URL(fileURLWithPath: out) }
    prefix = environment["SIM_PREFIX"] ?? URL(fileURLWithPath: flowPath).deletingPathExtension().lastPathComponent
    try FileManager.default.createDirectory(at: outDirectory, withIntermediateDirectories: true)
    app = XCUIApplication(bundleIdentifier: environment["SIM_BUNDLE"] ?? "com.triagecam.app")

    defer { writeLog() }
    do {
      try runFile(flowPath)
    } catch {
      note("FAILED: \(error)")
      save(screenshot(), as: "FAILED.png")
      save(Data(app.debugDescription.utf8), as: "FAILED-tree.txt")
      writeLog()
      XCTFail("\(error)")
    }
  }

  /// Runs a flow file line by line. `if`, `ifNot` and `end` skip a block; `run` runs another
  /// flow file, found beside this one.
  private func runFile(_ path: String) throws {
    let file = URL(fileURLWithPath: path)
    let lines = try String(contentsOfFile: path, encoding: .utf8).components(separatedBy: .newlines)
    /// How many enclosing blocks are being skipped. Zero means lines are run.
    var skipping = 0
    var depth = 0
    for (index, raw) in lines.enumerated() {
      let line = substitute(raw.trimmingCharacters(in: .whitespaces))
      if line.isEmpty || line.hasPrefix("#") { continue }
      let words = tokens(line)
      let place = "\(file.lastPathComponent) line \(index + 1): \(line)"
      do {
        switch words[0] {
        case "if", "ifNot":
          depth += 1
          if skipping > 0 {
            skipping += 1
          } else {
            guard words.count > 1 else { throw FlowError("\(words[0]) needs a text") }
            note(place)
            let there = find(words[1]).firstMatch.waitForExistence(timeout: words.count > 2 ? Double(words[2]) ?? 3 : 3)
            if there != (words[0] == "if") { skipping = 1 }
            note(there ? "  on screen" : "  not on screen")
          }
        case "end":
          guard depth > 0 else { throw FlowError("end without if") }
          depth -= 1
          if skipping > 0 { skipping -= 1 }
        case "run":
          if skipping > 0 { continue }
          guard words.count > 1 else { throw FlowError("run needs a flow file") }
          note(place)
          let other = words[1].hasPrefix("/") ? words[1] : file.deletingLastPathComponent().appendingPathComponent(words[1]).path
          try runFile(other)
        default:
          if skipping > 0 { continue }
          note(place)
          try run(words)
        }
      } catch let error as FlowFailure {
        throw error
      } catch {
        throw FlowFailure(description: "\(place): \(error)")
      }
    }
    if depth != 0 { throw FlowFailure(description: "\(file.lastPathComponent): if without end") }
  }

  // MARK: Commands

  private func run(_ words: [String]) throws {
    let command = words[0]
    let first = words.count > 1 ? words[1] : nil
    let second = words.count > 2 ? words[2] : nil
    func text() throws -> String {
      guard let first else { throw FlowError("\(command) needs a text") }
      return first
    }
    func seconds(_ word: String?, _ fallback: Double) -> Double { word.flatMap(Double.init) ?? fallback }

    switch command {
    case "launch":
      app.launch()
    case "activate":
      app.activate()
    case "terminate":
      app.terminate()
    case "home":
      XCUIDevice.shared.press(.home)
    case "open":
      // A custom-scheme link: iOS asks "Open in Crowdpulse?" first, which is answered here.
      guard let url = URL(string: try text()) else { throw FlowError("not a URL") }
      XCUIDevice.shared.system.open(url)
      confirmOpen()
    case "confirmOpen":
      confirmOpen()
    case "tapSystem", "tapSystemOptional":
      // Something iOS itself shows over the app or the home screen: a permission question, a
      // notification.
      let element = findSystem(try text()).firstMatch
      if element.waitForExistence(timeout: seconds(second, command == "tapSystem" ? 30 : 4)) {
        element.tap()
      } else if command == "tapSystem" {
        throw FlowError("iOS is not showing it")
      } else {
        note("  not there, skipped")
      }
    case "signal":
      // An empty file the rig script waits for, to act between two steps of a flow.
      save(Data(), as: "signal-\(try text())")
    case "wait":
      try waitFor(try text(), seconds(second, 30))
    case "waitGone":
      let query = find(try text())
      let deadline = Date().addingTimeInterval(seconds(second, 30))
      while query.count > 0 {
        if Date() > deadline { throw FlowError("still on screen") }
        Thread.sleep(forTimeInterval: 0.5)
      }
    case "assert":
      try waitFor(try text(), 3)
    case "assertNot":
      if find(try text()).count > 0 { throw FlowError("is on screen and should not be") }
    case "count":
      guard let expected = second.flatMap(Int.init) else { throw FlowError("count needs a text and a number") }
      // React Native shows a text as two nested elements with one label and one frame: places
      // are counted, not elements.
      let found = Set(find(try text()).allElementsBoundByIndex.map { NSCoder.string(for: $0.frame) }).count
      if found != expected { throw FlowError("found \(found), expected \(expected)") }
    case "tap":
      try tap(try text(), timeout: seconds(second, 30))
    case "tapOptional":
      if find(try text()).firstMatch.waitForExistence(timeout: seconds(second, 3)) {
        try tap(try text(), timeout: 3)
      } else {
        note("  not there, skipped")
      }
    case "type":
      guard let value = second else { throw FlowError("type needs a field and a text") }
      let field = try hittable(try text(), timeout: 30)
      Thread.sleep(forTimeInterval: 1)
      field.tap()
      field.typeText(value)
    case "clear":
      let field = try hittable(try text(), timeout: 30)
      field.tap()
      let length = (field.value as? String)?.count ?? 0
      if length > 0 { field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: length)) }
    case "hideKeyboard":
      if app.keyboards.count > 0 { app.typeText("\n") }
      // A list that puts the keyboard away when it is dragged.
      if app.keyboards.count > 0 { app.swipeDown(velocity: .slow) }
    case "scroll":
      switch first {
      case "down": app.swipeUp()
      case "up": app.swipeDown()
      default: throw FlowError("scroll down or scroll up")
      }
    case "scrollTo":
      _ = try hittable(try text(), timeout: seconds(second, 30))
    case "rotate":
      switch first {
      case "landscape": XCUIDevice.shared.orientation = .landscapeLeft
      case "portrait": XCUIDevice.shared.orientation = .portrait
      default: throw FlowError("rotate landscape or rotate portrait")
      }
    case "sleep":
      Thread.sleep(forTimeInterval: seconds(first, 1))
    case "shot":
      save(screenshot(), as: "\(try text()).png")
    case "screenShot":
      // The whole screen as the device holds it, for system prompts and the home screen.
      save(XCUIScreen.main.screenshot().pngRepresentation, as: "\(try text()).png")
    case "dump":
      save(Data(app.debugDescription.utf8), as: "\(try text()).txt")
    default:
      throw FlowError("unknown command")
    }
  }

  // MARK: Finding things

  /// Elements whose accessibility label or identifier is the text; with a leading `~`, whose
  /// label contains it. React Native joins the texts inside one touch target into one label,
  /// so a card or a row is found with `~`.
  private func find(_ text: String) -> XCUIElementQuery {
    let predicate: NSPredicate
    if text.hasPrefix("~") {
      predicate = NSPredicate(format: "label CONTAINS %@", String(text.dropFirst()))
    } else {
      predicate = NSPredicate(format: "label == %@ OR identifier == %@", text, text)
    }
    return app.descendants(matching: .any).matching(predicate)
  }

  private func findSystem(_ text: String) -> XCUIElementQuery {
    let predicate = text.hasPrefix("~")
      ? NSPredicate(format: "label CONTAINS %@", String(text.dropFirst()))
      : NSPredicate(format: "label == %@", text)
    return springboard.descendants(matching: .any).matching(predicate)
  }

  private func waitFor(_ text: String, _ timeout: Double) throws {
    if !find(text).firstMatch.waitForExistence(timeout: timeout) {
      throw FlowError("not on screen after \(Int(timeout)) s")
    }
  }

  /// The first match that can be touched, scrolling the list it is in to reach it if need be.
  private func hittable(_ text: String, timeout: Double) throws -> XCUIElement {
    try waitFor(text, timeout)
    for attempt in 0..<10 {
      let matches = find(text).allElementsBoundByIndex.filter { $0.exists }
      // Controls first: a title and a button often carry the same words.
      let ordered = matches.filter { isControl($0) } + matches.filter { !isControl($0) }
      if let element = ordered.first(where: { $0.isHittable }) {
        settle(element)
        return element
      }
      guard attempt < 9, let target = ordered.first else { break }
      // A flag banner that arrived over the nurse's screen covers what is under it.
      let banner = app.buttons["Close this notice"]
      if banner.exists, banner.isHittable, target.frame.minY < banner.frame.maxY + 300, !text.contains("Close this notice") {
        note("  a flag banner is in the way: closing it")
        banner.tap()
        Thread.sleep(forTimeInterval: 0.5)
        continue
      }
      scroll(towards: target)
    }
    throw FlowError("on screen but cannot be touched")
  }

  /// Waits until the element has stopped moving: a screen that is still sliding in takes the
  /// touch somewhere else.
  private func settle(_ element: XCUIElement) {
    var last = element.frame
    for _ in 0..<8 {
      Thread.sleep(forTimeInterval: 0.25)
      let now = element.exists ? element.frame : last
      if now == last { return }
      last = now
    }
  }

  /// Drags the scroll view that holds the element by half its height, towards the element.
  private func scroll(towards element: XCUIElement) {
    let frame = element.frame
    let holders = app.scrollViews.allElementsBoundByIndex
      .filter { $0.exists && $0.frame.minX <= frame.midX && frame.midX <= $0.frame.maxX && $0.frame.height > 0 }
      .sorted { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }
    guard let holder = holders.first else {
      app.swipeUp(velocity: .slow)
      return
    }
    let below = frame.midY > holder.frame.midY
    let from = holder.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: below ? 0.7 : 0.3))
    let to = holder.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: below ? 0.2 : 0.8))
    from.press(forDuration: 0.05, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 0.2)
  }

  private func isControl(_ element: XCUIElement) -> Bool {
    switch element.elementType {
    case .button, .textField, .secureTextField, .switch, .radioButton, .searchField, .tab, .link: return true
    default: return false
    }
  }

  private func tap(_ text: String, timeout: Double) throws {
    let element = try hittable(text, timeout: timeout)
    // A touch in the first second after a screen slides in or out is lost, although the
    // control is already there to be found.
    Thread.sleep(forTimeInterval: 1)
    element.tap()
  }

  private func confirmOpen() {
    let open = springboard.buttons["Open"]
    if open.waitForExistence(timeout: 3) { open.tap() }
  }

  // MARK: Flow text

  /// `${NAME}` is replaced by the environment variable `SIM_NAME`.
  private func substitute(_ line: String) -> String {
    var result = line
    while let start = result.range(of: "${"), let end = result.range(of: "}", range: start.upperBound..<result.endIndex) {
      let name = String(result[start.upperBound..<end.lowerBound])
      result.replaceSubrange(start.lowerBound..<end.upperBound, with: environment["SIM_\(name)"] ?? "")
    }
    return result
  }

  /// Words separated by spaces; a word in double quotes may hold spaces.
  private func tokens(_ line: String) -> [String] {
    var words: [String] = []
    var current = ""
    var quoted = false
    var open = false
    for character in line {
      if character == "\"" {
        quoted.toggle()
        open = true
      } else if character == " " && !quoted {
        if open || !current.isEmpty { words.append(current) }
        current = ""
        open = false
      } else {
        current.append(character)
      }
    }
    if open || !current.isEmpty { words.append(current) }
    return words
  }

  // MARK: Output

  /// The screen the way a person sees it. In landscape the simulator's picture stays in
  /// portrait and only says which way up it is; drawing it applies that.
  private func screenshot() -> Data {
    let shot = XCUIScreen.main.screenshot()
    let image = shot.image
    guard image.imageOrientation != .up else { return shot.pngRepresentation }
    let format = UIGraphicsImageRendererFormat()
    format.scale = image.scale
    let upright = UIGraphicsImageRenderer(size: image.size, format: format).image { _ in
      image.draw(in: CGRect(origin: .zero, size: image.size))
    }
    return upright.pngData() ?? shot.pngRepresentation
  }

  private func save(_ data: Data, as name: String) {
    let url = outDirectory.appendingPathComponent("\(prefix)-\(name)")
    do {
      try data.write(to: url)
    } catch {
      note("could not write \(url.path): \(error)")
    }
  }

  private func note(_ message: String) {
    let line = String(format: "%6.1f  %@", Date().timeIntervalSince(started), message)
    log.append(line)
    print("[flow] \(line)")
  }

  private func writeLog() {
    save(Data((log.joined(separator: "\n") + "\n").utf8), as: "flow.log")
  }
}

/// A failed line, with the file and line it came from.
struct FlowFailure: Error, CustomStringConvertible {
  let description: String
}

struct FlowError: Error, CustomStringConvertible {
  let description: String
  init(_ description: String) { self.description = description }
}
