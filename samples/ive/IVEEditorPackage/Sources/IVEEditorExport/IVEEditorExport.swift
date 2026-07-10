import Foundation
import IVEEditorCore
import IVEEditorMedia

public enum IVEExportContainer: Sendable, Equatable {
    case mp4
    case mov
    case png
    case jpeg
}

public enum IVEVideoCodec: Sendable, Equatable {
    case h264
    case hevc
    case proRes422
}

public struct IVEExportPreset: Sendable, Equatable {
    public let id: String
    public let title: String
    public let width: Int
    public let height: Int
    public let frameRate: Int?
    public let container: IVEExportContainer
    public let codec: IVEVideoCodec?
    public let requiresFeature: IVEFeature?

    public init(
        id: String,
        title: String,
        width: Int,
        height: Int,
        frameRate: Int? = nil,
        container: IVEExportContainer,
        codec: IVEVideoCodec? = nil,
        requiresFeature: IVEFeature? = nil
    ) {
        self.id = id
        self.title = title
        self.width = width
        self.height = height
        self.frameRate = frameRate
        self.container = container
        self.codec = codec
        self.requiresFeature = requiresFeature
    }

    public static let social1080p = IVEExportPreset(
        id: "social-1080p",
        title: "Social 1080p",
        width: 1920,
        height: 1080,
        frameRate: 30,
        container: .mp4,
        codec: .h264
    )

    public static let verticalShort = IVEExportPreset(
        id: "vertical-1080x1920",
        title: "Vertical Short",
        width: 1080,
        height: 1920,
        frameRate: 30,
        container: .mp4,
        codec: .hevc
    )

    public static let proResMaster = IVEExportPreset(
        id: "prores-master",
        title: "ProRes Master",
        width: 3840,
        height: 2160,
        frameRate: 60,
        container: .mov,
        codec: .proRes422,
        requiresFeature: .proCodecExport
    )
}

public struct IVEExportJob: Sendable, Equatable {
    public let project: IVEProjectHandle
    public let snapshot: IVEEditingSessionSnapshot
    public let preset: IVEExportPreset

    public init(project: IVEProjectHandle, snapshot: IVEEditingSessionSnapshot, preset: IVEExportPreset) {
        self.project = project
        self.snapshot = snapshot
        self.preset = preset
    }
}

public protocol IVEExportService {
    func export(_ job: IVEExportJob) throws -> URL
    func exportBatch(_ jobs: [IVEExportJob]) throws -> [URL]
}

public enum IVEExportPlannerError: Error, Equatable {
    case presetUnavailable
    case featureUnavailable(IVEFeature)
}

public struct IVEExportPlanner {
    public var presets: [IVEExportPreset]

    public init(presets: [IVEExportPreset] = [.social1080p, .verticalShort, .proResMaster]) {
        self.presets = presets
    }

    public func resolvePreset(id: String, capabilities: IVECapabilitySet) throws -> IVEExportPreset {
        guard let preset = presets.first(where: { $0.id == id }) else {
            throw IVEExportPlannerError.presetUnavailable
        }
        if let required = preset.requiresFeature, !capabilities.allows(required) {
            throw IVEExportPlannerError.featureUnavailable(required)
        }
        return preset
    }

    public func makeJob(
        project: IVEProjectHandle,
        snapshot: IVEEditingSessionSnapshot,
        preferredPresetID: String,
        capabilities: IVECapabilitySet
    ) throws -> IVEExportJob {
        let preset = try resolvePreset(id: preferredPresetID, capabilities: capabilities)
        return IVEExportJob(project: project, snapshot: snapshot, preset: preset)
    }
}
