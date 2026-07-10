// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "IVEEditorPackage",
    platforms: [
        .iOS(.v18),
        .macOS(.v26)
    ],
    products: [
        .library(name: "IVEEditorUI", targets: ["IVEEditorUI"]),
        .library(name: "IVEEditorCore", targets: ["IVEEditorCore"]),
        .library(name: "IVEEditorMedia", targets: ["IVEEditorMedia"]),
        .library(name: "IVEEditorExport", targets: ["IVEEditorExport"]),
        .library(name: "IVEEditorAI", targets: ["IVEEditorAI"])
    ],
    targets: [
        .target(name: "IVEEditorAI"),
        .target(
            name: "IVEEditorCore",
            dependencies: ["IVEEditorAI"]
        ),
        .target(
            name: "IVEEditorMedia",
            dependencies: ["IVEEditorCore"]
        ),
        .target(
            name: "IVEEditorExport",
            dependencies: ["IVEEditorCore", "IVEEditorMedia"]
        ),
        .target(
            name: "IVEEditorUI",
            dependencies: [
                "IVEEditorCore",
                "IVEEditorMedia",
                "IVEEditorExport",
                "IVEEditorAI"
            ],
            resources: [
                .process("Resources")
            ]
        ),
        .testTarget(
            name: "IVEEditorCoreTests",
            dependencies: ["IVEEditorCore"]
        ),
        .testTarget(
            name: "IVEEditorExportTests",
            dependencies: ["IVEEditorExport", "IVEEditorCore"]
        ),
        .testTarget(
            name: "IVEEditorAITests",
            dependencies: ["IVEEditorAI", "IVEEditorCore"]
        )
    ]
)
