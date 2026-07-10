import XCTest
@testable import IVEEditorCore

final class IVEEditorCoreTests: XCTestCase {
    private struct EffectiveImageState: Equatable {
        var exposure: Double = 0
        var contrast: Double = 1
        var saturation: Double = 1
        var denoise: Double = 0
        var sharpen: Double = 0
        var rotation: Double = 0
        var mirrorHorizontal = false
        var mirrorVertical = false
        var cropRect: IVENormalizedRect = .full
        var scale: Double = 1
        var filter: IVEImageFilterPreset = .none
    }

    private func effectiveImageState(from operations: [IVEEditOperation], imageID: UUID) -> EffectiveImageState {
        operations.reduce(into: EffectiveImageState()) { state, operation in
            switch operation {
            case let .imageExposure(assetID, value) where assetID == imageID:
                state.exposure += value
            case let .imageContrast(assetID, value) where assetID == imageID:
                state.contrast *= value
            case let .imageSaturation(assetID, value) where assetID == imageID:
                state.saturation *= value
            case let .imageDenoise(assetID, value) where assetID == imageID:
                state.denoise += value
            case let .imageSharpen(assetID, value) where assetID == imageID:
                state.sharpen += value
            case let .imageRotation(assetID, degrees) where assetID == imageID:
                state.rotation += degrees
            case let .imageMirrorHorizontal(assetID) where assetID == imageID:
                state.mirrorHorizontal.toggle()
            case let .imageMirrorVertical(assetID) where assetID == imageID:
                state.mirrorVertical.toggle()
            case let .imageCrop(assetID, rect, scale) where assetID == imageID:
                state.cropRect = rect
                state.scale = scale
            case let .imageFilter(assetID, preset) where assetID == imageID:
                state.filter = preset
            default:
                break
            }
        }
    }

    private func makeImageSession(imageID: UUID = UUID()) -> IVEEditingSession {
        IVEEditingSession(snapshot: IVEEditingSessionSnapshot(
            projectID: UUID(),
            timeline: .init(),
            operations: [],
            mediaAssets: [
                IVEMediaAssetRef(id: imageID, kind: .image, localIdentifier: "/tmp/example.jpg")
            ]
        ))
    }

    private func currentImageState(session: IVEEditingSession, imageID: UUID) -> EffectiveImageState {
        let snapshot = session.snapshot
        return effectiveImageState(from: snapshot.operations, imageID: imageID)
    }

    func testUndoRedoDeterminism() throws {
        let clipID = UUID()
        let timeline = IVEVideoTimeline(clips: [
            IVEVideoClip(id: clipID, assetID: UUID(), startSeconds: 0, durationSeconds: 12)
        ])
        let snapshot = IVEEditingSessionSnapshot(
            projectID: UUID(),
            timeline: timeline,
            operations: [],
            mediaAssets: []
        )
        let session = IVEEditingSession(snapshot: snapshot)

        session.apply(.videoTrim(clipID: clipID, start: 1, duration: 8))
        let afterApply = session.snapshot
        XCTAssertEqual(afterApply.timeline.clips.first?.startSeconds, 0)
        XCTAssertEqual(afterApply.timeline.clips.first?.durationSeconds, 8)
        XCTAssertEqual(afterApply.operations.last, .videoTrim(clipID: clipID, start: 1, duration: 8))

        let afterUndo = session.undo()
        XCTAssertEqual(afterUndo?.timeline.clips.first?.startSeconds, 0)
        XCTAssertEqual(afterUndo?.timeline.clips.first?.durationSeconds, 12)

        let afterRedo = session.redo()
        XCTAssertEqual(afterRedo?.timeline.clips.first?.startSeconds, 0)
        XCTAssertEqual(afterRedo?.timeline.clips.first?.durationSeconds, 8)
    }

    func testSplitAndRippleDeleteRules() {
        let clipA = IVEVideoClip(id: UUID(), assetID: UUID(), startSeconds: 0, durationSeconds: 6)
        let clipB = IVEVideoClip(id: UUID(), assetID: UUID(), startSeconds: 6, durationSeconds: 4)

        let timeline = IVEVideoTimeline(clips: [clipA, clipB])
        let split = timeline.split(clipID: clipA.id, at: 3)

        XCTAssertEqual(split.clips.count, 3)
        XCTAssertEqual(split.clips[0].durationSeconds, 3, accuracy: 0.0001)
        XCTAssertEqual(split.clips[1].startSeconds, 3, accuracy: 0.0001)
        XCTAssertEqual(split.clips[1].durationSeconds, 3, accuracy: 0.0001)

        let rippled = split.rippleDelete(clipID: split.clips[1].id)
        XCTAssertEqual(rippled.clips.count, 2)
        XCTAssertEqual(rippled.clips[1].startSeconds, 3, accuracy: 0.0001)
    }

