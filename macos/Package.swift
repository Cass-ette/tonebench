// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "ToneBench",
  platforms: [.macOS("14.2")],
  products: [.executable(name: "ToneBench", targets: ["ToneBench"])],
  targets: [
    .target(
      name: "ToneDSP", publicHeadersPath: "include",
      linkerSettings: [.linkedFramework("CoreAudio")]),
    .executableTarget(
      name: "ToneBench", dependencies: ["ToneDSP"],
      linkerSettings: [.linkedFramework("AppKit"), .linkedFramework("WebKit")]),
    .testTarget(name: "ToneDSPTests", dependencies: ["ToneDSP"]),
  ]
)
