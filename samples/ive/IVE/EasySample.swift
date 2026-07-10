//
//  EasySample.swift
//  IVE
//
//  Created by Raymund Vorwerk on 09.04.26.
//

import SwiftUI
import UniformTypeIdentifiers
import AVFoundation
import AVKit
#if os(iOS)
import UIKit
import PhotosUI
#else
import AppKit
#endif

import IVEEditorUI
import IVEEditorCore

struct EasySample: View {
    @State private var isImporterPresented = false
    @State private var selectedFileURL: URL?
    @State private var importErrorMessage: String?
    @State private var editorItem: EditorItem?
    #if os(iOS)
    @State private var photoSelections: [PhotosPickerItem] = []
    @State private var showingPhotosPicker = false
    #endif

    var body: some View {
        VStack(spacing: 16) {
            HStack(spacing: 10) {
                Button("Pick File") {
                    isImporterPresented = true
                }
                .buttonStyle(.borderedProminent)

                #if os(iOS)
                Button("Pick from Photos") {
                    showingPhotosPicker = true
                }
                .buttonStyle(.borderedProminent)
                #endif
            }

            if let url = selectedFileURL {
                Text("Selected: \(url.lastPathComponent)")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)

                mediaPreview(for: url)
                    .contentShape(Rectangle())
                    .onTapGesture {
                    editorItem = EditorItem(url: url)
                    }
            }

            if let importErrorMessage {
                Text(importErrorMessage)
                    .font(.footnote)
                    .foregroundStyle(.red)
            }
        }
        .padding()
        .fileImporter(
            isPresented: $isImporterPresented,
            allowedContentTypes: [.image, .movie],
            allowsMultipleSelection: false
        ) { result in
            switch result {
            case .success(let urls):
                guard let sourceURL = urls.first else {
                    importErrorMessage = "No file selected."
                    selectedFileURL = nil
                    return
                }
                do {
                    let copied = try copyToAppImports(sourceURL)
                    selectedFileURL = copied
                    importErrorMessage = nil
                } catch {
                    selectedFileURL = nil
                    importErrorMessage = error.localizedDescription
                }
            case .failure(let error):
                selectedFileURL = nil
                importErrorMessage = error.localizedDescription
            }
        }
        #if os(iOS)
        .photosPicker(
            isPresented: $showingPhotosPicker,
            selection: $photoSelections,
            maxSelectionCount: 1,
            matching: .any(of: [.images, .videos])
        )
        .onChange(of: photoSelections) { _, newItems in
            importFromPhotosPicker(newItems)
        }
        #endif
        .fullScreenCover(item: $editorItem) { item in
            IVEQuickEditorView(sourceURL: item.url) { result in
                selectedFileURL = result.url
                editorItem = nil
            }
        }
    }

    private func mediaPreview(for url: URL) -> some View {
        ZStack(alignment: .bottomLeading) {
            RoundedRectangle(cornerRadius: 14)
                .fill(.ultraThinMaterial)

            if isVideoURL(url) {
                InlineVideoPreview(url: url)
                    .frame(maxWidth: .infinity, minHeight: 220, maxHeight: 320)
            } else {
                AsyncImage(url: versionedURL(for: url)) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFit()
                    case .failure:
                        Image(systemName: "photo")
                            .resizable()
                            .scaledToFit()
                            .padding(40)
                            .foregroundStyle(.secondary)
                    case .empty:
                        ProgressView()
                    @unknown default:
                        EmptyView()
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 14))
            }

            Text("Tap media to open editor")
                .font(.footnote.weight(.semibold))
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(.thinMaterial, in: Capsule())
                .padding(10)
        }
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .frame(maxWidth: 700)
    }

    private func versionedURL(for url: URL) -> URL {
        let stamp: String = {
            let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
            let modifiedPart: String
            if let modified = attributes?[.modificationDate] as? Date {
                modifiedPart = String(Int(modified.timeIntervalSince1970 * 1000))
            } else {
                modifiedPart = "0"
            }
            let sizePart = String((attributes?[.size] as? NSNumber)?.int64Value ?? 0)
            return "\(modifiedPart)-\(sizePart)"
        }()
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return url
        }
        var queryItems = components.queryItems ?? []
        queryItems.removeAll(where: { $0.name == "ivev" })
        queryItems.append(URLQueryItem(name: "ivev", value: stamp))
        components.queryItems = queryItems
        return components.url ?? url
    }

    private func isVideoURL(_ url: URL) -> Bool {
        guard let type = UTType(filenameExtension: url.pathExtension.lowercased()) else {
            return false
        }
        return type.conforms(to: .movie)
    }

    private func copyToAppImports(_ sourceURL: URL) throws -> URL {
        let didAccess = sourceURL.startAccessingSecurityScopedResource()
        defer { if didAccess { sourceURL.stopAccessingSecurityScopedResource() } }

        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            .appendingPathComponent("EasyExampleImports", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)

        let target = root.appendingPathComponent(
            constrainedFileName(sourceURL: sourceURL, prefix: "easyimp", fallbackExtension: "dat")
        )
        if FileManager.default.fileExists(atPath: target.path) {
            try FileManager.default.removeItem(at: target)
        }
        try FileManager.default.copyItem(at: sourceURL, to: target)
        return target
    }

    #if os(iOS)
    private func importFromPhotosPicker(_ items: [PhotosPickerItem]) {
        defer { photoSelections = [] }
        guard let item = items.first else { return }

        Task {
            do {
                let utType = item.supportedContentTypes.first(where: { $0.conforms(to: .movie) || $0.conforms(to: .image) })
                let copied: URL
                if let utType, utType.conforms(to: .movie) {
                    guard let movie = try await item.loadTransferable(type: PickedMovieFile.self) else {
                        throw NSError(domain: "EasySample", code: 2, userInfo: [NSLocalizedDescriptionKey: "Unable to load selected movie file."])
                    }
                    copied = try copyToAppImports(movie.url)
                } else {
                    guard let data = try await item.loadTransferable(type: Data.self) else {
                        throw NSError(domain: "EasySample", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unable to load selected photo item."])
                    }
                    let ext = utType?.preferredFilenameExtension ?? "jpg"
                    copied = try writeImportedData(data, kind: .image, preferredExtension: ext)
                }
                await MainActor.run {
                    selectedFileURL = copied
                    importErrorMessage = nil
                }
            } catch {
                await MainActor.run {
                    selectedFileURL = nil
                    importErrorMessage = error.localizedDescription
                }
            }
        }
    }
    #endif

    private func writeImportedData(_ data: Data, kind: IVEMediaKind, preferredExtension: String) throws -> URL {
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            .appendingPathComponent("EasyExampleImports", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)

        let prefix: String
        let fallbackExt: String
        switch kind {
        case .image:
            prefix = "easyimg"
            fallbackExt = "jpg"
        case .video:
            prefix = "easyvid"
            fallbackExt = "mov"
        case .audio:
            prefix = "easyaud"
            fallbackExt = "m4a"
        }
        let ext = sanitizedExtension(preferredExtension, fallback: fallbackExt)
        let filename = "\(prefix)-\(String(UUID().uuidString.prefix(8)).lowercased()).\(ext)"
        let url = root.appendingPathComponent(filename)
        try data.write(to: url, options: [.atomic])
        return url
    }

    private func constrainedFileName(sourceURL: URL, prefix: String, fallbackExtension: String) -> String {
        let stem = sanitizedStem(sourceURL.deletingPathExtension().lastPathComponent, fallback: prefix, maxLength: 24)
        let extSource = sourceURL.pathExtension.isEmpty ? fallbackExtension : sourceURL.pathExtension
        let ext = sanitizedExtension(extSource, fallback: fallbackExtension)
        let suffix = String(UUID().uuidString.prefix(8)).lowercased()
        return "\(prefix)-\(stem)-\(suffix).\(ext)"
    }

    private func sanitizedStem(_ input: String, fallback: String, maxLength: Int) -> String {
        let bytes = Array(input.utf8)
        var output: [UInt8] = []
        var previousWasDash = false
        for byte in bytes {
            let lower = (byte >= 65 && byte <= 90) ? byte + 32 : byte
            let isNumber = lower >= 48 && lower <= 57
            let isLetter = lower >= 97 && lower <= 122
            let isDash = lower == 45 || lower == 95
            if isNumber || isLetter || isDash {
                output.append(lower)
                previousWasDash = false
            } else if !previousWasDash {
                output.append(45)
                previousWasDash = true
            }
            if output.count >= maxLength {
                break
            }
        }
        while let first = output.first, first == 45 || first == 95 { output.removeFirst() }
        while let last = output.last, last == 45 || last == 95 { output.removeLast() }
        if output.isEmpty {
            return fallback
        }
        return String(decoding: output, as: UTF8.self)
    }

    private func sanitizedExtension(_ input: String, fallback: String) -> String {
        let filtered = input.lowercased().filter { $0.isASCII && ($0.isLetter || $0.isNumber) }
        if !filtered.isEmpty {
            return String(filtered.prefix(8))
        }
        let fallbackFiltered = fallback.lowercased().filter { $0.isASCII && ($0.isLetter || $0.isNumber) }
        return fallbackFiltered.isEmpty ? "dat" : String(fallbackFiltered.prefix(8))
    }
}

