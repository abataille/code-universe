import Foundation
import IVEEditorAI

public enum IVEFeature: String, CaseIterable, Sendable, Codable {
    case imageAdjustments
    case videoTimeline
    case audioEditing
    case masksAndCompositing
    case aiTools
    case batchExport
    case proCodecExport
    case templates
}

public struct IVECapabilitySet: Sendable, Equatable, Codable {
    public var enabledFeatures: Set<IVEFeature>

    public init(enabledFeatures: Set<IVEFeature> = Set(IVEFeature.allCases)) {
        self.enabledFeatures = enabledFeatures
    }

    public func allows(_ feature: IVEFeature) -> Bool {
        enabledFeatures.contains(feature)
    }
}

public enum IVEEditorLayoutPolicy: Sendable, Equatable, Codable {
    case adaptive
    case compactPhone
    case multiPanelTabletAndDesktop
}

public enum IVEEditorEntryMode: Sendable, Equatable, Codable {
    case library
    case imageEditor
    case videoEditor
}

public struct IVEEditorConfiguration: Sendable, Equatable, Codable {
    public var layoutPolicy: IVEEditorLayoutPolicy
    public var autosaveIntervalSeconds: TimeInterval
    public var defaultExportPresetID: String
    public var entryMode: IVEEditorEntryMode
    public var showsSidebar: Bool

    public init(
        layoutPolicy: IVEEditorLayoutPolicy = .adaptive,
        autosaveIntervalSeconds: TimeInterval = 20,
        defaultExportPresetID: String = "social-1080p",
        entryMode: IVEEditorEntryMode = .library,
        showsSidebar: Bool = true
    ) {
        self.layoutPolicy = layoutPolicy
        self.autosaveIntervalSeconds = autosaveIntervalSeconds
        self.defaultExportPresetID = defaultExportPresetID
        self.entryMode = entryMode
        self.showsSidebar = showsSidebar
    }
}

public struct IVEProjectHandle: Sendable, Equatable, Hashable, Codable {
    public let id: UUID
    public var displayName: String

    public init(id: UUID = UUID(), displayName: String) {
        self.id = id
        self.displayName = displayName
    }
}

public enum IVEMediaKind: Sendable, Equatable, Hashable, Codable {
    case image
    case video
    case audio
}

public struct IVEMediaAssetRef: Sendable, Equatable, Hashable, Codable {
    public let id: UUID
    public let kind: IVEMediaKind
    public var localIdentifier: String

    public init(id: UUID = UUID(), kind: IVEMediaKind, localIdentifier: String) {
        self.id = id
        self.kind = kind
        self.localIdentifier = localIdentifier
    }
}

public protocol IVEProjectStore {
    func loadSessionSnapshot(for project: IVEProjectHandle) throws -> IVEEditingSessionSnapshot?
    func saveSessionSnapshot(_ snapshot: IVEEditingSessionSnapshot, for project: IVEProjectHandle) throws
}

public protocol IVEMediaStore {
    func media(for project: IVEProjectHandle) throws -> [IVEMediaAssetRef]
    func ingestMedia(localIdentifier: String, kind: IVEMediaKind, into project: IVEProjectHandle) throws -> IVEMediaAssetRef
}

public protocol IVETelemetrySink: Sendable {
    func track(event: String, metadata: [String: String])
}

public struct IVENoopTelemetrySink: IVETelemetrySink {
    public init() {}

    public func track(event: String, metadata: [String: String]) {}
}

public struct IVEVideoClip: Sendable, Equatable, Codable {
    public let id: UUID
    public let assetID: UUID
    public var startSeconds: Double
    public var durationSeconds: Double

    public init(id: UUID = UUID(), assetID: UUID, startSeconds: Double, durationSeconds: Double) {
        self.id = id
        self.assetID = assetID
        self.startSeconds = startSeconds
        self.durationSeconds = durationSeconds
    }

    public var endSeconds: Double {
        startSeconds + durationSeconds
    }
}

