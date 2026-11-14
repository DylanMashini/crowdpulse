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
    )
  ]
)
