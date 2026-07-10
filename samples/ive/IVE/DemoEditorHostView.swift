import SwiftUI
import Foundation

#if canImport(IVEEditorUI) && canImport(IVEEditorCore) && canImport(IVEEditorExport) && canImport(IVEEditorAI)
import IVEEditorUI
import IVEEditorCore
import IVEEditorExport
import IVEEditorAI

struct DemoEditorHostView: View {
    private let project = IVEProjectHandle(displayName: "IVE Demo Project")
    private let services = FileBackedHostServices()

    var body: some View {
        IVEEditorView(
            configuration: IVEEditorConfiguration(
                layoutPolicy: .adaptive,
                autosaveIntervalSeconds: 20,
                defaultExportPresetID: "social-1080p",
                showsSidebar: true
            ),
            project: project,
            services: services
        )
    }
}

final class FileBackedProjectStore: IVEProjectStore {
    private let root: URL
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(root: URL? = nil) {
        let base = root ?? AppDirectories.editorDataDirectory().appendingPathComponent("Projects", isDirectory: true)
        self.root = base
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    }

    func loadSessionSnapshot(for project: IVEProjectHandle) throws -> IVEEditingSessionSnapshot? {
        let url = snapshotURL(for: project)
        guard FileManager.default.fileExists(atPath: url.path) else {
            return nil
        }
        let data = try Data(contentsOf: url)
        return try decoder.decode(IVEEditingSessionSnapshot.self, from: data)
    }

    func saveSessionSnapshot(_ snapshot: IVEEditingSessionSnapshot, for project: IVEProjectHandle) throws {
        try ensureDirectory(root)
        let data = try encoder.encode(snapshot)
        try data.write(to: snapshotURL(for: project), options: [.atomic])
    }

    private func snapshotURL(for project: IVEProjectHandle) -> URL {
        root.appendingPathComponent("\(project.id.uuidString).json")
    }

    private func ensureDirectory(_ url: URL) throws {
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    }
}

final class LocalFilesMediaStore: IVEMediaStore {
    private let root: URL
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(root: URL? = nil) {
        let base = root ?? AppDirectories.editorDataDirectory().appendingPathComponent("MediaIndex", isDirectory: true)
        self.root = base
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    }

    func media(for project: IVEProjectHandle) throws -> [IVEMediaAssetRef] {
        let url = mediaIndexURL(for: project)
        guard FileManager.default.fileExists(atPath: url.path) else {
            return []
        }
        let data = try Data(contentsOf: url)
        return try decoder.decode([IVEMediaAssetRef].self, from: data)
    }

    func ingestMedia(localIdentifier: String, kind: IVEMediaKind, into project: IVEProjectHandle) throws -> IVEMediaAssetRef {
        var current = try media(for: project)
        let asset = IVEMediaAssetRef(kind: kind, localIdentifier: localIdentifier)
        current.append(asset)

        try ensureDirectory(root)
        let data = try encoder.encode(current)
        try data.write(to: mediaIndexURL(for: project), options: [.atomic])

        return asset
    }

    private func mediaIndexURL(for project: IVEProjectHandle) -> URL {
        root.appendingPathComponent("\(project.id.uuidString).json")
    }

    private func ensureDirectory(_ url: URL) throws {
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    }
}

private enum AppDirectories {
    nonisolated static func editorDataDirectory() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let appRoot = base.appendingPathComponent("IVEEditorData", isDirectory: true)
        try? FileManager.default.createDirectory(at: appRoot, withIntermediateDirectories: true)
        return appRoot
    }
}

struct ConsoleTelemetry: IVETelemetrySink {
    func track(event: String, metadata: [String: String]) {
        print("IVE telemetry: \(event) \(metadata)")
    }
}

struct LocalFileExportService: IVEExportService {
    private let root: URL

    init(root: URL? = nil) {
        self.root = root ?? AppDirectories.editorDataDirectory().appendingPathComponent("Exports", isDirectory: true)
    }

    func export(_ job: IVEExportJob) throws -> URL {
        try ensureDirectory(root)
        let fileURL = root.appendingPathComponent("\(job.project.id.uuidString)-\(job.preset.id)-\(Int(Date().timeIntervalSince1970)).iveexport.json")

        let dateFormatter = ISO8601DateFormatter()
        let manifest: [String: Any] = [
            "projectID": job.project.id.uuidString,
            "projectName": job.project.displayName,
            "presetID": job.preset.id,
            "presetTitle": job.preset.title,
            "width": job.preset.width,
            "height": job.preset.height,
            "frameRate": job.preset.frameRate as Any,
            "operationCount": job.snapshot.operations.count,
            "mediaAssetCount": job.snapshot.mediaAssets.count,
            "createdAt": dateFormatter.string(from: Date())
        ]

        let data = try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: fileURL, options: [.atomic])
        return fileURL
    }

    func exportBatch(_ jobs: [IVEExportJob]) throws -> [URL] {
        try jobs.map(export)
    }

    private func ensureDirectory(_ url: URL) throws {
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    }
}

struct BuiltinHeuristicAIProvider: IVEAIProvider {
    func removeBackground(from sourceAssetID: UUID) throws -> UUID {
        UUID()
    }

    func generateCaptions(for sourceAssetID: UUID, languageCode: String?) throws -> [IVECaptionSegment] {
        [
            IVECaptionSegment(startSeconds: 0, endSeconds: 2.5, text: "Intro"),
            IVECaptionSegment(startSeconds: 2.5, endSeconds: 6, text: "Main message"),
            IVECaptionSegment(startSeconds: 6, endSeconds: 9, text: "Call to action")
        ]
    }

    func suggestReframing(for sourceAssetID: UUID, aspectRatio: Double) throws -> [IVEReframeSuggestion] {
        let centerY = aspectRatio > 1 ? 0.48 : 0.52
        return [
            IVEReframeSuggestion(startSeconds: 0, endSeconds: 3, normalizedCenterX: 0.5, normalizedCenterY: centerY),
            IVEReframeSuggestion(startSeconds: 3, endSeconds: 6, normalizedCenterX: 0.48, normalizedCenterY: centerY),
            IVEReframeSuggestion(startSeconds: 6, endSeconds: 9, normalizedCenterX: 0.52, normalizedCenterY: centerY)
        ]
    }
}

struct FileBackedHostServices: IVEHostServices {
    let projectStore: IVEProjectStore = FileBackedProjectStore()
    let mediaStore: IVEMediaStore = LocalFilesMediaStore()
    let exportService: IVEExportService = LocalFileExportService()
    #if DEBUG
    let telemetry: IVETelemetrySink = ConsoleTelemetry()
    #else
    let telemetry: IVETelemetrySink = IVENoopTelemetrySink()
    #endif
    let aiProvider: IVEAIProvider? = BuiltinHeuristicAIProvider()
    let capabilities = IVECapabilitySet(enabledFeatures: Set(IVEFeature.allCases))
}

#else

struct DemoEditorHostView: View {
    var body: some View {
        VStack(spacing: 12) {
            Text("IVE Editor Package Not Linked")
                .font(.headline)
            Text("Add local package: ../IVEEditorPackage and link product IVEEditorUI to the app target.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding()
    }
}

#endif