    func testLinearKeyframeInterpolation() {
        let curve = IVEKeyframedScalar(keyframes: [
            IVEKeyframe(timeSeconds: 0, value: 0),
            IVEKeyframe(timeSeconds: 10, value: 100)
        ])

        XCTAssertEqual(curve.value(at: -1), 0)
        XCTAssertEqual(curve.value(at: 0), 0)
        XCTAssertEqual(curve.value(at: 5), 50, accuracy: 0.0001)
        XCTAssertEqual(curve.value(at: 10), 100)
        XCTAssertEqual(curve.value(at: 20), 100)
    }

    func testImageAdjustmentOperationsArePersistedAndUndoable() {
        let imageID = UUID()
        let session = IVEEditingSession(snapshot: IVEEditingSessionSnapshot(
            projectID: UUID(),
            timeline: .init(),
            operations: [],
            mediaAssets: [
                IVEMediaAssetRef(id: imageID, kind: .image, localIdentifier: "/tmp/example.jpg")
            ]
        ))

        session.apply(.imageExposure(assetID: imageID, value: 0.4))
        session.apply(.imageContrast(assetID: imageID, value: 1.2))
        session.apply(.imageSaturation(assetID: imageID, value: 0.8))
        session.apply(.imageRotation(assetID: imageID, degrees: 90))
        session.apply(.imageMirrorHorizontal(assetID: imageID))
        session.apply(.imageMirrorVertical(assetID: imageID))
        session.apply(.imageFilter(assetID: imageID, preset: .vivid))

        let snapshotAfterApply = session.snapshot
        XCTAssertEqual(snapshotAfterApply.operations.count, 7)

        _ = session.undo()
        let snapshotAfterUndo = session.snapshot
        XCTAssertEqual(snapshotAfterUndo.operations.count, 6)

        _ = session.redo()
        let snapshotAfterRedo = session.snapshot
        XCTAssertEqual(snapshotAfterRedo.operations.count, 7)
    }

    func testAdjustToolApplyUndoRedoResetCycle() {
        let imageID = UUID()
        let session = makeImageSession(imageID: imageID)

        session.applyMany([
            .imageExposure(assetID: imageID, value: 0.4),
            .imageContrast(assetID: imageID, value: 1.3),
            .imageSaturation(assetID: imageID, value: 0.85),
            .imageDenoise(assetID: imageID, value: 0.2),
            .imageSharpen(assetID: imageID, value: 0.35)
        ])

        let appliedState = currentImageState(session: session, imageID: imageID)
        XCTAssertNotEqual(appliedState, EffectiveImageState())

        _ = session.undo()
        let stateAfterUndo = currentImageState(session: session, imageID: imageID)
        XCTAssertEqual(stateAfterUndo, EffectiveImageState())

        _ = session.redo()
        let stateAfterRedo = currentImageState(session: session, imageID: imageID)
        XCTAssertEqual(stateAfterRedo, appliedState)

        session.applyMany([
            .imageExposure(assetID: imageID, value: -appliedState.exposure),
            .imageContrast(assetID: imageID, value: 1 / appliedState.contrast),
            .imageSaturation(assetID: imageID, value: 1 / appliedState.saturation),
            .imageDenoise(assetID: imageID, value: -appliedState.denoise),
            .imageSharpen(assetID: imageID, value: -appliedState.sharpen)
        ])
        let stateAfterReset = currentImageState(session: session, imageID: imageID)
        XCTAssertEqual(stateAfterReset, EffectiveImageState())

        _ = session.undo()
        let stateAfterResetUndo = currentImageState(session: session, imageID: imageID)
        XCTAssertEqual(stateAfterResetUndo, appliedState)
        _ = session.redo()
        let stateAfterResetRedo = currentImageState(session: session, imageID: imageID)
        XCTAssertEqual(stateAfterResetRedo, EffectiveImageState())
    }

