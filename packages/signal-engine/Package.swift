// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "SignalEngine",
  platforms: [.iOS(.v16), .macOS(.v13)],
  products: [
    .library(name: "SignalEngine", targets: ["SignalEngine"]),
    .executable(name: "engine-cli", targets: ["engine-cli"]),
  ],
  targets: [
    // Sources stay flat in Sources/SignalEngine: SignalEngine.podspec globs that one directory.
    .target(name: "SignalEngine"),
    .executableTarget(name: "engine-cli", dependencies: ["SignalEngine"]),
    .testTarget(name: "SignalEngineTests", dependencies: ["SignalEngine"]),
  ]
)