public struct IVEVideoTimeline: Sendable, Equatable, Codable {
    public var clips: [IVEVideoClip]

    public init(clips: [IVEVideoClip] = []) {
        self.clips = clips.sorted { $0.startSeconds < $1.startSeconds }
    }

    public func trimmed(clipID: UUID, newStart: Double, newDuration: Double) -> IVEVideoTimeline {
        var copy = self
        guard let index = copy.clips.firstIndex(where: { $0.id == clipID }) else {
            return copy
        }
        copy.clips[index].durationSeconds = max(0.1, newDuration)
        return copy
    }

    public func split(clipID: UUID, at absoluteTime: Double) -> IVEVideoTimeline {
        var copy = self
        guard let index = copy.clips.firstIndex(where: { $0.id == clipID }) else {
            return copy
        }

        let clip = copy.clips[index]
        guard absoluteTime > clip.startSeconds, absoluteTime < clip.endSeconds else {
            return copy
        }

        let leftDuration = absoluteTime - clip.startSeconds
        let rightDuration = clip.durationSeconds - leftDuration

        copy.clips[index].durationSeconds = leftDuration
        let rightClip = IVEVideoClip(assetID: clip.assetID, startSeconds: absoluteTime, durationSeconds: rightDuration)
        copy.clips.insert(rightClip, at: index + 1)
        return copy
    }

    public func rippleDelete(clipID: UUID) -> IVEVideoTimeline {
        guard let index = clips.firstIndex(where: { $0.id == clipID }) else {
            return self
        }
        let removed = clips[index]
        let shiftBy = removed.durationSeconds

        var updated = clips
        updated.remove(at: index)
        for idx in updated.indices {
            if updated[idx].startSeconds > removed.startSeconds {
                updated[idx].startSeconds -= shiftBy
            }
        }
        return IVEVideoTimeline(clips: updated)
    }
}

public struct IVEKeyframe: Sendable, Equatable, Codable {
    public let timeSeconds: Double
    public let value: Double

    public init(timeSeconds: Double, value: Double) {
        self.timeSeconds = timeSeconds
        self.value = value
    }
}

public struct IVEKeyframedScalar: Sendable, Equatable, Codable {
    public var keyframes: [IVEKeyframe]

    public init(keyframes: [IVEKeyframe]) {
        self.keyframes = keyframes.sorted { $0.timeSeconds < $1.timeSeconds }
    }

    public func value(at timeSeconds: Double) -> Double {
        guard let first = keyframes.first else {
            return 0
        }
        guard let last = keyframes.last else {
            return first.value
        }

        if timeSeconds <= first.timeSeconds {
            return first.value
        }
        if timeSeconds >= last.timeSeconds {
            return last.value
        }

        for index in 0..<(keyframes.count - 1) {
            let lhs = keyframes[index]
            let rhs = keyframes[index + 1]
            if timeSeconds >= lhs.timeSeconds, timeSeconds <= rhs.timeSeconds {
                let distance = rhs.timeSeconds - lhs.timeSeconds
                if distance == 0 {
                    return rhs.value
                }
                let progress = (timeSeconds - lhs.timeSeconds) / distance
                return lhs.value + ((rhs.value - lhs.value) * progress)
            }
        }

        return last.value
    }
}

public enum IVEImageFilterPreset: String, Sendable, Equatable, Codable, CaseIterable {
    case none
    case mono
    case vivid
    case warm
    case cool
    case dramatic
    case noir
    case faded
    case vintage
    case punch
    case tealOrange
    case sepia
}

public struct IVENormalizedRect: Sendable, Equatable, Codable {
    public var x: Double
    public var y: Double
    public var width: Double
    public var height: Double

    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }

    public static let full = IVENormalizedRect(x: 0, y: 0, width: 1, height: 1)
}

public enum IVEVideoCropMode: String, Sendable, Equatable, Codable, CaseIterable {
    case fit
    case trueCrop
}

