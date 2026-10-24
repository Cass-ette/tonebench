// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "ToneBench",
  platforms: [.macOS("14.2")],
  products: [.executable(name: "ToneBench", targets: ["ToneBench"])],
  targets: [
    .target(
      name: "ToneDSP", publicHeadersPath: "include",
      linkerSettings: [.linkedFramework("CoreAudio"), .linkedFramework("Accelerate")]),
    .target(name: "ToneStems", linkerSettings: [.linkedFramework("AVFoundation")]),
    .executableTarget(
      name: "ToneBench", dependencies: ["ToneDSP", "ToneStems"],
      linkerSettings: [.linkedFramework("AppKit"), .linkedFramework("WebKit")]),
    .testTarget(name: "ToneDSPTests", dependencies: ["ToneDSP"]),
    .testTarget(name: "ToneStemsTests", dependencies: ["ToneStems"]),
  ]
)
