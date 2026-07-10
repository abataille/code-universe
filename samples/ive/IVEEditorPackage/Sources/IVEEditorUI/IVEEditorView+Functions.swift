import SwiftUI
import AVKit
import AVFoundation
import UniformTypeIdentifiers
import Dispatch
import CoreGraphics
import ImageIO
import CoreImage
import CoreImage.CIFilterBuiltins
import Vision
import IVEEditorCore
import IVEEditorMedia
import IVEEditorExport
import IVEEditorAI

#if os(iOS)
import PhotosUI
import UIKit
#elseif os(macOS)
import AppKit
#endif

enum IVEBackgroundReplacementStyle {
    case white
    case black
    case blurred
}

private func iveLocalized(_ key: String) -> String {
    NSLocalizedString(
        key,
        tableName: "Localizable",
        bundle: .module,
        value: key,
        comment: ""
    )
}

extension IVEEditorView {
    var selectedLibraryAsset: IVEMediaAssetRef? {
        if let id = selectedLibraryAssetID {
            return importedAssets.first(where: { $0.id == id })
        }
        return importedAssets.first
    }

    var selectedImageAsset: IVEMediaAssetRef? {
        if let id = selectedImageAssetID {
            return importedAssets.first(where: { $0.id == id })
        }
        return importedAssets.first(where: { $0.kind == .image })
    }

    var selectedVideoAsset: IVEMediaAssetRef? {
        if let selectedVideoAssetID {
            return importedAssets.first(where: { $0.id == selectedVideoAssetID })
        }
        if let clipID = selectedClipID,
           let clip = snapshot?.timeline.clips.first(where: { $0.id == clipID }) {
            return importedAssets.first(where: { $0.id == clip.assetID })
        }
        return importedAssets.first(where: { $0.kind == .video })
    }

    var selectedTimelineClip: IVEVideoClip? {
        guard let selectedClipID else { return nil }
        return snapshot?.timeline.clips.first(where: { $0.id == selectedClipID })
    }

    var selectedVideoDurationSeconds: Double {
        guard let asset = selectedVideoAsset,
              let url = displayURL(for: asset) else {
            return max(1, trimStart + trimDuration)
        }
        let seconds = videoDurationByURL[url.absoluteString] ?? 0
        guard seconds.isFinite, seconds > 0 else {
            return max(1, trimStart + trimDuration)
        }
        return seconds
    }

    func selectLibraryAsset(_ asset: IVEMediaAssetRef) {
        selectedLibraryAssetID = asset.id
        if asset.kind == .image {
            selectedImageAssetID = asset.id
        }
    }

    func presentFileImporter() {
        showingFileImporter = true
    }

    func reloadMediaAssetsTapped() {
        loadMediaAssets()
    }

    func exportChangedLibraryItemsTapped() {
        exportChangedLibraryItems()
    }

    #if os(iOS)
    func handlePhotoSelectionsChanged(_ selections: [PhotosPickerItem]) {
        guard !selections.isEmpty else { return }
        importFromPhotosPicker(selections)
    }

    func beginPhotoImport() {
        photoSelections = []
        showingPhotosPicker = true
    }
    #else
    func beginPhotoImport() {}
    #endif

    func removeBackgroundTapped() {
        removeBackground()
    }

    func setBackgroundWhiteTapped() {
        applyBackgroundReplacement(style: .white)
    }

    func setBackgroundBlackTapped() {
        applyBackgroundReplacement(style: .black)
    }

    func setBackgroundBlurTapped() {
        applyBackgroundReplacement(style: .blurred)
    }

    func removeDetectedSubjectTapped() {
        removeDetectedSubjectObject()
    }

    func applyAdjustmentsTapped() {
        applyAdjustments()
    }

    func exportEditedImageTapped() {
        guard !isImageExportInProgress else { return }
        isImageExportInProgress = true
        imageProcessingStartedAt = Date()
        defer {
            isImageExportInProgress = false
            imageProcessingStartedAt = nil
        }
        guard let selectedImage = selectedImageAsset else {
            #if DEBUG
            iveTouchDebug("export_blocked no_selected_image")
            #endif
            errorMessage = iveLocalized("No selected image to export.")
            return
        }
        guard let sourceURL = displayURL(for: selectedImage) else {
            #if DEBUG
            iveTouchDebug("export_blocked missing_source localIdentifier=\(selectedImage.localIdentifier)")
            #endif
            errorMessage = iveLocalized("Selected image source is missing. Please re-import the image and try again.")
            return
        }
        exportEditedImage(from: selectedImage, sourceURL: sourceURL)
    }

    func replaceImageAndCloseTapped() {
        guard !isImageDoneInProgress else { return }
        isImageDoneInProgress = true
        imageProcessingStartedAt = Date()
        defer {
            isImageDoneInProgress = false
            imageProcessingStartedAt = nil
        }
        guard let selectedImage = selectedImageAsset else {
            #if DEBUG
            iveTouchDebug("done_blocked no_selected_image")
            #endif
            errorMessage = iveLocalized("No selected image to finalize.")
            return
        }
        guard let sourceURL = displayURL(for: selectedImage) else {
            #if DEBUG
            iveTouchDebug("done_blocked missing_source localIdentifier=\(selectedImage.localIdentifier)")
            #endif
            errorMessage = iveLocalized("Selected image source is missing. Please re-import the image and try again.")
            return
        }
        replaceImageAndClose(image: selectedImage, sourceURL: sourceURL)
    }

    func resetImageToOriginalTapped() {
        resetImageToOriginal()
    }

    func resetVideoToOriginalTapped() {
        resetVideoToOriginal()
    }

    func buildTimelineFromVideosTapped() {
        buildTimelineFromVideos()
    }

    func splitSelectedClipTapped() {
        splitSelectedClip()
    }

    func rippleDeleteSelectedClipTapped() {
        rippleDeleteSelectedClip()
    }

    func trimSelectedClipTapped() {
        trimSelectedClip()
    }

    func applyVideoAdjustmentsTapped() {
        applyVideoAdjustments()
    }

    func setCalibrationPreviewEnabled(_ enabled: Bool) {
        if enabled {
            if calibrationPreviewURL == nil {
                calibrationPreviewURL = makeCalibrationReferenceAssetFileURL()
            }
            guard calibrationPreviewURL != nil else {
                errorMessage = NSLocalizedString(
                    "Calibration reference asset is unavailable.",
                    tableName: "Localizable",
                    bundle: .module,
                    value: "Calibration reference asset is unavailable.",
                    comment: ""
                )
                isCalibrationPreviewEnabled = false
                return
            }
            isCalibrationPreviewEnabled = true
        } else {
            isCalibrationPreviewEnabled = false
        }
    }

    func exportEditedVideoTapped() {
        exportEditedVideo()
    }

    func replaceVideoAndCloseTapped() {
        replaceVideoAndClose()
    }

    func undoTapped() {
        undo()
    }

    func redoTapped() {
        redo()
    }

    func resetPendingImageCropArea() {
        guard let imageID = selectedImageAssetID else {
            pendingCropRect = .full
            pendingScale = 1
            return
        }
        pendingCropRect = effectiveCropRect(for: imageID)
        pendingScale = effectiveScale(for: imageID)
    }

