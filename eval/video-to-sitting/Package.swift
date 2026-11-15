// swift-tools-version: 6.0
import PackageDescription

// Turns dataset video into the sitting file the phone writes, so the engine runs on it unchanged.
// Sources/video-to-sitting/Phone holds symlinks to the capture module's own region code.
let package = Package(
  name: "video-to-sitting",
  platforms: [.macOS(.v13)],
  dependencies: [.package(path: "../../packages/signal-engine")],
  targets: [
    .executableTarget(
      name: "video-to-sitting",
      dependencies: [.product(name: "SignalEngine", package: "signal-engine")],
      swiftSettings: [.swiftLanguageMode(.v5)]
    ),
    // The same region code fed frames as they are taken (the dashboard's webcam): JPEG frames on
    // stdin, outlines, readings and the summary on stdout. Its other sources are symlinks too.
    .executableTarget(
      name: "live-sitting",
      dependencies: [.product(name: "SignalEngine", package: "signal-engine")],
      swiftSettings: [.swiftLanguageMode(.v5)]
    ),
  ]
)