    func testCropToolApplyUndoRedoResetCycle() {
        let imageID = UUID()
        let session = makeImageSession(imageID: imageID)
        let cropRect = IVENormalizedRect(x: 0.2, y: 0.2, width: 0.6, height: 0.6)

        session.apply(.imageCrop(assetID: imageID, rect: cropRect, scale: 1))
        var croppedState = EffectiveImageState()
        croppedState.cropRect = cropRect
        let stateAfterApply = currentImageState(session: session, imageID: imageID)
        XCTAssertEqual(stateAfterApply, croppedState)

        _ = session.undo()
        let stateAfterUndo = currentImageState(session: session, imageID: imageID)
        XCTAssertEqual(stateAfterUndo, EffectiveImageState())

        _ = session.redo()
        let stateAfterRedo = currentImageState(session: session, imageID: imageID)
        XCTAssertEqual(stateAfterRedo, croppedState)

        session.apply(.imageCrop(assetID: imageID, rect: .full, scale: 1))
        let stateAfterReset = currentImageState(session: session, imageID: imageID)
        XCTAssertEqual(stateAfterReset, EffectiveImageState())
    }

    func testStyleToolApplyUndoRedoResetCycle() {
        let imageID = UUID()
        let session = makeImageSession(imageID: imageID)

        session.apply(.imageFilter(assetID: imageID, preset: .vivid))
        let stateAfterApply = currentImageState(session: session, imageID: imageID)
        XCTAssertEqual(stateAfterApply.filter, .vivid)

        _ = session.undo()
        let stateAfterUndo = currentImageState(session: session, imageID: imageID)
        XCTAssertEqual(stateAfterUndo, EffectiveImageState())

        _ = session.redo()
        var expected = EffectiveImageState()
        expected.filter = .vivid
        let stateAfterRedo = currentImageState(session: session, imageID: imageID)
        XCTAssertEqual(stateAfterRedo, expected)

        session.apply(.imageFilter(assetID: imageID, preset: .none))
        let stateAfterReset = currentImageState(session: session, imageID: imageID)
        XCTAssertEqual(stateAfterReset, EffectiveImageState())
    }

    func testMediaAssetReplacementIsUndoableAndRedoable() {
        let imageID = UUID()
        let original = "/tmp/original.jpg"
        let replaced = "/tmp/replaced.png"
        let session = IVEEditingSession(snapshot: IVEEditingSessionSnapshot(
            projectID: UUID(),
            timeline: .init(),
            operations: [],
            mediaAssets: [IVEMediaAssetRef(id: imageID, kind: .image, localIdentifier: original)]
        ))

        let didReplace = session.replaceMediaAssetLocalIdentifier(assetID: imageID, localIdentifier: replaced)
        XCTAssertTrue(didReplace)
        var snapshot = session.snapshot
        XCTAssertEqual(snapshot.mediaAssets.first?.localIdentifier, replaced)

        _ = session.undo()
        snapshot = session.snapshot
        XCTAssertEqual(snapshot.mediaAssets.first?.localIdentifier, original)

        _ = session.redo()
        snapshot = session.snapshot
        XCTAssertEqual(snapshot.mediaAssets.first?.localIdentifier, replaced)
    }

    func testTransformToolApplyUndoRedoResetCycle() {
        let imageID = UUID()
        let session = makeImageSession(imageID: imageID)

        session.applyMany([
            .imageRotation(assetID: imageID, degrees: 45),
            .imageMirrorHorizontal(assetID: imageID),
            .imageMirrorVertical(assetID: imageID)
        ])
        var transformed = EffectiveImageState()
        transformed.rotation = 45
        transformed.mirrorHorizontal = true
        transformed.mirrorVertical = true
        let stateAfterApply = currentImageState(session: session, imageID: imageID)
        XCTAssertEqual(stateAfterApply, transformed)

        _ = session.undo()
        let stateAfterUndo = currentImageState(session: session, imageID: imageID)
        XCTAssertEqual(stateAfterUndo, EffectiveImageState())

        _ = session.redo()
        let stateAfterRedo = currentImageState(session: session, imageID: imageID)
        XCTAssertEqual(stateAfterRedo, transformed)

        session.applyMany([
            .imageRotation(assetID: imageID, degrees: -transformed.rotation),
            .imageMirrorHorizontal(assetID: imageID),
            .imageMirrorVertical(assetID: imageID)
        ])
        let stateAfterReset = currentImageState(session: session, imageID: imageID)
        XCTAssertEqual(stateAfterReset, EffectiveImageState())
    }
}