public struct IVEColorCurveSettings: Sendable, Equatable, Codable {
    public var masterShadows: Double
    public var masterMidtones: Double
    public var masterHighlights: Double
    public var redShadows: Double
    public var redMidtones: Double
    public var redHighlights: Double
    public var greenShadows: Double
    public var greenMidtones: Double
    public var greenHighlights: Double
    public var blueShadows: Double
    public var blueMidtones: Double
    public var blueHighlights: Double
    public var blackPoint: Double
    public var whitePoint: Double

    public init(
        masterShadows: Double = 0,
        masterMidtones: Double = 0,
        masterHighlights: Double = 0,
        redShadows: Double = 0,
        redMidtones: Double = 0,
        redHighlights: Double = 0,
        greenShadows: Double = 0,
        greenMidtones: Double = 0,
        greenHighlights: Double = 0,
        blueShadows: Double = 0,
        blueMidtones: Double = 0,
        blueHighlights: Double = 0,
        blackPoint: Double = 0,
        whitePoint: Double = 1
    ) {
        self.masterShadows = masterShadows
        self.masterMidtones = masterMidtones
        self.masterHighlights = masterHighlights
        self.redShadows = redShadows
        self.redMidtones = redMidtones
        self.redHighlights = redHighlights
        self.greenShadows = greenShadows
        self.greenMidtones = greenMidtones
        self.greenHighlights = greenHighlights
        self.blueShadows = blueShadows
        self.blueMidtones = blueMidtones
        self.blueHighlights = blueHighlights
        self.blackPoint = blackPoint
        self.whitePoint = whitePoint
    }

    public static let identity = IVEColorCurveSettings()
}

public enum IVEEditOperation: Sendable, Equatable, Codable {
    case imageExposure(assetID: UUID, value: Double)
    case imageContrast(assetID: UUID, value: Double)
    case imageSaturation(assetID: UUID, value: Double)
    case imageTemperature(assetID: UUID, value: Double)
    case imageTint(assetID: UUID, value: Double)
    case imageCurveShadows(assetID: UUID, value: Double)
    case imageCurveMidtones(assetID: UUID, value: Double)
    case imageCurveHighlights(assetID: UUID, value: Double)
    case imageColorCurve(assetID: UUID, settings: IVEColorCurveSettings)
    case imageDenoise(assetID: UUID, value: Double)
    case imageSharpen(assetID: UUID, value: Double)
    case imageRotation(assetID: UUID, degrees: Double)
    case imageMirrorHorizontal(assetID: UUID)
    case imageMirrorVertical(assetID: UUID)
    case imageCrop(assetID: UUID, rect: IVENormalizedRect, scale: Double)
    case imageFilter(assetID: UUID, preset: IVEImageFilterPreset)
    case videoTrim(clipID: UUID, start: Double, duration: Double)
    case videoExposure(assetID: UUID, value: Double)
    case videoContrast(assetID: UUID, value: Double)
    case videoSaturation(assetID: UUID, value: Double)
    case videoTemperature(assetID: UUID, value: Double)
    case videoTint(assetID: UUID, value: Double)
    case videoCurveShadows(assetID: UUID, value: Double)
    case videoCurveMidtones(assetID: UUID, value: Double)
    case videoCurveHighlights(assetID: UUID, value: Double)
    case videoColorCurve(assetID: UUID, settings: IVEColorCurveSettings)
    case videoRotation(assetID: UUID, degrees: Double)
    case videoMirrorHorizontal(assetID: UUID)
    case videoMirrorVertical(assetID: UUID)
    case videoFilter(assetID: UUID, preset: IVEImageFilterPreset)
    case videoCrop(assetID: UUID, rect: IVENormalizedRect, scale: Double)
    case videoCropMode(assetID: UUID, mode: IVEVideoCropMode)
    case applyCaptions(assetID: UUID, captions: [IVECaptionSegment])
}

public struct IVEEditingSessionSnapshot: Sendable, Equatable, Codable {
    public var projectID: UUID
    public var timeline: IVEVideoTimeline
    public var operations: [IVEEditOperation]
    public var mediaAssets: [IVEMediaAssetRef]
    public var savedAt: Date

