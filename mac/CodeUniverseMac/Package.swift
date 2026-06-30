// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "CodeUniverseMac",
  platforms: [
    .macOS(.v13)
  ],
  products: [
    .executable(name: "CodeUniverseMac", targets: ["CodeUniverseMac"])
  ],
  targets: [
    .executableTarget(name: "CodeUniverseMac")
  ]
)
