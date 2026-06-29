// swift-tools-version: 6.0

import PackageDescription

let package = Package(
  name: "CodeUniverseSwiftSyntaxScanner",
  platforms: [
    .macOS(.v14)
  ],
  products: [
    .executable(name: "scan-swift-syntax", targets: ["ScanSwiftSyntax"])
  ],
  dependencies: [
    .package(url: "https://github.com/swiftlang/swift-syntax.git", branch: "main")
  ],
  targets: [
    .executableTarget(
      name: "ScanSwiftSyntax",
      dependencies: [
        .product(name: "SwiftParser", package: "swift-syntax"),
        .product(name: "SwiftSyntax", package: "swift-syntax")
      ]
    )
  ]
)
