import ExpoModulesCore
import UIKit

/// Holds the interface in landscape while the sitting screen is up.
///
/// The navigator's own `orientation` option does not work in a development build: the dev
/// launcher puts its view controller between the window's root and the navigation stack, and
/// react-native-screens only looks one level below the root. The app delegate is asked before
/// any view controller, so the lock lives there.
///
/// Used on the main thread only.
enum OrientationLock {
  private static var landscapeOnly = false
  /// How the interface stood when the lock was taken.
  private static var orientationBeforeLock: UIInterfaceOrientationMask?

  static var mask: UIInterfaceOrientationMask {
    landscapeOnly ? declared.intersection(.landscape) : declared
  }

  /// What Info.plist allows. A subscriber's answer replaces it, so the unlocked state has to
  /// repeat it.
  private static let declared: UIInterfaceOrientationMask = {
    let names = Bundle.main.object(forInfoDictionaryKey: "UISupportedInterfaceOrientations") as? [String] ?? []
    let masks: [String: UIInterfaceOrientationMask] = [
      "UIInterfaceOrientationPortrait": .portrait,
      "UIInterfaceOrientationPortraitUpsideDown": .portraitUpsideDown,
      "UIInterfaceOrientationLandscapeLeft": .landscapeLeft,
      "UIInterfaceOrientationLandscapeRight": .landscapeRight,
    ]
    let mask = names.reduce(into: UIInterfaceOrientationMask()) { $0.formUnion(masks[$1] ?? []) }
    return mask.isEmpty ? .allButUpsideDown : mask
  }()

  /// The orientation the phone is held in. Nil when it lies flat, and on the simulator.
  private static var heldOrientation: UIInterfaceOrientationMask? {
    switch UIDevice.current.orientation {
    case .portrait: return .portrait
    case .portraitUpsideDown: return .portraitUpsideDown
    // The device and interface enumerations name the two landscapes the opposite way round.
    case .landscapeLeft: return .landscapeRight
    case .landscapeRight: return .landscapeLeft
    default: return nil
    }
  }

  private static func mask(of orientation: UIInterfaceOrientation) -> UIInterfaceOrientationMask? {
    switch orientation {
    case .portrait: return .portrait
    case .portraitUpsideDown: return .portraitUpsideDown
    case .landscapeLeft: return .landscapeLeft
    case .landscapeRight: return .landscapeRight
    default: return nil
    }
  }

  static func set(landscapeOnly locked: Bool) {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    if locked, !landscapeOnly {
      orientationBeforeLock = scenes.first.flatMap { mask(of: $0.interfaceOrientation) }
    }
    landscapeOnly = locked

    // Releasing the lock does not turn the interface by itself. It goes back to the way the
    // phone is held (still landscape on the mount, portrait in the hand), or failing that to
    // where it stood before the lock.
    var wanted = mask
    if !locked, let previous = heldOrientation ?? orientationBeforeLock, !previous.isDisjoint(with: mask) {
      wanted = previous.intersection(mask)
    }
    for scene in scenes {
      for window in scene.windows {
        var controller = window.rootViewController
        while let presented = controller?.presentedViewController { controller = presented }
        controller?.setNeedsUpdateOfSupportedInterfaceOrientations()
      }
      scene.requestGeometryUpdate(.iOS(interfaceOrientations: wanted)) { error in
        NSLog("TriageCapture: the interface could not be rotated: %@", error.localizedDescription)
      }
    }
  }
}

public class OrientationLockAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?
  ) -> UIInterfaceOrientationMask {
    OrientationLock.mask
  }
}
