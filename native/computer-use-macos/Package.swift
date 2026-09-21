// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "KoluxComputerUseMacOS",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .library(
            name: "KoluxComputerUseMacOSCore",
            targets: ["KoluxComputerUseMacOSCore"]
        ),
        .executable(
            name: "kolux-computer-use-macos",
            targets: ["KoluxComputerUseMacOS"]
        )
    ],
    targets: [
        .target(
            name: "KoluxComputerUseMacOSCore",
            path: "Sources/KoluxComputerUseMacOSCore"
        ),
        .executableTarget(
            name: "KoluxComputerUseMacOS",
            dependencies: ["KoluxComputerUseMacOSCore"],
            path: "Sources/KoluxComputerUseMacOS"
        ),
        .testTarget(
            name: "KoluxComputerUseMacOSTests",
            dependencies: ["KoluxComputerUseMacOSCore"],
            path: "Tests/KoluxComputerUseMacOSTests"
        )
    ]
)