#if os(iOS)
private struct PickedMovieFile: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { movie in
            SentTransferredFile(movie.url)
        } importing: { received in
            let tempRoot = FileManager.default.temporaryDirectory
            let suffix = String(UUID().uuidString.prefix(8)).lowercased()
            let ext = received.file.pathExtension.isEmpty ? "mov" : received.file.pathExtension
            let url = tempRoot.appendingPathComponent("picked-movie-\(suffix).\(ext)")
            if FileManager.default.fileExists(atPath: url.path) {
                try FileManager.default.removeItem(at: url)
            }
            try FileManager.default.copyItem(at: received.file, to: url)
            return Self(url: url)
        }
    }
}
#endif

private struct EditorItem: Identifiable {
    let id = UUID()
    let url: URL
}

private struct InlineVideoPreview: View {
    let url: URL
    @State private var player: AVPlayer?

    var body: some View {
        ZStack {
            if let player {
                VideoPlayer(player: player)
                    .allowsHitTesting(false)
            } else {
                VStack(spacing: 10) {
                    Image(systemName: "film")
                        .font(.system(size: 44))
                    ProgressView()
                }
                .foregroundStyle(.secondary)
            }
        }
        .task(id: url) {
            let next = AVPlayer(url: url)
            next.isMuted = true
            next.actionAtItemEnd = .none
            player = next
            next.play()
        }
        .onDisappear {
            player?.pause()
        }
    }
}

#Preview {
    EasySample()
}
