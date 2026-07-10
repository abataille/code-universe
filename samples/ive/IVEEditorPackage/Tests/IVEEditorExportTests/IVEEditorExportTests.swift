import XCTest
@testable import IVEEditorCore
@testable import IVEEditorExport

final class IVEEditorExportTests: XCTestCase {
    func testPresetResolutionWithFeatureGate() throws {
        let planner = IVEExportPlanner()
        let freeCapabilities = IVECapabilitySet(enabledFeatures: [.imageAdjustments, .videoTimeline])

        XCTAssertThrowsError(try planner.resolvePreset(id: "prores-master", capabilities: freeCapabilities))

        let proCapabilities = IVECapabilitySet(enabledFeatures: Set(IVEFeature.allCases))
        let preset = try planner.resolvePreset(id: "prores-master", capabilities: proCapabilities)
        XCTAssertEqual(preset.codec, .proRes422)
    }

    func testMakeJobUsesResolvedPreset() throws {
        let planner = IVEExportPlanner()
        let project = IVEProjectHandle(displayName: "Demo")
        let snapshot = IVEEditingSessionSnapshot(
            projectID: project.id,
            timeline: .init(),
            operations: [],
            mediaAssets: []
        )

        let job = try planner.makeJob(
            project: project,
            snapshot: snapshot,
            preferredPresetID: "social-1080p",
            capabilities: IVECapabilitySet(enabledFeatures: Set(IVEFeature.allCases))
        )

        XCTAssertEqual(job.preset.id, "social-1080p")
        XCTAssertEqual(job.project.id, project.id)
    }
}
