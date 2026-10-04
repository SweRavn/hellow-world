// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "Graft",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        // Spec model, expression engine, validator, Graft engine. Foundation only.
        .library(name: "GraftCore", targets: ["GraftCore"]),
        // SwiftUI renderer, GraftSlotView and the end-user VibeSheet.
        .library(name: "GraftUI", targets: ["GraftUI"]),
    ],
    targets: [
        .target(name: "GraftCore"),
        .target(name: "GraftUI", dependencies: ["GraftCore"]),
        .testTarget(name: "GraftCoreTests", dependencies: ["GraftCore"]),
    ]
)