    public init(
        projectID: UUID,
        timeline: IVEVideoTimeline,
        operations: [IVEEditOperation],
        mediaAssets: [IVEMediaAssetRef],
        savedAt: Date = Date()
    ) {
        self.projectID = projectID
        self.timeline = timeline
        self.operations = operations
        self.mediaAssets = mediaAssets
        self.savedAt = savedAt
    }
}

public final class IVEEditingSession {
    public private(set) var snapshot: IVEEditingSessionSnapshot
    private var undoStack: [IVEEditingSessionSnapshot] = []
    private var redoStack: [IVEEditingSessionSnapshot] = []

    public init(snapshot: IVEEditingSessionSnapshot) {
        self.snapshot = snapshot
    }

    public func updateMediaAssets(_ mediaAssets: [IVEMediaAssetRef]) {
        snapshot.mediaAssets = mediaAssets
        snapshot.savedAt = Date()
    }

    @discardableResult
    public func replaceMediaAssetLocalIdentifier(assetID: UUID, localIdentifier: String) -> Bool {
        guard let index = snapshot.mediaAssets.firstIndex(where: { $0.id == assetID }) else {
            return false
        }
        guard snapshot.mediaAssets[index].localIdentifier != localIdentifier else {
            return false
        }
        undoStack.append(snapshot)
        redoStack.removeAll()
        snapshot.mediaAssets[index].localIdentifier = localIdentifier
        snapshot.savedAt = Date()
        return true
    }

    public func apply(_ operation: IVEEditOperation) {
        undoStack.append(snapshot)
        redoStack.removeAll()
        applyWithoutHistory(operation)
        snapshot.savedAt = Date()
    }

    public func applyMany(_ operations: [IVEEditOperation]) {
        guard !operations.isEmpty else { return }
        undoStack.append(snapshot)
        redoStack.removeAll()
        for operation in operations {
            applyWithoutHistory(operation)
        }
        snapshot.savedAt = Date()
    }

    public func canUndo() -> Bool {
        !undoStack.isEmpty
    }

    public func canRedo() -> Bool {
        !redoStack.isEmpty
    }

    private func applyWithoutHistory(_ operation: IVEEditOperation) {
        switch operation {
        case .imageExposure,
             .imageContrast,
             .imageSaturation,
             .imageTemperature,
             .imageTint,
             .imageCurveShadows,
             .imageCurveMidtones,
             .imageCurveHighlights,
             .imageColorCurve,
             .imageDenoise,
             .imageSharpen,
             .imageRotation,
             .imageMirrorHorizontal,
             .imageMirrorVertical,
             .imageCrop,
             .imageFilter:
            snapshot.operations.append(operation)
        case .videoExposure,
             .videoContrast,
             .videoSaturation,
             .videoTemperature,
             .videoTint,
             .videoCurveShadows,
             .videoCurveMidtones,
             .videoCurveHighlights,
             .videoColorCurve,
             .videoRotation,
             .videoMirrorHorizontal,
             .videoMirrorVertical,
             .videoFilter,
             .videoCrop,
             .videoCropMode:
            snapshot.operations.append(operation)
        case let .videoTrim(clipID, start, duration):
            snapshot.timeline = snapshot.timeline.trimmed(clipID: clipID, newStart: start, newDuration: duration)
            snapshot.operations.append(operation)
        case .applyCaptions:
            snapshot.operations.append(operation)
        }
    }

    @discardableResult
    public func undo() -> IVEEditingSessionSnapshot? {
        guard let previous = undoStack.popLast() else {
            return nil
        }
        redoStack.append(snapshot)
        snapshot = previous
        return snapshot
    }

    @discardableResult
    public func redo() -> IVEEditingSessionSnapshot? {
        guard let next = redoStack.popLast() else {
            return nil
        }
        undoStack.append(snapshot)
        snapshot = next
        return snapshot
    }
}