    func resetPendingVideoCropArea() {
        guard let videoID = selectedVideoAssetID else {
            pendingVideoCropRect = .full
            pendingVideoCropMode = .fit
            return
        }
        pendingVideoCropRect = effectiveVideoCropRect(for: videoID)
        pendingVideoCropMode = effectiveVideoCropMode(for: videoID)
    }
    func loadInitialState() {
        loadMediaAssets()
        do {
            if let stored = try services.projectStore.loadSessionSnapshot(for: project) {
                snapshot = stored
                session = IVEEditingSession(snapshot: stored)
            } else {
                let initial = IVEEditingSessionSnapshot(
                    projectID: project.id,
                    timeline: .init(),
                    operations: [],
                    mediaAssets: importedAssets
                )
                snapshot = initial
                session = IVEEditingSession(snapshot: initial)
                try services.projectStore.saveSessionSnapshot(initial, for: project)
            }
            ensureSelections()
            applyConfiguredEntryModeIfNeeded()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
    func loadMediaAssets() {
        do {
            importedAssets = try services.mediaStore.media(for: project)
            if var current = snapshot {
                current.mediaAssets = importedAssets
                current.savedAt = Date()
                if let session {
                    session.updateMediaAssets(importedAssets)
                }
                persist(snapshot: current, resetSession: false)
            }
            ensureSelections()
            applyConfiguredEntryModeIfNeeded()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
    func ensureSelections() {
        if selectedLibraryAssetID == nil {
            selectedLibraryAssetID = importedAssets.first?.id
        }
        if selectedImageAssetID == nil {
            selectedImageAssetID = importedAssets.first(where: { $0.kind == .image })?.id
        }
        if selectedClipID == nil {
            selectedClipID = snapshot?.timeline.clips.first?.id
        }
        if selectedVideoAssetID == nil {
            selectedVideoAssetID = importedAssets.first(where: { $0.kind == .video })?.id
        }
        syncPendingAdjustmentsToCurrentImage()
        syncPendingVideoAdjustmentsToCurrentVideo()
    }
    func applyConfiguredEntryModeIfNeeded() {
        guard !hasAppliedInitialEntryMode else { return }
        hasAppliedInitialEntryMode = true

        switch configuration.entryMode {
        case .library:
            selectedTab = .library
        case .imageEditor:
            if let image = importedAssets.first(where: { $0.kind == .image }) {
                selectedLibraryAssetID = image.id
                selectedImageAssetID = image.id
                selectedTab = .edit
            } else {
                selectedTab = .library
            }
        case .videoEditor:
            if let video = importedAssets.first(where: { $0.kind == .video }) {
                selectedLibraryAssetID = video.id
                selectedVideoAssetID = video.id
                selectedTab = .timeline
            } else {
                selectedTab = .library
            }
        }
    }
    func persist(snapshot newSnapshot: IVEEditingSessionSnapshot, resetSession: Bool) {
        snapshot = newSnapshot
        importedAssets = newSnapshot.mediaAssets
        if resetSession {
            session = IVEEditingSession(snapshot: newSnapshot)
        }
        ensureSelections()
        refreshHistoryAvailability()
        let snapshotToSave = newSnapshot
        let projectStore = services.projectStore
        let projectHandle = project
        Task(priority: .utility) {
            do {
                try projectStore.saveSessionSnapshot(snapshotToSave, for: projectHandle)
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
    func applyAdjustments() {
        guard !isImageApplyInProgress else { return }
        isImageApplyInProgress = true
        imageProcessingStartedAt = Date()
        defer {
            isImageApplyInProgress = false
            imageProcessingStartedAt = nil
        }
        guard let imageID = selectedImageAssetID else { return }
        var operations: [IVEEditOperation] = []

        switch activeImageTool {
        case .adjust:
            let currentExposure = effectiveExposure(for: imageID)
            let currentContrast = effectiveContrast(for: imageID)
            let currentSaturation = effectiveSaturation(for: imageID)
            let currentTemperature = effectiveTemperature(for: imageID)
            let currentTint = effectiveTint(for: imageID)
            let currentDenoise = effectiveDenoise(for: imageID)
            let currentSharpen = effectiveSharpen(for: imageID)

            let exposureDelta = pendingExposureValue - currentExposure
            if abs(exposureDelta) > 0.0001 {
                operations.append(.imageExposure(assetID: imageID, value: exposureDelta))
            }
            if currentContrast != 0 {
                let contrastFactor = pendingContrastValue / currentContrast
                if abs(contrastFactor - 1) > 0.0001 {
                    operations.append(.imageContrast(assetID: imageID, value: contrastFactor))
                }
            }
            if currentSaturation != 0 {
                let saturationFactor = pendingSaturationValue / currentSaturation
                if abs(saturationFactor - 1) > 0.0001 {
                    operations.append(.imageSaturation(assetID: imageID, value: saturationFactor))
                }
            }
            let temperatureDelta = pendingTemperatureValue - currentTemperature
            if abs(temperatureDelta) > 0.0001 {
                operations.append(.imageTemperature(assetID: imageID, value: temperatureDelta))
            }
            let tintDelta = pendingTintValue - currentTint
            if abs(tintDelta) > 0.0001 {
                operations.append(.imageTint(assetID: imageID, value: tintDelta))
            }
            let denoiseDelta = pendingDenoiseValue - currentDenoise
            if abs(denoiseDelta) > 0.0001 {
                operations.append(.imageDenoise(assetID: imageID, value: denoiseDelta))
            }
            let sharpenDelta = pendingSharpenValue - currentSharpen
            if abs(sharpenDelta) > 0.0001 {
                operations.append(.imageSharpen(assetID: imageID, value: sharpenDelta))
            }

        case .color:
            let currentSettings = effectiveColorCurveSettings(for: imageID)
            let pendingSettings = IVEColorCurveSettings(
                masterShadows: pendingCurveShadowsValue,
                masterMidtones: pendingCurveMidtonesValue,
                masterHighlights: pendingCurveHighlightsValue,
                redShadows: pendingCurveRedShadowsValue,
                redMidtones: pendingCurveRedMidtonesValue,
                redHighlights: pendingCurveRedHighlightsValue,
                greenShadows: pendingCurveGreenShadowsValue,
                greenMidtones: pendingCurveGreenMidtonesValue,
                greenHighlights: pendingCurveGreenHighlightsValue,
                blueShadows: pendingCurveBlueShadowsValue,
                blueMidtones: pendingCurveBlueMidtonesValue,
                blueHighlights: pendingCurveBlueHighlightsValue,
                blackPoint: pendingBlackPointValue,
                whitePoint: pendingWhitePointValue
            )
            if pendingSettings != currentSettings {
                operations.append(.imageColorCurve(assetID: imageID, settings: pendingSettings))
            }

        case .crop:
            let currentCropRect = effectiveCropRect(for: imageID)
            let currentScale = effectiveScale(for: imageID)
            if pendingCropRect != currentCropRect || abs(pendingScale - currentScale) > 0.0001 {
                operations.append(.imageCrop(assetID: imageID, rect: pendingCropRect, scale: pendingScale))
            }

        case .style:
            let currentFilter = effectiveFilterPreset(for: imageID)
            if pendingFilterPreset != currentFilter {
                operations.append(.imageFilter(assetID: imageID, preset: pendingFilterPreset))
            }

        case .transform:
            let currentRotation = effectiveRotation(for: imageID)
            let currentMirrorHorizontal = effectiveMirrorHorizontal(for: imageID)
            let currentMirrorVertical = effectiveMirrorVertical(for: imageID)

            let rotationDelta = pendingRotationDegrees - currentRotation
            if abs(rotationDelta) > 0.0001 {
                operations.append(.imageRotation(assetID: imageID, degrees: rotationDelta))
            }
            if pendingMirrorHorizontal != currentMirrorHorizontal {
                operations.append(.imageMirrorHorizontal(assetID: imageID))
            }
            if pendingMirrorVertical != currentMirrorVertical {
                operations.append(.imageMirrorVertical(assetID: imageID))
            }
        }

        guard let session, !operations.isEmpty else {
            syncPendingAdjustmentsToCurrentImage()
            if activeImageTool == .crop {
                activeImageTool = .adjust
                imageEditorInteractionNonce &+= 1
            }
            return
        }
        session.applyMany(operations)
        let next = session.snapshot
        persist(snapshot: next, resetSession: false)
        syncPendingAdjustmentsToCurrentImage()
        if activeImageTool == .crop {
            activeImageTool = .adjust
            imageEditorInteractionNonce &+= 1
        }
    }
    func exportEditedImage(from selectedImage: IVEMediaAssetRef, sourceURL: URL) {
        do {
            let renderState = currentImageRenderState(for: selectedImage.id)
            let cropRect = pendingCropRect
            let scale = pendingScale
            let editedURL = try runImageProcessing {
                try makeCroppedImageFile(
                    from: sourceURL,
                    cropRect: cropRect,
                    scale: scale,
                    renderState: renderState
                )
            }
            promptSaveLocation(for: editedURL, copyOnly: true)
            services.telemetry.track(event: "image_export_edited", metadata: ["project": project.displayName])
        } catch {
            #if DEBUG
            iveTouchDebug("export_failed \(error.localizedDescription)")
            #endif
            errorMessage = error.localizedDescription
        }
    }
    func replaceImageAndClose(image selectedImage: IVEMediaAssetRef, sourceURL: URL) {
        do {
            let renderState = currentImageRenderState(for: selectedImage.id)
            let cropRect = pendingCropRect
            let scale = pendingScale
            let editedURL = try runImageProcessing {
                try makeCroppedImageFile(
                    from: sourceURL,
                    cropRect: cropRect,
                    scale: scale,
                    renderState: renderState
                )
            }
            services.telemetry.track(event: "image_replace_close", metadata: ["project": project.displayName])
            if let onFinish {
                removeEditOperationsForImageAsset(selectedImage.id)
                onFinish(IVEEditorFinishResult(url: editedURL, kind: .image))
            } else {
                let created = try services.mediaStore.ingestMedia(
                    localIdentifier: editedURL.path,
                    kind: .image,
                    into: project
                )
                loadMediaAssets()
                selectedLibraryAssetID = created.id
                selectedImageAssetID = created.id
                selectedTab = .library
            }
            dismiss()
        } catch {
            #if DEBUG
            iveTouchDebug("done_failed \(error.localizedDescription)")
            #endif
            errorMessage = error.localizedDescription
        }
    }
    func exportEditedImage() {
        guard let selectedImage = selectedImageAsset, let sourceURL = displayURL(for: selectedImage) else {
            errorMessage = iveLocalized("No selected image to export.")
            return
        }
        exportEditedImage(from: selectedImage, sourceURL: sourceURL)
    }
    func replaceImageAndClose() {
        guard let selectedImage = selectedImageAsset, let sourceURL = displayURL(for: selectedImage) else {
            errorMessage = iveLocalized("No selected image to finalize.")
            return
        }
        replaceImageAndClose(image: selectedImage, sourceURL: sourceURL)
    }
    func applyVideoAdjustments() {
        guard !isVideoApplyInProgress else { return }
        isVideoApplyInProgress = true
        videoProcessingStartedAt = Date()
        defer {
            isVideoApplyInProgress = false
            videoProcessingStartedAt = nil
        }
        guard let video = selectedVideoAsset else { return }
        guard let session else { return }
        var operations: [IVEEditOperation] = []
        var didApplyCrop = false
        let currentExposure = effectiveVideoExposure(for: video.id)
        let currentContrast = effectiveVideoContrast(for: video.id)
        let currentSaturation = effectiveVideoSaturation(for: video.id)
        let currentTemperature = effectiveVideoTemperature(for: video.id)
        let currentTint = effectiveVideoTint(for: video.id)
        let currentRotation = effectiveVideoRotation(for: video.id)
        let currentMirrorHorizontal = effectiveVideoMirrorHorizontal(for: video.id)
        let currentMirrorVertical = effectiveVideoMirrorVertical(for: video.id)
        let currentFilter = effectiveVideoFilterPreset(for: video.id)
        let currentCropRect = effectiveVideoCropRect(for: video.id)
        let currentCropMode = effectiveVideoCropMode(for: video.id)
        switch activeVideoTool {
        case .adjust:
            let exposureDelta = pendingVideoExposureValue - currentExposure
            if abs(exposureDelta) > 0.0001 {
                operations.append(.videoExposure(assetID: video.id, value: exposureDelta))
            }
            if currentContrast != 0 {
                let contrastMultiplier = pendingVideoContrastValue / currentContrast
                if abs(contrastMultiplier - 1) > 0.0001 {
                    operations.append(.videoContrast(assetID: video.id, value: contrastMultiplier))
                }
            }
            if currentSaturation != 0 {
                let saturationMultiplier = pendingVideoSaturationValue / currentSaturation
                if abs(saturationMultiplier - 1) > 0.0001 {
                    operations.append(.videoSaturation(assetID: video.id, value: saturationMultiplier))
                }
            }
            let temperatureDelta = pendingVideoTemperatureValue - currentTemperature
            if abs(temperatureDelta) > 0.0001 {
                operations.append(.videoTemperature(assetID: video.id, value: temperatureDelta))
            }
            let tintDelta = pendingVideoTintValue - currentTint
            if abs(tintDelta) > 0.0001 {
                operations.append(.videoTint(assetID: video.id, value: tintDelta))
            }
        case .color:
            let currentSettings = effectiveVideoColorCurveSettings(for: video.id)
            let pendingSettings = IVEColorCurveSettings(
                masterShadows: pendingVideoCurveShadowsValue,
                masterMidtones: pendingVideoCurveMidtonesValue,
                masterHighlights: pendingVideoCurveHighlightsValue,
                redShadows: pendingVideoCurveRedShadowsValue,
                redMidtones: pendingVideoCurveRedMidtonesValue,
                redHighlights: pendingVideoCurveRedHighlightsValue,
                greenShadows: pendingVideoCurveGreenShadowsValue,
                greenMidtones: pendingVideoCurveGreenMidtonesValue,
                greenHighlights: pendingVideoCurveGreenHighlightsValue,
                blueShadows: pendingVideoCurveBlueShadowsValue,
                blueMidtones: pendingVideoCurveBlueMidtonesValue,
                blueHighlights: pendingVideoCurveBlueHighlightsValue,
                blackPoint: pendingVideoBlackPointValue,
                whitePoint: pendingVideoWhitePointValue
            )
            if pendingSettings != currentSettings {
                operations.append(.videoColorCurve(assetID: video.id, settings: pendingSettings))
            }
        case .crop:
            if pendingVideoCropRect != currentCropRect {
                operations.append(.videoCrop(assetID: video.id, rect: pendingVideoCropRect, scale: 1))
                didApplyCrop = true
            }
            if pendingVideoCropMode != currentCropMode {
                operations.append(.videoCropMode(assetID: video.id, mode: pendingVideoCropMode))
                didApplyCrop = true
            }
        case .style:
            if pendingVideoFilterPreset != currentFilter {
                operations.append(.videoFilter(assetID: video.id, preset: pendingVideoFilterPreset))
            }
        case .transform:
            let rotationDelta = pendingVideoRotationDegrees - currentRotation
            if abs(rotationDelta) > 0.0001 {
                operations.append(.videoRotation(assetID: video.id, degrees: rotationDelta))
            }
            if pendingVideoMirrorHorizontal != currentMirrorHorizontal {
                operations.append(.videoMirrorHorizontal(assetID: video.id))
            }
            if pendingVideoMirrorVertical != currentMirrorVertical {
                operations.append(.videoMirrorVertical(assetID: video.id))
            }
        case .timeline:
            break
        }
        guard !operations.isEmpty else {
            return
        }
        session.applyMany(operations)
        let next = session.snapshot
        persist(snapshot: next, resetSession: false)
        syncPendingVideoAdjustmentsToCurrentVideo()
        if didApplyCrop {
            activeVideoTool = .adjust
        }
    }
    func createEditedVideoAsset() {
        guard !isVideoDoneInProgress else { return }
        guard let video = selectedVideoAsset, let sourceURL = displayURL(for: video) else { return }
        isVideoDoneInProgress = true
        videoProcessingStartedAt = Date()
        Task { @MainActor in
            defer {
                isVideoDoneInProgress = false
                videoProcessingStartedAt = nil
            }
            do {
                let trimRange = currentTrimRangeForSelectedVideo()
                let outputURL = try await makeCroppedVideoFile(
                    from: sourceURL,
                    cropRect: pendingVideoCropRect,
                    cropMode: pendingVideoCropMode,
                    trimRange: trimRange,
                    renderState: currentVideoRenderState(for: video.id)
                )
                let created = try services.mediaStore.ingestMedia(
                    localIdentifier: outputURL.path,
                    kind: .video,
                    into: project
                )
                loadMediaAssets()
                selectedLibraryAssetID = created.id
                selectedVideoAssetID = created.id
                services.telemetry.track(event: "video_cropped", metadata: ["project": project.displayName])
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
    func exportEditedVideo() {
        guard !isVideoExportInProgress else { return }
        guard let video = selectedVideoAsset, let sourceURL = displayURL(for: video) else { return }
        isVideoExportInProgress = true
        videoProcessingStartedAt = Date()
        Task { @MainActor in
            defer {
                isVideoExportInProgress = false
                videoProcessingStartedAt = nil
            }
            do {
                let trimRange = currentTrimRangeForSelectedVideo()
                let outputURL = try await makeCroppedVideoFile(
                    from: sourceURL,
                    cropRect: pendingVideoCropRect,
                    cropMode: pendingVideoCropMode,
                    trimRange: trimRange,
                    renderState: currentVideoRenderState(for: video.id)
                )
                promptSaveLocation(for: outputURL, copyOnly: true)
                services.telemetry.track(event: "video_export_edited", metadata: ["project": project.displayName])
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
    func replaceVideoAndClose() {
        guard !isVideoDoneInProgress else { return }
        guard let video = selectedVideoAsset, let sourceURL = displayURL(for: video) else { return }
        isVideoDoneInProgress = true
        videoProcessingStartedAt = Date()
        Task { @MainActor in
            defer {
                isVideoDoneInProgress = false
                videoProcessingStartedAt = nil
            }
            do {
                let trimRange = currentTrimRangeForSelectedVideo()
                let outputURL = try await makeCroppedVideoFile(
                    from: sourceURL,
                    cropRect: pendingVideoCropRect,
                    cropMode: pendingVideoCropMode,
                    trimRange: trimRange,
                    renderState: currentVideoRenderState(for: video.id)
                )
                services.telemetry.track(event: "video_replace_close", metadata: ["project": project.displayName])
                if let onFinish {
                    removeEditOperationsForVideoAsset(video.id)
                    onFinish(IVEEditorFinishResult(url: outputURL, kind: .video))
                } else {
                    let created = try services.mediaStore.ingestMedia(
                        localIdentifier: outputURL.path,
                        kind: .video,
                        into: project
                    )
                    loadMediaAssets()
                    selectedLibraryAssetID = created.id
                    selectedVideoAssetID = created.id
                    selectedClipID = nil
                    trimStart = 0
                    trimDuration = selectedVideoDurationSeconds
                    selectedTab = .library
                }
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
    func exportChangedLibraryItems() {
        let changed = importedAssets.filter(isChangedLibraryAsset)
        guard !changed.isEmpty else {
            errorMessage = iveLocalized("No changed library items to export.")
            return
        }
        let urls = changed.compactMap(displayURL(for:))
        guard !urls.isEmpty else {
            errorMessage = iveLocalized("Changed items are missing source files.")
            return
        }

        #if os(macOS)
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = true
        panel.prompt = "Export"
        guard panel.runModal() == .OK, let destinationFolder = panel.url else { return }

        do {
            for source in urls {
                let destination = uniqueDestinationURL(for: source.lastPathComponent, in: destinationFolder)
                try FileManager.default.copyItem(at: source, to: destination)
            }
            lastExportPath = destinationFolder.path
            services.telemetry.track(event: "library_export_changed", metadata: ["count": String(urls.count)])
        } catch {
            errorMessage = error.localizedDescription
        }
        #else
        pendingExportQueue = urls
        exportNextQueuedItemIfNeeded()
        services.telemetry.track(event: "library_export_changed_ios", metadata: ["count": String(urls.count)])
        #endif
    }

    func isChangedLibraryAsset(_ asset: IVEMediaAssetRef) -> Bool {
        let name = URL(fileURLWithPath: asset.localIdentifier).lastPathComponent.lowercased()
        return name.contains("-crop.") || name.hasPrefix("ai-bg-")
    }

    func uniqueDestinationURL(for fileName: String, in folder: URL) -> URL {
        let sourceURL = URL(fileURLWithPath: fileName)
        let extensionFallback = sourceURL.pathExtension.isEmpty ? "dat" : sourceURL.pathExtension
        let safeName = constrainedFileName(sourceURL: sourceURL, prefix: "ive", fallbackExtension: extensionFallback)
        var candidate = folder.appendingPathComponent(safeName)
        if !FileManager.default.fileExists(atPath: candidate.path) {
            return candidate
        }

        let ext = candidate.pathExtension
        let base = sanitizedFileStem(
            candidate.deletingPathExtension().lastPathComponent,
            fallback: "ive",
            maxLength: 30
        )
        var index = 2
        while true {
            let numbered = ext.isEmpty ? "\(base)-\(index)" : "\(base)-\(index).\(ext)"
            candidate = folder.appendingPathComponent(numbered)
            if !FileManager.default.fileExists(atPath: candidate.path) {
                return candidate
            }
            index += 1
        }
    }

    func constrainedFileName(sourceURL: URL?, prefix: String, fallbackExtension: String) -> String {
        let sourceStem = sourceURL?.deletingPathExtension().lastPathComponent ?? prefix
        let stem = sanitizedFileStem(sourceStem, fallback: prefix, maxLength: 24)
        let extensionSource = sourceURL?.pathExtension ?? fallbackExtension
        let ext = sanitizedFileExtension(extensionSource, fallback: fallbackExtension)
        let suffix = String(UUID().uuidString.prefix(8)).lowercased()
        return "\(prefix)-\(stem)-\(suffix).\(ext)"
    }

    func sanitizedFileStem(_ input: String, fallback: String, maxLength: Int) -> String {
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

        while let first = output.first, first == 45 || first == 95 {
            output.removeFirst()
        }
        while let last = output.last, last == 45 || last == 95 {
            output.removeLast()
        }

        if output.isEmpty {
            return fallback
        }
        return String(decoding: output, as: UTF8.self)
    }

    func sanitizedFileExtension(_ input: String, fallback: String) -> String {
        func normalizedASCIIExtension(from value: String) -> String {
            let bytes = Array(value.utf8)
            var output: [UInt8] = []
            output.reserveCapacity(8)

            for byte in bytes {
                let lower = (byte >= 65 && byte <= 90) ? byte + 32 : byte
                let isNumber = lower >= 48 && lower <= 57
                let isLetter = lower >= 97 && lower <= 122
                if isNumber || isLetter {
                    output.append(lower)
                    if output.count == 8 {
                        break
                    }
                }
            }

            return String(decoding: output, as: UTF8.self)
        }

        let primary = normalizedASCIIExtension(from: input)
        if !primary.isEmpty {
            return primary
        }

        let fallbackValue = normalizedASCIIExtension(from: fallback)
        return fallbackValue.isEmpty ? "dat" : fallbackValue
    }
    func removeEditOperationsForImageAsset(_ assetID: UUID) {
        guard var current = snapshot else { return }
        current.operations.removeAll { operation in
            switch operation {
            case let .imageExposure(id, _),
                 let .imageContrast(id, _),
                 let .imageSaturation(id, _),
                 let .imageTemperature(id, _),
                 let .imageTint(id, _),
                 let .imageCurveShadows(id, _),
                 let .imageCurveMidtones(id, _),
                 let .imageCurveHighlights(id, _),
                 let .imageColorCurve(id, _),
                 let .imageDenoise(id, _),
                 let .imageSharpen(id, _),
                 let .imageRotation(id, _),
                 let .imageCrop(id, _, _),
                 let .imageFilter(id, _):
                return id == assetID
            case let .imageMirrorHorizontal(id),
                 let .imageMirrorVertical(id):
                return id == assetID
            default:
                return false
            }
        }
        current.savedAt = Date()
        snapshot = current
        session = IVEEditingSession(snapshot: current)
        do {
            try services.projectStore.saveSessionSnapshot(current, for: project)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
    func removeEditOperationsForVideoAsset(_ assetID: UUID) {
        guard var current = snapshot else { return }
        let clipIDsForAsset = Set(current.timeline.clips.filter { $0.assetID == assetID }.map(\.id))
        current.operations.removeAll { operation in
            switch operation {
            case let .videoExposure(id, _),
                 let .videoContrast(id, _),
                 let .videoSaturation(id, _),
                 let .videoTemperature(id, _),
                 let .videoTint(id, _),
                 let .videoCurveShadows(id, _),
                 let .videoCurveMidtones(id, _),
                 let .videoCurveHighlights(id, _),
                 let .videoColorCurve(id, _),
                 let .videoRotation(id, _),
                 let .videoFilter(id, _),
                 let .videoCrop(id, _, _),
                 let .videoCropMode(id, _),
                 let .applyCaptions(id, _):
                return id == assetID
            case let .videoMirrorHorizontal(id),
                 let .videoMirrorVertical(id):
                return id == assetID
            case let .videoTrim(clipID, _, _):
                return clipIDsForAsset.contains(clipID)
            default:
                return false
            }
        }
        current.savedAt = Date()
        snapshot = current
        session = IVEEditingSession(snapshot: current)
        do {
            try services.projectStore.saveSessionSnapshot(current, for: project)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func replaceFile(at destinationURL: URL, with sourceURL: URL) throws {
        guard destinationURL.path != sourceURL.path else { return }
        let manager = FileManager.default
        let backupURL = destinationURL.deletingLastPathComponent().appendingPathComponent("\(UUID().uuidString)-backup-\(destinationURL.lastPathComponent)")
        do {
            _ = try manager.replaceItemAt(
                destinationURL,
                withItemAt: sourceURL,
                backupItemName: backupURL.lastPathComponent,
                options: [.usingNewMetadataOnly]
            )
            if manager.fileExists(atPath: backupURL.path) {
                try? manager.removeItem(at: backupURL)
            }
            if manager.fileExists(atPath: sourceURL.path) {
                try? manager.removeItem(at: sourceURL)
            }
        } catch {
            let tempURL = destinationURL.deletingLastPathComponent().appendingPathComponent("\(UUID().uuidString)-swap-\(destinationURL.lastPathComponent)")
            if manager.fileExists(atPath: tempURL.path) {
                try manager.removeItem(at: tempURL)
            }
            try manager.copyItem(at: sourceURL, to: tempURL)
            if manager.fileExists(atPath: destinationURL.path) {
                try manager.removeItem(at: destinationURL)
            }
            try manager.moveItem(at: tempURL, to: destinationURL)
            try? manager.removeItem(at: sourceURL)
        }
    }
    func exportNextQueuedItemIfNeeded() {
        guard !showingSaveLocationPicker, !pendingExportQueue.isEmpty else { return }
        let next = pendingExportQueue.removeFirst()
        promptSaveLocation(for: next, copyOnly: true)
    }

    func currentImageRenderState(for assetID: UUID) -> ImageRenderState {
        ImageRenderState(
            exposure: pendingExposureValue,
            contrast: pendingContrastValue,
            saturation: pendingSaturationValue,
            temperature: pendingTemperatureValue,
            tint: pendingTintValue,
            curveShadows: pendingCurveShadowsValue,
            curveMidtones: pendingCurveMidtonesValue,
            curveHighlights: pendingCurveHighlightsValue,
            curveRedShadows: pendingCurveRedShadowsValue,
            curveRedMidtones: pendingCurveRedMidtonesValue,
            curveRedHighlights: pendingCurveRedHighlightsValue,
            curveGreenShadows: pendingCurveGreenShadowsValue,
            curveGreenMidtones: pendingCurveGreenMidtonesValue,
            curveGreenHighlights: pendingCurveGreenHighlightsValue,
            curveBlueShadows: pendingCurveBlueShadowsValue,
            curveBlueMidtones: pendingCurveBlueMidtonesValue,
            curveBlueHighlights: pendingCurveBlueHighlightsValue,
            blackPoint: pendingBlackPointValue,
            whitePoint: pendingWhitePointValue,
            denoise: pendingDenoiseValue,
            sharpen: pendingSharpenValue,
            rotationDegrees: pendingRotationDegrees,
            mirrorHorizontal: pendingMirrorHorizontal,
            mirrorVertical: pendingMirrorVertical,
            filterPreset: pendingFilterPreset
        )
    }

    func currentVideoRenderState(for assetID: UUID) -> VideoRenderState {
        VideoRenderState(
            exposure: pendingVideoExposureValue,
            contrast: pendingVideoContrastValue,
            saturation: pendingVideoSaturationValue,
            temperature: pendingVideoTemperatureValue,
            tint: pendingVideoTintValue,
            curveShadows: pendingVideoCurveShadowsValue,
            curveMidtones: pendingVideoCurveMidtonesValue,
            curveHighlights: pendingVideoCurveHighlightsValue,
            curveRedShadows: pendingVideoCurveRedShadowsValue,
            curveRedMidtones: pendingVideoCurveRedMidtonesValue,
            curveRedHighlights: pendingVideoCurveRedHighlightsValue,
            curveGreenShadows: pendingVideoCurveGreenShadowsValue,
            curveGreenMidtones: pendingVideoCurveGreenMidtonesValue,
            curveGreenHighlights: pendingVideoCurveGreenHighlightsValue,
            curveBlueShadows: pendingVideoCurveBlueShadowsValue,
            curveBlueMidtones: pendingVideoCurveBlueMidtonesValue,
            curveBlueHighlights: pendingVideoCurveBlueHighlightsValue,
            blackPoint: pendingVideoBlackPointValue,
            whitePoint: pendingVideoWhitePointValue,
            rotationDegrees: pendingVideoRotationDegrees,
            mirrorHorizontal: pendingVideoMirrorHorizontal,
            mirrorVertical: pendingVideoMirrorVertical,
            filterPreset: pendingVideoFilterPreset
        )
    }

    func effectiveVideoRenderState(for assetID: UUID) -> VideoRenderState {
        VideoRenderState(
            exposure: effectiveVideoExposure(for: assetID),
            contrast: effectiveVideoContrast(for: assetID),
            saturation: effectiveVideoSaturation(for: assetID),
            temperature: effectiveVideoTemperature(for: assetID),
            tint: effectiveVideoTint(for: assetID),
            curveShadows: effectiveVideoCurveShadows(for: assetID),
            curveMidtones: effectiveVideoCurveMidtones(for: assetID),
            curveHighlights: effectiveVideoCurveHighlights(for: assetID),
            curveRedShadows: effectiveVideoColorCurveSettings(for: assetID).redShadows,
            curveRedMidtones: effectiveVideoColorCurveSettings(for: assetID).redMidtones,
            curveRedHighlights: effectiveVideoColorCurveSettings(for: assetID).redHighlights,
            curveGreenShadows: effectiveVideoColorCurveSettings(for: assetID).greenShadows,
            curveGreenMidtones: effectiveVideoColorCurveSettings(for: assetID).greenMidtones,
            curveGreenHighlights: effectiveVideoColorCurveSettings(for: assetID).greenHighlights,
            curveBlueShadows: effectiveVideoColorCurveSettings(for: assetID).blueShadows,
            curveBlueMidtones: effectiveVideoColorCurveSettings(for: assetID).blueMidtones,
            curveBlueHighlights: effectiveVideoColorCurveSettings(for: assetID).blueHighlights,
            blackPoint: effectiveVideoColorCurveSettings(for: assetID).blackPoint,
            whitePoint: effectiveVideoColorCurveSettings(for: assetID).whitePoint,
            rotationDegrees: effectiveVideoRotation(for: assetID),
            mirrorHorizontal: effectiveVideoMirrorHorizontal(for: assetID),
            mirrorVertical: effectiveVideoMirrorVertical(for: assetID),
            filterPreset: effectiveVideoFilterPreset(for: assetID)
        )
    }

    func currentTrimRangeForSelectedVideo() -> CMTimeRange? {
        guard let selectedClipID,
              let clip = snapshot?.timeline.clips.first(where: { $0.id == selectedClipID }),
              let video = selectedVideoAsset,
              clip.assetID == video.id else {
            return nil
        }

        let start: Double
        let duration: Double
        if activeVideoTool == .timeline {
            let clampedStart = max(0, trimStart)
            let maxDuration = max(0.1, selectedVideoDurationSeconds - clampedStart)
            start = clampedStart
            duration = min(max(0.1, trimDuration), maxDuration)
        } else {
            start = max(0, effectiveTrimStart(for: clip.id))
            duration = max(0.1, effectiveTrimDuration(for: clip))
        }

        return CMTimeRange(
            start: CMTime(seconds: start, preferredTimescale: 600),
            duration: CMTime(seconds: duration, preferredTimescale: 600)
        )
    }

    func effectiveTrimStart(for clipID: UUID) -> Double {
        guard let operations = snapshot?.operations else { return 0 }
        return operations.reversed().compactMap { operation in
            if case let .videoTrim(id, start, _) = operation, id == clipID {
                return start
            }
            return nil
        }.first ?? 0
    }

    func effectiveTrimDuration(for clip: IVEVideoClip) -> Double {
        guard let operations = snapshot?.operations else { return clip.durationSeconds }
        return operations.reversed().compactMap { operation in
            if case let .videoTrim(id, _, duration) = operation, id == clip.id {
                return duration
            }
            return nil
        }.first ?? clip.durationSeconds
    }
    func resetPendingAdjustments() {
        pendingExposureValue = 0
        pendingContrastValue = 1
        pendingSaturationValue = 1
        pendingTemperatureValue = 0
        pendingTintValue = 0
        pendingCurveShadowsValue = 0
        pendingCurveMidtonesValue = 0
        pendingCurveHighlightsValue = 0
        pendingCurveRedShadowsValue = 0
        pendingCurveRedMidtonesValue = 0
        pendingCurveRedHighlightsValue = 0
        pendingCurveGreenShadowsValue = 0
        pendingCurveGreenMidtonesValue = 0
        pendingCurveGreenHighlightsValue = 0
        pendingCurveBlueShadowsValue = 0
        pendingCurveBlueMidtonesValue = 0
        pendingCurveBlueHighlightsValue = 0
        pendingBlackPointValue = 0
        pendingWhitePointValue = 1
        pendingDenoiseValue = 0
        pendingSharpenValue = 0
        pendingRotationDegrees = 0
        pendingMirrorHorizontal = false
        pendingMirrorVertical = false
        pendingCropRect = .full
        pendingScale = 1
        pendingFilterPreset = .none
    }
    func syncPendingAdjustmentsToCurrentImage() {
        guard let image = selectedImageAsset else {
            resetPendingAdjustments()
            return
        }
        let imageID = image.id
        pendingExposureValue = effectiveExposure(for: imageID)
        pendingContrastValue = effectiveContrast(for: imageID)
        pendingSaturationValue = effectiveSaturation(for: imageID)
        pendingTemperatureValue = effectiveTemperature(for: imageID)
        pendingTintValue = effectiveTint(for: imageID)
        pendingCurveShadowsValue = effectiveCurveShadows(for: imageID)
        pendingCurveMidtonesValue = effectiveCurveMidtones(for: imageID)
        pendingCurveHighlightsValue = effectiveCurveHighlights(for: imageID)
        let imageCurveSettings = effectiveColorCurveSettings(for: imageID)
        pendingCurveRedShadowsValue = imageCurveSettings.redShadows
        pendingCurveRedMidtonesValue = imageCurveSettings.redMidtones
        pendingCurveRedHighlightsValue = imageCurveSettings.redHighlights
        pendingCurveGreenShadowsValue = imageCurveSettings.greenShadows
        pendingCurveGreenMidtonesValue = imageCurveSettings.greenMidtones
        pendingCurveGreenHighlightsValue = imageCurveSettings.greenHighlights
        pendingCurveBlueShadowsValue = imageCurveSettings.blueShadows
        pendingCurveBlueMidtonesValue = imageCurveSettings.blueMidtones
        pendingCurveBlueHighlightsValue = imageCurveSettings.blueHighlights
        pendingBlackPointValue = imageCurveSettings.blackPoint
        pendingWhitePointValue = imageCurveSettings.whitePoint
        pendingDenoiseValue = effectiveDenoise(for: imageID)
        pendingSharpenValue = effectiveSharpen(for: imageID)
        pendingRotationDegrees = effectiveRotation(for: imageID)
        pendingMirrorHorizontal = effectiveMirrorHorizontal(for: imageID)
        pendingMirrorVertical = effectiveMirrorVertical(for: imageID)
        pendingCropRect = effectiveCropRect(for: imageID)
        pendingScale = effectiveScale(for: imageID)
        pendingFilterPreset = effectiveFilterPreset(for: imageID)
    }
    func syncPendingVideoAdjustmentsToCurrentVideo() {
        if let video = selectedVideoAsset {
            pendingVideoExposureValue = effectiveVideoExposure(for: video.id)
            pendingVideoContrastValue = effectiveVideoContrast(for: video.id)
            pendingVideoSaturationValue = effectiveVideoSaturation(for: video.id)
            pendingVideoTemperatureValue = effectiveVideoTemperature(for: video.id)
            pendingVideoTintValue = effectiveVideoTint(for: video.id)
            pendingVideoCurveShadowsValue = effectiveVideoCurveShadows(for: video.id)
            pendingVideoCurveMidtonesValue = effectiveVideoCurveMidtones(for: video.id)
            pendingVideoCurveHighlightsValue = effectiveVideoCurveHighlights(for: video.id)
            let videoCurveSettings = effectiveVideoColorCurveSettings(for: video.id)
            pendingVideoCurveRedShadowsValue = videoCurveSettings.redShadows
            pendingVideoCurveRedMidtonesValue = videoCurveSettings.redMidtones
            pendingVideoCurveRedHighlightsValue = videoCurveSettings.redHighlights
            pendingVideoCurveGreenShadowsValue = videoCurveSettings.greenShadows
            pendingVideoCurveGreenMidtonesValue = videoCurveSettings.greenMidtones
            pendingVideoCurveGreenHighlightsValue = videoCurveSettings.greenHighlights
            pendingVideoCurveBlueShadowsValue = videoCurveSettings.blueShadows
            pendingVideoCurveBlueMidtonesValue = videoCurveSettings.blueMidtones
            pendingVideoCurveBlueHighlightsValue = videoCurveSettings.blueHighlights
            pendingVideoBlackPointValue = videoCurveSettings.blackPoint
            pendingVideoWhitePointValue = videoCurveSettings.whitePoint
            pendingVideoRotationDegrees = effectiveVideoRotation(for: video.id)
            pendingVideoMirrorHorizontal = effectiveVideoMirrorHorizontal(for: video.id)
            pendingVideoMirrorVertical = effectiveVideoMirrorVertical(for: video.id)
            pendingVideoCropRect = effectiveVideoCropRect(for: video.id)
            pendingVideoCropMode = effectiveVideoCropMode(for: video.id)
            pendingVideoFilterPreset = effectiveVideoFilterPreset(for: video.id)
            if let clip = selectedTimelineClip, clip.assetID == video.id {
                trimStart = effectiveTrimStart(for: clip.id)
                trimDuration = effectiveTrimDuration(for: clip)
            }
        } else {
            pendingVideoExposureValue = 0
            pendingVideoContrastValue = 1
            pendingVideoSaturationValue = 1
            pendingVideoTemperatureValue = 0
            pendingVideoTintValue = 0
            pendingVideoCurveShadowsValue = 0
            pendingVideoCurveMidtonesValue = 0
            pendingVideoCurveHighlightsValue = 0
            pendingVideoCurveRedShadowsValue = 0
            pendingVideoCurveRedMidtonesValue = 0
            pendingVideoCurveRedHighlightsValue = 0
            pendingVideoCurveGreenShadowsValue = 0
            pendingVideoCurveGreenMidtonesValue = 0
            pendingVideoCurveGreenHighlightsValue = 0
            pendingVideoCurveBlueShadowsValue = 0
            pendingVideoCurveBlueMidtonesValue = 0
            pendingVideoCurveBlueHighlightsValue = 0
            pendingVideoBlackPointValue = 0
            pendingVideoWhitePointValue = 1
            pendingVideoRotationDegrees = 0
            pendingVideoMirrorHorizontal = false
            pendingVideoMirrorVertical = false
            pendingVideoCropRect = .full
            pendingVideoCropMode = .fit
            pendingVideoFilterPreset = .none
            trimStart = 0
            trimDuration = 5
        }
    }

    func applyImageCurvePreset(_ preset: IVEColorCurvePreset) {
        switch preset {
        case .neutral:
            pendingCurveShadowsValue = 0
            pendingCurveMidtonesValue = 0
            pendingCurveHighlightsValue = 0
            pendingCurveRedShadowsValue = 0
            pendingCurveRedMidtonesValue = 0
            pendingCurveRedHighlightsValue = 0
            pendingCurveGreenShadowsValue = 0
            pendingCurveGreenMidtonesValue = 0
            pendingCurveGreenHighlightsValue = 0
            pendingCurveBlueShadowsValue = 0
            pendingCurveBlueMidtonesValue = 0
            pendingCurveBlueHighlightsValue = 0
            pendingBlackPointValue = 0
            pendingWhitePointValue = 1
        case .film:
            pendingCurveShadowsValue = -0.18
            pendingCurveMidtonesValue = 0.08
            pendingCurveHighlightsValue = 0.14
            pendingCurveRedShadowsValue = 0.04
            pendingCurveRedMidtonesValue = 0.06
            pendingCurveRedHighlightsValue = 0.05
            pendingCurveGreenShadowsValue = -0.02
            pendingCurveGreenMidtonesValue = 0
            pendingCurveGreenHighlightsValue = 0.02
            pendingCurveBlueShadowsValue = -0.06
            pendingCurveBlueMidtonesValue = -0.02
            pendingCurveBlueHighlightsValue = 0.03
            pendingBlackPointValue = 0.03
            pendingWhitePointValue = 0.96
        case .highContrast:
            pendingCurveShadowsValue = -0.32
            pendingCurveMidtonesValue = 0.02
            pendingCurveHighlightsValue = 0.28
            pendingCurveRedShadowsValue = 0
            pendingCurveRedMidtonesValue = 0
            pendingCurveRedHighlightsValue = 0
            pendingCurveGreenShadowsValue = 0
            pendingCurveGreenMidtonesValue = 0
            pendingCurveGreenHighlightsValue = 0
            pendingCurveBlueShadowsValue = 0
            pendingCurveBlueMidtonesValue = 0
            pendingCurveBlueHighlightsValue = 0
            pendingBlackPointValue = 0.05
            pendingWhitePointValue = 0.95
        }
    }

    func applyVideoCurvePreset(_ preset: IVEColorCurvePreset) {
        switch preset {
        case .neutral:
            pendingVideoCurveShadowsValue = 0
            pendingVideoCurveMidtonesValue = 0
            pendingVideoCurveHighlightsValue = 0
            pendingVideoCurveRedShadowsValue = 0
            pendingVideoCurveRedMidtonesValue = 0
            pendingVideoCurveRedHighlightsValue = 0
            pendingVideoCurveGreenShadowsValue = 0
            pendingVideoCurveGreenMidtonesValue = 0
            pendingVideoCurveGreenHighlightsValue = 0
            pendingVideoCurveBlueShadowsValue = 0
            pendingVideoCurveBlueMidtonesValue = 0
            pendingVideoCurveBlueHighlightsValue = 0
            pendingVideoBlackPointValue = 0
            pendingVideoWhitePointValue = 1
        case .film:
            pendingVideoCurveShadowsValue = -0.18
            pendingVideoCurveMidtonesValue = 0.08
            pendingVideoCurveHighlightsValue = 0.14
            pendingVideoCurveRedShadowsValue = 0.04
            pendingVideoCurveRedMidtonesValue = 0.06
            pendingVideoCurveRedHighlightsValue = 0.05
            pendingVideoCurveGreenShadowsValue = -0.02
            pendingVideoCurveGreenMidtonesValue = 0
            pendingVideoCurveGreenHighlightsValue = 0.02
            pendingVideoCurveBlueShadowsValue = -0.06
            pendingVideoCurveBlueMidtonesValue = -0.02
            pendingVideoCurveBlueHighlightsValue = 0.03
            pendingVideoBlackPointValue = 0.03
            pendingVideoWhitePointValue = 0.96
        case .highContrast:
            pendingVideoCurveShadowsValue = -0.32
            pendingVideoCurveMidtonesValue = 0.02
            pendingVideoCurveHighlightsValue = 0.28
            pendingVideoCurveRedShadowsValue = 0
            pendingVideoCurveRedMidtonesValue = 0
            pendingVideoCurveRedHighlightsValue = 0
            pendingVideoCurveGreenShadowsValue = 0
            pendingVideoCurveGreenMidtonesValue = 0
            pendingVideoCurveGreenHighlightsValue = 0
            pendingVideoCurveBlueShadowsValue = 0
            pendingVideoCurveBlueMidtonesValue = 0
            pendingVideoCurveBlueHighlightsValue = 0
            pendingVideoBlackPointValue = 0.05
            pendingVideoWhitePointValue = 0.95
        }
    }

    func resetImageToOriginal() {
        guard !isImageResetInProgress else { return }
        isImageResetInProgress = true
        imageProcessingStartedAt = Date()
        defer {
            isImageResetInProgress = false
            imageProcessingStartedAt = nil
        }
        guard let selectedImage = selectedImageAsset else { return }
        guard let session else { return }
        activeImageTool = .adjust
        let imageID = selectedImage.id

        var operations: [IVEEditOperation] = []
        let exposure = effectiveExposure(for: imageID)
        if abs(exposure) > 0.0001 {
            operations.append(.imageExposure(assetID: imageID, value: -exposure))
        }
        let contrast = effectiveContrast(for: imageID)
        if contrast != 0, abs(contrast - 1) > 0.0001 {
            operations.append(.imageContrast(assetID: imageID, value: 1 / contrast))
        }
        let saturation = effectiveSaturation(for: imageID)
        if saturation != 0, abs(saturation - 1) > 0.0001 {
            operations.append(.imageSaturation(assetID: imageID, value: 1 / saturation))
        }
        let temperature = effectiveTemperature(for: imageID)
        if abs(temperature) > 0.0001 {
            operations.append(.imageTemperature(assetID: imageID, value: -temperature))
        }
        let tint = effectiveTint(for: imageID)
        if abs(tint) > 0.0001 {
            operations.append(.imageTint(assetID: imageID, value: -tint))
        }
        let curveShadows = effectiveCurveShadows(for: imageID)
        if abs(curveShadows) > 0.0001 {
            operations.append(.imageCurveShadows(assetID: imageID, value: -curveShadows))
        }
        let curveMidtones = effectiveCurveMidtones(for: imageID)
        if abs(curveMidtones) > 0.0001 {
            operations.append(.imageCurveMidtones(assetID: imageID, value: -curveMidtones))
        }
        let curveHighlights = effectiveCurveHighlights(for: imageID)
        if abs(curveHighlights) > 0.0001 {
            operations.append(.imageCurveHighlights(assetID: imageID, value: -curveHighlights))
        }
        let colorCurveSettings = effectiveColorCurveSettings(for: imageID)
        if colorCurveSettings != .identity {
            operations.append(.imageColorCurve(assetID: imageID, settings: .identity))
        }
        let denoise = effectiveDenoise(for: imageID)
        if abs(denoise) > 0.0001 {
            operations.append(.imageDenoise(assetID: imageID, value: -denoise))
        }
        let sharpen = effectiveSharpen(for: imageID)
        if abs(sharpen) > 0.0001 {
            operations.append(.imageSharpen(assetID: imageID, value: -sharpen))
        }
        let rotation = effectiveRotation(for: imageID)
        if abs(rotation) > 0.0001 {
            operations.append(.imageRotation(assetID: imageID, degrees: -rotation))
        }
        if effectiveMirrorHorizontal(for: imageID) {
            operations.append(.imageMirrorHorizontal(assetID: imageID))
        }
        if effectiveMirrorVertical(for: imageID) {
            operations.append(.imageMirrorVertical(assetID: imageID))
        }
        if effectiveCropRect(for: imageID) != .full || abs(effectiveScale(for: imageID) - 1) > 0.0001 {
            operations.append(.imageCrop(assetID: imageID, rect: .full, scale: 1))
        }
        if effectiveFilterPreset(for: imageID) != .none {
            operations.append(.imageFilter(assetID: imageID, preset: .none))
        }

        guard !operations.isEmpty else {
            resetPendingAdjustments()
            aiStatusMessage = nil
            return
        }
        session.applyMany(operations)
        let next = session.snapshot
        persist(snapshot: next, resetSession: false)
        syncPendingAdjustmentsToCurrentImage()
        aiStatusMessage = nil
    }
    func resetVideoToOriginal() {
        guard !isVideoResetInProgress else { return }
        isVideoResetInProgress = true
        videoProcessingStartedAt = Date()
        defer {
            isVideoResetInProgress = false
            videoProcessingStartedAt = nil
        }
        guard let selectedVideo = selectedVideoAsset else { return }
        activeVideoTool = .adjust
        let videoID = selectedVideo.id
        guard var current = snapshot else { return }

        let clipIDsForAsset = Set(current.timeline.clips.filter { $0.assetID == videoID }.map(\.id))
        current.operations.removeAll { operation in
            switch operation {
            case let .videoExposure(id, _),
                 let .videoContrast(id, _),
                 let .videoSaturation(id, _),
                 let .videoTemperature(id, _),
                 let .videoTint(id, _),
                 let .videoCurveShadows(id, _),
                 let .videoCurveMidtones(id, _),
                 let .videoCurveHighlights(id, _),
                 let .videoColorCurve(id, _),
                 let .videoRotation(id, _),
                 let .videoFilter(id, _),
                 let .videoCrop(id, _, _),
                 let .videoCropMode(id, _),
                 let .applyCaptions(id, _):
                return id == videoID
            case let .videoMirrorHorizontal(id),
                 let .videoMirrorVertical(id):
                return id == videoID
            case let .videoTrim(clipID, _, _):
                return clipIDsForAsset.contains(clipID)
            default:
                return false
            }
        }

        if let selectedClipID,
           let clip = current.timeline.clips.first(where: { $0.id == selectedClipID && $0.assetID == videoID }) {
            let resetDuration = max(0.1, selectedVideoDurationSeconds)
            if abs(clip.durationSeconds - resetDuration) > 0.0001 {
                current.operations.append(.videoTrim(clipID: selectedClipID, start: 0, duration: resetDuration))
            }
        }

        current.savedAt = Date()
        persist(snapshot: current, resetSession: true)
        syncPendingVideoAdjustmentsToCurrentVideo()
    }
    func apply(operation: IVEEditOperation) {
        guard let session else { return }
        session.apply(operation)
        let next = session.snapshot
        persist(snapshot: next, resetSession: false)
    }
    func undo() {
        guard !isHistoryChangeInProgress else { return }
        isHistoryChangeInProgress = true
        defer { isHistoryChangeInProgress = false }
        guard let session else { return }
        guard let next = session.undo() else { return }
        persist(snapshot: next, resetSession: false)
        syncPendingAdjustmentsToCurrentImage()
        syncPendingVideoAdjustmentsToCurrentVideo()
    }
    func redo() {
        guard !isHistoryChangeInProgress else { return }
        isHistoryChangeInProgress = true
        defer { isHistoryChangeInProgress = false }
        guard let session else { return }
        guard let next = session.redo() else { return }
        persist(snapshot: next, resetSession: false)
        syncPendingAdjustmentsToCurrentImage()
        syncPendingVideoAdjustmentsToCurrentVideo()
    }
    func refreshHistoryAvailability() {
        guard let session else {
            canUndo = false
            canRedo = false
            return
        }
        canUndo = session.canUndo()
        canRedo = session.canRedo()
    }
    func buildTimelineFromVideos() {
        guard !isVideoBuildTimelineInProgress else { return }
        isVideoBuildTimelineInProgress = true
        videoProcessingStartedAt = Date()
        defer {
            isVideoBuildTimelineInProgress = false
            videoProcessingStartedAt = nil
        }
        let videos = importedAssets.filter { $0.kind == .video }
        guard !videos.isEmpty, var current = snapshot else { return }
        var start = 0.0
        let clips = videos.map { asset -> IVEVideoClip in
            defer { start += 5 }
            return IVEVideoClip(assetID: asset.id, startSeconds: start, durationSeconds: 5)
        }
        current.timeline = IVEVideoTimeline(clips: clips)
        current.savedAt = Date()
        selectedClipID = clips.first?.id
        selectedVideoAssetID = clips.first?.assetID
        trimStart = 0
        trimDuration = clips.first?.durationSeconds ?? 5
        persist(snapshot: current, resetSession: true)
    }
    func trimSelectedClip() {
        guard !isVideoTrimInProgress else { return }
        isVideoTrimInProgress = true
        videoProcessingStartedAt = Date()
        defer {
            isVideoTrimInProgress = false
            videoProcessingStartedAt = nil
        }
        guard let clipID = selectedClipID else { return }
        apply(operation: .videoTrim(clipID: clipID, start: trimStart, duration: trimDuration))
    }
    func splitSelectedClip() {
        guard !isVideoSplitInProgress else { return }
        isVideoSplitInProgress = true
        videoProcessingStartedAt = Date()
        defer {
            isVideoSplitInProgress = false
            videoProcessingStartedAt = nil
        }
        guard let clipID = selectedClipID, var current = snapshot else { return }
        guard let clip = current.timeline.clips.first(where: { $0.id == clipID }) else { return }
        let splitAt = clip.startSeconds + (clip.durationSeconds / 2)
        current.timeline = current.timeline.split(clipID: clipID, at: splitAt)
        current.savedAt = Date()
        persist(snapshot: current, resetSession: true)
    }
    func rippleDeleteSelectedClip() {
        guard !isVideoRippleDeleteInProgress else { return }
        isVideoRippleDeleteInProgress = true
        videoProcessingStartedAt = Date()
        defer {
            isVideoRippleDeleteInProgress = false
            videoProcessingStartedAt = nil
        }
        guard let clipID = selectedClipID, var current = snapshot else { return }
        current.timeline = current.timeline.rippleDelete(clipID: clipID)
        current.savedAt = Date()
        selectedClipID = current.timeline.clips.first?.id
        trimStart = 0
        trimDuration = current.timeline.clips.first?.durationSeconds ?? 5
        persist(snapshot: current, resetSession: true)
    }
    func autoCaptions() {
        guard let provider = services.aiProvider else {
            aiStatusMessage = "No AI provider available."
            return
        }
        guard let video = selectedVideoAsset ?? importedAssets.first(where: { $0.kind == .video }) else {
            aiStatusMessage = "Import a video first."
            return
        }
        do {
            let captions = try provider.generateCaptions(for: video.id, languageCode: "en")
            apply(operation: .applyCaptions(assetID: video.id, captions: captions))
            if let first = captions.first {
                aiStatusMessage = "Generated \(captions.count) captions. First: \"\(first.text)\""
            } else {
                aiStatusMessage = "AI returned no captions for this video."
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
    func removeBackground() {
        guard !isImageAIOperationInProgress else { return }
        isImageAIOperationInProgress = true
        imageProcessingStartedAt = Date()
        defer {
            isImageAIOperationInProgress = false
            imageProcessingStartedAt = nil
        }
        guard let provider = services.aiProvider else {
            aiStatusMessage = "No AI provider available."
            return
        }
        guard let image = selectedImageAsset ?? importedAssets.first(where: { $0.kind == .image }),
              let sourceURL = displayURL(for: image) else {
            aiStatusMessage = "Import an image first."
            return
        }
        do {
            let derivedID = try provider.removeBackground(from: image.id)
            let derivedURL = try runImageProcessing {
                try makeBackgroundRemovedPreviewFile(
                    from: sourceURL,
                    identifier: derivedID.uuidString
                )
            }
            try replaceImageSource(for: image.id, with: derivedURL.path)
            aiStatusMessage = "Background removal applied."
        } catch {
            errorMessage = error.localizedDescription
        }
    }
    func applyBackgroundReplacement(style: IVEBackgroundReplacementStyle) {
        guard !isImageAIOperationInProgress else { return }
        isImageAIOperationInProgress = true
        imageProcessingStartedAt = Date()
        defer {
            isImageAIOperationInProgress = false
            imageProcessingStartedAt = nil
        }
        guard let image = selectedImageAsset ?? importedAssets.first(where: { $0.kind == .image }),
              let sourceURL = displayURL(for: image) else {
            aiStatusMessage = "Import an image first."
            return
        }
        do {
            let outputURL = try runImageProcessing {
                try makeBackgroundReplacedImageFile(from: sourceURL, style: style)
            }
            try replaceImageSource(for: image.id, with: outputURL.path)
            aiStatusMessage = "Background updated."
            services.telemetry.track(event: "image_background_changed", metadata: ["project": project.displayName])
        } catch {
            errorMessage = error.localizedDescription
        }
    }
    func removeDetectedSubjectObject() {
        guard !isImageAIOperationInProgress else { return }
        isImageAIOperationInProgress = true
        imageProcessingStartedAt = Date()
        defer {
            isImageAIOperationInProgress = false
            imageProcessingStartedAt = nil
        }
        guard let image = selectedImageAsset ?? importedAssets.first(where: { $0.kind == .image }),
              let sourceURL = displayURL(for: image) else {
            aiStatusMessage = "Import an image first."
            return
        }
        do {
            let outputURL = try runImageProcessing {
                try makeSubjectRemovedImageFile(from: sourceURL)
            }
            try replaceImageSource(for: image.id, with: outputURL.path)
            aiStatusMessage = "Detected subject removed."
            services.telemetry.track(event: "image_subject_removed", metadata: ["project": project.displayName])
        } catch {
            errorMessage = error.localizedDescription
        }
    }
    func replaceImageSource(for imageID: UUID, with localIdentifier: String) throws {
        guard let session else {
            throw NSError(
                domain: "IVEEditor",
                code: 3020,
                userInfo: [NSLocalizedDescriptionKey: iveLocalized("Editing session is unavailable.")]
            )
        }
        let didReplace = session.replaceMediaAssetLocalIdentifier(
            assetID: imageID,
            localIdentifier: localIdentifier
        )
        guard didReplace else {
            throw NSError(
                domain: "IVEEditor",
                code: 3021,
                userInfo: [NSLocalizedDescriptionKey: iveLocalized("Unable to update image source in session history.")]
            )
        }
        let next = session.snapshot
        persist(snapshot: next, resetSession: false)
        selectedLibraryAssetID = imageID
        selectedImageAssetID = imageID
    }

    func runImageProcessing<T>(_ operation: @escaping () throws -> T) throws -> T {
        try operation()
    }

    func makeBackgroundReplacedImageFile(from sourceURL: URL, style: IVEBackgroundReplacementStyle) throws -> URL {
        guard let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
              let sourceCG = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
            throw NSError(domain: "IVEEditor", code: 3010, userInfo: [NSLocalizedDescriptionKey: iveLocalized("Unable to load source image for background replacement.")])
        }

        let visionInput = try makeVisionCompatibleImage(from: sourceCG, maxDimension: 2048)
        let input = CIImage(cgImage: visionInput)
        let alphaMask = try makePersonSegmentationMask(for: visionInput, targetExtent: input.extent)

        let background: CIImage
        switch style {
        case .white:
            background = CIImage(color: .white).cropped(to: input.extent)
        case .black:
            background = CIImage(color: .black).cropped(to: input.extent)
        case .blurred:
            let blur = CIFilter.gaussianBlur()
            blur.inputImage = input.clampedToExtent()
            blur.radius = 28
            background = (blur.outputImage ?? input).cropped(to: input.extent)
        }

        let blend = CIFilter.blendWithMask()
        blend.inputImage = input
        blend.backgroundImage = background
        blend.maskImage = alphaMask
        let output = (blend.outputImage ?? input).cropped(to: input.extent)

        let context = CIContext(options: [.useSoftwareRenderer: true])
        guard let cgImage = context.createCGImage(output, from: output.extent.integral) else {
            throw NSError(domain: "IVEEditor", code: 3011, userInfo: [NSLocalizedDescriptionKey: iveLocalized("Unable to render background replacement image.")])
        }

        let outputURL = try importsDirectoryURL().appendingPathComponent(
            constrainedFileName(sourceURL: sourceURL, prefix: "bg", fallbackExtension: "png")
        )
        guard let destination = CGImageDestinationCreateWithURL(outputURL as CFURL, UTType.png.identifier as CFString, 1, nil) else {
            throw NSError(domain: "IVEEditor", code: 3012, userInfo: [NSLocalizedDescriptionKey: iveLocalized("Unable to prepare background replacement output file.")])
        }
        CGImageDestinationAddImage(destination, cgImage, nil)
        guard CGImageDestinationFinalize(destination) else {
            throw NSError(domain: "IVEEditor", code: 3013, userInfo: [NSLocalizedDescriptionKey: iveLocalized("Unable to save background replacement image.")])
        }
        return outputURL
    }

    func makeSubjectRemovedImageFile(from sourceURL: URL) throws -> URL {
        guard let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
              let sourceCG = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
            throw NSError(domain: "IVEEditor", code: 3014, userInfo: [NSLocalizedDescriptionKey: iveLocalized("Unable to load source image for object removal.")])
        }

        let visionInput = try makeVisionCompatibleImage(from: sourceCG, maxDimension: 2048)
        let input = CIImage(cgImage: visionInput)
        let alphaMask = try makePersonSegmentationMask(for: visionInput, targetExtent: input.extent)

        let blur = CIFilter.gaussianBlur()
        blur.inputImage = input.clampedToExtent()
        blur.radius = 24
        let blurredBackground = (blur.outputImage ?? input).cropped(to: input.extent)

        let blend = CIFilter.blendWithMask()
        // Where mask is white (detected person), use blurred background to hide subject.
        blend.inputImage = blurredBackground
        blend.backgroundImage = input
        blend.maskImage = alphaMask
        let output = (blend.outputImage ?? input).cropped(to: input.extent)

        let context = CIContext(options: [.useSoftwareRenderer: true])
        guard let cgImage = context.createCGImage(output, from: output.extent.integral) else {
            throw NSError(domain: "IVEEditor", code: 3015, userInfo: [NSLocalizedDescriptionKey: iveLocalized("Unable to render object removal image.")])
        }

        let outputURL = try importsDirectoryURL().appendingPathComponent(
            constrainedFileName(sourceURL: sourceURL, prefix: "objremove", fallbackExtension: "png")
        )
        guard let destination = CGImageDestinationCreateWithURL(outputURL as CFURL, UTType.png.identifier as CFString, 1, nil) else {
            throw NSError(domain: "IVEEditor", code: 3016, userInfo: [NSLocalizedDescriptionKey: iveLocalized("Unable to prepare object removal output file.")])
        }
        CGImageDestinationAddImage(destination, cgImage, nil)
        guard CGImageDestinationFinalize(destination) else {
            throw NSError(domain: "IVEEditor", code: 3017, userInfo: [NSLocalizedDescriptionKey: iveLocalized("Unable to save object removal image.")])
        }
        return outputURL
    }

    func makeBackgroundRemovedPreviewFile(from sourceURL: URL, identifier: String) throws -> URL {
        guard let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
              let sourceCG = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
            throw NSError(domain: "IVEEditor", code: 3001, userInfo: [NSLocalizedDescriptionKey: iveLocalized("Unable to load source image for background removal.")])
        }

        let visionInput = try makeVisionCompatibleImage(from: sourceCG, maxDimension: 2048)
        let input = CIImage(cgImage: visionInput)
        var alphaMask = try makePersonSegmentationMask(for: visionInput, targetExtent: input.extent)

        // Slight feathering avoids hard mask edges.
        if let blur = CIFilter(name: "CIGaussianBlur") {
            blur.setValue(alphaMask, forKey: kCIInputImageKey)
            blur.setValue(0.8, forKey: kCIInputRadiusKey)
            if let blurred = blur.outputImage {
                alphaMask = blurred.cropped(to: input.extent)
            }
        }

        let transparentBG = CIImage(color: .clear).cropped(to: input.extent)
        let blend = CIFilter.blendWithMask()
        blend.inputImage = input
        blend.backgroundImage = transparentBG
        blend.maskImage = alphaMask
        let output = (blend.outputImage ?? input).cropped(to: input.extent)

        let context = CIContext(options: [.useSoftwareRenderer: true])
        guard let cgImage = context.createCGImage(output, from: output.extent.integral) else {
            throw NSError(domain: "IVEEditor", code: 3002, userInfo: [NSLocalizedDescriptionKey: iveLocalized("Unable to render background removal preview.")])
        }

        let outputURL = try importsDirectoryURL().appendingPathComponent("ai-bg-\(identifier).png")
        guard let destination = CGImageDestinationCreateWithURL(outputURL as CFURL, UTType.png.identifier as CFString, 1, nil) else {
            throw NSError(domain: "IVEEditor", code: 3003, userInfo: [NSLocalizedDescriptionKey: iveLocalized("Unable to prepare background removal output file.")])
        }
        CGImageDestinationAddImage(destination, cgImage, nil)
        guard CGImageDestinationFinalize(destination) else {
            throw NSError(domain: "IVEEditor", code: 3004, userInfo: [NSLocalizedDescriptionKey: iveLocalized("Unable to save background removal preview.")])
        }

        return outputURL
    }

    func makePersonSegmentationMask(for image: CGImage, targetExtent: CGRect) throws -> CIImage {
        let request = VNGeneratePersonSegmentationRequest()
        request.qualityLevel = .accurate
        request.outputPixelFormat = kCVPixelFormatType_OneComponent8
        request.preferBackgroundProcessing = true

        let handler = VNImageRequestHandler(cgImage: image, options: [:])
        try handler.perform([request])
        guard let observation = request.results?.first else {
            throw NSError(domain: "IVEEditor", code: 3005, userInfo: [NSLocalizedDescriptionKey: iveLocalized("No person detected for background removal.")])
        }

        var mask = CIImage(cvPixelBuffer: observation.pixelBuffer)
        let scaleX = targetExtent.width / max(1, mask.extent.width)
        let scaleY = targetExtent.height / max(1, mask.extent.height)
        mask = mask
            .transformed(by: CGAffineTransform(scaleX: scaleX, y: scaleY))
            .cropped(to: targetExtent)
        return mask
    }

    func makeVisionCompatibleImage(from image: CGImage, maxDimension: Int) throws -> CGImage {
        let sourceWidth = image.width
        let sourceHeight = image.height
        guard sourceWidth > 0, sourceHeight > 0 else {
            throw NSError(domain: "IVEEditor", code: 3007, userInfo: [NSLocalizedDescriptionKey: iveLocalized("Invalid source image dimensions.")])
        }

        let largest = max(sourceWidth, sourceHeight)
        let scale = min(1.0, Double(maxDimension) / Double(largest))
        let targetWidth = max(1, Int((Double(sourceWidth) * scale).rounded()))
        let targetHeight = max(1, Int((Double(sourceHeight) * scale).rounded()))

        let colorSpace = CGColorSpaceCreateDeviceRGB()
        guard let context = CGContext(
            data: nil,
            width: targetWidth,
            height: targetHeight,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
            throw NSError(domain: "IVEEditor", code: 3008, userInfo: [NSLocalizedDescriptionKey: iveLocalized("Unable to prepare image context for background removal.")])
        }

        context.interpolationQuality = .high
        context.draw(image, in: CGRect(x: 0, y: 0, width: targetWidth, height: targetHeight))
        guard let result = context.makeImage() else {
            throw NSError(domain: "IVEEditor", code: 3009, userInfo: [NSLocalizedDescriptionKey: iveLocalized("Unable to prepare image for Vision background removal.")])
        }
        return result
    }

    func handleFileImportResult(_ result: Result<[URL], any Error>) {
        do {
            let urls = try result.get()
            var lastImportedID: UUID?
            for sourceURL in urls {
                let didAccess = sourceURL.startAccessingSecurityScopedResource()
                defer {
                    if didAccess { sourceURL.stopAccessingSecurityScopedResource() }
                }
                let copied = try copyImportedFileToAppSupport(sourceURL)
                let created = try services.mediaStore.ingestMedia(
                    localIdentifier: copied.path,
                    kind: mediaKind(from: copied),
                    into: project
                )
                lastImportedID = created.id
            }
            loadMediaAssets()
            if let lastImportedID {
                selectedLibraryAssetID = lastImportedID
                if importedAssets.first(where: { $0.id == lastImportedID })?.kind == .image {
                    selectedImageAssetID = lastImportedID
                }
            }
            services.telemetry.track(event: "media_import_files", metadata: ["count": String(urls.count)])
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    #if os(iOS)
    func importFromPhotosPicker(_ items: [PhotosPickerItem]) {
        defer { photoSelections = [] }
        do {
            var lastCreated: IVEMediaAssetRef?
            for item in items {
                let kind: IVEMediaKind = item.supportedContentTypes.contains(where: { $0.conforms(to: .movie) }) ? .video : .image
                let fallback = item.itemIdentifier ?? UUID().uuidString
                let created = try services.mediaStore.ingestMedia(localIdentifier: fallback, kind: kind, into: project)
                lastCreated = created
            }
            loadMediaAssets()
            if let created = lastCreated {
                selectedLibraryAssetID = created.id
                if created.kind == .image {
                    selectedImageAssetID = created.id
                }
            }
            services.telemetry.track(event: "media_import_photos", metadata: ["count": String(items.count)])
        } catch {
            errorMessage = error.localizedDescription
        }
    }
    #endif

    func displayURL(for asset: IVEMediaAssetRef) -> URL? {
        let url = URL(fileURLWithPath: asset.localIdentifier)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    func mediaKind(from url: URL) -> IVEMediaKind {
        guard let type = UTType(filenameExtension: url.pathExtension.lowercased()) else { return .image }
        if type.conforms(to: .movie) { return .video }
        if type.conforms(to: .audio) { return .audio }
        return .image
    }

    private func makeCalibrationReferenceAssetFileURL() -> URL? {
        let data: Data?
        #if os(iOS)
        data = UIImage(named: "CalibrationReference")?.pngData()
        #elseif os(macOS)
        if let image = NSImage(named: "CalibrationReference"),
           let tiffData = image.tiffRepresentation,
           let bitmap = NSBitmapImageRep(data: tiffData) {
            data = bitmap.representation(using: .png, properties: [:])
        } else {
            data = nil
        }
        #else
        data = nil
        #endif

        guard let data else { return nil }
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("ive-calibration-reference-\(UUID().uuidString)")
            .appendingPathExtension("png")
        do {
            try data.write(to: url, options: .atomic)
            return url
        } catch {
            return nil
        }
    }

    func effectiveExposure(for assetID: UUID) -> Double {
        guard let operations = snapshot?.operations else { return 0 }
        return operations.reduce(0) { partial, operation in
            if case let .imageExposure(id, value) = operation, id == assetID {
                return partial + value
            }
            return partial
        }
    }

    func effectiveContrast(for assetID: UUID) -> Double {
        guard let operations = snapshot?.operations else { return 1 }
        return operations.reduce(1) { partial, operation in
            if case let .imageContrast(id, value) = operation, id == assetID {
                return partial * value
            }
            return partial
        }
    }

    func effectiveSaturation(for assetID: UUID) -> Double {
        guard let operations = snapshot?.operations else { return 1 }
        return operations.reduce(1) { partial, operation in
            if case let .imageSaturation(id, value) = operation, id == assetID {
                return partial * value
            }
            return partial
        }
    }

    func effectiveTemperature(for assetID: UUID) -> Double {
        guard let operations = snapshot?.operations else { return 0 }
        return operations.reduce(0) { partial, operation in
            if case let .imageTemperature(id, value) = operation, id == assetID {
                return partial + value
            }
            return partial
        }
    }

    func effectiveTint(for assetID: UUID) -> Double {
        guard let operations = snapshot?.operations else { return 0 }
        return operations.reduce(0) { partial, operation in
            if case let .imageTint(id, value) = operation, id == assetID {
                return partial + value
            }
            return partial
        }
    }

    func effectiveCurveShadows(for assetID: UUID) -> Double {
        if let settings = snapshot?.operations.reversed().compactMap({ operation -> IVEColorCurveSettings? in
            if case let .imageColorCurve(id, settings) = operation, id == assetID {
                return settings
            }
            return nil
        }).first {
            return settings.masterShadows
        }
        guard let operations = snapshot?.operations else { return 0 }
        return operations.reduce(0) { partial, operation in
            if case let .imageCurveShadows(id, value) = operation, id == assetID {
                return partial + value
            }
            return partial
        }
    }

    func effectiveCurveMidtones(for assetID: UUID) -> Double {
        if let settings = snapshot?.operations.reversed().compactMap({ operation -> IVEColorCurveSettings? in
            if case let .imageColorCurve(id, settings) = operation, id == assetID {
                return settings
            }
            return nil
        }).first {
            return settings.masterMidtones
        }
        guard let operations = snapshot?.operations else { return 0 }
        return operations.reduce(0) { partial, operation in
            if case let .imageCurveMidtones(id, value) = operation, id == assetID {
                return partial + value
            }
            return partial
        }
    }

    func effectiveCurveHighlights(for assetID: UUID) -> Double {
        if let settings = snapshot?.operations.reversed().compactMap({ operation -> IVEColorCurveSettings? in
            if case let .imageColorCurve(id, settings) = operation, id == assetID {
                return settings
            }
            return nil
        }).first {
            return settings.masterHighlights
        }
        guard let operations = snapshot?.operations else { return 0 }
        return operations.reduce(0) { partial, operation in
            if case let .imageCurveHighlights(id, value) = operation, id == assetID {
                return partial + value
            }
            return partial
        }
    }

    func effectiveDenoise(for assetID: UUID) -> Double {
        guard let operations = snapshot?.operations else { return 0 }
        return operations.reduce(0) { partial, operation in
            if case let .imageDenoise(id, value) = operation, id == assetID {
                return partial + value
            }
            return partial
        }
    }

    func effectiveSharpen(for assetID: UUID) -> Double {
        guard let operations = snapshot?.operations else { return 0 }
        return operations.reduce(0) { partial, operation in
            if case let .imageSharpen(id, value) = operation, id == assetID {
                return partial + value
            }
            return partial
        }
    }

    func effectiveRotation(for assetID: UUID) -> Double {
        guard let operations = snapshot?.operations else { return 0 }
        return operations.reduce(0) { partial, operation in
            if case let .imageRotation(id, degrees) = operation, id == assetID {
                return partial + degrees
            }
            return partial
        }
    }

    func effectiveMirrorHorizontal(for assetID: UUID) -> Bool {
        guard let operations = snapshot?.operations else { return false }
        let flips = operations.reduce(0) { partial, operation in
            if case let .imageMirrorHorizontal(id) = operation, id == assetID {
                return partial + 1
            }
            return partial
        }
        return flips.isMultiple(of: 2) == false
    }

    func effectiveMirrorVertical(for assetID: UUID) -> Bool {
        guard let operations = snapshot?.operations else { return false }
        let flips = operations.reduce(0) { partial, operation in
            if case let .imageMirrorVertical(id) = operation, id == assetID {
                return partial + 1
            }
            return partial
        }
        return flips.isMultiple(of: 2) == false
    }

    func effectiveCropRect(for assetID: UUID) -> IVENormalizedRect {
        guard let operations = snapshot?.operations else { return .full }
        return operations.reversed().compactMap { operation in
            if case let .imageCrop(id, rect, _) = operation, id == assetID {
                return rect
            }
            return nil
        }.first ?? .full
    }

    func effectiveScale(for assetID: UUID) -> Double {
        guard let operations = snapshot?.operations else { return 1 }
        return operations.reversed().compactMap { operation in
            if case let .imageCrop(id, _, scale) = operation, id == assetID {
                return scale
            }
            return nil
        }.first ?? 1
    }

    func effectiveVideoCropRect(for assetID: UUID) -> IVENormalizedRect {
        guard let operations = snapshot?.operations else { return .full }
        return operations.reversed().compactMap { operation in
            if case let .videoCrop(id, rect, _) = operation, id == assetID {
                return rect
            }
            return nil
        }.first ?? .full
    }

    func effectiveVideoScale(for assetID: UUID) -> Double {
        guard let operations = snapshot?.operations else { return 1 }
        return operations.reversed().compactMap { operation in
            if case let .videoCrop(id, _, scale) = operation, id == assetID {
                return scale
            }
            return nil
        }.first ?? 1
    }

    func effectiveVideoCropMode(for assetID: UUID) -> IVEVideoCropMode {
        guard let operations = snapshot?.operations else { return .fit }
        return operations.reversed().compactMap { operation in
            if case let .videoCropMode(id, mode) = operation, id == assetID {
                return mode
            }
            return nil
        }.first ?? .fit
    }

    func effectiveVideoExposure(for assetID: UUID) -> Double {
        guard let operations = snapshot?.operations else { return 0 }
        return operations.reduce(0) { partial, operation in
            if case let .videoExposure(id, value) = operation, id == assetID {
                return partial + value
            }
            return partial
        }
    }

    func effectiveVideoContrast(for assetID: UUID) -> Double {
        guard let operations = snapshot?.operations else { return 1 }
        return operations.reduce(1) { partial, operation in
            if case let .videoContrast(id, value) = operation, id == assetID {
                return partial * value
            }
            return partial
        }
    }

    func effectiveVideoSaturation(for assetID: UUID) -> Double {
        guard let operations = snapshot?.operations else { return 1 }
        return operations.reduce(1) { partial, operation in
            if case let .videoSaturation(id, value) = operation, id == assetID {
                return partial * value
            }
            return partial
        }
    }

    func effectiveVideoTemperature(for assetID: UUID) -> Double {
        guard let operations = snapshot?.operations else { return 0 }
        return operations.reduce(0) { partial, operation in
            if case let .videoTemperature(id, value) = operation, id == assetID {
                return partial + value
            }
            return partial
        }
    }

    func effectiveVideoTint(for assetID: UUID) -> Double {
        guard let operations = snapshot?.operations else { return 0 }
        return operations.reduce(0) { partial, operation in
            if case let .videoTint(id, value) = operation, id == assetID {
                return partial + value
            }
            return partial
        }
    }

    func effectiveVideoCurveShadows(for assetID: UUID) -> Double {
        if let settings = snapshot?.operations.reversed().compactMap({ operation -> IVEColorCurveSettings? in
            if case let .videoColorCurve(id, settings) = operation, id == assetID {
                return settings
            }
            return nil
        }).first {
            return settings.masterShadows
        }
        guard let operations = snapshot?.operations else { return 0 }
        return operations.reduce(0) { partial, operation in
            if case let .videoCurveShadows(id, value) = operation, id == assetID {
                return partial + value
            }
            return partial
        }
    }

    func effectiveVideoCurveMidtones(for assetID: UUID) -> Double {
        if let settings = snapshot?.operations.reversed().compactMap({ operation -> IVEColorCurveSettings? in
            if case let .videoColorCurve(id, settings) = operation, id == assetID {
                return settings
            }
            return nil
        }).first {
            return settings.masterMidtones
        }
        guard let operations = snapshot?.operations else { return 0 }
        return operations.reduce(0) { partial, operation in
            if case let .videoCurveMidtones(id, value) = operation, id == assetID {
                return partial + value
            }
            return partial
        }
    }

    func effectiveVideoCurveHighlights(for assetID: UUID) -> Double {
        if let settings = snapshot?.operations.reversed().compactMap({ operation -> IVEColorCurveSettings? in
            if case let .videoColorCurve(id, settings) = operation, id == assetID {
                return settings
            }
            return nil
        }).first {
            return settings.masterHighlights
        }
        guard let operations = snapshot?.operations else { return 0 }
        return operations.reduce(0) { partial, operation in
            if case let .videoCurveHighlights(id, value) = operation, id == assetID {
                return partial + value
            }
            return partial
        }
    }

    func effectiveVideoRotation(for assetID: UUID) -> Double {
        guard let operations = snapshot?.operations else { return 0 }
        return operations.reduce(0) { partial, operation in
            if case let .videoRotation(id, degrees) = operation, id == assetID {
                return partial + degrees
            }
            return partial
        }
    }

    func effectiveVideoMirrorHorizontal(for assetID: UUID) -> Bool {
        guard let operations = snapshot?.operations else { return false }
        let flips = operations.reduce(0) { partial, operation in
            if case let .videoMirrorHorizontal(id) = operation, id == assetID {
                return partial + 1
            }
            return partial
        }
        return flips.isMultiple(of: 2) == false
    }

    func effectiveVideoMirrorVertical(for assetID: UUID) -> Bool {
        guard let operations = snapshot?.operations else { return false }
        let flips = operations.reduce(0) { partial, operation in
            if case let .videoMirrorVertical(id) = operation, id == assetID {
                return partial + 1
            }
            return partial
        }
        return flips.isMultiple(of: 2) == false
    }

    func effectiveVideoFilterPreset(for assetID: UUID) -> IVEImageFilterPreset {
        guard let operations = snapshot?.operations else { return .none }
        return operations.reversed().compactMap { operation in
            if case let .videoFilter(id, preset) = operation, id == assetID {
                return preset
            }
            return nil
        }.first ?? .none
    }

    func captionsForVideo(_ assetID: UUID) -> [IVECaptionSegment] {
        guard let operations = snapshot?.operations else { return [] }
        return operations.reversed().compactMap { operation in
            if case let .applyCaptions(id, captions) = operation, id == assetID {
                return captions
            }
            return nil
        }.first ?? []
    }

    func effectiveFilterPreset(for assetID: UUID) -> IVEImageFilterPreset {
        guard let operations = snapshot?.operations else { return .none }
        return operations.reversed().compactMap { operation in
            if case let .imageFilter(id, preset) = operation, id == assetID {
                return preset
            }
            return nil
        }.first ?? .none
    }

    func effectiveColorCurveSettings(for assetID: UUID) -> IVEColorCurveSettings {
        if let settings = snapshot?.operations.reversed().compactMap({ operation -> IVEColorCurveSettings? in
            if case let .imageColorCurve(id, settings) = operation, id == assetID {
                return settings
            }
            return nil
        }).first {
            return settings
        }
        return IVEColorCurveSettings(
            masterShadows: effectiveCurveShadows(for: assetID),
            masterMidtones: effectiveCurveMidtones(for: assetID),
            masterHighlights: effectiveCurveHighlights(for: assetID)
        )
    }

    func effectiveVideoColorCurveSettings(for assetID: UUID) -> IVEColorCurveSettings {
        if let settings = snapshot?.operations.reversed().compactMap({ operation -> IVEColorCurveSettings? in
            if case let .videoColorCurve(id, settings) = operation, id == assetID {
                return settings
            }
            return nil
        }).first {
            return settings
        }
        return IVEColorCurveSettings(
            masterShadows: effectiveVideoCurveShadows(for: assetID),
            masterMidtones: effectiveVideoCurveMidtones(for: assetID),
            masterHighlights: effectiveVideoCurveHighlights(for: assetID)
        )
    }

    func label(for kind: IVEMediaKind) -> String {
        switch kind {
        case .image: return "Image"
        case .video: return "Video"
        case .audio: return "Audio"
        }
    }

    func shortName(for value: String) -> String {
        URL(fileURLWithPath: value).lastPathComponent
    }

    func shortID(_ id: UUID) -> String {
        String(id.uuidString.prefix(8))
    }

    func imageAspectRatio(for url: URL) -> CGFloat? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? CGFloat,
              let height = properties[kCGImagePropertyPixelHeight] as? CGFloat,
              height > 0 else {
            return nil
        }
        return width / height
    }

    func videoAspectRatio(for url: URL) -> CGFloat? {
        videoAspectRatioByURL[url.absoluteString]
    }

    @MainActor
    func loadVideoMetadataIfNeeded(for url: URL) async {
        let key = url.absoluteString
        if videoDurationByURL[key] != nil, videoAspectRatioByURL[key] != nil {
            return
        }

        let asset = AVURLAsset(url: url)
        if videoDurationByURL[key] == nil {
            if let duration = try? await asset.load(.duration) {
                let seconds = CMTimeGetSeconds(duration)
                if seconds.isFinite, seconds > 0 {
                    videoDurationByURL[key] = seconds
                }
            }
        }

        if videoAspectRatioByURL[key] == nil {
            if let track = (try? await asset.loadTracks(withMediaType: .video))?.first {
                let naturalSize = (try? await track.load(.naturalSize)) ?? .zero
                let preferredTransform = (try? await track.load(.preferredTransform)) ?? .identity
                let rect = CGRect(origin: .zero, size: naturalSize).applying(preferredTransform)
                let width = abs(rect.width)
                let height = abs(rect.height)
                if height > 0 {
                    videoAspectRatioByURL[key] = width / height
                }
            }
        }
    }

    func importsDirectoryURL() throws -> URL {
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            .appendingPathComponent("IVEEditorData", isDirectory: true)
            .appendingPathComponent("Imports", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }

    func copyImportedFileToAppSupport(_ sourceURL: URL) throws -> URL {
        let directory = try importsDirectoryURL()
        let target = directory.appendingPathComponent(
            constrainedFileName(sourceURL: sourceURL, prefix: "imp", fallbackExtension: "dat")
        )
        if FileManager.default.fileExists(atPath: target.path) {
            try FileManager.default.removeItem(at: target)
        }
        try FileManager.default.copyItem(at: sourceURL, to: target)
        return target
    }

    func writeImportedData(_ data: Data, kind: IVEMediaKind) throws -> URL {
        let directory = try importsDirectoryURL()
        let ext: String
        switch kind {
        case .image: ext = "jpg"
        case .video: ext = "mov"
        case .audio: ext = "m4a"
        }
        let prefix: String
        switch kind {
        case .image: prefix = "img"
        case .video: prefix = "vid"
        case .audio: prefix = "aud"
        }
        let url = directory.appendingPathComponent(
            constrainedFileName(sourceURL: nil, prefix: prefix, fallbackExtension: ext)
        )
        try data.write(to: url, options: [.atomic])
        return url
    }

    func makeCroppedImageFile(
        from sourceURL: URL,
        cropRect: IVENormalizedRect,
        scale: Double,
        renderState: ImageRenderState
    ) throws -> URL {
        var image: CIImage
        if let ci = CIImage(contentsOf: sourceURL) {
            image = ci
        } else if let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
                  let cg = CGImageSourceCreateImageAtIndex(source, 0, nil) {
            image = CIImage(cgImage: cg)
        } else {
            throw NSError(domain: "IVEEditor", code: 1001, userInfo: [NSLocalizedDescriptionKey: iveLocalized("Unable to load source image.")])
        }

        let baseExtent = image.extent
        let normalized = normalizedCropRect(cropRect)
        let flippedY = 1 - normalized.y - normalized.height
        let selectedRect = CGRect(
            x: baseExtent.minX + (normalized.x * baseExtent.width),
            y: baseExtent.minY + (flippedY * baseExtent.height),
            width: normalized.width * baseExtent.width,
            height: normalized.height * baseExtent.height
        )
        let safeScale = max(1, scale)
        let sampleRect = CGRect(
            x: selectedRect.midX - ((selectedRect.width / safeScale) / 2),
            y: selectedRect.midY - ((selectedRect.height / safeScale) / 2),
            width: selectedRect.width / safeScale,
            height: selectedRect.height / safeScale
        ).intersection(baseExtent)
        image = image.cropped(to: sampleRect)

        // Keep output dimension equal to the user's selected area.
        let scaleX = selectedRect.width / max(1, sampleRect.width)
        let scaleY = selectedRect.height / max(1, sampleRect.height)
        if abs(scaleX - 1) > 0.001 || abs(scaleY - 1) > 0.001 {
            image = image.transformed(by: CGAffineTransform(scaleX: scaleX, y: scaleY))
        }

        let controls = CIFilter.colorControls()
        controls.inputImage = image
        controls.brightness = Float((renderState.exposure * 0.2) + renderState.filterBrightness)
        controls.contrast = Float(renderState.contrast * renderState.filterContrast)
        controls.saturation = Float(renderState.saturation * renderState.filterSaturation)
        image = controls.outputImage ?? image

        if abs(renderState.temperature) > 0.0001 || abs(renderState.tint) > 0.0001 {
            let vectors = colorCorrectionVectors(
                temperature: renderState.temperature,
                tint: renderState.tint
            )
            let correction = CIFilter.temperatureAndTint()
            correction.inputImage = image
            correction.neutral = vectors.neutral
            correction.targetNeutral = vectors.targetNeutral
            image = correction.outputImage ?? image
        }

        image = applyToneCurve(to: image, settings: renderState.colorCurveSettings)

        if renderState.denoise > 0 {
            let denoise = CIFilter.noiseReduction()
            denoise.inputImage = image
            denoise.noiseLevel = Float(min(1, max(0, renderState.denoise)) * 0.2)
            denoise.sharpness = 0.25
            image = denoise.outputImage ?? image
        }

        if renderState.sharpen > 0 {
            let sharpen = CIFilter.sharpenLuminance()
            sharpen.inputImage = image
            sharpen.sharpness = Float(min(2, max(0, renderState.sharpen)) * 1.6)
            image = sharpen.outputImage ?? image
        }

        if renderState.filterHueRotationDegrees != 0 {
            let hue = CIFilter.hueAdjust()
            hue.inputImage = image
            hue.angle = Float(renderState.filterHueRotationDegrees * .pi / 180)
            image = hue.outputImage ?? image
        }

        var transform = CGAffineTransform.identity
        if renderState.mirrorHorizontal || renderState.mirrorVertical {
            let sx: CGFloat = renderState.mirrorHorizontal ? -1 : 1
            let sy: CGFloat = renderState.mirrorVertical ? -1 : 1
            transform = transform
                .translatedBy(x: image.extent.midX, y: image.extent.midY)
                .scaledBy(x: sx, y: sy)
                .translatedBy(x: -image.extent.midX, y: -image.extent.midY)
        }
        if renderState.rotationDegrees != 0 {
            let radians = CGFloat(renderState.rotationDegrees * .pi / 180)
            transform = transform
                .translatedBy(x: image.extent.midX, y: image.extent.midY)
                .rotated(by: radians)
                .translatedBy(x: -image.extent.midX, y: -image.extent.midY)
        }
        if transform != .identity {
            image = image.transformed(by: transform)
        }

        let context = CIContext()
        guard let outputCG = context.createCGImage(image, from: image.extent.integral) else {
            throw NSError(domain: "IVEEditor", code: 1002, userInfo: [NSLocalizedDescriptionKey: iveLocalized("Unable to render cropped image.")])
        }

        let outputURL = try importsDirectoryURL().appendingPathComponent(
            constrainedFileName(sourceURL: sourceURL, prefix: "imgedit", fallbackExtension: "jpg")
        )
        guard let destination = CGImageDestinationCreateWithURL(outputURL as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else {
            throw NSError(domain: "IVEEditor", code: 1003, userInfo: [NSLocalizedDescriptionKey: iveLocalized("Unable to prepare cropped output.")])
        }
        CGImageDestinationAddImage(destination, outputCG, nil)
        guard CGImageDestinationFinalize(destination) else {
            throw NSError(domain: "IVEEditor", code: 1004, userInfo: [NSLocalizedDescriptionKey: iveLocalized("Unable to save cropped image.")])
        }
        return outputURL
    }

    func makeCroppedVideoFile(
        from sourceURL: URL,
        cropRect: IVENormalizedRect,
        cropMode: IVEVideoCropMode,
        trimRange: CMTimeRange?,
        renderState: VideoRenderState
    ) async throws -> URL {
        let asset = AVURLAsset(url: sourceURL)
        guard (try? await asset.loadTracks(withMediaType: .video))?.first != nil else {
            throw NSError(domain: "IVEEditor", code: 2001, userInfo: [NSLocalizedDescriptionKey: iveLocalized("No video track found.")])
        }

        let outputURL = try importsDirectoryURL().appendingPathComponent(
            constrainedFileName(sourceURL: sourceURL, prefix: "videdit", fallbackExtension: "mov")
        )
        let service = IVEVideoEditingService(asset: asset)
        try await service.exportEditedVideo(
            to: outputURL,
            cropRect: cropRect,
            cropMode: cropMode,
            trimRange: trimRange,
            renderState: renderState
        )

        return outputURL
    }

    func normalizedCropRect(_ rect: IVENormalizedRect) -> IVENormalizedRect {
        let minSize = 0.02
        let width = min(1, max(minSize, rect.width))
        let height = min(1, max(minSize, rect.height))
        let x = min(1 - width, max(0, rect.x))
        let y = min(1 - height, max(0, rect.y))
        return IVENormalizedRect(x: x, y: y, width: width, height: height)
    }

    func colorCorrectionVectors(temperature: Double, tint: Double) -> (neutral: CIVector, targetNeutral: CIVector) {
        let clampedTemperature = max(-4000, min(4000, temperature))
        let clampedTint = max(-200, min(200, tint))
        let neutral = CIVector(x: 6500, y: 0)
        let targetNeutral = CIVector(
            x: 6500 + clampedTemperature,
            y: clampedTint
        )
        return (neutral, targetNeutral)
    }

    func applyToneCurve(to image: CIImage, settings: IVEColorCurveSettings) -> CIImage {
        let toneCurve = CIFilter.toneCurve()
        toneCurve.inputImage = image

        let s = max(-1, min(1, settings.masterShadows))
        let m = max(-1, min(1, settings.masterMidtones))
        let h = max(-1, min(1, settings.masterHighlights))
        let blackPoint = max(0, min(0.4, settings.blackPoint))
        let whitePoint = max(blackPoint + 0.05, min(1, settings.whitePoint))
        let span = max(0.05, whitePoint - blackPoint)

        toneCurve.point0 = CGPoint(x: 0, y: blackPoint)
        toneCurve.point1 = CGPoint(x: blackPoint + (0.25 * span), y: max(0, min(1, blackPoint + (0.25 * span) + (s * 0.2))))
        toneCurve.point2 = CGPoint(x: blackPoint + (0.5 * span), y: max(0, min(1, blackPoint + (0.5 * span) + (m * 0.2))))
        toneCurve.point3 = CGPoint(x: blackPoint + (0.75 * span), y: max(0, min(1, blackPoint + (0.75 * span) + (h * 0.2))))
        toneCurve.point4 = CGPoint(x: 1, y: whitePoint)

        var result = toneCurve.outputImage ?? image

        let redGain = 1 + (settings.redMidtones * 0.3) + (settings.redHighlights * 0.15) - (settings.redShadows * 0.1)
        let greenGain = 1 + (settings.greenMidtones * 0.3) + (settings.greenHighlights * 0.15) - (settings.greenShadows * 0.1)
        let blueGain = 1 + (settings.blueMidtones * 0.3) + (settings.blueHighlights * 0.15) - (settings.blueShadows * 0.1)
        let redBias = (settings.redHighlights - settings.redShadows) * 0.04
        let greenBias = (settings.greenHighlights - settings.greenShadows) * 0.04
        let blueBias = (settings.blueHighlights - settings.blueShadows) * 0.04

        if abs(redGain - 1) > 0.0001 || abs(greenGain - 1) > 0.0001 || abs(blueGain - 1) > 0.0001 ||
            abs(redBias) > 0.0001 || abs(greenBias) > 0.0001 || abs(blueBias) > 0.0001 {
            let matrix = CIFilter.colorMatrix()
            matrix.inputImage = result
            matrix.rVector = CIVector(x: redGain, y: 0, z: 0, w: 0)
            matrix.gVector = CIVector(x: 0, y: greenGain, z: 0, w: 0)
            matrix.bVector = CIVector(x: 0, y: 0, z: blueGain, w: 0)
            matrix.aVector = CIVector(x: 0, y: 0, z: 0, w: 1)
            matrix.biasVector = CIVector(x: redBias, y: greenBias, z: blueBias, w: 0)
            result = matrix.outputImage ?? result
        }

        return result
    }
    func promptSaveLocation(for url: URL, copyOnly: Bool = false) {
        #if os(macOS)
        let panel = NSSavePanel()
        panel.nameFieldStringValue = url.lastPathComponent.isEmpty ? saveDefaultName : url.lastPathComponent
        panel.canCreateDirectories = true
        panel.isExtensionHidden = false
        if panel.runModal() == .OK, let destination = panel.url {
            do {
                if FileManager.default.fileExists(atPath: destination.path) {
                    try FileManager.default.removeItem(at: destination)
                }
                if copyOnly {
                    try FileManager.default.copyItem(at: url, to: destination)
                } else {
                    try FileManager.default.moveItem(at: url, to: destination)
                }
                lastExportPath = destination.path
            } catch {
                errorMessage = error.localizedDescription
            }
        }
        #else
        if copyOnly {
            do {
                let copyURL = try importsDirectoryURL().appendingPathComponent(
                    constrainedFileName(sourceURL: url, prefix: "exportcopy", fallbackExtension: url.pathExtension)
                )
                if FileManager.default.fileExists(atPath: copyURL.path) {
                    try FileManager.default.removeItem(at: copyURL)
                }
                try FileManager.default.copyItem(at: url, to: copyURL)
                saveSourceURL = copyURL
            } catch {
                errorMessage = error.localizedDescription
                return
            }
        } else {
            saveSourceURL = url
        }
        saveDefaultName = url.deletingPathExtension().lastPathComponent
        showingSaveLocationPicker = true
        #endif
    }
}
