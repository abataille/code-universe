import SwiftUI
import AVKit
import AVFoundation
import UniformTypeIdentifiers
import CoreGraphics
import ImageIO
import CoreImage
import CoreImage.CIFilterBuiltins
import Vision
import OSLog
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

private let iveTouchLogger = Logger(subsystem: "IVEEditor", category: "TouchDebug")

func iveTouchDebug(_ message: String) {
    #if DEBUG
    iveTouchLogger.debug("\(message, privacy: .public)")
    print("IVE_TOUCH \(message)")
    #endif
}

private func iveL(_ key: String) -> String {
    NSLocalizedString(
        key,
        tableName: "Localizable",
        bundle: .module,
        value: key,
        comment: ""
    )
}

private func iveLF(_ key: String, _ arguments: CVarArg...) -> String {
    String(format: iveL(key), locale: Locale.current, arguments: arguments)
}

public protocol IVEHostServices {
    var projectStore: IVEProjectStore { get }
    var mediaStore: IVEMediaStore { get }
    var exportService: IVEExportService { get }
    var telemetry: IVETelemetrySink { get }
    var aiProvider: IVEAIProvider? { get }
    var capabilities: IVECapabilitySet { get }
}

public struct IVEEditorFinishResult: Sendable {
    public let url: URL
    public let kind: IVEMediaKind

    public init(url: URL, kind: IVEMediaKind) {
        self.url = url
        self.kind = kind
    }
}

public struct IVEEditorView: View {
    @Environment(\.dismiss) var dismiss
    let configuration: IVEEditorConfiguration
    let project: IVEProjectHandle
    let services: any IVEHostServices
    let onFinish: ((IVEEditorFinishResult) -> Void)?

    @State var selectedTab: EditorTab = .library
    @State var importedAssets: [IVEMediaAssetRef] = []
    @State var selectedLibraryAssetID: UUID?
    @State var showingFileImporter = false
    @State var errorMessage: String?

    @State var snapshot: IVEEditingSessionSnapshot?
    @State var session: IVEEditingSession?
    @State var selectedImageAssetID: UUID?
    @State var pendingExposureValue = 0.0
    @State var pendingContrastValue = 1.0
    @State var pendingSaturationValue = 1.0
    @State var pendingTemperatureValue = 0.0
    @State var pendingTintValue = 0.0
    @State var pendingCurveShadowsValue = 0.0
    @State var pendingCurveMidtonesValue = 0.0
    @State var pendingCurveHighlightsValue = 0.0
    @State var pendingCurveRedShadowsValue = 0.0
    @State var pendingCurveRedMidtonesValue = 0.0
    @State var pendingCurveRedHighlightsValue = 0.0
    @State var pendingCurveGreenShadowsValue = 0.0
    @State var pendingCurveGreenMidtonesValue = 0.0
    @State var pendingCurveGreenHighlightsValue = 0.0
    @State var pendingCurveBlueShadowsValue = 0.0
    @State var pendingCurveBlueMidtonesValue = 0.0
    @State var pendingCurveBlueHighlightsValue = 0.0
    @State var pendingBlackPointValue = 0.0
    @State var pendingWhitePointValue = 1.0
    @State var activeImageCurveChannel: IVECurveEditingChannel = .master
    @State var pendingDenoiseValue = 0.0
    @State var pendingSharpenValue = 0.0
    @State var pendingRotationDegrees = 0.0
    @State var pendingMirrorHorizontal = false
    @State var pendingMirrorVertical = false
    @State var pendingCropRect: IVENormalizedRect = .full
    @State var pendingScale = 1.0
    @State var pendingFilterPreset: IVEImageFilterPreset = .none
    @State var activeImageTool: ImageEditorTool = .adjust

    @State var selectedClipID: UUID?
    @State var selectedVideoAssetID: UUID?
    @State var trimStart = 0.0
    @State var trimDuration = 5.0
    @State var pendingVideoExposureValue = 0.0
    @State var pendingVideoContrastValue = 1.0
    @State var pendingVideoSaturationValue = 1.0
    @State var pendingVideoTemperatureValue = 0.0
    @State var pendingVideoTintValue = 0.0
    @State var pendingVideoCurveShadowsValue = 0.0
    @State var pendingVideoCurveMidtonesValue = 0.0
    @State var pendingVideoCurveHighlightsValue = 0.0
    @State var pendingVideoCurveRedShadowsValue = 0.0
    @State var pendingVideoCurveRedMidtonesValue = 0.0
    @State var pendingVideoCurveRedHighlightsValue = 0.0
    @State var pendingVideoCurveGreenShadowsValue = 0.0
    @State var pendingVideoCurveGreenMidtonesValue = 0.0
    @State var pendingVideoCurveGreenHighlightsValue = 0.0
    @State var pendingVideoCurveBlueShadowsValue = 0.0
    @State var pendingVideoCurveBlueMidtonesValue = 0.0
    @State var pendingVideoCurveBlueHighlightsValue = 0.0
    @State var pendingVideoBlackPointValue = 0.0
    @State var pendingVideoWhitePointValue = 1.0
    @State var activeVideoCurveChannel: IVECurveEditingChannel = .master
    @State var pendingVideoRotationDegrees = 0.0
    @State var pendingVideoMirrorHorizontal = false
    @State var pendingVideoMirrorVertical = false
    @State var pendingVideoCropRect: IVENormalizedRect = .full
    @State var pendingVideoCropMode: IVEVideoCropMode = .fit
    @State var pendingVideoFilterPreset: IVEImageFilterPreset = .none
    @State var activeVideoTool: VideoEditorTool = .adjust

    @State var lastExportPath: String?
    @State var aiStatusMessage: String?
    @State var saveSourceURL: URL?
    @State var saveDefaultName = "IVE-Export"
    @State var showingSaveLocationPicker = false
    @State var pendingExportQueue: [URL] = []
    @State var hasAppliedInitialEntryMode = false
    @State var canUndo = false
    @State var canRedo = false
    @State var imageEditorInteractionNonce: UInt = 0
    @State var isImageAIOperationInProgress = false
    @State var isImageApplyInProgress = false
    @State var isImageExportInProgress = false
    @State var isImageDoneInProgress = false
    @State var isImageResetInProgress = false
    @State var imageProcessingStartedAt: Date?
    @State var isVideoBuildTimelineInProgress = false
    @State var isVideoSplitInProgress = false
    @State var isVideoRippleDeleteInProgress = false
    @State var isVideoTrimInProgress = false
    @State var isVideoApplyInProgress = false
    @State var isVideoExportInProgress = false
    @State var isVideoDoneInProgress = false
    @State var isVideoResetInProgress = false
    @State var videoProcessingStartedAt: Date?
    @State var showHistogramOverlay = false
    @State var isHistoryChangeInProgress = false
    @State var editPanelAvailableWidth: CGFloat = 0
    @State var editPanelAvailableHeight: CGFloat = 0
    @State var timelinePanelAvailableWidth: CGFloat = 0
    @State var timelinePanelAvailableHeight: CGFloat = 0
    @State var videoDurationByURL: [String: Double] = [:]
    @State var videoAspectRatioByURL: [String: CGFloat] = [:]
    @State var currentVideoPreviewTimeSeconds: Double = 0
    @State var videoReferenceFrameTimeByAssetID: [UUID: Double] = [:]
    @State var videoPreviewPauseToken: UInt = 0
    @State var videoPreviewSeekToken: UInt = 0
    @State var videoPreviewRequestedTimeSeconds: Double?
    @State var isCalibrationPreviewEnabled = false
    @State var calibrationPreviewURL: URL?

    #if os(iOS)
    @State var photoSelections: [PhotosPickerItem] = []
    @State var showingPhotosPicker = false
    #endif

    var usesCompactLayout: Bool {
        #if os(iOS)
        UIDevice.current.userInterfaceIdiom == .phone
        #else
        false
        #endif
    }
    
    var effectiveLayoutPolicy: IVEEditorLayoutPolicy {
        switch configuration.layoutPolicy {
        case .adaptive:
            return usesCompactLayout ? .compactPhone : .multiPanelTabletAndDesktop
        case .compactPhone:
            return .compactPhone
        case .multiPanelTabletAndDesktop:
            return .multiPanelTabletAndDesktop
        }
    }

    var libraryPreviewHeightRange: ClosedRange<CGFloat> {
        usesCompactLayout ? 240...300 : 420...560
    }

    func adaptivePreviewHeightRange(
        containerHeight: CGFloat,
        isHistogramVisible: Bool
    ) -> ClosedRange<CGFloat> {
        let safeHeight = max(0, containerHeight)
        guard safeHeight > 0 else {
            if usesCompactLayout {
                return isHistogramVisible ? 220...340 : 320...500
            }
            return 420...760
        }

        if usesCompactLayout {
            let minHeight = isHistogramVisible
                ? max(200, min(320, safeHeight * 0.24))
                : max(280, min(420, safeHeight * 0.36))
            let maxHeight = max(minHeight + 40, min(560, safeHeight * 0.62))
            return minHeight...maxHeight
        }

        let minHeight = max(360, min(580, safeHeight * 0.44))
        let maxHeight = max(minHeight + 80, min(920, safeHeight * 0.78))
        return minHeight...maxHeight
    }

    private func splitDecision(for availableWidth: CGFloat) -> IVEAdaptiveSplitDecision {
        guard usesCompactLayout else {
            return IVEAdaptiveSplitDecision(isStacked: false, controlsWidth: nil)
        }

        let width = max(0, availableWidth)
        let spacing: CGFloat = 16
        let minimumPreviewWidth: CGFloat = 300
        let rawControlsWidth = width * 0.5
        let maxAllowedControlsWidth = max(280, width - minimumPreviewWidth - spacing)
        let controlsWidth = min(maxAllowedControlsWidth, max(280, rawControlsWidth))
        let canShowSideBySide = width >= (controlsWidth + minimumPreviewWidth + spacing)
        return IVEAdaptiveSplitDecision(
            isStacked: !canShowSideBySide,
            controlsWidth: canShowSideBySide ? controlsWidth : nil
        )
    }

    @ViewBuilder
    private func adaptiveControlsPreviewLayout<Controls: View, Preview: View>(
        availableWidth: CGFloat,
        availableHeight: CGFloat,
        controls: Controls,
        preview: Preview
    ) -> some View {
        let split = splitDecision(for: availableWidth)
        if split.isStacked {
            VStack(alignment: .leading, spacing: 12) {
                controls
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                preview
            }
        } else {
            HStack(alignment: .top, spacing: 16) {
                if usesCompactLayout, let controlsWidth = split.controlsWidth {
                    ScrollView(.vertical, showsIndicators: true) {
                        controls
                            .frame(maxWidth: .infinity, alignment: .topLeading)
                    }
                    .frame(width: controlsWidth, alignment: .topLeading)
                    .frame(height: availableHeight > 0 ? availableHeight : nil, alignment: .topLeading)
                    preview
                } else {
                    ScrollView(.vertical, showsIndicators: true) {
                        controls
                            .frame(maxWidth: .infinity, alignment: .topLeading)
                    }
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                    .frame(height: availableHeight > 0 ? availableHeight : nil, alignment: .topLeading)
                    preview
                        .frame(maxWidth: .infinity, alignment: .topLeading)
                }
            }
        }
    }

    #if os(iOS)
    var isCurrentInterfaceLandscape: Bool {
        if UIDevice.current.userInterfaceIdiom == .phone {
            let deviceOrientation = UIDevice.current.orientation
            if deviceOrientation.isLandscape {
                return true
            }
            if deviceOrientation.isPortrait {
                return false
            }
        }
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        if let orientation = scenes.first(where: { $0.activationState == .foregroundActive })?.interfaceOrientation {
            return orientation.isLandscape
        }
        if let orientation = scenes.first?.interfaceOrientation {
            return orientation.isLandscape
        }
        return UIScreen.main.bounds.width > UIScreen.main.bounds.height
    }
    #endif

    public init(
        configuration: IVEEditorConfiguration,
        project: IVEProjectHandle,
        services: any IVEHostServices,
        onFinish: ((IVEEditorFinishResult) -> Void)? = nil
    ) {
        self.configuration = configuration
        self.project = project
        self.services = services
        self.onFinish = onFinish
    }

    public var body: some View {
        Group {
//            #if os(iOS)
//            if UIDevice.current.userInterfaceIdiom == .phone {
//                phoneContainer
//            } else {
//                splitContainer
//            }
//            #else
//            splitContainer
//            #endif
            splitContainer
        }
        .tint(.gray)
        .onAppear {
            loadInitialState()
            services.telemetry.track(event: "editor_opened", metadata: ["project": project.displayName])
        }
        .alert(iveL("Editor Error"), isPresented: Binding(
            get: { errorMessage != nil },
            set: { show in
                if !show { errorMessage = nil }
            }
        )) {
            Button(iveL("OK"), role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? iveL("Unknown error"))
        }
        #if os(iOS)
        .fileMover(
            isPresented: $showingSaveLocationPicker,
            file: saveSourceURL
        ) { result in
            switch result {
            case let .success(destination):
                lastExportPath = destination.path
                exportNextQueuedItemIfNeeded()
            case let .failure(error):
                errorMessage = error.localizedDescription
                pendingExportQueue.removeAll()
            }
        }
        #endif
    }

    private var phoneContainer: some View {
        TabView(selection: $selectedTab) {
            libraryPanel
                .tabItem { Label(iveL("Library"), systemImage: "photo.on.rectangle") }
                .tag(EditorTab.library)
            editPanel
                .tabItem { Label(iveL("Edit"), systemImage: "slider.horizontal.3") }
                .tag(EditorTab.edit)
            timelinePanel
                .tabItem { Label(iveL("Timeline"), systemImage: "film.stack") }
                .tag(EditorTab.timeline)
        }
    }

    private var splitContainer: some View {
        Group {
            if configuration.showsSidebar && configuration.entryMode == .library && effectiveLayoutPolicy != .compactPhone {
                NavigationSplitView {
                    List(EditorTab.allCases) { tab in
                        Button {
                            selectedTab = tab
                        } label: {
                                HStack {
                                    Label(tab.title, systemImage: tab.iconName)
                                    Spacer()
                                    if selectedTab == tab {
                                        Image(systemName: "checkmark")
                                            .foregroundStyle(.secondary)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                    .navigationTitle(project.displayName)
                } detail: {
                    selectedPanel
                        .toolbar {
                            ToolbarItem(placement: .automatic) {
                                Text(iveL("IVE"))
                                    .font(.headline)
                            }
                        }
                }
            } else {
                if configuration.entryMode == .library {
                    VStack(spacing: 10) {
                        Picker(iveL("Section"), selection: $selectedTab) {
                            ForEach(EditorTab.allCases) { tab in
                                Label(tab.title, systemImage: tab.iconName).tag(tab)
                            }
                        }
                        .pickerStyle(.segmented)
                        .padding(.horizontal)
                        selectedPanel
                    }
                } else {
                    selectedPanel
                }
            }
        }
    }

    @ViewBuilder
    private var selectedPanel: some View {
        switch selectedTab {
        case .library: libraryPanel
        case .edit: editPanel
        case .timeline: timelinePanel
        }
    }

    private var libraryPanel: some View {
        PanelShell(title: iveL("Library"), subtitle: iveL("Import and preview media")) {
            IVELibraryActionRow(
                onOpenPhotos: beginPhotoImport,
                onOpenFiles: presentFileImporter,
                onReload: reloadMediaAssetsTapped,
                onExportChanged: exportChangedLibraryItemsTapped
            )

            if let path = lastExportPath {
                Text(iveLF("Last export: %@", path))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .truncationMode(.middle)
            }

            if let selected = selectedLibraryAsset {
                MediaPreviewCard(
                    asset: selected,
                    url: displayURL(for: selected),
                    exposure: effectiveExposure(for: selected.id),
                    contrast: effectiveContrast(for: selected.id),
                    saturation: effectiveSaturation(for: selected.id),
                    temperature: effectiveTemperature(for: selected.id),
                    tint: effectiveTint(for: selected.id),
                    curveShadows: effectiveCurveShadows(for: selected.id),
                    curveMidtones: effectiveCurveMidtones(for: selected.id),
                    curveHighlights: effectiveCurveHighlights(for: selected.id),
                    curveRedShadows: effectiveColorCurveSettings(for: selected.id).redShadows,
                    curveRedMidtones: effectiveColorCurveSettings(for: selected.id).redMidtones,
                    curveRedHighlights: effectiveColorCurveSettings(for: selected.id).redHighlights,
                    curveGreenShadows: effectiveColorCurveSettings(for: selected.id).greenShadows,
                    curveGreenMidtones: effectiveColorCurveSettings(for: selected.id).greenMidtones,
                    curveGreenHighlights: effectiveColorCurveSettings(for: selected.id).greenHighlights,
                    curveBlueShadows: effectiveColorCurveSettings(for: selected.id).blueShadows,
                    curveBlueMidtones: effectiveColorCurveSettings(for: selected.id).blueMidtones,
                    curveBlueHighlights: effectiveColorCurveSettings(for: selected.id).blueHighlights,
                    blackPoint: effectiveColorCurveSettings(for: selected.id).blackPoint,
                    whitePoint: effectiveColorCurveSettings(for: selected.id).whitePoint,
                    denoise: effectiveDenoise(for: selected.id),
                    sharpen: effectiveSharpen(for: selected.id),
                    rotationDegrees: effectiveRotation(for: selected.id),
                    mirrorHorizontal: effectiveMirrorHorizontal(for: selected.id),
                    mirrorVertical: effectiveMirrorVertical(for: selected.id),
                    cropRect: effectiveCropRect(for: selected.id),
                    scale: effectiveScale(for: selected.id),
                    videoCropMode: effectiveVideoCropMode(for: selected.id),
                    filterPreset: effectiveFilterPreset(for: selected.id),
                    showHistogram: showHistogramOverlay
                )
                .frame(minHeight: libraryPreviewHeightRange.lowerBound, maxHeight: libraryPreviewHeightRange.upperBound)
            }

            IVELibraryAssetList(
                assets: importedAssets,
                selectedAssetID: selectedLibraryAssetID,
                kindLabel: label(for:),
                shortName: shortName(for:),
                onSelect: selectLibraryAsset
            )
            .fileImporter(
                isPresented: $showingFileImporter,
                allowedContentTypes: [.image, .movie, .audio],
                allowsMultipleSelection: true,
                onCompletion: handleFileImportResult
            )
            #if os(iOS)
            .photosPicker(
                isPresented: $showingPhotosPicker,
                selection: $photoSelections,
                maxSelectionCount: 20,
                matching: .any(of: [.images, .videos])
            )
            .onChange(of: photoSelections) { _, newValue in handlePhotoSelectionsChanged(newValue) }
            #endif
        }
    }

    private var editPanel: some View {
        let split = splitDecision(for: editPanelAvailableWidth)
        return PanelShell(
            title: iveL("Editor"),
            subtitle: iveL("Apply non-destructive image adjustments with undo/redo"),
            isScrollable: split.isStacked,
            isScrollEnabled: true
        ) {
                let imageAssets = importedAssets.filter { $0.kind == .image }
            if imageAssets.isEmpty {
                Text(iveL("Import an image in Library to start editing."))
                    .foregroundStyle(.secondary)
            } else {
                let selectedImage = selectedImageAsset
                let originalSourceURL = selectedImage.flatMap(displayURL(for:))
                let sourceURL = isCalibrationPreviewEnabled ? (calibrationPreviewURL ?? originalSourceURL) : originalSourceURL
                let isCropSelectionActive = activeImageTool == .crop
                let previewCropRect = isCropSelectionActive ? .full : pendingCropRect
                let previewScale = isCropSelectionActive ? 1 : pendingScale
                let previewHeightRange = adaptivePreviewHeightRange(
                    containerHeight: editPanelAvailableHeight,
                    isHistogramVisible: showHistogramOverlay
                )

                let preview = IVEImagePreviewSection(
                    selectedImage: selectedImage,
                    sourceURL: sourceURL,
                    sourceAspectRatio: sourceURL.flatMap(imageAspectRatio(for:)),
                    isCropSelectionActive: isCropSelectionActive,
                    cropRect: $pendingCropRect,
                    previewCropRect: previewCropRect,
                    previewScale: previewScale,
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
                    filterPreset: pendingFilterPreset,
                    showHistogram: showHistogramOverlay,
                    previewHeightRange: previewHeightRange
                )
                .frame(maxWidth: .infinity, alignment: .topLeading)
                .allowsHitTesting(isCropSelectionActive)
                let controls = IVEImageEditorControls(
                    activeTool: $activeImageTool,
                    pendingExposureValue: $pendingExposureValue,
                    pendingContrastValue: $pendingContrastValue,
                    pendingSaturationValue: $pendingSaturationValue,
                    pendingTemperatureValue: $pendingTemperatureValue,
                    pendingTintValue: $pendingTintValue,
                    pendingCurveShadowsValue: $pendingCurveShadowsValue,
                    pendingCurveMidtonesValue: $pendingCurveMidtonesValue,
                    pendingCurveHighlightsValue: $pendingCurveHighlightsValue,
                    pendingCurveRedShadowsValue: $pendingCurveRedShadowsValue,
                    pendingCurveRedMidtonesValue: $pendingCurveRedMidtonesValue,
                    pendingCurveRedHighlightsValue: $pendingCurveRedHighlightsValue,
                    pendingCurveGreenShadowsValue: $pendingCurveGreenShadowsValue,
                    pendingCurveGreenMidtonesValue: $pendingCurveGreenMidtonesValue,
                    pendingCurveGreenHighlightsValue: $pendingCurveGreenHighlightsValue,
                    pendingCurveBlueShadowsValue: $pendingCurveBlueShadowsValue,
                    pendingCurveBlueMidtonesValue: $pendingCurveBlueMidtonesValue,
                    pendingCurveBlueHighlightsValue: $pendingCurveBlueHighlightsValue,
                    pendingBlackPointValue: $pendingBlackPointValue,
                    pendingWhitePointValue: $pendingWhitePointValue,
                    activeCurveChannel: $activeImageCurveChannel,
                    pendingDenoiseValue: $pendingDenoiseValue,
                    pendingSharpenValue: $pendingSharpenValue,
                    pendingCropRect: $pendingCropRect,
                    pendingFilterPreset: $pendingFilterPreset,
                    pendingRotationDegrees: $pendingRotationDegrees,
                    pendingMirrorHorizontal: $pendingMirrorHorizontal,
                    pendingMirrorVertical: $pendingMirrorVertical,
                    filterThumbnailSourceURL: sourceURL,
                    hasAIProvider: services.aiProvider != nil,
                    aiStatusMessage: aiStatusMessage,
                    onResetCropArea: resetPendingImageCropArea,
                    onRemoveBackground: removeBackgroundTapped,
                    onSetBackgroundWhite: setBackgroundWhiteTapped,
                    onSetBackgroundBlack: setBackgroundBlackTapped,
                    onSetBackgroundBlur: setBackgroundBlurTapped,
                    onRemoveSubject: removeDetectedSubjectTapped,
                    onApplyNow: applyAdjustmentsTapped,
                    isCalibrationPreviewEnabled: isCalibrationPreviewEnabled,
                    onSetCalibrationPreviewEnabled: setCalibrationPreviewEnabled,
                    onExport: exportEditedImageTapped,
                    onDone: replaceImageAndCloseTapped,
                    onAbort: { dismiss() },
                    onResetImage: resetImageToOriginalTapped,
                    onApplyCurvePreset: applyImageCurvePreset,
                    onToggleHistogram: { showHistogramOverlay.toggle() },
                    onUndo: undoTapped,
                    onRedo: redoTapped,
                    isHistogramVisible: showHistogramOverlay,
                    canUndo: canUndo,
                    canRedo: canRedo,
                    isAIOperationInProgress: isImageAIOperationInProgress,
                    isApplyInProgress: isImageApplyInProgress,
                    isExportInProgress: isImageExportInProgress,
                    isDoneInProgress: isImageDoneInProgress,
                    isResetInProgress: isImageResetInProgress,
                    imageProcessingStartedAt: imageProcessingStartedAt,
                    isHistoryChangeInProgress: isHistoryChangeInProgress
                )
                .zIndex(5)
                adaptiveControlsPreviewLayout(
                    availableWidth: editPanelAvailableWidth,
                    availableHeight: editPanelAvailableHeight,
                    controls: controls,
                    preview: preview
                )
                .frame(maxWidth: .infinity, alignment: .topLeading)
                .onAvailableSizeChange { size in
                    if abs(editPanelAvailableWidth - size.width) > 0.5 {
                        editPanelAvailableWidth = size.width
                    }
                    if abs(editPanelAvailableHeight - size.height) > 0.5 {
                        editPanelAvailableHeight = size.height
                    }
                }
                .id(imageEditorInteractionNonce)
            }
        }
    }


    private var timelinePanel: some View {
        let split = splitDecision(for: timelinePanelAvailableWidth)
        return PanelShell(
            title: iveL("Timeline"),
            subtitle: iveL("Build, trim, split, and ripple delete"),
            isScrollable: split.isStacked
        ) {
            let videoAssets = importedAssets.filter { $0.kind == .video }
            let clips = snapshot?.timeline.clips ?? []
            if let asset = selectedVideoAsset, let url = displayURL(for: asset) {
                    let referenceFrameTimeSeconds = videoReferenceFrameTimeByAssetID[asset.id]
                    let videoAspect = videoAspectRatio(for: url)
                    let sourceAspect = (videoAspect ?? (16.0 / 9.0))
                    let previewCropRect = activeVideoTool == .crop ? IVENormalizedRect.full : effectiveVideoCropRect(for: asset.id)
                    let previewCropMode = activeVideoTool == .crop ? .fit : effectiveVideoCropMode(for: asset.id)
                    let aspectCropRect = activeVideoTool == .crop ? pendingVideoCropRect : previewCropRect
                    let selectedKeyframeSeconds = videoReferenceFrameTimeByAssetID[asset.id]
                    let previewAspect: CGFloat = {
                        guard previewCropMode == .trueCrop else { return sourceAspect }
                        let width = max(0.02, min(1, aspectCropRect.width))
                        let height = max(0.02, min(1, aspectCropRect.height))
                        return max(0.1, sourceAspect * CGFloat(width / height))
                    }()
                    let trimRange = currentTrimRangeForSelectedVideo()
                    let videoRenderState = currentVideoRenderState(for: asset.id)
                    let showVideoCalibrationPreview = isCalibrationPreviewEnabled && activeVideoTool == .color
                    let previewHeightRange = adaptivePreviewHeightRange(
                        containerHeight: timelinePanelAvailableHeight,
                        isHistogramVisible: showHistogramOverlay
                    )

                    let preview = Group {
                        if showVideoCalibrationPreview, let calibrationURL = calibrationPreviewURL {
                            IVEProcessedImagePreview(
                                url: calibrationURL,
                                cropRect: .full,
                                scale: 1,
                                renderState: ImageRenderState(
                                    exposure: videoRenderState.exposure,
                                    contrast: videoRenderState.contrast,
                                    saturation: videoRenderState.saturation,
                                    temperature: videoRenderState.temperature,
                                    tint: videoRenderState.tint,
                                    curveShadows: videoRenderState.curveShadows,
                                    curveMidtones: videoRenderState.curveMidtones,
                                    curveHighlights: videoRenderState.curveHighlights,
                                    curveRedShadows: videoRenderState.curveRedShadows,
                                    curveRedMidtones: videoRenderState.curveRedMidtones,
                                    curveRedHighlights: videoRenderState.curveRedHighlights,
                                    curveGreenShadows: videoRenderState.curveGreenShadows,
                                    curveGreenMidtones: videoRenderState.curveGreenMidtones,
                                    curveGreenHighlights: videoRenderState.curveGreenHighlights,
                                    curveBlueShadows: videoRenderState.curveBlueShadows,
                                    curveBlueMidtones: videoRenderState.curveBlueMidtones,
                                    curveBlueHighlights: videoRenderState.curveBlueHighlights,
                                    blackPoint: videoRenderState.blackPoint,
                                    whitePoint: videoRenderState.whitePoint,
                                    denoise: 0,
                                    sharpen: 0,
                                    rotationDegrees: 0,
                                    mirrorHorizontal: false,
                                    mirrorVertical: false,
                                    filterPreset: videoRenderState.filterPreset
                                )
                            )
                        } else {
                            VideoPreview(
                                url: url,
                                cropRect: previewCropRect,
                                cropMode: previewCropMode,
                                trimRange: trimRange,
                                renderState: videoRenderState,
                                pauseToken: videoPreviewPauseToken,
                                seekToken: videoPreviewSeekToken,
                                seekTimeSeconds: videoPreviewRequestedTimeSeconds,
                                onDisplayedTimeChange: { currentTime in
                                    currentVideoPreviewTimeSeconds = max(0, currentTime)
                                }
                            )
                        }
                    }
                    .aspectRatio(previewAspect, contentMode: .fit)
                    .frame(minHeight: previewHeightRange.lowerBound, maxHeight: previewHeightRange.upperBound)
                    .frame(maxWidth: .infinity)
                    .layoutPriority(1)
                    .clipped()
                    .overlay {
                        if activeVideoTool == .crop {
                            CropSelectionOverlay(
                                cropRect: $pendingVideoCropRect,
                                contentAspectRatio: videoAspect,
                                lockedAspectRatio: nil
                            )
                            .padding(8)
                        }
                    }

                    let previewWithKeyframeAction = VStack(alignment: .leading, spacing: 10) {
                        VStack(alignment: .leading, spacing: 4) {
                            Button {
                                videoReferenceFrameTimeByAssetID[asset.id] = max(0, currentVideoPreviewTimeSeconds)
                                videoPreviewPauseToken &+= 1
                            } label: {
                                Image(systemName: "pin.circle.fill")
                                    .font(.title3)
                            }
                            .buttonStyle(.borderedProminent)
                            .accessibilityLabel(iveL("Use Current Frame as Keyframe"))

                            Text(
                                selectedKeyframeSeconds?
                                    .formatted(.number.precision(.fractionLength(2)))
                                ?? "—"
                            )
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(.ultraThinMaterial, in: Capsule())
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)

                        preview

                        if clips.count > 1 {
                            LazyVStack(spacing: 6) {
                                ForEach(clips, id: \.id) { clip in
                                    Button {
                                        selectedClipID = clip.id
                                        selectedVideoAssetID = clip.assetID
                                        syncPendingVideoAdjustmentsToCurrentVideo()
                                        if let assetForClip = importedAssets.first(where: { $0.id == clip.assetID }),
                                           let url = displayURL(for: assetForClip) {
                                            Task {
                                                await loadVideoMetadataIfNeeded(for: url)
                                            }
                                        }
                                    } label: {
                                        HStack {
                                            Text(shortID(clip.id))
                                                .font(.caption.monospaced())
                                                .frame(width: 90, alignment: .leading)
                                            Text(iveLF("Start %@s", clip.startSeconds.formatted(.number.precision(.fractionLength(2)))))
                                            Text(iveLF("Duration %@s", clip.durationSeconds.formatted(.number.precision(.fractionLength(2)))))
                                            Spacer()
                                            if selectedClipID == clip.id {
                                                Image(systemName: "checkmark")
                                                    .foregroundStyle(.secondary)
                                            }
                                        }
                                        .padding(.horizontal, 10)
                                        .padding(.vertical, 8)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .iveSurfaceCard(cornerRadius: 10)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                    }

                    let controls = IVEVideoEditorControls(
                        videoAssets: videoAssets,
                        selectedVideoAssetID: $selectedVideoAssetID,
                        activeTool: $activeVideoTool,
                        pendingVideoExposureValue: $pendingVideoExposureValue,
                        pendingVideoContrastValue: $pendingVideoContrastValue,
                        pendingVideoSaturationValue: $pendingVideoSaturationValue,
                        pendingVideoTemperatureValue: $pendingVideoTemperatureValue,
                        pendingVideoTintValue: $pendingVideoTintValue,
                        pendingVideoCurveShadowsValue: $pendingVideoCurveShadowsValue,
                        pendingVideoCurveMidtonesValue: $pendingVideoCurveMidtonesValue,
                        pendingVideoCurveHighlightsValue: $pendingVideoCurveHighlightsValue,
                        pendingVideoCurveRedShadowsValue: $pendingVideoCurveRedShadowsValue,
                        pendingVideoCurveRedMidtonesValue: $pendingVideoCurveRedMidtonesValue,
                        pendingVideoCurveRedHighlightsValue: $pendingVideoCurveRedHighlightsValue,
                        pendingVideoCurveGreenShadowsValue: $pendingVideoCurveGreenShadowsValue,
                        pendingVideoCurveGreenMidtonesValue: $pendingVideoCurveGreenMidtonesValue,
                        pendingVideoCurveGreenHighlightsValue: $pendingVideoCurveGreenHighlightsValue,
                        pendingVideoCurveBlueShadowsValue: $pendingVideoCurveBlueShadowsValue,
                        pendingVideoCurveBlueMidtonesValue: $pendingVideoCurveBlueMidtonesValue,
                        pendingVideoCurveBlueHighlightsValue: $pendingVideoCurveBlueHighlightsValue,
                        pendingVideoBlackPointValue: $pendingVideoBlackPointValue,
                        pendingVideoWhitePointValue: $pendingVideoWhitePointValue,
                        activeCurveChannel: $activeVideoCurveChannel,
                        pendingVideoCropRect: $pendingVideoCropRect,
                        pendingVideoCropMode: $pendingVideoCropMode,
                        pendingVideoFilterPreset: $pendingVideoFilterPreset,
                        pendingVideoRotationDegrees: $pendingVideoRotationDegrees,
                        pendingVideoMirrorHorizontal: $pendingVideoMirrorHorizontal,
                        pendingVideoMirrorVertical: $pendingVideoMirrorVertical,
                        filterThumbnailSourceURL: url,
                        referenceFrameTimeSeconds: referenceFrameTimeSeconds,
                        selectedTimelineClip: selectedTimelineClip,
                        clips: clips,
                        trimStart: $trimStart,
                        trimDuration: $trimDuration,
                        selectedVideoDurationSeconds: selectedVideoDurationSeconds,
                        shortName: shortName(for:),
                        onSelectVideo: { video in
                            selectedVideoAssetID = video.id
                            syncPendingVideoAdjustmentsToCurrentVideo()
                            if let url = displayURL(for: video) {
                                Task {
                                    await loadVideoMetadataIfNeeded(for: url)
                                }
                            }
                        },
                        onResetCropArea: resetPendingVideoCropArea,
                        onBuildTimeline: buildTimelineFromVideosTapped,
                        onSplitSelected: splitSelectedClipTapped,
                        onRippleDeleteSelected: rippleDeleteSelectedClipTapped,
                        onApplyTrim: trimSelectedClipTapped,
                        onApply: applyVideoAdjustmentsTapped,
                        onExport: exportEditedVideoTapped,
                        onDone: replaceVideoAndCloseTapped,
                        onAbort: { dismiss() },
                        onResetVideo: resetVideoToOriginalTapped,
                        onTrimStartPreviewChanged: { newStart in
                            videoPreviewRequestedTimeSeconds = max(0, newStart)
                            videoPreviewSeekToken &+= 1
                        },
                        onApplyCurvePreset: applyVideoCurvePreset,
                        onToggleHistogram: { showHistogramOverlay.toggle() },
                        isCalibrationPreviewEnabled: isCalibrationPreviewEnabled,
                        onSetCalibrationPreviewEnabled: setCalibrationPreviewEnabled,
                        onUndo: undoTapped,
                        onRedo: redoTapped,
                        isHistogramVisible: showHistogramOverlay,
                        canUndo: canUndo,
                        canRedo: canRedo,
                        isBuildTimelineInProgress: isVideoBuildTimelineInProgress,
                        isSplitInProgress: isVideoSplitInProgress,
                        isRippleDeleteInProgress: isVideoRippleDeleteInProgress,
                        isTrimInProgress: isVideoTrimInProgress,
                        isApplyInProgress: isVideoApplyInProgress,
                        isExportInProgress: isVideoExportInProgress,
                        isDoneInProgress: isVideoDoneInProgress,
                        isResetInProgress: isVideoResetInProgress,
                        videoProcessingStartedAt: videoProcessingStartedAt,
                        isHistoryChangeInProgress: isHistoryChangeInProgress
                    )

                    adaptiveControlsPreviewLayout(
                        availableWidth: timelinePanelAvailableWidth,
                        availableHeight: timelinePanelAvailableHeight,
                        controls: controls,
                        preview: previewWithKeyframeAction
                    )
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                    .onAvailableSizeChange { size in
                        if abs(timelinePanelAvailableWidth - size.width) > 0.5 {
                            timelinePanelAvailableWidth = size.width
                        }
                        if abs(timelinePanelAvailableHeight - size.height) > 0.5 {
                            timelinePanelAvailableHeight = size.height
                        }
                    }
                    .task(id: url) {
                        await loadVideoMetadataIfNeeded(for: url)
                    }
            }

        }
    }
}

private struct IVEAdaptiveSplitDecision {
    var isStacked: Bool
    var controlsWidth: CGFloat?
}

private struct AvailableSizePreferenceKey: PreferenceKey {
    static let defaultValue: CGSize = .zero

    static func reduce(value: inout CGSize, nextValue: () -> CGSize) {
        value = nextValue()
    }
}

private extension View {
    func onAvailableSizeChange(_ handler: @escaping (CGSize) -> Void) -> some View {
        self
            .background(
                GeometryReader { proxy in
                    Color.clear
                        .preference(key: AvailableSizePreferenceKey.self, value: proxy.size)
                }
            )
            .onPreferenceChange(AvailableSizePreferenceKey.self, perform: handler)
    }

    func onAvailableWidthChange(_ handler: @escaping (CGFloat) -> Void) -> some View {
        onAvailableSizeChange { size in
            handler(size.width)
        }
    }
}

public enum IVEEditorLauncher {
    @MainActor
    public static func make(
        sourceURL: URL,
        onFinished: @escaping (IVEEditorFinishResult) -> Void
    ) -> some View {
        IVEQuickEditorView(sourceURL: sourceURL, onFinished: onFinished)
    }
}

public struct IVEQuickEditorView: View {
    private let sourceURL: URL
    private let onFinished: (IVEEditorFinishResult) -> Void

    @State private var isPrepared = false
    @State private var project = IVEProjectHandle(displayName: "IVE Quick Edit")
    @State private var services = IVEQuickHostServices()
    @State private var configuration = IVEEditorConfiguration()
    @State private var errorMessage: String?

    public init(
        sourceURL: URL,
        onFinished: @escaping (IVEEditorFinishResult) -> Void
    ) {
        self.sourceURL = sourceURL
        self.onFinished = onFinished
    }

    public var body: some View {
        Group {
            if isPrepared {
                IVEEditorView(
                    configuration: configuration,
                    project: project,
                    services: services,
                    onFinish: onFinished
                )
            } else if let errorMessage {
                VStack(spacing: 10) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 30))
                        .foregroundStyle(.orange)
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .padding()
            } else {
                ProgressView("Preparing Editor...")
                    .padding()
            }
        }
        .onAppear {
            prepareEditor()
        }
    }

    @MainActor
    private func prepareEditor() {
        do {
            let runtimeServices = IVEQuickHostServices()
            let copiedURL = try copyToAppImports(sourceURL)
            let kind = mediaKind(for: copiedURL)
            guard kind == .image || kind == .video else {
                throw NSError(domain: "IVEQuickEditor", code: 1, userInfo: [NSLocalizedDescriptionKey: "Only image and video are supported."])
            }

            let runtimeProject = IVEProjectHandle(displayName: "IVE Quick Edit")
            _ = try runtimeServices.mediaStore.ingestMedia(
                localIdentifier: copiedURL.path,
                kind: kind,
                into: runtimeProject
            )

            services = runtimeServices
            project = runtimeProject
            configuration = IVEEditorConfiguration(
                layoutPolicy: .adaptive,
                autosaveIntervalSeconds: 20,
                defaultExportPresetID: "social-1080p",
                entryMode: kind == .video ? .videoEditor : .imageEditor,
                showsSidebar: false
            )
            isPrepared = true
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
            isPrepared = false
        }
    }

    private func mediaKind(for url: URL) -> IVEMediaKind {
        guard let type = UTType(filenameExtension: url.pathExtension.lowercased()) else {
            return .audio
        }
        if type.conforms(to: .movie) { return .video }
        if type.conforms(to: .image) { return .image }
        return .audio
    }

    private func copyToAppImports(_ sourceURL: URL) throws -> URL {
        let didAccess = sourceURL.startAccessingSecurityScopedResource()
        defer { if didAccess { sourceURL.stopAccessingSecurityScopedResource() } }

        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            .appendingPathComponent("IVEQuickEditorImports", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)

        let target = root.appendingPathComponent(
            quickConstrainedFileName(sourceURL: sourceURL, prefix: "quickimp", fallbackExtension: "dat")
        )
        if FileManager.default.fileExists(atPath: target.path) {
            try FileManager.default.removeItem(at: target)
        }
        try FileManager.default.copyItem(at: sourceURL, to: target)
        return target
    }

    private func quickConstrainedFileName(sourceURL: URL, prefix: String, fallbackExtension: String) -> String {
        let stem = quickSanitizedStem(sourceURL.deletingPathExtension().lastPathComponent, fallback: prefix, maxLength: 24)
        let extSource = sourceURL.pathExtension.isEmpty ? fallbackExtension : sourceURL.pathExtension
        let ext = quickSanitizedExtension(extSource, fallback: fallbackExtension)
        let suffix = String(UUID().uuidString.prefix(8)).lowercased()
        return "\(prefix)-\(stem)-\(suffix).\(ext)"
    }

    private func quickSanitizedStem(_ input: String, fallback: String, maxLength: Int) -> String {
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

    private func quickSanitizedExtension(_ input: String, fallback: String) -> String {
        let filtered = input.lowercased().filter { $0.isASCII && ($0.isLetter || $0.isNumber) }
        if !filtered.isEmpty {
            return String(filtered.prefix(8))
        }
        let fallbackFiltered = fallback.lowercased().filter { $0.isASCII && ($0.isLetter || $0.isNumber) }
        return fallbackFiltered.isEmpty ? "dat" : String(fallbackFiltered.prefix(8))
    }
}

private final class IVEQuickProjectStore: IVEProjectStore {
    private var snapshots: [UUID: IVEEditingSessionSnapshot] = [:]

    func loadSessionSnapshot(for project: IVEProjectHandle) throws -> IVEEditingSessionSnapshot? {
        snapshots[project.id]
    }

    func saveSessionSnapshot(_ snapshot: IVEEditingSessionSnapshot, for project: IVEProjectHandle) throws {
        snapshots[project.id] = snapshot
    }
}

private final class IVEQuickMediaStore: IVEMediaStore {
    private var mediaByProject: [UUID: [IVEMediaAssetRef]] = [:]

    func media(for project: IVEProjectHandle) throws -> [IVEMediaAssetRef] {
        mediaByProject[project.id] ?? []
    }

    func ingestMedia(localIdentifier: String, kind: IVEMediaKind, into project: IVEProjectHandle) throws -> IVEMediaAssetRef {
        var current = mediaByProject[project.id] ?? []
        let created = IVEMediaAssetRef(kind: kind, localIdentifier: localIdentifier)
        current.append(created)
        mediaByProject[project.id] = current
        return created
    }
}

private struct IVEQuickExportService: IVEExportService {
    func export(_ job: IVEExportJob) throws -> URL {
        let root = FileManager.default.temporaryDirectory
        let out = root.appendingPathComponent("ive-quick-export-\(UUID().uuidString).json")
        try Data("{}".utf8).write(to: out, options: [.atomic])
        return out
    }

    func exportBatch(_ jobs: [IVEExportJob]) throws -> [URL] {
        var urls: [URL] = []
        for job in jobs {
            urls.append(try export(job))
        }
        return urls
    }
}

private struct IVEQuickHostServices: IVEHostServices {
    let projectStore: IVEProjectStore = IVEQuickProjectStore()
    let mediaStore: IVEMediaStore = IVEQuickMediaStore()
    let exportService: IVEExportService = IVEQuickExportService()
    let telemetry: IVETelemetrySink = IVENoopTelemetrySink()
    let aiProvider: IVEAIProvider? = nil
    let capabilities = IVECapabilitySet(enabledFeatures: Set(IVEFeature.allCases))
}

enum EditorTab: String, CaseIterable, Identifiable {
    case library
    case edit
    case timeline

    var id: String { rawValue }

    var title: String {
        switch self {
        case .library: return iveL("Library")
        case .edit: return iveL("Editor")
        case .timeline: return iveL("Timeline")
        }
    }

    var iconName: String {
        switch self {
        case .library: return "photo.on.rectangle"
        case .edit: return "slider.horizontal.3"
        case .timeline: return "film.stack"
        }
    }
}

enum ImageEditorTool: String, CaseIterable, Identifiable {
    case adjust
    case color
    case crop
    case style
    case transform

    var id: String { rawValue }

    var title: String {
        switch self {
        case .adjust: return iveL("Adjust")
        case .color: return iveL("Color")
        case .crop: return iveL("Crop")
        case .style: return iveL("Style")
        case .transform: return iveL("Transform")
        }
    }

    var iconName: String {
        switch self {
        case .adjust: return "slider.horizontal.3"
        case .color: return "dial.high"
        case .crop: return "crop"
        case .style: return "wand.and.stars"
        case .transform: return "rotate.3d"
        }
    }
}

enum VideoEditorTool: String, CaseIterable, Identifiable {
    case adjust
    case color
    case crop
    case style
    case transform
    case timeline

    var id: String { rawValue }

    var title: String {
        switch self {
        case .adjust: return iveL("Adjust")
        case .color: return iveL("Color")
        case .crop: return iveL("Crop")
        case .style: return iveL("Style")
        case .transform: return iveL("Transform")
        case .timeline: return iveL("Timeline")
        }
    }

    var iconName: String {
        switch self {
        case .adjust: return "slider.horizontal.3"
        case .color: return "dial.high"
        case .crop: return "crop"
        case .style: return "wand.and.stars"
        case .transform: return "rotate.3d"
        case .timeline: return "timeline.selection"
        }
    }
}

enum IVECurveEditingChannel: String, CaseIterable, Identifiable {
    case master
    case red
    case green
    case blue

    var id: String { rawValue }

    var title: String {
        switch self {
        case .master: return iveL("RGB")
        case .red: return iveL("R")
        case .green: return iveL("G")
        case .blue: return iveL("B")
        }
    }
}

enum IVEColorCurvePreset: String, CaseIterable, Identifiable {
    case neutral
    case film
    case highContrast

    var id: String { rawValue }

    var title: String {
        switch self {
        case .neutral: return iveL("Neutral")
        case .film: return iveL("Film")
        case .highContrast: return iveL("High Contrast")
        }
    }
}

private struct IVELibraryActionRow: View {
    let onOpenPhotos: () -> Void
    let onOpenFiles: () -> Void
    let onReload: () -> Void
    let onExportChanged: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            #if os(iOS)
            Button(action: onOpenPhotos) {
                Label(iveL("Photos"), systemImage: "photo.on.rectangle")
            }
            .buttonStyle(.borderedProminent)
            #endif

            Button(action: onOpenFiles) {
                Label(iveL("Files"), systemImage: "folder")
            }
            .buttonStyle(.bordered)

            Button(action: onReload) {
                Label(iveL("Reload"), systemImage: "arrow.clockwise")
            }
            .buttonStyle(.bordered)

            Button(action: onExportChanged) {
                Label(iveL("Export Changed"), systemImage: "square.and.arrow.up")
            }
            .buttonStyle(.borderedProminent)
        }
    }
}

private struct IVELibraryAssetList: View {
    let assets: [IVEMediaAssetRef]
    let selectedAssetID: UUID?
    let kindLabel: (IVEMediaKind) -> String
    let shortName: (String) -> String
    let onSelect: (IVEMediaAssetRef) -> Void

    var body: some View {
        Group {
            if assets.isEmpty {
                Text(iveL("No media imported yet."))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 220)
            } else {
                LazyVStack(spacing: 6) {
                    ForEach(assets, id: \.id) { asset in
                        Button {
                            onSelect(asset)
                        } label: {
                            HStack {
                                Text(kindLabel(asset.kind))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .frame(width: 50, alignment: .leading)
                                Text(shortName(asset.localIdentifier))
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                                Spacer()
                                if selectedAssetID == asset.id {
                                    Image(systemName: "checkmark")
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .iveSurfaceCard(cornerRadius: 10)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }
}

private struct IVEImagePreviewSection: View {
    let selectedImage: IVEMediaAssetRef?
    let sourceURL: URL?
    let sourceAspectRatio: CGFloat?
    let isCropSelectionActive: Bool
    @Binding var cropRect: IVENormalizedRect
    let previewCropRect: IVENormalizedRect
    let previewScale: Double
    let exposure: Double
    let contrast: Double
    let saturation: Double
    let temperature: Double
    let tint: Double
    let curveShadows: Double
    let curveMidtones: Double
    let curveHighlights: Double
    let curveRedShadows: Double
    let curveRedMidtones: Double
    let curveRedHighlights: Double
    let curveGreenShadows: Double
    let curveGreenMidtones: Double
    let curveGreenHighlights: Double
    let curveBlueShadows: Double
    let curveBlueMidtones: Double
    let curveBlueHighlights: Double
    let blackPoint: Double
    let whitePoint: Double
    let denoise: Double
    let sharpen: Double
    let rotationDegrees: Double
    let mirrorHorizontal: Bool
    let mirrorVertical: Bool
    let filterPreset: IVEImageFilterPreset
    let showHistogram: Bool
    let previewHeightRange: ClosedRange<CGFloat>

    var body: some View {
        Group {
            if let selectedImage {
                MediaPreviewCard(
                    asset: selectedImage,
                    url: sourceURL,
                    exposure: exposure,
                    contrast: contrast,
                    saturation: saturation,
                    temperature: temperature,
                    tint: tint,
                    curveShadows: curveShadows,
                    curveMidtones: curveMidtones,
                    curveHighlights: curveHighlights,
                    curveRedShadows: curveRedShadows,
                    curveRedMidtones: curveRedMidtones,
                    curveRedHighlights: curveRedHighlights,
                    curveGreenShadows: curveGreenShadows,
                    curveGreenMidtones: curveGreenMidtones,
                    curveGreenHighlights: curveGreenHighlights,
                    curveBlueShadows: curveBlueShadows,
                    curveBlueMidtones: curveBlueMidtones,
                    curveBlueHighlights: curveBlueHighlights,
                    blackPoint: blackPoint,
                    whitePoint: whitePoint,
                    denoise: denoise,
                    sharpen: sharpen,
                    rotationDegrees: rotationDegrees,
                    mirrorHorizontal: mirrorHorizontal,
                    mirrorVertical: mirrorVertical,
                    cropRect: previewCropRect,
                    scale: 1,
                    videoCropMode: .fit,
                    filterPreset: filterPreset,
                    showHistogram: showHistogram
                )
                .frame(minHeight: previewHeightRange.lowerBound, maxHeight: previewHeightRange.upperBound)
                .clipped()
                .overlay {
                    if isCropSelectionActive {
                        CropSelectionOverlay(
                            cropRect: $cropRect,
                            contentAspectRatio: sourceAspectRatio,
                            lockedAspectRatio: nil
                        )
                        .padding(8)
                        .allowsHitTesting(true)
                        .id("image-crop-overlay-active")
                    }
                }
            }
        }
    }
}

private struct IVEControlSizingTokens {
    let isCompactWidth: Bool
    let dynamicTypeSize: DynamicTypeSize

    private var dynamicScale: CGFloat {
        if dynamicTypeSize.isAccessibilitySize { return 1.2 }
        if dynamicTypeSize >= .xLarge { return 1.08 }
        if dynamicTypeSize <= .small { return 0.95 }
        return 1.0
    }

    var toolTileWidth: CGFloat {
        (isCompactWidth ? 80 : 86) * dynamicScale
    }

    var toolTileHeight: CGFloat {
        (isCompactWidth ? 68 : 74) * dynamicScale
    }

    var filterPreviewWidth: CGFloat {
        (isCompactWidth ? 62 : 68) * dynamicScale
    }

    var filterPreviewHeight: CGFloat {
        (isCompactWidth ? 48 : 54) * dynamicScale
    }

    var rowLabelWidth: CGFloat {
        (isCompactWidth ? 78 : 92) * dynamicScale
    }

    var iconButtonWidth: CGFloat {
        (isCompactWidth ? 76 : 86) * dynamicScale
    }

    var iconCircleSize: CGFloat {
        (isCompactWidth ? 48 : 54) * dynamicScale
    }

    var expectedActionRowItemWidth: CGFloat {
        iconButtonWidth
    }
}

private struct IVEImageEditorControls: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    @Binding var activeTool: ImageEditorTool
    @Binding var pendingExposureValue: Double
    @Binding var pendingContrastValue: Double
    @Binding var pendingSaturationValue: Double
    @Binding var pendingTemperatureValue: Double
    @Binding var pendingTintValue: Double
    @Binding var pendingCurveShadowsValue: Double
    @Binding var pendingCurveMidtonesValue: Double
    @Binding var pendingCurveHighlightsValue: Double
    @Binding var pendingCurveRedShadowsValue: Double
    @Binding var pendingCurveRedMidtonesValue: Double
    @Binding var pendingCurveRedHighlightsValue: Double
    @Binding var pendingCurveGreenShadowsValue: Double
    @Binding var pendingCurveGreenMidtonesValue: Double
    @Binding var pendingCurveGreenHighlightsValue: Double
    @Binding var pendingCurveBlueShadowsValue: Double
    @Binding var pendingCurveBlueMidtonesValue: Double
    @Binding var pendingCurveBlueHighlightsValue: Double
    @Binding var pendingBlackPointValue: Double
    @Binding var pendingWhitePointValue: Double
    @Binding var activeCurveChannel: IVECurveEditingChannel
    @Binding var pendingDenoiseValue: Double
    @Binding var pendingSharpenValue: Double
    @Binding var pendingCropRect: IVENormalizedRect
    @Binding var pendingFilterPreset: IVEImageFilterPreset
    @Binding var pendingRotationDegrees: Double
    @Binding var pendingMirrorHorizontal: Bool
    @Binding var pendingMirrorVertical: Bool
    let filterThumbnailSourceURL: URL?

    let hasAIProvider: Bool
    let aiStatusMessage: String?
    let onResetCropArea: () -> Void
    let onRemoveBackground: () -> Void
    let onSetBackgroundWhite: () -> Void
    let onSetBackgroundBlack: () -> Void
    let onSetBackgroundBlur: () -> Void
    let onRemoveSubject: () -> Void
    let onApplyNow: () -> Void
    let isCalibrationPreviewEnabled: Bool
    let onSetCalibrationPreviewEnabled: (Bool) -> Void
    let onExport: () -> Void
    let onDone: () -> Void
    let onAbort: () -> Void
    let onResetImage: () -> Void
    let onApplyCurvePreset: (IVEColorCurvePreset) -> Void
    let onToggleHistogram: () -> Void
    let onUndo: () -> Void
    let onRedo: () -> Void
    let isHistogramVisible: Bool
    let canUndo: Bool
    let canRedo: Bool
    let isAIOperationInProgress: Bool
    let isApplyInProgress: Bool
    let isExportInProgress: Bool
    let isDoneInProgress: Bool
    let isResetInProgress: Bool
    let imageProcessingStartedAt: Date?
    let isHistoryChangeInProgress: Bool

    private var sizingTokens: IVEControlSizingTokens {
        IVEControlSizingTokens(
            isCompactWidth: horizontalSizeClass == .compact,
            dynamicTypeSize: dynamicTypeSize
        )
    }

    private var selectedCurveShadowsBinding: Binding<Double> {
        Binding(
            get: {
                switch activeCurveChannel {
                case .master: return pendingCurveShadowsValue
                case .red: return pendingCurveRedShadowsValue
                case .green: return pendingCurveGreenShadowsValue
                case .blue: return pendingCurveBlueShadowsValue
                }
            },
            set: { newValue in
                switch activeCurveChannel {
                case .master: pendingCurveShadowsValue = newValue
                case .red: pendingCurveRedShadowsValue = newValue
                case .green: pendingCurveGreenShadowsValue = newValue
                case .blue: pendingCurveBlueShadowsValue = newValue
                }
            }
        )
    }

    private var selectedCurveMidtonesBinding: Binding<Double> {
        Binding(
            get: {
                switch activeCurveChannel {
                case .master: return pendingCurveMidtonesValue
                case .red: return pendingCurveRedMidtonesValue
                case .green: return pendingCurveGreenMidtonesValue
                case .blue: return pendingCurveBlueMidtonesValue
                }
            },
            set: { newValue in
                switch activeCurveChannel {
                case .master: pendingCurveMidtonesValue = newValue
                case .red: pendingCurveRedMidtonesValue = newValue
                case .green: pendingCurveGreenMidtonesValue = newValue
                case .blue: pendingCurveBlueMidtonesValue = newValue
                }
            }
        )
    }

    private var selectedCurveHighlightsBinding: Binding<Double> {
        Binding(
            get: {
                switch activeCurveChannel {
                case .master: return pendingCurveHighlightsValue
                case .red: return pendingCurveRedHighlightsValue
                case .green: return pendingCurveGreenHighlightsValue
                case .blue: return pendingCurveBlueHighlightsValue
                }
            },
            set: { newValue in
                switch activeCurveChannel {
                case .master: pendingCurveHighlightsValue = newValue
                case .red: pendingCurveRedHighlightsValue = newValue
                case .green: pendingCurveGreenHighlightsValue = newValue
                case .blue: pendingCurveBlueHighlightsValue = newValue
                }
            }
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            imageToolStrip

            VStack(alignment: .leading, spacing: 12) {
                IVEImageToolHeader(tool: activeTool)
                activeToolPanel
            }
            .padding(12)
            .iveSurfaceCard(cornerRadius: 18)

            if activeTool == .color, isHistogramVisible, let sourceURL = filterThumbnailSourceURL {
                IVEHistogramOverlay(
                    sourceURL: sourceURL,
                    isVideo: false,
                    curveShadows: selectedCurveShadowsBinding,
                    curveMidtones: selectedCurveMidtonesBinding,
                    curveHighlights: selectedCurveHighlightsBinding,
                    blackPoint: $pendingBlackPointValue,
                    whitePoint: $pendingWhitePointValue
                )
                    .frame(height: 148)
                    .padding(8)
                    .iveSurfaceCard(cornerRadius: 14)
            }

            imageActionRow

            HStack(spacing: 10) {
                IVEVideoIconButton(systemImage: "arrow.uturn.backward", isEnabled: canUndo && !isHistoryChangeInProgress, accessibilityLabel: "Undo", action: onUndo)
                IVEVideoIconButton(systemImage: "arrow.uturn.forward", isEnabled: canRedo && !isHistoryChangeInProgress, accessibilityLabel: "Redo", action: onRedo)
            }

            if isAIOperationInProgress || isApplyInProgress || isExportInProgress || isDoneInProgress || isResetInProgress || isHistoryChangeInProgress {
                if let imageProcessingStartedAt {
                    TimelineView(.periodic(from: .now, by: 1)) { timelineContext in
                        Label("\(iveL("Processing action...")) \(elapsedTimeLabel(since: imageProcessingStartedAt, now: timelineContext.date))", systemImage: "hourglass")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Label(iveL("Processing action..."), systemImage: "hourglass")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Text(
                "Undo/Redo works on the edit history. Apply commits current controls. Done & Close saves and closes. Abort & Close discards and closes. Reset Image restores the original asset.",
                tableName: "Localizable",
                bundle: .module
            )
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }

    private var imageToolStrip: some View {
        IVEHorizontalChevronScroll(
            minimumExpectedContentWidth: imageToolStripExpectedWidth
        ) {
            HStack(spacing: 8) {
                ForEach(ImageEditorTool.allCases) { tool in
                    let isSelected = activeTool == tool
                    Button {
                        activeTool = tool
                    } label: {
                        VStack(spacing: 6) {
                            Image(systemName: tool.iconName)
                                .font(.system(size: 19, weight: .semibold))
                            Text(tool.title)
                                .font(.caption2.weight(.medium))
                        }
                        .foregroundStyle(isSelected ? Color.accentColor : .primary)
                        .frame(width: sizingTokens.toolTileWidth, height: sizingTokens.toolTileHeight)
                        .background(
                            RoundedRectangle(cornerRadius: 16, style: .continuous)
                                .fill(isSelected ? Color.accentColor.opacity(0.16) : Color.clear)
                        )
                    }
                    .buttonStyle(.plain)
                    .iveSurfaceCard(cornerRadius: 16)
                }
            }
            .padding(.horizontal, 2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .animation(.spring(duration: 0.28), value: activeTool)
    }

    private var imageToolStripExpectedWidth: CGFloat {
        let itemCount = CGFloat(ImageEditorTool.allCases.count)
        guard itemCount > 0 else { return 0 }
        return (itemCount * sizingTokens.toolTileWidth) + ((itemCount - 1) * 8) + 4
    }

    private var imageActionRowExpectedWidth: CGFloat {
        let itemCount: CGFloat = 5
        return (itemCount * sizingTokens.expectedActionRowItemWidth) + ((itemCount - 1) * 10)
    }

    private func elapsedTimeLabel(since start: Date, now: Date) -> String {
        let totalSeconds = max(0, Int(now.timeIntervalSince(start)))
        let minutes = totalSeconds / 60
        let seconds = totalSeconds % 60
        return String(format: "(%d:%02d)", minutes, seconds)
    }

    @ViewBuilder
    private var activeToolPanel: some View {
        switch activeTool {
        case .adjust:
            VStack(alignment: .leading, spacing: 8) {
                LabeledSliderRow(title: iveL("Exposure"), valueText: pendingExposureValue.formatted(.number.precision(.fractionLength(2))), value: $pendingExposureValue, range: -2...2)
                LabeledSliderRow(title: iveL("Contrast"), valueText: pendingContrastValue.formatted(.number.precision(.fractionLength(2))), value: $pendingContrastValue, range: 0.5...2)
                LabeledSliderRow(title: iveL("Saturation"), valueText: pendingSaturationValue.formatted(.number.precision(.fractionLength(2))), value: $pendingSaturationValue, range: 0...2)
                LabeledSliderRow(
                    title: iveL("Temperature"),
                    valueText: pendingTemperatureValue.formatted(.number.sign(strategy: .always()).precision(.fractionLength(0))),
                    value: $pendingTemperatureValue,
                    range: -4000...4000,
                    step: 10
                )
                LabeledSliderRow(
                    title: iveL("Tint"),
                    valueText: pendingTintValue.formatted(.number.sign(strategy: .always()).precision(.fractionLength(0))),
                    value: $pendingTintValue,
                    range: -200...200,
                    step: 1
                )
                LabeledSliderRow(title: iveL("Denoise"), valueText: pendingDenoiseValue.formatted(.number.precision(.fractionLength(2))), value: $pendingDenoiseValue, range: 0...1)
                LabeledSliderRow(title: iveL("Sharpen"), valueText: pendingSharpenValue.formatted(.number.precision(.fractionLength(2))), value: $pendingSharpenValue, range: 0...2)
            }
        case .color:
            VStack(alignment: .leading, spacing: 8) {
                Picker(iveL("Curve Channel"), selection: $activeCurveChannel) {
                    ForEach(IVECurveEditingChannel.allCases) { channel in
                        Text(channel.title).tag(channel)
                    }
                }
                .pickerStyle(.segmented)

                switch activeCurveChannel {
                case .master:
                    LabeledSliderRow(title: iveL("Curve Shadows"), valueText: pendingCurveShadowsValue.formatted(.number.precision(.fractionLength(2))), value: $pendingCurveShadowsValue, range: -1...1)
                    LabeledSliderRow(title: iveL("Curve Midtones"), valueText: pendingCurveMidtonesValue.formatted(.number.precision(.fractionLength(2))), value: $pendingCurveMidtonesValue, range: -1...1)
                    LabeledSliderRow(title: iveL("Curve Highlights"), valueText: pendingCurveHighlightsValue.formatted(.number.precision(.fractionLength(2))), value: $pendingCurveHighlightsValue, range: -1...1)
                case .red:
                    LabeledSliderRow(title: iveL("Red Shadows"), valueText: pendingCurveRedShadowsValue.formatted(.number.precision(.fractionLength(2))), value: $pendingCurveRedShadowsValue, range: -1...1)
                    LabeledSliderRow(title: iveL("Red Midtones"), valueText: pendingCurveRedMidtonesValue.formatted(.number.precision(.fractionLength(2))), value: $pendingCurveRedMidtonesValue, range: -1...1)
                    LabeledSliderRow(title: iveL("Red Highlights"), valueText: pendingCurveRedHighlightsValue.formatted(.number.precision(.fractionLength(2))), value: $pendingCurveRedHighlightsValue, range: -1...1)
                case .green:
                    LabeledSliderRow(title: iveL("Green Shadows"), valueText: pendingCurveGreenShadowsValue.formatted(.number.precision(.fractionLength(2))), value: $pendingCurveGreenShadowsValue, range: -1...1)
                    LabeledSliderRow(title: iveL("Green Midtones"), valueText: pendingCurveGreenMidtonesValue.formatted(.number.precision(.fractionLength(2))), value: $pendingCurveGreenMidtonesValue, range: -1...1)
                    LabeledSliderRow(title: iveL("Green Highlights"), valueText: pendingCurveGreenHighlightsValue.formatted(.number.precision(.fractionLength(2))), value: $pendingCurveGreenHighlightsValue, range: -1...1)
                case .blue:
                    LabeledSliderRow(title: iveL("Blue Shadows"), valueText: pendingCurveBlueShadowsValue.formatted(.number.precision(.fractionLength(2))), value: $pendingCurveBlueShadowsValue, range: -1...1)
                    LabeledSliderRow(title: iveL("Blue Midtones"), valueText: pendingCurveBlueMidtonesValue.formatted(.number.precision(.fractionLength(2))), value: $pendingCurveBlueMidtonesValue, range: -1...1)
                    LabeledSliderRow(title: iveL("Blue Highlights"), valueText: pendingCurveBlueHighlightsValue.formatted(.number.precision(.fractionLength(2))), value: $pendingCurveBlueHighlightsValue, range: -1...1)
                }

                LabeledSliderRow(title: iveL("Black Point"), valueText: pendingBlackPointValue.formatted(.number.precision(.fractionLength(2))), value: $pendingBlackPointValue, range: 0...0.3, step: 0.005)
                LabeledSliderRow(title: iveL("White Point"), valueText: pendingWhitePointValue.formatted(.number.precision(.fractionLength(2))), value: $pendingWhitePointValue, range: 0.7...1, step: 0.005)

                HStack(spacing: 8) {
                    ForEach(IVEColorCurvePreset.allCases) { preset in
                        Button(preset.title) {
                            onApplyCurvePreset(preset)
                        }
                        .buttonStyle(.bordered)
                        if preset == .highContrast {
                            Toggle(
                                isOn: Binding(
                                    get: { isCalibrationPreviewEnabled },
                                    set: { onSetCalibrationPreviewEnabled($0) }
                                )
                            ) {
                                Label(iveL("Calibration Preview"), systemImage: "circle.lefthalf.filled")
                            }
                            .toggleStyle(.button)
                        }
                    }
                }
                IVEVideoIconButton(systemImage: isHistogramVisible ? "chart.bar.fill" : "chart.bar", accessibilityLabel: "Toggle Histogram", action: onToggleHistogram)
                Text(iveL("Use Histogram to inspect tonal distribution while tuning the curve."))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        case .crop:
            VStack(alignment: .leading, spacing: 8) {
                Text(iveL("Draw a crop rectangle on the preview. Apply commits the selection."))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        case .style:
            VStack(alignment: .leading, spacing: 8) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(IVEImageFilterPreset.allCases, id: \.self) { preset in
                            let isSelected = pendingFilterPreset == preset
                            Button {
                                pendingFilterPreset = preset
                            } label: {
                                VStack(spacing: 6) {
                                    IVEFilterThumbnail(preset: preset, sourceURL: filterThumbnailSourceURL)
                                        .frame(width: sizingTokens.filterPreviewWidth, height: sizingTokens.filterPreviewHeight)
                                    Text(filterChipTitle(for: preset))
                                        .font(.caption2.weight(.medium))
                                        .lineLimit(1)
                                }
                                .padding(6)
                                .background(
                                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                                        .fill(isSelected ? Color.accentColor.opacity(0.18) : Color.clear)
                                )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 2)
                }
                .iveSurfaceCard(cornerRadius: 12)

                VStack(alignment: .leading, spacing: 8) {
                    if hasAIProvider {
                        IVEVideoIconButton(
                            systemImage: "wand.and.stars",
                            isProminent: true,
                            isEnabled: !isAIOperationInProgress,
                            accessibilityLabel: "AI Remove Background",
                            action: onRemoveBackground
                        )
                    }
                    Text(iveL("AI Functions"))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)

                    HStack(spacing: 8) {
                        IVEVideoIconButton(
                            systemImage: "square.fill",
                            isEnabled: !isAIOperationInProgress,
                            accessibilityLabel: "Background White",
                            action: onSetBackgroundWhite
                        )
                        IVEVideoIconButton(
                            systemImage: "square",
                            isEnabled: !isAIOperationInProgress,
                            accessibilityLabel: "Background Black",
                            action: onSetBackgroundBlack
                        )
                        IVEVideoIconButton(
                            systemImage: "drop.halffull",
                            isEnabled: !isAIOperationInProgress,
                            accessibilityLabel: "Background Blur",
                            action: onSetBackgroundBlur
                        )
                        IVEVideoIconButton(
                            systemImage: "eraser",
                            isEnabled: !isAIOperationInProgress,
                            accessibilityLabel: "Remove Subject",
                            action: onRemoveSubject
                        )
                    }
                }

                if let aiStatusMessage {
                    Text(aiStatusMessage)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
        case .transform:
            VStack(alignment: .leading, spacing: 8) {
                LabeledSliderRow(
                    title: iveL("Rotation"),
                    valueText: "\(pendingRotationDegrees.formatted(.number.precision(.fractionLength(0))))°",
                    value: $pendingRotationDegrees,
                    range: -180...180,
                    step: 1
                )
                HStack(spacing: 10) {
                    Text(iveL("Flip"))
                        .font(.footnote)
                        .frame(width: sizingTokens.rowLabelWidth, alignment: .leading)
                    IVEVideoTogglePill(title: iveL("Horizontal"), systemImage: "flip.horizontal", isOn: $pendingMirrorHorizontal)
                    IVEVideoTogglePill(title: iveL("Vertical"), systemImage: "arrow.trianglehead.up.and.down.righttriangle.up.righttriangle.down", isOn: $pendingMirrorVertical)
                }
            }
        }
    }

    private var imageActionRow: some View {
        IVEHorizontalChevronScroll(
            minimumExpectedContentWidth: imageActionRowExpectedWidth
        ) {
            HStack(spacing: 10) {
                IVEVideoIconButton(systemImage: "checkmark.circle", isProminent: true, isEnabled: !isApplyInProgress, accessibilityLabel: "Apply", action: onApplyNow)
                IVEVideoIconButton(systemImage: "square.and.arrow.up", isEnabled: !isExportInProgress, accessibilityLabel: "Export", action: onExport)
                IVEVideoIconButton(systemImage: "checkmark.circle.fill", isProminent: true, prominentBackgroundColor: .green, isEnabled: !isDoneInProgress, accessibilityLabel: "Done & Close", action: onDone)
                IVEVideoIconButton(systemImage: "xmark.circle.fill", isProminent: true, prominentBackgroundColor: .red, accessibilityLabel: "Abort & Close", action: onAbort)
                IVEVideoIconButton(
                    systemImage: "arrow.uturn.backward.circle",
                    nonProminentBackgroundColor: .yellow.opacity(0.24),
                    isEnabled: !isResetInProgress,
                    accessibilityLabel: "Reset Image",
                    action: onResetImage
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func filterChipTitle(for preset: IVEImageFilterPreset) -> String {
        switch preset {
        case .none: iveL("None")
        case .mono: iveL("Mono")
        case .vivid: iveL("Vivid")
        case .warm: iveL("Warm")
        case .cool: iveL("Cool")
        case .dramatic: iveL("Drama")
        case .noir: iveL("Noir")
        case .faded: iveL("Faded")
        case .vintage: iveL("Vintage")
        case .punch: iveL("Punch")
        case .tealOrange: iveL("Teal Orange")
        case .sepia: iveL("Sepia")
        }
    }

}

private struct IVEFilterThumbnail: View {
    let preset: IVEImageFilterPreset
    let sourceURL: URL?
    @State private var thumbnailCGImage: CGImage?

    var body: some View {
        ZStack {
            if let thumbnailCGImage {
                Image(decorative: thumbnailCGImage, scale: 1, orientation: .up)
                    .resizable()
                    .scaledToFill()
            } else {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(gradient)
                Image(systemName: "photo")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(symbolColor)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(Color.white.opacity(0.24), lineWidth: 0.7)
        )
        .task(id: cacheKey) {
            thumbnailCGImage = await loadThumbnail()
        }
    }

    private var cacheKey: String {
        "\(sourceURL?.absoluteString ?? "nil")::\(preset.rawValue)"
    }

    private func loadThumbnail() async -> CGImage? {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .utility).async {
                let generated = Self.generateThumbnail(preset: preset, sourceURL: sourceURL)
                continuation.resume(returning: generated)
            }
        }
    }

    nonisolated private static func generateThumbnail(preset: IVEImageFilterPreset, sourceURL: URL?) -> CGImage? {
        guard let sourceURL else { return nil }

        let sourceImage: CIImage
        if let ci = CIImage(contentsOf: sourceURL, options: [.applyOrientationProperty: true]) {
            sourceImage = ci
        } else if let imageSource = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
                  let cg = CGImageSourceCreateImageAtIndex(imageSource, 0, nil) {
            sourceImage = CIImage(cgImage: cg)
        } else {
            return nil
        }

        let baseExtent = sourceImage.extent.integral
        guard baseExtent.width > 0, baseExtent.height > 0 else { return nil }
        let targetMax: CGFloat = 220
        let scale = min(1, targetMax / max(baseExtent.width, baseExtent.height))
        var image = sourceImage.transformed(by: CGAffineTransform(scaleX: scale, y: scale))

        let state = ImageRenderState(
            exposure: 0,
            contrast: 1,
            saturation: 1,
            temperature: 0,
            tint: 0,
            curveShadows: 0,
            curveMidtones: 0,
            curveHighlights: 0,
            denoise: 0,
            sharpen: 0,
            rotationDegrees: 0,
            mirrorHorizontal: false,
            mirrorVertical: false,
            filterPreset: preset
        )

        let controls = CIFilter.colorControls()
        controls.inputImage = image
        controls.brightness = Float(state.filterBrightness)
        controls.contrast = Float(state.filterContrast)
        controls.saturation = Float(state.filterSaturation)
        image = controls.outputImage ?? image

        if state.filterHueRotationDegrees != 0 {
            let hue = CIFilter.hueAdjust()
            hue.inputImage = image
            hue.angle = Float(state.filterHueRotationDegrees * .pi / 180)
            image = hue.outputImage ?? image
        }

        let extent = image.extent.integral
        return CIContext().createCGImage(image, from: extent)
    }

    private var gradient: LinearGradient {
        switch preset {
        case .none:
            return LinearGradient(colors: [.gray.opacity(0.22), .gray.opacity(0.1)], startPoint: .topLeading, endPoint: .bottomTrailing)
        case .mono:
            return LinearGradient(colors: [.gray.opacity(0.55), .black.opacity(0.72)], startPoint: .topLeading, endPoint: .bottomTrailing)
        case .vivid:
            return LinearGradient(colors: [.orange.opacity(0.9), .pink.opacity(0.85)], startPoint: .topLeading, endPoint: .bottomTrailing)
        case .warm:
            return LinearGradient(colors: [.yellow.opacity(0.7), .orange.opacity(0.8)], startPoint: .topLeading, endPoint: .bottomTrailing)
        case .cool:
            return LinearGradient(colors: [.teal.opacity(0.75), .blue.opacity(0.8)], startPoint: .topLeading, endPoint: .bottomTrailing)
        case .dramatic:
            return LinearGradient(colors: [.indigo.opacity(0.7), .black.opacity(0.9)], startPoint: .topLeading, endPoint: .bottomTrailing)
        case .noir:
            return LinearGradient(colors: [.black.opacity(0.95), .gray.opacity(0.45)], startPoint: .topLeading, endPoint: .bottomTrailing)
        case .faded:
            return LinearGradient(colors: [.brown.opacity(0.35), .gray.opacity(0.25)], startPoint: .topLeading, endPoint: .bottomTrailing)
        case .vintage:
            return LinearGradient(colors: [.brown.opacity(0.65), .orange.opacity(0.5)], startPoint: .topLeading, endPoint: .bottomTrailing)
        case .punch:
            return LinearGradient(colors: [.red.opacity(0.85), .purple.opacity(0.8)], startPoint: .topLeading, endPoint: .bottomTrailing)
        case .tealOrange:
            return LinearGradient(colors: [.teal.opacity(0.8), .orange.opacity(0.85)], startPoint: .topLeading, endPoint: .bottomTrailing)
        case .sepia:
            return LinearGradient(colors: [.brown.opacity(0.82), .yellow.opacity(0.42)], startPoint: .topLeading, endPoint: .bottomTrailing)
        }
    }

    private var symbolColor: Color {
        switch preset {
        case .noir:
            return .white.opacity(0.9)
        default:
            return .white.opacity(0.85)
        }
    }
}

private struct IVEVideoFilterThumbnail: View {
    let preset: IVEImageFilterPreset
    let sourceURL: URL?
    let referenceTimeSeconds: Double?
    @State private var thumbnailCGImage: CGImage?

    var body: some View {
        ZStack {
            if let thumbnailCGImage {
                Image(decorative: thumbnailCGImage, scale: 1, orientation: .up)
                    .resizable()
                    .scaledToFill()
            } else {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [.gray.opacity(0.26), .gray.opacity(0.12)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                Image(systemName: "film")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.85))
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(Color.white.opacity(0.24), lineWidth: 0.7)
        )
        .task(id: cacheKey) {
            thumbnailCGImage = await loadThumbnail()
        }
    }

    private var cacheKey: String {
        let referenceSignature: String
        if let referenceTimeSeconds {
            referenceSignature = String(format: "%.3f", referenceTimeSeconds)
        } else {
            referenceSignature = "nil"
        }
        return "\(sourceURL?.absoluteString ?? "nil")::\(preset.rawValue)::\(referenceSignature)"
    }

    private func loadThumbnail() async -> CGImage? {
        await Self.generateThumbnail(
            preset: preset,
            sourceURL: sourceURL,
            referenceTimeSeconds: referenceTimeSeconds
        )
    }

    nonisolated private static func generateThumbnail(
        preset: IVEImageFilterPreset,
        sourceURL: URL?,
        referenceTimeSeconds: Double?
    ) async -> CGImage? {
        guard let sourceURL else { return nil }

        guard let frame = await iveVideoFrameCGImage(
            from: sourceURL,
            at: referenceTimeSeconds ?? 0,
            maximumSize: CGSize(width: 320, height: 320)
        ) else {
            return nil
        }

        let sourceImage = CIImage(cgImage: frame)
        let baseExtent = sourceImage.extent.integral
        guard baseExtent.width > 0, baseExtent.height > 0 else { return nil }
        let targetMax: CGFloat = 220
        let scale = min(1, targetMax / max(baseExtent.width, baseExtent.height))
        var image = sourceImage.transformed(by: CGAffineTransform(scaleX: scale, y: scale))

        let state = VideoRenderState(
            exposure: 0,
            contrast: 1,
            saturation: 1,
            temperature: 0,
            tint: 0,
            curveShadows: 0,
            curveMidtones: 0,
            curveHighlights: 0,
            rotationDegrees: 0,
            mirrorHorizontal: false,
            mirrorVertical: false,
            filterPreset: preset
        )

        let controls = CIFilter.colorControls()
        controls.inputImage = image
        controls.brightness = Float(state.filterBrightness)
        controls.contrast = Float(state.filterContrast)
        controls.saturation = Float(state.filterSaturation)
        image = controls.outputImage ?? image

        if state.filterHueRotationDegrees != 0 {
            let hue = CIFilter.hueAdjust()
            hue.inputImage = image
            hue.angle = Float(state.filterHueRotationDegrees * .pi / 180)
            image = hue.outputImage ?? image
        }

        let extent = image.extent.integral
        return CIContext().createCGImage(image, from: extent)
    }

}

fileprivate func iveVideoFrameCGImage(from sourceURL: URL, at timeSeconds: Double, maximumSize: CGSize) async -> CGImage? {
    await withCheckedContinuation { continuation in
        let asset = AVURLAsset(url: sourceURL)
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = maximumSize
        generator.requestedTimeToleranceBefore = .zero
        generator.requestedTimeToleranceAfter = .zero
        let requestedTime = CMTime(seconds: max(0, timeSeconds), preferredTimescale: 600)

        generator.generateCGImagesAsynchronously(forTimes: [NSValue(time: requestedTime)]) { _, image, _, result, _ in
            if result == .succeeded {
                continuation.resume(returning: image)
            } else {
                continuation.resume(returning: nil)
            }
        }
    }
}

fileprivate func iveFirstVideoFrameCGImage(from sourceURL: URL, maximumSize: CGSize) async -> CGImage? {
    await iveVideoFrameCGImage(from: sourceURL, at: 0, maximumSize: maximumSize)
}

private struct IVEImageToolHeader: View {
    let tool: ImageEditorTool

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: tool.iconName)
                .font(.subheadline.weight(.semibold))
                .frame(width: 28, height: 28)
                .background(Color.accentColor.opacity(0.14), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .foregroundStyle(Color.accentColor)
            VStack(alignment: .leading, spacing: 2) {
                Text(tool.title)
                    .font(.subheadline.weight(.semibold))
                Text(toolSubtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var toolSubtitle: String {
        switch tool {
        case .adjust: iveL("Tune light, detail, and intensity.")
        case .color: iveL("Shape tonal curve and inspect histogram.")
        case .crop: iveL("Draw a crop directly on the image.")
        case .style: iveL("Choose a look or run helper actions.")
        case .transform: iveL("Rotate or flip the current image.")
        }
    }
}

private struct IVEImageActionChip: View {
    let title: String
    var isEnabled = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.caption.weight(.medium))
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
        }
        .buttonStyle(.plain)
        .contentShape(Rectangle())
        .iveSurfaceCard(cornerRadius: 999)
        .opacity(isEnabled ? 1 : 0.6)
        .disabled(!isEnabled)
    }
}

private struct IVEVideoEditorControls: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    let videoAssets: [IVEMediaAssetRef]
    @Binding var selectedVideoAssetID: UUID?
    @Binding var activeTool: VideoEditorTool
    @Binding var pendingVideoExposureValue: Double
    @Binding var pendingVideoContrastValue: Double
    @Binding var pendingVideoSaturationValue: Double
    @Binding var pendingVideoTemperatureValue: Double
    @Binding var pendingVideoTintValue: Double
    @Binding var pendingVideoCurveShadowsValue: Double
    @Binding var pendingVideoCurveMidtonesValue: Double
    @Binding var pendingVideoCurveHighlightsValue: Double
    @Binding var pendingVideoCurveRedShadowsValue: Double
    @Binding var pendingVideoCurveRedMidtonesValue: Double
    @Binding var pendingVideoCurveRedHighlightsValue: Double
    @Binding var pendingVideoCurveGreenShadowsValue: Double
    @Binding var pendingVideoCurveGreenMidtonesValue: Double
    @Binding var pendingVideoCurveGreenHighlightsValue: Double
    @Binding var pendingVideoCurveBlueShadowsValue: Double
    @Binding var pendingVideoCurveBlueMidtonesValue: Double
    @Binding var pendingVideoCurveBlueHighlightsValue: Double
    @Binding var pendingVideoBlackPointValue: Double
    @Binding var pendingVideoWhitePointValue: Double
    @Binding var activeCurveChannel: IVECurveEditingChannel
    @Binding var pendingVideoCropRect: IVENormalizedRect
    @Binding var pendingVideoCropMode: IVEVideoCropMode
    @Binding var pendingVideoFilterPreset: IVEImageFilterPreset
    @Binding var pendingVideoRotationDegrees: Double
    @Binding var pendingVideoMirrorHorizontal: Bool
    @Binding var pendingVideoMirrorVertical: Bool
    let filterThumbnailSourceURL: URL?
    let referenceFrameTimeSeconds: Double?
    let selectedTimelineClip: IVEVideoClip?
    let clips: [IVEVideoClip]
    @Binding var trimStart: Double
    @Binding var trimDuration: Double
    let selectedVideoDurationSeconds: Double
    let shortName: (String) -> String
    let onSelectVideo: (IVEMediaAssetRef) -> Void
    let onResetCropArea: () -> Void
    let onBuildTimeline: () -> Void
    let onSplitSelected: () -> Void
    let onRippleDeleteSelected: () -> Void
    let onApplyTrim: () -> Void
    let onApply: () -> Void
    let onExport: () -> Void
    let onDone: () -> Void
    let onAbort: () -> Void
    let onResetVideo: () -> Void
    let onTrimStartPreviewChanged: (Double) -> Void
    let onApplyCurvePreset: (IVEColorCurvePreset) -> Void
    let onToggleHistogram: () -> Void
    let isCalibrationPreviewEnabled: Bool
    let onSetCalibrationPreviewEnabled: (Bool) -> Void
    let onUndo: () -> Void
    let onRedo: () -> Void
    let isHistogramVisible: Bool
    let canUndo: Bool
    let canRedo: Bool
    let isBuildTimelineInProgress: Bool
    let isSplitInProgress: Bool
    let isRippleDeleteInProgress: Bool
    let isTrimInProgress: Bool
    let isApplyInProgress: Bool
    let isExportInProgress: Bool
    let isDoneInProgress: Bool
    let isResetInProgress: Bool
    let videoProcessingStartedAt: Date?
    let isHistoryChangeInProgress: Bool

    private var sizingTokens: IVEControlSizingTokens {
        IVEControlSizingTokens(
            isCompactWidth: horizontalSizeClass == .compact,
            dynamicTypeSize: dynamicTypeSize
        )
    }

    private var selectedCurveShadowsBinding: Binding<Double> {
        Binding(
            get: {
                switch activeCurveChannel {
                case .master: return pendingVideoCurveShadowsValue
                case .red: return pendingVideoCurveRedShadowsValue
                case .green: return pendingVideoCurveGreenShadowsValue
                case .blue: return pendingVideoCurveBlueShadowsValue
                }
            },
            set: { newValue in
                switch activeCurveChannel {
                case .master: pendingVideoCurveShadowsValue = newValue
                case .red: pendingVideoCurveRedShadowsValue = newValue
                case .green: pendingVideoCurveGreenShadowsValue = newValue
                case .blue: pendingVideoCurveBlueShadowsValue = newValue
                }
            }
        )
    }

    private var selectedCurveMidtonesBinding: Binding<Double> {
        Binding(
            get: {
                switch activeCurveChannel {
                case .master: return pendingVideoCurveMidtonesValue
                case .red: return pendingVideoCurveRedMidtonesValue
                case .green: return pendingVideoCurveGreenMidtonesValue
                case .blue: return pendingVideoCurveBlueMidtonesValue
                }
            },
            set: { newValue in
                switch activeCurveChannel {
                case .master: pendingVideoCurveMidtonesValue = newValue
                case .red: pendingVideoCurveRedMidtonesValue = newValue
                case .green: pendingVideoCurveGreenMidtonesValue = newValue
                case .blue: pendingVideoCurveBlueMidtonesValue = newValue
                }
            }
        )
    }

    private var selectedCurveHighlightsBinding: Binding<Double> {
        Binding(
            get: {
                switch activeCurveChannel {
                case .master: return pendingVideoCurveHighlightsValue
                case .red: return pendingVideoCurveRedHighlightsValue
                case .green: return pendingVideoCurveGreenHighlightsValue
                case .blue: return pendingVideoCurveBlueHighlightsValue
                }
            },
            set: { newValue in
                switch activeCurveChannel {
                case .master: pendingVideoCurveHighlightsValue = newValue
                case .red: pendingVideoCurveRedHighlightsValue = newValue
                case .green: pendingVideoCurveGreenHighlightsValue = newValue
                case .blue: pendingVideoCurveBlueHighlightsValue = newValue
                }
            }
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if videoAssets.count > 1 {
                videoSelector
            }

            toolStrip

            VStack(alignment: .leading, spacing: 12) {
                IVEVideoToolHeader(tool: activeTool)
                activeToolPanel
            }
            .padding(12)
            .iveSurfaceCard(cornerRadius: 18)

            if activeTool == .color, isHistogramVisible, let sourceURL = filterThumbnailSourceURL {
                IVEHistogramOverlay(
                    sourceURL: sourceURL,
                    isVideo: true,
                    curveShadows: selectedCurveShadowsBinding,
                    curveMidtones: selectedCurveMidtonesBinding,
                    curveHighlights: selectedCurveHighlightsBinding,
                    blackPoint: $pendingVideoBlackPointValue,
                    whitePoint: $pendingVideoWhitePointValue
                )
                    .frame(height: 148)
                    .padding(8)
                    .iveSurfaceCard(cornerRadius: 14)
            }

            actionRow

            historyRow

            if isBuildTimelineInProgress || isSplitInProgress || isRippleDeleteInProgress || isTrimInProgress || isApplyInProgress || isExportInProgress || isDoneInProgress || isResetInProgress || isHistoryChangeInProgress {
                if let videoProcessingStartedAt, (isExportInProgress || isDoneInProgress) {
                    TimelineView(.periodic(from: .now, by: 1)) { timelineContext in
                        Label("\(iveL("Processing action...")) \(elapsedTimeLabel(since: videoProcessingStartedAt, now: timelineContext.date))", systemImage: "hourglass")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Label(iveL("Processing action..."), systemImage: "hourglass")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Text(
                "Undo/Redo applies to the edit history. Apply commits current controls. Done & Close saves and closes. Abort & Close discards and closes. Reset Video restores the original asset.",
                tableName: "Localizable",
                bundle: .module
            )
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }

    private var videoSelector: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(videoAssets, id: \.id) { video in
                    let isSelected = selectedVideoAssetID == video.id
                    Button {
                        onSelectVideo(video)
                    } label: {
                        VStack(spacing: 6) {
                            Image(systemName: isSelected ? "film.fill" : "film")
                                .font(.system(size: 19, weight: .semibold))
                            Text(shortName(video.localIdentifier))
                                .lineLimit(1)
                                .truncationMode(.middle)
                                .font(.caption2)
                        }
                        .frame(width: sizingTokens.toolTileWidth, height: sizingTokens.toolTileHeight)
                        .background(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .fill(isSelected ? Color.accentColor.opacity(0.18) : Color.clear)
                        )
                    }
                    .buttonStyle(.plain)
                    .iveSurfaceCard(cornerRadius: 14)
                }
            }
            .padding(.horizontal, 2)
        }
    }

    private func elapsedTimeLabel(since start: Date, now: Date) -> String {
        let totalSeconds = max(0, Int(now.timeIntervalSince(start)))
        let minutes = totalSeconds / 60
        let seconds = totalSeconds % 60
        return String(format: "(%d:%02d)", minutes, seconds)
    }

    private var toolStrip: some View {
        IVEHorizontalChevronScroll(
            minimumExpectedContentWidth: videoToolStripExpectedWidth
        ) {
            HStack(spacing: 8) {
                ForEach(VideoEditorTool.allCases) { tool in
                    let isSelected = activeTool == tool
                    Button {
                        activeTool = tool
                    } label: {
                        VStack(spacing: 6) {
                            Image(systemName: tool.iconName)
                                .font(.system(size: 19, weight: .semibold))
                            Text(tool.title)
                                .font(.caption2.weight(.medium))
                        }
                        .foregroundStyle(isSelected ? Color.accentColor : .primary)
                        .frame(width: sizingTokens.toolTileWidth, height: sizingTokens.toolTileHeight)
                        .background(
                            RoundedRectangle(cornerRadius: 16, style: .continuous)
                                .fill(isSelected ? Color.accentColor.opacity(0.16) : Color.clear)
                        )
                    }
                    .buttonStyle(.plain)
                    .iveSurfaceCard(cornerRadius: 16)
                }
            }
            .padding(.horizontal, 2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .animation(.spring(duration: 0.28), value: activeTool)
    }

    private var videoToolStripExpectedWidth: CGFloat {
        let itemCount = CGFloat(VideoEditorTool.allCases.count)
        guard itemCount > 0 else { return 0 }
        return (itemCount * sizingTokens.toolTileWidth) + ((itemCount - 1) * 8) + 4
    }

    private var videoActionRowExpectedWidth: CGFloat {
        let itemCount: CGFloat = 5
        return (itemCount * sizingTokens.expectedActionRowItemWidth) + ((itemCount - 1) * 10)
    }

    @ViewBuilder
    private var activeToolPanel: some View {
        switch activeTool {
        case .adjust:
            VStack(alignment: .leading, spacing: 8) {
                LabeledSliderRow(
                    title: iveL("Exposure"),
                    valueText: pendingVideoExposureValue.formatted(.number.precision(.fractionLength(2))),
                    value: $pendingVideoExposureValue,
                    range: -2...2
                )
                LabeledSliderRow(
                    title: iveL("Contrast"),
                    valueText: pendingVideoContrastValue.formatted(.number.precision(.fractionLength(2))),
                    value: $pendingVideoContrastValue,
                    range: 0.5...2
                )
                LabeledSliderRow(
                    title: iveL("Saturation"),
                    valueText: pendingVideoSaturationValue.formatted(.number.precision(.fractionLength(2))),
                    value: $pendingVideoSaturationValue,
                    range: 0...2
                )
                LabeledSliderRow(
                    title: iveL("Temperature"),
                    valueText: pendingVideoTemperatureValue.formatted(.number.sign(strategy: .always()).precision(.fractionLength(0))),
                    value: $pendingVideoTemperatureValue,
                    range: -4000...4000,
                    step: 10
                )
                LabeledSliderRow(
                    title: iveL("Tint"),
                    valueText: pendingVideoTintValue.formatted(.number.sign(strategy: .always()).precision(.fractionLength(0))),
                    value: $pendingVideoTintValue,
                    range: -200...200,
                    step: 1
                )
            }
        case .color:
            VStack(alignment: .leading, spacing: 8) {
                Picker(iveL("Curve Channel"), selection: $activeCurveChannel) {
                    ForEach(IVECurveEditingChannel.allCases) { channel in
                        Text(channel.title).tag(channel)
                    }
                }
                .pickerStyle(.segmented)

                switch activeCurveChannel {
                case .master:
                    LabeledSliderRow(title: iveL("Curve Shadows"), valueText: pendingVideoCurveShadowsValue.formatted(.number.precision(.fractionLength(2))), value: $pendingVideoCurveShadowsValue, range: -1...1)
                    LabeledSliderRow(title: iveL("Curve Midtones"), valueText: pendingVideoCurveMidtonesValue.formatted(.number.precision(.fractionLength(2))), value: $pendingVideoCurveMidtonesValue, range: -1...1)
                    LabeledSliderRow(title: iveL("Curve Highlights"), valueText: pendingVideoCurveHighlightsValue.formatted(.number.precision(.fractionLength(2))), value: $pendingVideoCurveHighlightsValue, range: -1...1)
                case .red:
                    LabeledSliderRow(title: iveL("Red Shadows"), valueText: pendingVideoCurveRedShadowsValue.formatted(.number.precision(.fractionLength(2))), value: $pendingVideoCurveRedShadowsValue, range: -1...1)
                    LabeledSliderRow(title: iveL("Red Midtones"), valueText: pendingVideoCurveRedMidtonesValue.formatted(.number.precision(.fractionLength(2))), value: $pendingVideoCurveRedMidtonesValue, range: -1...1)
                    LabeledSliderRow(title: iveL("Red Highlights"), valueText: pendingVideoCurveRedHighlightsValue.formatted(.number.precision(.fractionLength(2))), value: $pendingVideoCurveRedHighlightsValue, range: -1...1)
                case .green:
                    LabeledSliderRow(title: iveL("Green Shadows"), valueText: pendingVideoCurveGreenShadowsValue.formatted(.number.precision(.fractionLength(2))), value: $pendingVideoCurveGreenShadowsValue, range: -1...1)
                    LabeledSliderRow(title: iveL("Green Midtones"), valueText: pendingVideoCurveGreenMidtonesValue.formatted(.number.precision(.fractionLength(2))), value: $pendingVideoCurveGreenMidtonesValue, range: -1...1)
                    LabeledSliderRow(title: iveL("Green Highlights"), valueText: pendingVideoCurveGreenHighlightsValue.formatted(.number.precision(.fractionLength(2))), value: $pendingVideoCurveGreenHighlightsValue, range: -1...1)
                case .blue:
                    LabeledSliderRow(title: iveL("Blue Shadows"), valueText: pendingVideoCurveBlueShadowsValue.formatted(.number.precision(.fractionLength(2))), value: $pendingVideoCurveBlueShadowsValue, range: -1...1)
                    LabeledSliderRow(title: iveL("Blue Midtones"), valueText: pendingVideoCurveBlueMidtonesValue.formatted(.number.precision(.fractionLength(2))), value: $pendingVideoCurveBlueMidtonesValue, range: -1...1)
                    LabeledSliderRow(title: iveL("Blue Highlights"), valueText: pendingVideoCurveBlueHighlightsValue.formatted(.number.precision(.fractionLength(2))), value: $pendingVideoCurveBlueHighlightsValue, range: -1...1)
                }

                LabeledSliderRow(title: iveL("Black Point"), valueText: pendingVideoBlackPointValue.formatted(.number.precision(.fractionLength(2))), value: $pendingVideoBlackPointValue, range: 0...0.3, step: 0.005)
                LabeledSliderRow(title: iveL("White Point"), valueText: pendingVideoWhitePointValue.formatted(.number.precision(.fractionLength(2))), value: $pendingVideoWhitePointValue, range: 0.7...1, step: 0.005)

                HStack(spacing: 8) {
                    ForEach(IVEColorCurvePreset.allCases) { preset in
                        Button(preset.title) {
                            onApplyCurvePreset(preset)
                        }
                        .buttonStyle(.bordered)
                        if preset == .highContrast {
                            Toggle(
                                isOn: Binding(
                                    get: { isCalibrationPreviewEnabled },
                                    set: { onSetCalibrationPreviewEnabled($0) }
                                )
                            ) {
                                Label(iveL("Calibration Preview"), systemImage: "circle.lefthalf.filled")
                            }
                            .toggleStyle(.button)
                        }
                    }
                }
                IVEVideoIconButton(systemImage: isHistogramVisible ? "chart.bar.fill" : "chart.bar", accessibilityLabel: "Toggle Histogram", action: onToggleHistogram)
                Text(iveL("Use Histogram to inspect tonal distribution while tuning the curve."))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        case .crop:
            VStack(alignment: .leading, spacing: 10) {
                Picker(iveL("Crop Mode"), selection: $pendingVideoCropMode) {
                    Text(iveL("Fit")).tag(IVEVideoCropMode.fit)
                    Text(iveL("True Crop")).tag(IVEVideoCropMode.trueCrop)
                }
                .pickerStyle(.segmented)
                Text(
                    pendingVideoCropMode == .fit
                        ? iveL("Fit keeps original video dimensions and reframes the selected area.")
                        : iveL("True Crop exports only the selected area at its own dimensions.")
                )
                .font(.caption)
                .foregroundStyle(.secondary)
                Text(iveL("Draw a crop rectangle directly on the preview. Apply commits crop mode and crop area."))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        case .style:
            VStack(alignment: .leading, spacing: 8) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(IVEImageFilterPreset.allCases, id: \.self) { preset in
                            let isSelected = pendingVideoFilterPreset == preset
                            Button {
                                pendingVideoFilterPreset = preset
                            } label: {
                                VStack(spacing: 6) {
                                    IVEVideoFilterThumbnail(
                                        preset: preset,
                                        sourceURL: filterThumbnailSourceURL,
                                        referenceTimeSeconds: referenceFrameTimeSeconds
                                    )
                                        .frame(width: sizingTokens.filterPreviewWidth, height: sizingTokens.filterPreviewHeight)
                                    Text(filterChipTitle(for: preset))
                                        .font(.caption2.weight(.medium))
                                        .lineLimit(1)
                                }
                                .padding(6)
                                .background(
                                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                                        .fill(isSelected ? Color.accentColor.opacity(0.16) : Color.clear)
                                )
                            }
                            .buttonStyle(.plain)
                            .iveSurfaceCard(cornerRadius: 12)
                            .accessibilityLabel(filterChipTitle(for: preset))
                        }
                    }
                    .padding(.horizontal, 2)
                }
                .iveSurfaceCard(cornerRadius: 12)
            }
        case .transform:
            VStack(alignment: .leading, spacing: 8) {
                LabeledSliderRow(
                    title: iveL("Rotation"),
                    valueText: "\(pendingVideoRotationDegrees.formatted(.number.precision(.fractionLength(0))))°",
                    value: $pendingVideoRotationDegrees,
                    range: -180...180,
                    step: 1
                )
                HStack(spacing: 10) {
                    Text(iveL("Flip"))
                        .font(.footnote)
                        .frame(width: sizingTokens.rowLabelWidth, alignment: .leading)
                    IVEVideoTogglePill(
                        title: iveL("Horizontal"),
                        systemImage: "flip.horizontal",
                        isOn: $pendingVideoMirrorHorizontal
                    )
                    IVEVideoTogglePill(
                        title: iveL("Vertical"),
                        systemImage: "arrow.trianglehead.up.and.down.righttriangle.up.righttriangle.down",
                        isOn: $pendingVideoMirrorVertical
                    )
                }
            }
        case .timeline:
            timelinePanel
        }
    }

    private var actionRow: some View {
        IVEHorizontalChevronScroll(
            minimumExpectedContentWidth: videoActionRowExpectedWidth
        ) {
            HStack(spacing: 10) {
                IVEVideoIconButton(systemImage: "checkmark.circle", isProminent: true, isEnabled: !isApplyInProgress, accessibilityLabel: "Apply", action: onApply)
                IVEVideoIconButton(systemImage: "square.and.arrow.up", isEnabled: !isExportInProgress, accessibilityLabel: "Export", action: onExport)
                IVEVideoIconButton(systemImage: "checkmark.circle.fill", isProminent: true, prominentBackgroundColor: .green, isEnabled: !isDoneInProgress, accessibilityLabel: "Done & Close", action: onDone)
                IVEVideoIconButton(systemImage: "xmark.circle.fill", isProminent: true, prominentBackgroundColor: .red, accessibilityLabel: "Abort & Close", action: onAbort)
                IVEVideoIconButton(
                    systemImage: "arrow.uturn.backward.circle",
                    nonProminentBackgroundColor: .yellow.opacity(0.24),
                    isEnabled: !isResetInProgress,
                    accessibilityLabel: "Reset Video",
                    action: onResetVideo
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var historyRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                IVEVideoIconButton(systemImage: "arrow.uturn.backward", isEnabled: canUndo && !isHistoryChangeInProgress, accessibilityLabel: "Undo", action: onUndo)
                IVEVideoIconButton(systemImage: "arrow.uturn.forward", isEnabled: canRedo && !isHistoryChangeInProgress, accessibilityLabel: "Redo", action: onRedo)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var timelinePanel: some View {
        let hasAnyVideos = !videoAssets.isEmpty
        let hasSelectedClip = selectedTimelineClip != nil

        return VStack(alignment: .leading, spacing: 10) {
            IVEHorizontalChevronScroll {
                HStack(spacing: 10) {
                    IVEVideoIconButton(
                        systemImage: "square.stack.3d.up.fill",
                        isProminent: true,
                        isEnabled: hasAnyVideos && !isBuildTimelineInProgress,
                        accessibilityLabel: "Build Timeline",
                        action: onBuildTimeline
                    )
                    IVEVideoIconButton(
                        systemImage: "scissors",
                        isEnabled: hasSelectedClip && !isSplitInProgress,
                        accessibilityLabel: "Split Selected",
                        action: onSplitSelected
                    )
                    IVEVideoIconButton(
                        systemImage: "trash",
                        isEnabled: hasSelectedClip && !isRippleDeleteInProgress,
                        accessibilityLabel: "Ripple Delete Selected",
                        action: onRippleDeleteSelected
                    )
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if !hasSelectedClip {
                Text(iveL("Select or build a timeline clip to enable Split, Delete, and Trim."))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if !clips.isEmpty {
                let maxTrimStart = max(0, selectedVideoDurationSeconds - 0.1)
                let maxTrimDuration = max(0.1, selectedVideoDurationSeconds - trimStart)

                if let selectedTimelineClip {
                    TrimRangePreview(
                        trimStart: trimStart,
                        trimDuration: trimDuration,
                        originalClipStart: selectedTimelineClip.startSeconds,
                        originalClipDuration: selectedTimelineClip.durationSeconds
                    )
                }

                Text(iveLF("Video Duration: %@s", selectedVideoDurationSeconds.formatted(.number.precision(.fractionLength(2)))))
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Text(iveLF("Trim Start: %@", trimStart.formatted(.number.precision(.fractionLength(2)))))
                Slider(value: $trimStart, in: 0...maxTrimStart)
                    .onChange(of: trimStart) { _, newValue in
                        let clampedStart = min(max(0, newValue), maxTrimStart)
                        if clampedStart != trimStart {
                            trimStart = clampedStart
                        }
                        onTrimStartPreviewChanged(clampedStart)
                        let allowedDuration = max(0.1, selectedVideoDurationSeconds - trimStart)
                        if trimDuration > allowedDuration {
                            trimDuration = allowedDuration
                        }
                    }

                Text(iveLF("Trim Duration: %@", trimDuration.formatted(.number.precision(.fractionLength(2)))))
                Slider(value: $trimDuration, in: 0.1...maxTrimDuration)
                    .onChange(of: trimDuration) { _, newValue in
                        let allowedDuration = max(0.1, selectedVideoDurationSeconds - trimStart)
                        let clampedDuration = min(max(0.1, newValue), allowedDuration)
                        if clampedDuration != trimDuration {
                            trimDuration = clampedDuration
                        }
                    }

                IVEVideoIconButton(
                    systemImage: "timeline.selection",
                    isProminent: true,
                    isEnabled: hasSelectedClip && !isTrimInProgress,
                    accessibilityLabel: "Apply Trim",
                    action: onApplyTrim
                )
            }
        }
    }

    private func filterChipTitle(for preset: IVEImageFilterPreset) -> String {
        switch preset {
        case .none: iveL("None")
        case .mono: iveL("Mono")
        case .vivid: iveL("Vivid")
        case .warm: iveL("Warm")
        case .cool: iveL("Cool")
        case .dramatic: iveL("Drama")
        case .noir: iveL("Noir")
        case .faded: iveL("Faded")
        case .vintage: iveL("Vintage")
        case .punch: iveL("Punch")
        case .tealOrange: iveL("Teal Orange")
        case .sepia: iveL("Sepia")
        }
    }
}

private struct IVEVideoToolHeader: View {
    let tool: VideoEditorTool

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: tool.iconName)
                .font(.subheadline.weight(.semibold))
                .frame(width: 28, height: 28)
                .background(Color.accentColor.opacity(0.14), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .foregroundStyle(Color.accentColor)
            VStack(alignment: .leading, spacing: 2) {
                Text(tool.title)
                    .font(.subheadline.weight(.semibold))
                Text(toolSubtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var toolSubtitle: String {
        switch tool {
        case .adjust: iveL("Tune exposure, contrast, and saturation.")
        case .color: iveL("Shape tonal curve and inspect histogram.")
        case .crop: iveL("Draw a crop and choose fit or true crop.")
        case .style: iveL("Choose one filter look.")
        case .transform: iveL("Rotate or flip the current frame.")
        case .timeline: iveL("Trim and manage clip order.")
        }
    }
}

//private struct IVEVideoIconButton: View {
//    let systemImage: String
//    var isProminent = false
//    var isEnabled = true
//    let accessibilityLabel: String
//    let action: () -> Void
//    private let buttonSize: CGFloat = 52
//
//    var body: some View {
//        if isProminent {
//            Button(action: action) {
//                Image(systemName: systemImage)
//                    .font(.system(size: 20, weight: .semibold))
//                    .frame(width: buttonSize, height: buttonSize)
//                    .contentShape(Rectangle())
//            }
//            .buttonStyle(.borderedProminent)
//            .disabled(!isEnabled)
//            .accessibilityLabel(accessibilityLabel)
//        } else {
//            Button(action: action) {
//                Image(systemName: systemImage)
//                    .font(.system(size: 20, weight: .semibold))
//                    .frame(width: buttonSize, height: buttonSize)
//                    .contentShape(Rectangle())
//            }
//            .buttonStyle(.bordered)
//            .disabled(!isEnabled)
//            .accessibilityLabel(accessibilityLabel)
//        }
//    }
//}

private struct IVEVideoIconButton: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    let systemImage: String
    var isProminent: Bool = false
    var prominentBackgroundColor: Color = .accentColor
    var nonProminentBackgroundColor: Color = Color.secondary.opacity(0.14)
    var isEnabled: Bool = true
    let accessibilityLabel: String
    let action: () -> Void

    private var sizingTokens: IVEControlSizingTokens {
        IVEControlSizingTokens(
            isCompactWidth: horizontalSizeClass == .compact,
            dynamicTypeSize: dynamicTypeSize
        )
    }
    
    private var localizedLabel: String {
        NSLocalizedString(
            accessibilityLabel,
            tableName: "Localizable",
            bundle: .module,
            value: accessibilityLabel,
            comment: ""
        )
    }
    
    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: systemImage)
                    .font(.system(size: 23, weight: .semibold))
                    .foregroundStyle(isProminent ? .white : .primary)
                    .frame(width: sizingTokens.iconCircleSize, height: sizingTokens.iconCircleSize)
                    .background(
                        isProminent
                            ? prominentBackgroundColor
                            : nonProminentBackgroundColor,
                        in: Circle()
                    )
                    .overlay(
                        Circle()
                            .strokeBorder(
                                isProminent ? Color.clear : Color.primary.opacity(0.15),
                                lineWidth: 1.5
                            )
                    )
                Text(localizedLabel)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                    .minimumScaleFactor(0.8)
            }
            .frame(width: sizingTokens.iconButtonWidth)
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .accessibilityLabel(localizedLabel)
        .contentShape(Rectangle())
    }
}

private struct IVEVideoTogglePill: View {
    let title: String
    let systemImage: String
    @Binding var isOn: Bool

    var body: some View {
        Button {
            isOn.toggle()
        } label: {
            HStack(spacing: 6) {
                Image(systemName: systemImage)
                Text(title)
                    .font(.caption.weight(.medium))
            }
            .foregroundStyle(isOn ? Color.accentColor : .primary)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(
                Capsule(style: .continuous)
                    .fill(isOn ? Color.accentColor.opacity(0.16) : Color.clear)
            )
        }
        .buttonStyle(.plain)
        .iveSurfaceCard(cornerRadius: 999)
        .accessibilityLabel(title)
    }
}

private struct PanelShell<Content: View>: View {
    let title: String
    let subtitle: String
    var isScrollable = true
    var isScrollEnabled = true
    @ViewBuilder var content: Content

    var body: some View {
        Group {
            if isScrollable {
                ScrollView(.vertical, showsIndicators: true) {
                    shellContent
                }
                .scrollDisabled(!isScrollEnabled)
            } else {
                shellContent
            }
        }
        .background {
            LinearGradient(
                colors: [
                    Color.white.opacity(0.06),
                    Color.black.opacity(0.05),
                    Color.clear
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }
    }

    @ViewBuilder
    private var shellContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(.title3.weight(.semibold))
                Text(subtitle)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .iveHeaderGlassCard(cornerRadius: 14)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
    }
}

private struct CropSelectionOverlay: View {
    @Binding var cropRect: IVENormalizedRect
    let contentAspectRatio: CGFloat?
    let lockedAspectRatio: CGFloat?
    @State private var reportedDragStart = false
    @State private var dragMode: CropDragMode?
    @State private var activeHandle: CropHandle?
    @State private var handleDragStartRect: IVENormalizedRect?

    private enum CropDragMode {
        case draw(start: CGPoint)
        case move(startRect: IVENormalizedRect, startPoint: CGPoint)
    }

    private enum CropHandle: CaseIterable {
        case top
        case right
        case bottom
        case left
    }

    var body: some View {
        GeometryReader { proxy in
            let contentRect = fittedRect(in: proxy.size, aspectRatio: contentAspectRatio)
            let rect = bounded(cropRect)
            let frame = CGRect(
                x: contentRect.minX + (rect.x * contentRect.width),
                y: contentRect.minY + (rect.y * contentRect.height),
                width: rect.width * contentRect.width,
                height: rect.height * contentRect.height
            )

            ZStack {
                Color.clear
                    .contentShape(Rectangle())
                    .gesture(
                        DragGesture(minimumDistance: 2, coordinateSpace: .named("crop-overlay"))
                            .onChanged { value in
                                guard activeHandle == nil else { return }
                                if !reportedDragStart { reportedDragStart = true }
                                let start = clamped(value.startLocation, to: contentRect)
                                let current = clamped(value.location, to: contentRect)

                                if dragMode == nil {
                                    let currentRect = bounded(cropRect)
                                    let isNearlyFullSelection = currentRect.width > 0.97 && currentRect.height > 0.97
                                    if frame.contains(start) && !isNearlyFullSelection {
                                        dragMode = .move(startRect: currentRect, startPoint: start)
                                    } else {
                                        dragMode = .draw(start: start)
                                    }
                                }

                                switch dragMode {
                                case let .draw(origin):
                                    let drawnRect = drawRect(from: origin, to: current, in: contentRect)
                                    cropRect = normalizedRect(from: drawnRect, in: contentRect)
                                case let .move(startRect, startPoint):
                                    let dx = (current.x - startPoint.x) / max(1, contentRect.width)
                                    let dy = (current.y - startPoint.y) / max(1, contentRect.height)
                                    cropRect = bounded(IVENormalizedRect(
                                        x: startRect.x + dx,
                                        y: startRect.y + dy,
                                        width: startRect.width,
                                        height: startRect.height
                                    ))
                                case .none:
                                    break
                                }
                            }
                            .onEnded { _ in
                                reportedDragStart = false
                                dragMode = nil
                            }
                    )

                Rectangle()
                    .stroke(.yellow, lineWidth: 2)
                    .frame(width: frame.width, height: frame.height)
                    .position(x: frame.midX, y: frame.midY)

                ForEach(CropHandle.allCases, id: \.self) { handle in
                    edgeHandle(for: handle, in: frame)
                        .highPriorityGesture(
                            DragGesture(minimumDistance: 0, coordinateSpace: .named("crop-overlay"))
                                .onChanged { value in
                                    if activeHandle == nil {
                                        activeHandle = handle
                                        handleDragStartRect = bounded(cropRect)
                                    }
                                    guard activeHandle == handle else { return }
                                    resize(with: handle, value: value, startRect: handleDragStartRect ?? bounded(cropRect), in: contentRect)
                                }
                                .onEnded { _ in
                                    activeHandle = nil
                                    handleDragStartRect = nil
                                }
                        )
                }
            }
            .coordinateSpace(name: "crop-overlay")
        }
    }

    @ViewBuilder
    private func edgeHandle(for handle: CropHandle, in frame: CGRect) -> some View {
        let horizontal = handle == .top || handle == .bottom
        let visualSize = horizontal ? CGSize(width: 44, height: 12) : CGSize(width: 12, height: 44)
        let touchSize = horizontal ? CGSize(width: max(72, frame.width * 0.45), height: 34) : CGSize(width: 34, height: max(72, frame.height * 0.45))
        ZStack {
            Color.white.opacity(0.001)
                .frame(width: touchSize.width, height: touchSize.height)

            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(Color.white.opacity(0.92))
                .overlay {
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .stroke(Color.black.opacity(0.25), lineWidth: 0.5)
                }
                .frame(width: visualSize.width, height: visualSize.height)
                .shadow(color: .black.opacity(0.18), radius: 2, y: 1)
        }
        .contentShape(Rectangle())
        .position(position(for: handle, in: frame))
        .accessibilityHidden(true)
    }

    private func position(for handle: CropHandle, in frame: CGRect) -> CGPoint {
        switch handle {
        case .top:
            return CGPoint(x: frame.midX, y: frame.minY)
        case .right:
            return CGPoint(x: frame.maxX, y: frame.midY)
        case .bottom:
            return CGPoint(x: frame.midX, y: frame.maxY)
        case .left:
            return CGPoint(x: frame.minX, y: frame.midY)
        }
    }

    private func resize(with handle: CropHandle, value: DragGesture.Value, startRect: IVENormalizedRect, in contentRect: CGRect) {
        if let lockedAspectRatio, lockedAspectRatio > 0 {
            resizeLockedAspect(with: handle, value: value, startRect: startRect, in: contentRect, aspectRatio: lockedAspectRatio)
            return
        }

        let minSize = 0.02
        let dx = (value.location.x - value.startLocation.x) / max(1, contentRect.width)
        let dy = (value.location.y - value.startLocation.y) / max(1, contentRect.height)

        var minX = startRect.x
        var minY = startRect.y
        var maxX = startRect.x + startRect.width
        var maxY = startRect.y + startRect.height

        switch handle {
        case .left:
            minX = clamped(startRect.x + dx, lower: 0, upper: maxX - minSize)
        case .right:
            maxX = clamped((startRect.x + startRect.width) + dx, lower: minX + minSize, upper: 1)
        case .top:
            minY = clamped(startRect.y + dy, lower: 0, upper: maxY - minSize)
        case .bottom:
            maxY = clamped((startRect.y + startRect.height) + dy, lower: minY + minSize, upper: 1)
        }

        cropRect = bounded(
            IVENormalizedRect(
                x: minX,
                y: minY,
                width: maxX - minX,
                height: maxY - minY
            )
        )
    }

    private func resizeLockedAspect(
        with handle: CropHandle,
        value: DragGesture.Value,
        startRect: IVENormalizedRect,
        in contentRect: CGRect,
        aspectRatio: CGFloat
    ) {
        let minSize = CGFloat(0.02)
        let startFrame = CGRect(
            x: contentRect.minX + (startRect.x * contentRect.width),
            y: contentRect.minY + (startRect.y * contentRect.height),
            width: max(minSize * contentRect.width, startRect.width * contentRect.width),
            height: max(minSize * contentRect.height, startRect.height * contentRect.height)
        )
        let location = clamped(value.location, to: contentRect)
        var frame = startFrame

        switch handle {
        case .left:
            let anchorX = startFrame.maxX
            let minX = min(anchorX - (minSize * contentRect.width), max(contentRect.minX, location.x))
            let width = max(minSize * contentRect.width, anchorX - minX)
            let height = width / max(0.0001, aspectRatio)
            let centerY = startFrame.midY
            frame = CGRect(x: anchorX - width, y: centerY - (height / 2), width: width, height: height)
        case .right:
            let anchorX = startFrame.minX
            let maxX = max(anchorX + (minSize * contentRect.width), min(contentRect.maxX, location.x))
            let width = max(minSize * contentRect.width, maxX - anchorX)
            let height = width / max(0.0001, aspectRatio)
            let centerY = startFrame.midY
            frame = CGRect(x: anchorX, y: centerY - (height / 2), width: width, height: height)
        case .top:
            let anchorY = startFrame.maxY
            let minY = min(anchorY - (minSize * contentRect.height), max(contentRect.minY, location.y))
            let height = max(minSize * contentRect.height, anchorY - minY)
            let width = height * aspectRatio
            let centerX = startFrame.midX
            frame = CGRect(x: centerX - (width / 2), y: anchorY - height, width: width, height: height)
        case .bottom:
            let anchorY = startFrame.minY
            let maxY = max(anchorY + (minSize * contentRect.height), min(contentRect.maxY, location.y))
            let height = max(minSize * contentRect.height, maxY - anchorY)
            let width = height * aspectRatio
            let centerX = startFrame.midX
            frame = CGRect(x: centerX - (width / 2), y: anchorY, width: width, height: height)
        }

        let fitted = fittedRectForLockedAspect(frame, in: contentRect, aspectRatio: aspectRatio)
        cropRect = normalizedRect(from: fitted, in: contentRect)
    }

    private func drawRect(from origin: CGPoint, to current: CGPoint, in contentRect: CGRect) -> CGRect {
        guard let lockedAspectRatio, lockedAspectRatio > 0 else {
            return CGRect(
                x: min(origin.x, current.x),
                y: min(origin.y, current.y),
                width: abs(current.x - origin.x),
                height: abs(current.y - origin.y)
            )
        }

        let dx = current.x - origin.x
        let dy = current.y - origin.y
        let xSign: CGFloat = dx >= 0 ? 1 : -1
        let ySign: CGFloat = dy >= 0 ? 1 : -1
        let maxWidth = xSign > 0 ? (contentRect.maxX - origin.x) : (origin.x - contentRect.minX)
        let maxHeight = ySign > 0 ? (contentRect.maxY - origin.y) : (origin.y - contentRect.minY)
        let desiredWidth = max(abs(dx), abs(dy) * lockedAspectRatio)
        var width = min(maxWidth, desiredWidth)
        var height = width / lockedAspectRatio
        if height > maxHeight {
            height = maxHeight
            width = height * lockedAspectRatio
        }

        let endX = origin.x + (xSign * width)
        let endY = origin.y + (ySign * height)
        return CGRect(
            x: min(origin.x, endX),
            y: min(origin.y, endY),
            width: abs(endX - origin.x),
            height: abs(endY - origin.y)
        )
    }

    private func fittedRectForLockedAspect(_ rect: CGRect, in bounds: CGRect, aspectRatio: CGFloat) -> CGRect {
        let ratio = max(0.0001, aspectRatio)
        var width = max(1, rect.width)
        var height = max(1, rect.height)
        if width / max(1, height) > ratio {
            height = width / ratio
        } else {
            width = height * ratio
        }

        let minWidth = max(1, bounds.width * 0.02)
        let minHeight = max(1, bounds.height * 0.02)
        width = max(minWidth, width)
        height = max(minHeight, height)

        if width > bounds.width {
            width = bounds.width
            height = width / ratio
        }
        if height > bounds.height {
            height = bounds.height
            width = height * ratio
        }

        var x = rect.midX - (width / 2)
        var y = rect.midY - (height / 2)
        x = min(bounds.maxX - width, max(bounds.minX, x))
        y = min(bounds.maxY - height, max(bounds.minY, y))
        return CGRect(x: x, y: y, width: width, height: height)
    }

    private func normalizedRect(from rect: CGRect, in contentRect: CGRect) -> IVENormalizedRect {
        guard contentRect.width > 0, contentRect.height > 0 else { return bounded(cropRect) }
        return bounded(
            IVENormalizedRect(
                x: (rect.minX - contentRect.minX) / contentRect.width,
                y: (rect.minY - contentRect.minY) / contentRect.height,
                width: rect.width / contentRect.width,
                height: rect.height / contentRect.height
            )
        )
    }

    private func fittedRect(in size: CGSize, aspectRatio: CGFloat?) -> CGRect {
        guard let aspectRatio, aspectRatio > 0 else {
            return CGRect(origin: .zero, size: size)
        }
        let viewAspectRatio = size.width / max(1, size.height)
        if viewAspectRatio > aspectRatio {
            let width = size.height * aspectRatio
            return CGRect(x: (size.width - width) / 2, y: 0, width: width, height: size.height)
        } else {
            let height = size.width / aspectRatio
            return CGRect(x: 0, y: (size.height - height) / 2, width: size.width, height: height)
        }
    }

    private func clamped(_ point: CGPoint, to rect: CGRect) -> CGPoint {
        CGPoint(
            x: min(rect.maxX, max(rect.minX, point.x)),
            y: min(rect.maxY, max(rect.minY, point.y))
        )
    }

    private func clamped(_ value: Double, lower: Double, upper: Double) -> Double {
        min(upper, max(lower, value))
    }

    private func bounded(_ rect: IVENormalizedRect) -> IVENormalizedRect {
        let minSize = 0.02
        let width = min(1, max(minSize, rect.width))
        let height = min(1, max(minSize, rect.height))
        let x = min(1 - width, max(0, rect.x))
        let y = min(1 - height, max(0, rect.y))
        return IVENormalizedRect(x: x, y: y, width: width, height: height)
    }
}

private struct IVEHorizontalChevronScroll<Content: View>: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    var minimumExpectedContentWidth: CGFloat = 0
    @ViewBuilder let content: Content
    @State private var scrollGeometry = IVEHorizontalScrollGeometry()
    private let overflowThreshold: CGFloat = 1

    private var showsNativeIndicators: Bool {
        #if os(iOS)
        horizontalSizeClass != .compact
        #else
        true
        #endif
    }

    private var showsEdgeHints: Bool {
        !showsNativeIndicators
    }

    private var showLeadingChevron: Bool {
        scrollGeometry.contentOffsetX > overflowThreshold
    }

    private var showTrailingChevron: Bool {
        let effectiveContentWidth = max(scrollGeometry.contentWidth, minimumExpectedContentWidth)
        if scrollGeometry.viewportWidth > 0, effectiveContentWidth > 0,
           (effectiveContentWidth - scrollGeometry.contentOffsetX) > scrollGeometry.viewportWidth + overflowThreshold {
            return true
        }
        return false
    }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: showsNativeIndicators) {
            content
                .fixedSize(horizontal: true, vertical: false)
        }
        .onScrollGeometryChange(for: IVEHorizontalScrollGeometry.self) { geometry in
            IVEHorizontalScrollGeometry(
                contentOffsetX: geometry.contentOffset.x,
                contentWidth: geometry.contentSize.width,
                contentHeight: geometry.contentSize.height,
                viewportWidth: geometry.containerSize.width
            )
        } action: { _, newGeometry in
            scrollGeometry = newGeometry
        }
        .overlay(alignment: .leading) {
            if  showLeadingChevron {
                edgeOverflowHint(isLeading: true)
            }
        }
        .overlay(alignment: .trailing) {
            if  showTrailingChevron {
                edgeOverflowHint(isLeading: false)
            }
        }
    }

    @ViewBuilder
    private func edgeOverflowHint(isLeading: Bool) -> some View {
        let overlayHeight = max(44, scrollGeometry.contentHeight)
        ZStack(alignment: isLeading ? .leading : .trailing) {
            Rectangle()
                .fill(
                    LinearGradient(
                        colors: isLeading
                            ? [Color.primary.opacity(0.24), .clear]
                            : [.clear, Color.primary.opacity(0.24)],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )
                .frame(width: 40, height: overlayHeight)

            HStack(spacing: 3) {
                Circle().frame(width: 4, height: 4)
                Circle().frame(width: 4, height: 4)
                Circle().frame(width: 4, height: 4)
            }
            .foregroundStyle(Color.primary.opacity(0.92))
            .padding(.horizontal, 6)
            .padding(.vertical, 4)
            .background(.ultraThinMaterial, in: Capsule(style: .continuous))
            .overlay(
                Capsule(style: .continuous)
                    .stroke(Color.primary.opacity(0.28), lineWidth: 0.8)
            )
            .shadow(color: Color.black.opacity(0.18), radius: 1.2, x: 0, y: 0.5)
            .padding(isLeading ? .leading : .trailing, 6)
        }
        .padding(isLeading ? .leading : .trailing, 1)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

private struct IVEHorizontalScrollGeometry: Equatable {
    var contentOffsetX: CGFloat = 0
    var contentWidth: CGFloat = 0
    var contentHeight: CGFloat = 0
    var viewportWidth: CGFloat = 0
}

private struct LabeledSliderRow: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    let title: String
    let valueText: String
    @Binding var value: Double
    let range: ClosedRange<Double>
    var step: Double? = nil

    private var sizingTokens: IVEControlSizingTokens {
        IVEControlSizingTokens(
            isCompactWidth: horizontalSizeClass == .compact,
            dynamicTypeSize: dynamicTypeSize
        )
    }

    private var valueLabelWidth: CGFloat {
        max(52, sizingTokens.rowLabelWidth * 0.6)
    }

    var body: some View {
        HStack(spacing: 10) {
            Text(title)
                .font(.caption.weight(.semibold))
                .frame(width: sizingTokens.rowLabelWidth, alignment: .leading)
            if let step {
                Slider(value: $value, in: range, step: step)
            } else {
                Slider(value: $value, in: range)
            }
            Text(valueText)
                .font(.caption2.monospacedDigit())
                .frame(width: valueLabelWidth, alignment: .trailing)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .iveSurfaceCard(cornerRadius: 12)
    }
}

private extension View {
    @ViewBuilder
    func iveSurfaceCard(cornerRadius: CGFloat = 12) -> some View {
        if #available(iOS 26, macOS 26, *) {
            self
                .glassEffect(.regular.tint(.white.opacity(0.08)), in: .rect(cornerRadius: cornerRadius))
        } else {
            self
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        }
    }

    @ViewBuilder
    func iveHeaderGlassCard(cornerRadius: CGFloat = 14) -> some View {
        if #available(iOS 26, macOS 26, *) {
            self
                .glassEffect(.regular.tint(.white.opacity(0.1)).interactive(), in: .rect(cornerRadius: cornerRadius))
        } else {
            self
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        }
    }
}

struct ImageRenderState {
    let exposure: Double
    let contrast: Double
    let saturation: Double
    let temperature: Double
    let tint: Double
    let curveShadows: Double
    let curveMidtones: Double
    let curveHighlights: Double
    let curveRedShadows: Double
    let curveRedMidtones: Double
    let curveRedHighlights: Double
    let curveGreenShadows: Double
    let curveGreenMidtones: Double
    let curveGreenHighlights: Double
    let curveBlueShadows: Double
    let curveBlueMidtones: Double
    let curveBlueHighlights: Double
    let blackPoint: Double
    let whitePoint: Double
    let denoise: Double
    let sharpen: Double
    let rotationDegrees: Double
    let mirrorHorizontal: Bool
    let mirrorVertical: Bool
    let filterPreset: IVEImageFilterPreset

    init(
        exposure: Double,
        contrast: Double,
        saturation: Double,
        temperature: Double,
        tint: Double,
        curveShadows: Double,
        curveMidtones: Double,
        curveHighlights: Double,
        curveRedShadows: Double = 0,
        curveRedMidtones: Double = 0,
        curveRedHighlights: Double = 0,
        curveGreenShadows: Double = 0,
        curveGreenMidtones: Double = 0,
        curveGreenHighlights: Double = 0,
        curveBlueShadows: Double = 0,
        curveBlueMidtones: Double = 0,
        curveBlueHighlights: Double = 0,
        blackPoint: Double = 0,
        whitePoint: Double = 1,
        denoise: Double,
        sharpen: Double,
        rotationDegrees: Double,
        mirrorHorizontal: Bool,
        mirrorVertical: Bool,
        filterPreset: IVEImageFilterPreset
    ) {
        self.exposure = exposure
        self.contrast = contrast
        self.saturation = saturation
        self.temperature = temperature
        self.tint = tint
        self.curveShadows = curveShadows
        self.curveMidtones = curveMidtones
        self.curveHighlights = curveHighlights
        self.curveRedShadows = curveRedShadows
        self.curveRedMidtones = curveRedMidtones
        self.curveRedHighlights = curveRedHighlights
        self.curveGreenShadows = curveGreenShadows
        self.curveGreenMidtones = curveGreenMidtones
        self.curveGreenHighlights = curveGreenHighlights
        self.curveBlueShadows = curveBlueShadows
        self.curveBlueMidtones = curveBlueMidtones
        self.curveBlueHighlights = curveBlueHighlights
        self.blackPoint = blackPoint
        self.whitePoint = whitePoint
        self.denoise = denoise
        self.sharpen = sharpen
        self.rotationDegrees = rotationDegrees
        self.mirrorHorizontal = mirrorHorizontal
        self.mirrorVertical = mirrorVertical
        self.filterPreset = filterPreset
    }

    var filterContrast: Double {
        switch filterPreset {
        case .none: return 1
        case .mono: return 1.05
        case .vivid: return 1.2
        case .warm: return 1.08
        case .cool: return 1.08
        case .dramatic: return 1.25
        case .noir: return 1.32
        case .faded: return 0.88
        case .vintage: return 1.1
        case .punch: return 1.35
        case .tealOrange: return 1.18
        case .sepia: return 1.06
        }
    }

    var filterSaturation: Double {
        switch filterPreset {
        case .none: return 1
        case .mono: return 0.05
        case .vivid: return 1.35
        case .warm: return 1.12
        case .cool: return 0.92
        case .dramatic: return 0.9
        case .noir: return 0.02
        case .faded: return 0.72
        case .vintage: return 0.82
        case .punch: return 1.5
        case .tealOrange: return 1.22
        case .sepia: return 0.78
        }
    }

    var filterBrightness: Double {
        switch filterPreset {
        case .none: return 0
        case .mono: return 0.02
        case .vivid: return 0.03
        case .warm: return 0.04
        case .cool: return 0
        case .dramatic: return -0.04
        case .noir: return -0.02
        case .faded: return 0.06
        case .vintage: return 0.03
        case .punch: return 0.02
        case .tealOrange: return 0.01
        case .sepia: return 0.02
        }
    }

    var filterHueRotationDegrees: Double {
        switch filterPreset {
        case .none: return 0
        case .mono: return 0
        case .vivid: return 0
        case .warm: return 10
        case .cool: return -10
        case .dramatic: return 0
        case .noir: return 0
        case .faded: return 2
        case .vintage: return 8
        case .punch: return 0
        case .tealOrange: return -12
        case .sepia: return 18
        }
    }

    var colorCurveSettings: IVEColorCurveSettings {
        IVEColorCurveSettings(
            masterShadows: curveShadows,
            masterMidtones: curveMidtones,
            masterHighlights: curveHighlights,
            redShadows: curveRedShadows,
            redMidtones: curveRedMidtones,
            redHighlights: curveRedHighlights,
            greenShadows: curveGreenShadows,
            greenMidtones: curveGreenMidtones,
            greenHighlights: curveGreenHighlights,
            blueShadows: curveBlueShadows,
            blueMidtones: curveBlueMidtones,
            blueHighlights: curveBlueHighlights,
            blackPoint: blackPoint,
            whitePoint: whitePoint
        )
    }
}

struct VideoRenderState {
    let exposure: Double
    let contrast: Double
    let saturation: Double
    let temperature: Double
    let tint: Double
    let curveShadows: Double
    let curveMidtones: Double
    let curveHighlights: Double
    let curveRedShadows: Double
    let curveRedMidtones: Double
    let curveRedHighlights: Double
    let curveGreenShadows: Double
    let curveGreenMidtones: Double
    let curveGreenHighlights: Double
    let curveBlueShadows: Double
    let curveBlueMidtones: Double
    let curveBlueHighlights: Double
    let blackPoint: Double
    let whitePoint: Double
    let rotationDegrees: Double
    let mirrorHorizontal: Bool
    let mirrorVertical: Bool
    let filterPreset: IVEImageFilterPreset

    init(
        exposure: Double,
        contrast: Double,
        saturation: Double,
        temperature: Double,
        tint: Double,
        curveShadows: Double,
        curveMidtones: Double,
        curveHighlights: Double,
        curveRedShadows: Double = 0,
        curveRedMidtones: Double = 0,
        curveRedHighlights: Double = 0,
        curveGreenShadows: Double = 0,
        curveGreenMidtones: Double = 0,
        curveGreenHighlights: Double = 0,
        curveBlueShadows: Double = 0,
        curveBlueMidtones: Double = 0,
        curveBlueHighlights: Double = 0,
        blackPoint: Double = 0,
        whitePoint: Double = 1,
        rotationDegrees: Double,
        mirrorHorizontal: Bool,
        mirrorVertical: Bool,
        filterPreset: IVEImageFilterPreset
    ) {
        self.exposure = exposure
        self.contrast = contrast
        self.saturation = saturation
        self.temperature = temperature
        self.tint = tint
        self.curveShadows = curveShadows
        self.curveMidtones = curveMidtones
        self.curveHighlights = curveHighlights
        self.curveRedShadows = curveRedShadows
        self.curveRedMidtones = curveRedMidtones
        self.curveRedHighlights = curveRedHighlights
        self.curveGreenShadows = curveGreenShadows
        self.curveGreenMidtones = curveGreenMidtones
        self.curveGreenHighlights = curveGreenHighlights
        self.curveBlueShadows = curveBlueShadows
        self.curveBlueMidtones = curveBlueMidtones
        self.curveBlueHighlights = curveBlueHighlights
        self.blackPoint = blackPoint
        self.whitePoint = whitePoint
        self.rotationDegrees = rotationDegrees
        self.mirrorHorizontal = mirrorHorizontal
        self.mirrorVertical = mirrorVertical
        self.filterPreset = filterPreset
    }

    var filterContrast: Double {
        switch filterPreset {
        case .none: return 1
        case .mono: return 1.05
        case .vivid: return 1.2
        case .warm: return 1.08
        case .cool: return 1.08
        case .dramatic: return 1.25
        case .noir: return 1.32
        case .faded: return 0.88
        case .vintage: return 1.1
        case .punch: return 1.35
        case .tealOrange: return 1.18
        case .sepia: return 1.06
        }
    }

    var filterSaturation: Double {
        switch filterPreset {
        case .none: return 1
        case .mono: return 0.05
        case .vivid: return 1.35
        case .warm: return 1.12
        case .cool: return 0.92
        case .dramatic: return 0.9
        case .noir: return 0.02
        case .faded: return 0.72
        case .vintage: return 0.82
        case .punch: return 1.5
        case .tealOrange: return 1.22
        case .sepia: return 0.78
        }
    }

    var filterBrightness: Double {
        switch filterPreset {
        case .none: return 0
        case .mono: return 0.02
        case .vivid: return 0.03
        case .warm: return 0.04
        case .cool: return 0
        case .dramatic: return -0.04
        case .noir: return -0.02
        case .faded: return 0.06
        case .vintage: return 0.03
        case .punch: return 0.02
        case .tealOrange: return 0.01
        case .sepia: return 0.02
        }
    }

    var filterHueRotationDegrees: Double {
        switch filterPreset {
        case .none: return 0
        case .mono: return 0
        case .vivid: return 0
        case .warm: return 10
        case .cool: return -10
        case .dramatic: return 0
        case .noir: return 0
        case .faded: return 2
        case .vintage: return 8
        case .punch: return 0
        case .tealOrange: return -12
        case .sepia: return 18
        }
    }

    var colorCurveSettings: IVEColorCurveSettings {
        IVEColorCurveSettings(
            masterShadows: curveShadows,
            masterMidtones: curveMidtones,
            masterHighlights: curveHighlights,
            redShadows: curveRedShadows,
            redMidtones: curveRedMidtones,
            redHighlights: curveRedHighlights,
            greenShadows: curveGreenShadows,
            greenMidtones: curveGreenMidtones,
            greenHighlights: curveGreenHighlights,
            blueShadows: curveBlueShadows,
            blueMidtones: curveBlueMidtones,
            blueHighlights: curveBlueHighlights,
            blackPoint: blackPoint,
            whitePoint: whitePoint
        )
    }
}

private struct MediaPreviewCard: View {
    let asset: IVEMediaAssetRef
    let url: URL?
    let exposure: Double
    let contrast: Double
    let saturation: Double
    let temperature: Double
    let tint: Double
    let curveShadows: Double
    let curveMidtones: Double
    let curveHighlights: Double
    let curveRedShadows: Double
    let curveRedMidtones: Double
    let curveRedHighlights: Double
    let curveGreenShadows: Double
    let curveGreenMidtones: Double
    let curveGreenHighlights: Double
    let curveBlueShadows: Double
    let curveBlueMidtones: Double
    let curveBlueHighlights: Double
    let blackPoint: Double
    let whitePoint: Double
    let denoise: Double
    let sharpen: Double
    let rotationDegrees: Double
    let mirrorHorizontal: Bool
    let mirrorVertical: Bool
    let cropRect: IVENormalizedRect
    let scale: Double
    let videoCropMode: IVEVideoCropMode
    let filterPreset: IVEImageFilterPreset
    let showHistogram: Bool

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 10)
                .fill(.ultraThinMaterial)
            if let url {
                switch asset.kind {
                case .image:
                    IVEProcessedImagePreview(
                        url: url,
                        cropRect: cropRect,
                        scale: scale,
                        renderState: ImageRenderState(
                            exposure: exposure,
                            contrast: contrast,
                            saturation: saturation,
                            temperature: temperature,
                            tint: tint,
                            curveShadows: curveShadows,
                            curveMidtones: curveMidtones,
                            curveHighlights: curveHighlights,
                            curveRedShadows: curveRedShadows,
                            curveRedMidtones: curveRedMidtones,
                            curveRedHighlights: curveRedHighlights,
                            curveGreenShadows: curveGreenShadows,
                            curveGreenMidtones: curveGreenMidtones,
                            curveGreenHighlights: curveGreenHighlights,
                            curveBlueShadows: curveBlueShadows,
                            curveBlueMidtones: curveBlueMidtones,
                            curveBlueHighlights: curveBlueHighlights,
                            blackPoint: blackPoint,
                            whitePoint: whitePoint,
                            denoise: denoise,
                            sharpen: sharpen,
                            rotationDegrees: rotationDegrees,
                            mirrorHorizontal: mirrorHorizontal,
                            mirrorVertical: mirrorVertical,
                            filterPreset: filterPreset
                        )
                    )
                case .video:
                    VideoPreview(
                        url: url,
                        cropRect: cropRect,
                        cropMode: videoCropMode,
                        trimRange: nil,
                        renderState: VideoRenderState(
                            exposure: exposure,
                            contrast: contrast,
                            saturation: saturation,
                            temperature: temperature,
                            tint: tint,
                            curveShadows: curveShadows,
                            curveMidtones: curveMidtones,
                            curveHighlights: curveHighlights,
                            curveRedShadows: curveRedShadows,
                            curveRedMidtones: curveRedMidtones,
                            curveRedHighlights: curveRedHighlights,
                            curveGreenShadows: curveGreenShadows,
                            curveGreenMidtones: curveGreenMidtones,
                            curveGreenHighlights: curveGreenHighlights,
                            curveBlueShadows: curveBlueShadows,
                            curveBlueMidtones: curveBlueMidtones,
                            curveBlueHighlights: curveBlueHighlights,
                            blackPoint: blackPoint,
                            whitePoint: whitePoint,
                            rotationDegrees: rotationDegrees,
                            mirrorHorizontal: mirrorHorizontal,
                            mirrorVertical: mirrorVertical,
                            filterPreset: filterPreset
                        )
                    )
                case .audio:
                    VStack(spacing: 8) {
                        Image(systemName: "waveform").font(.system(size: 28))
                        Text(url.lastPathComponent).font(.footnote).lineLimit(1)
                    }
                    .foregroundStyle(.secondary)
                }
            } else {
                Text(iveL("Preview unavailable for this item")).foregroundStyle(.secondary)
            }
        }
    }
}

private struct IVEProcessedImagePreview: View {
    let url: URL
    let cropRect: IVENormalizedRect
    let scale: Double
    let renderState: ImageRenderState

    @State private var renderedPreview: CGImage?

    private var renderSignature: String {
        [
            url.path,
            versionStamp(for: url),
            String(cropRect.x),
            String(cropRect.y),
            String(cropRect.width),
            String(cropRect.height),
            String(scale),
            String(renderState.exposure),
            String(renderState.contrast),
            String(renderState.saturation),
            String(renderState.temperature),
            String(renderState.tint),
            String(renderState.curveShadows),
            String(renderState.curveMidtones),
            String(renderState.curveHighlights),
            String(renderState.curveRedShadows),
            String(renderState.curveRedMidtones),
            String(renderState.curveRedHighlights),
            String(renderState.curveGreenShadows),
            String(renderState.curveGreenMidtones),
            String(renderState.curveGreenHighlights),
            String(renderState.curveBlueShadows),
            String(renderState.curveBlueMidtones),
            String(renderState.curveBlueHighlights),
            String(renderState.blackPoint),
            String(renderState.whitePoint),
            String(renderState.denoise),
            String(renderState.sharpen),
            String(renderState.rotationDegrees),
            String(renderState.mirrorHorizontal),
            String(renderState.mirrorVertical),
            renderState.filterPreset.rawValue
        ].joined(separator: "|")
    }

    var body: some View {
        ZStack {
            if let renderedPreview {
                Image(decorative: renderedPreview, scale: 1, orientation: .up)
                    .resizable()
                    .scaledToFit()
            } else {
                ProgressView()
            }
        }
        .task(id: renderSignature) {
            renderedPreview = await loadRenderedPreview()
        }
    }

    private func loadRenderedPreview() async -> CGImage? {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                let rendered = Self.renderImage(
                    from: url,
                    cropRect: cropRect,
                    scale: scale,
                    renderState: renderState
                )
                continuation.resume(returning: rendered)
            }
        }
    }

    nonisolated private static func renderImage(
        from sourceURL: URL,
        cropRect: IVENormalizedRect,
        scale: Double,
        renderState: ImageRenderState
    ) -> CGImage? {
        var image: CIImage
        if let ci = CIImage(contentsOf: sourceURL, options: [.applyOrientationProperty: true]) {
            image = ci
        } else if let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
                  let cg = CGImageSourceCreateImageAtIndex(source, 0, nil) {
            image = CIImage(cgImage: cg)
        } else {
            return nil
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
            let correction = CIFilter.temperatureAndTint()
            let vectors = colorCorrectionVectors(
                temperature: renderState.temperature,
                tint: renderState.tint
            )
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

        let extent = image.extent.integral
        guard extent.width > 1, extent.height > 1 else { return nil }
        return CIContext().createCGImage(image, from: extent)
    }

    nonisolated private static func normalizedCropRect(_ rect: IVENormalizedRect) -> IVENormalizedRect {
        let minSize = 0.02
        let width = min(1, max(minSize, rect.width))
        let height = min(1, max(minSize, rect.height))
        let x = min(1 - width, max(0, rect.x))
        let y = min(1 - height, max(0, rect.y))
        return IVENormalizedRect(x: x, y: y, width: width, height: height)
    }

    nonisolated private static func colorCorrectionVectors(temperature: Double, tint: Double) -> (neutral: CIVector, targetNeutral: CIVector) {
        let clampedTemperature = max(-4000, min(4000, temperature))
        let clampedTint = max(-200, min(200, tint))
        let neutral = CIVector(x: 6500, y: 0)
        let targetNeutral = CIVector(
            x: 6500 + clampedTemperature,
            y: clampedTint
        )
        return (neutral, targetNeutral)
    }

    nonisolated private static func applyToneCurve(to image: CIImage, settings: IVEColorCurveSettings) -> CIImage {
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

    private func versionStamp(for url: URL) -> String {
        let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
        let modifiedPart: String
        if let modified = attributes?[.modificationDate] as? Date {
            modifiedPart = String(Int(modified.timeIntervalSince1970 * 1000))
        } else {
            modifiedPart = "0"
        }
        let sizePart = String((attributes?[.size] as? NSNumber)?.int64Value ?? 0)
        return "\(modifiedPart)-\(sizePart)"
    }
}

private struct IVEHistogramOverlay: View {
    private enum HistogramMode: String, CaseIterable, Identifiable {
        case rgb
        case luma

        var id: String { rawValue }
    }

    private enum CurveZone: CaseIterable {
        case shadows
        case midtones
        case highlights
    }

    let sourceURL: URL
    let isVideo: Bool
    let curveShadows: Binding<Double>?
    let curveMidtones: Binding<Double>?
    let curveHighlights: Binding<Double>?
    let blackPoint: Binding<Double>?
    let whitePoint: Binding<Double>?
    @State private var redBins: [CGFloat] = Array(repeating: 0, count: 64)
    @State private var greenBins: [CGFloat] = Array(repeating: 0, count: 64)
    @State private var blueBins: [CGFloat] = Array(repeating: 0, count: 64)
    @State private var lumaBins: [CGFloat] = Array(repeating: 0, count: 64)
    @State private var activeZone: CurveZone?
    @State private var histogramMode: HistogramMode = .rgb

    private var cacheKey: String {
        "\(sourceURL.path)-\(isVideo)"
    }

    init(
        sourceURL: URL,
        isVideo: Bool,
        curveShadows: Binding<Double>? = nil,
        curveMidtones: Binding<Double>? = nil,
        curveHighlights: Binding<Double>? = nil,
        blackPoint: Binding<Double>? = nil,
        whitePoint: Binding<Double>? = nil
    ) {
        self.sourceURL = sourceURL
        self.isVideo = isVideo
        self.curveShadows = curveShadows
        self.curveMidtones = curveMidtones
        self.curveHighlights = curveHighlights
        self.blackPoint = blackPoint
        self.whitePoint = whitePoint
    }

    private var isInteractive: Bool {
        curveShadows != nil && curveMidtones != nil && curveHighlights != nil
    }

    private var hasPointControls: Bool {
        blackPoint != nil && whitePoint != nil
    }

    private var activeBins: [CGFloat] {
        histogramMode == .luma ? lumaBins : zip(zip(redBins, greenBins), blueBins).map { max($0.0.0, $0.0.1, $0.1) }
    }

    private var leftClipAmount: CGFloat {
        activeBins.first ?? 0
    }

    private var rightClipAmount: CGFloat {
        activeBins.last ?? 0
    }

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(.black.opacity(0.35))
            VStack(alignment: .leading, spacing: 4) {
                Text(iveL("Histogram"))
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.8))
                Picker("Histogram Mode", selection: $histogramMode) {
                    Text(iveL("RGB")).tag(HistogramMode.rgb)
                    Text(iveL("Luma")).tag(HistogramMode.luma)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                GeometryReader { proxy in
                    let width = max(1, proxy.size.width)
                    let height = max(1, proxy.size.height)
                    let count = CGFloat(max(1, redBins.count))
                    let barWidth = width / count

                    ZStack(alignment: .bottomLeading) {
                        if histogramMode == .rgb {
                            histogramPath(for: redBins, width: barWidth, height: height)
                                .fill(Color.red.opacity(0.45))
                            histogramPath(for: greenBins, width: barWidth, height: height)
                                .fill(Color.green.opacity(0.45))
                            histogramPath(for: blueBins, width: barWidth, height: height)
                                .fill(Color.blue.opacity(0.45))
                        } else {
                            histogramPath(for: lumaBins, width: barWidth, height: height)
                                .fill(Color.white.opacity(0.75))
                        }

                        if isInteractive {
                            ForEach(CurveZone.allCases, id: \.self) { zone in
                                let position = handlePosition(for: zone, in: CGSize(width: width, height: height))
                                Path { path in
                                    path.move(to: CGPoint(x: position.x, y: 0))
                                    path.addLine(to: CGPoint(x: position.x, y: height))
                                }
                                .stroke(style: StrokeStyle(lineWidth: 0.7, dash: [4, 3]))
                                .foregroundStyle(.white.opacity(activeZone == zone ? 0.9 : 0.45))

                                Circle()
                                    .fill(.white)
                                    .frame(width: activeZone == zone ? 11 : 9, height: activeZone == zone ? 11 : 9)
                                    .position(position)
                            }
                        }

                        if hasPointControls {
                            let blackX = (blackPoint?.wrappedValue ?? 0) * width
                            let whiteX = (whitePoint?.wrappedValue ?? 1) * width

                            Path { path in
                                path.move(to: CGPoint(x: blackX, y: 0))
                                path.addLine(to: CGPoint(x: blackX, y: height))
                            }
                            .stroke(.orange.opacity(0.9), lineWidth: 1.2)

                            Path { path in
                                path.move(to: CGPoint(x: whiteX, y: 0))
                                path.addLine(to: CGPoint(x: whiteX, y: height))
                            }
                            .stroke(.yellow.opacity(0.9), lineWidth: 1.2)
                        }
                    }
                    .contentShape(Rectangle())
                    .simultaneousGesture(
                        DragGesture(minimumDistance: 0)
                            .onChanged { value in
                                let dx = abs(value.translation.width)
                                let dy = abs(value.translation.height)
                                guard dx >= dy else { return }
                                updateInteractiveCurve(at: value.location, in: proxy.size)
                                updateBlackWhitePoints(at: value.location, in: proxy.size)
                            }
                            .onEnded { _ in
                                activeZone = nil
                            }
                    )
                }
                .frame(height: 112)

                HStack(spacing: 8) {
                    if leftClipAmount > 0.85 {
                        Text(iveL("Shadow clip"))
                            .font(.caption2)
                            .foregroundStyle(.orange.opacity(0.95))
                    }
                    Spacer(minLength: 0)
                    if rightClipAmount > 0.85 {
                        Text(iveL("Highlight clip"))
                            .font(.caption2)
                            .foregroundStyle(.orange.opacity(0.95))
                    }
                }

                if isInteractive {
                    Text(
                        iveL("Drag horizontally in left/center/right zone for Shadows/Midtones/Highlights")
                    )
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.75))
                }
            }
            .padding(6)
        }
        .frame(maxWidth: .infinity, minHeight: 132, maxHeight: 132)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(.white.opacity(0.2), lineWidth: 0.6)
        )
        .task(id: cacheKey) {
            let bins = await loadHistogramBins()
            redBins = bins.red
            greenBins = bins.green
            blueBins = bins.blue
            lumaBins = bins.luma
        }
    }

    private func handlePosition(for zone: CurveZone, in size: CGSize) -> CGPoint {
        let bounds = zoneBounds(for: zone, width: size.width)
        let value = curveValue(for: zone)
        let normalized = CGFloat((value + 1) / 2)
        let x = bounds.lowerBound + normalized * max(1, (bounds.upperBound - bounds.lowerBound))
        let y = max(10, min(size.height - 10, size.height * 0.22))
        return CGPoint(x: x, y: y)
    }

    private func zoneBounds(for zone: CurveZone, width: CGFloat) -> ClosedRange<CGFloat> {
        let fullWidth = max(1, width)
        let third = fullWidth / 3
        let inset: CGFloat = 10
        switch zone {
        case .shadows:
            return inset...max(inset, third - inset)
        case .midtones:
            return (third + inset)...max(third + inset, (2 * third) - inset)
        case .highlights:
            return ((2 * third) + inset)...max((2 * third) + inset, fullWidth - inset)
        }
    }

    private func curveValue(for zone: CurveZone) -> Double {
        switch zone {
        case .shadows:
            return curveShadows?.wrappedValue ?? 0
        case .midtones:
            return curveMidtones?.wrappedValue ?? 0
        case .highlights:
            return curveHighlights?.wrappedValue ?? 0
        }
    }

    private func setCurveValue(_ value: Double, for zone: CurveZone) {
        let clamped = min(1, max(-1, value))
        switch zone {
        case .shadows:
            curveShadows?.wrappedValue = clamped
        case .midtones:
            curveMidtones?.wrappedValue = clamped
        case .highlights:
            curveHighlights?.wrappedValue = clamped
        }
    }

    private func zoneForX(_ x: CGFloat, width: CGFloat) -> CurveZone {
        let normalized = max(0, min(1, x / max(1, width)))
        if normalized < (1.0 / 3.0) { return .shadows }
        if normalized < (2.0 / 3.0) { return .midtones }
        return .highlights
    }

    private func updateInteractiveCurve(at location: CGPoint, in size: CGSize) {
        guard isInteractive else { return }
        let zone = activeZone ?? zoneForX(location.x, width: size.width)
        activeZone = zone
        let bounds = zoneBounds(for: zone, width: size.width)
        let clampedX = min(bounds.upperBound, max(bounds.lowerBound, location.x))
        let span = max(1, bounds.upperBound - bounds.lowerBound)
        let normalizedX = (clampedX - bounds.lowerBound) / span
        let mappedValue = Double((normalizedX * 2) - 1)
        setCurveValue(mappedValue, for: zone)
    }

    private func updateBlackWhitePoints(at location: CGPoint, in size: CGSize) {
        guard hasPointControls else { return }
        let width = max(1, size.width)
        let normalizedX = max(0, min(1, location.x / width))
        let currentBlack = blackPoint?.wrappedValue ?? 0
        let currentWhite = whitePoint?.wrappedValue ?? 1
        let proximityThreshold = 0.06
        let blackDistance = abs(normalizedX - currentBlack)
        let whiteDistance = abs(normalizedX - currentWhite)
        guard min(blackDistance, whiteDistance) <= proximityThreshold else { return }

        if blackDistance < whiteDistance {
            blackPoint?.wrappedValue = min(0.4, max(0, min(normalizedX, currentWhite - 0.05)))
        } else {
            whitePoint?.wrappedValue = max(0.6, min(1, max(normalizedX, currentBlack + 0.05)))
        }
    }

    private func histogramPath(for bins: [CGFloat], width: CGFloat, height: CGFloat) -> Path {
        var path = Path()
        for (index, value) in bins.enumerated() {
            let clamped = max(0, min(1, value))
            let x = CGFloat(index) * width
            let barHeight = max(1, clamped * height)
            path.addRect(CGRect(x: x, y: height - barHeight, width: max(1, width - 0.3), height: barHeight))
        }
        return path
    }

    private func loadHistogramBins() async -> (red: [CGFloat], green: [CGFloat], blue: [CGFloat], luma: [CGFloat]) {
        await Self.generateHistogramBins(sourceURL: sourceURL, isVideo: isVideo)
    }

    nonisolated private static func generateHistogramBins(sourceURL: URL, isVideo: Bool) async -> (red: [CGFloat], green: [CGFloat], blue: [CGFloat], luma: [CGFloat]) {
        let binCount = 64
        let sourceCGImage: CGImage?
        if isVideo {
            sourceCGImage = await iveFirstVideoFrameCGImage(
                from: sourceURL,
                maximumSize: CGSize(width: 256, height: 256)
            )
        } else if let imageSource = CGImageSourceCreateWithURL(sourceURL as CFURL, nil) {
            let options: [CFString: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceThumbnailMaxPixelSize: 256,
                kCGImageSourceCreateThumbnailWithTransform: true
            ]
            sourceCGImage = CGImageSourceCreateThumbnailAtIndex(imageSource, 0, options as CFDictionary)
        } else {
            sourceCGImage = nil
        }

        guard let sourceCGImage else {
            let empty = Array(repeating: CGFloat(0), count: binCount)
            return (empty, empty, empty, empty)
        }

        let width = sourceCGImage.width
        let height = sourceCGImage.height
        guard width > 0, height > 0 else {
            let empty = Array(repeating: CGFloat(0), count: binCount)
            return (empty, empty, empty, empty)
        }

        let bytesPerPixel = 4
        let bytesPerRow = width * bytesPerPixel
        var pixelData = [UInt8](repeating: 0, count: height * bytesPerRow)
        guard let context = CGContext(
            data: &pixelData,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: bytesPerRow,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
            let empty = Array(repeating: CGFloat(0), count: binCount)
            return (empty, empty, empty, empty)
        }
        context.draw(sourceCGImage, in: CGRect(x: 0, y: 0, width: width, height: height))

        var red = [CGFloat](repeating: 0, count: binCount)
        var green = [CGFloat](repeating: 0, count: binCount)
        var blue = [CGFloat](repeating: 0, count: binCount)
        var luma = [CGFloat](repeating: 0, count: binCount)
        var maxValue: CGFloat = 0

        for y in 0..<height {
            let rowOffset = y * bytesPerRow
            for x in 0..<width {
                let pixelOffset = rowOffset + (x * bytesPerPixel)
                let r = Int(pixelData[pixelOffset])
                let g = Int(pixelData[pixelOffset + 1])
                let b = Int(pixelData[pixelOffset + 2])

                let rBin = min(binCount - 1, (r * binCount) / 256)
                let gBin = min(binCount - 1, (g * binCount) / 256)
                let bBin = min(binCount - 1, (b * binCount) / 256)
                let weightedLuma = (0.2126 * Double(r)) + (0.7152 * Double(g)) + (0.0722 * Double(b))
                let l = Int(round(weightedLuma))
                let lumaBin = min(binCount - 1, (max(0, min(255, l)) * binCount) / 256)

                red[rBin] += 1
                green[gBin] += 1
                blue[bBin] += 1
                luma[lumaBin] += 1
            }
        }

        for index in 0..<binCount {
            maxValue = max(maxValue, red[index], green[index], blue[index], luma[index])
        }

        if maxValue > 0 {
            red = red.map { $0 / maxValue }
            green = green.map { $0 / maxValue }
            blue = blue.map { $0 / maxValue }
            luma = luma.map { $0 / maxValue }
        }
        return (red, green, blue, luma)
    }
}

private struct VideoPreview: View {
    let url: URL
    let cropRect: IVENormalizedRect
    var cropMode: IVEVideoCropMode = .fit
    let trimRange: CMTimeRange?
    let renderState: VideoRenderState
    var pauseToken: UInt = 0
    var seekToken: UInt = 0
    var seekTimeSeconds: Double? = nil
    var onDisplayedTimeChange: (@MainActor @Sendable (Double) -> Void)? = nil
    @State private var player: AVPlayer?
    @State private var playerBuildToken: UInt = 0
    @State private var renderUpdateToken: UInt = 0
    @State private var timeObserverToken: Any?
    @State private var timeObserverPlayer: AVPlayer?
    @State private var itemEndObserverToken: NSObjectProtocol?
    @State private var itemEndObserverItem: AVPlayerItem?

    private var trimSignature: String {
        guard let trimRange else { return "none" }
        return "\(CMTimeGetSeconds(trimRange.start))-\(CMTimeGetSeconds(trimRange.duration))"
    }

    private var renderSignature: String {
        [
            String(cropRect.x),
            String(cropRect.y),
            String(cropRect.width),
            String(cropRect.height),
            cropMode.rawValue,
            trimSignature,
            String(renderState.exposure),
            String(renderState.contrast),
            String(renderState.saturation),
            String(renderState.temperature),
            String(renderState.tint),
            String(renderState.curveShadows),
            String(renderState.curveMidtones),
            String(renderState.curveHighlights),
            String(renderState.curveRedShadows),
            String(renderState.curveRedMidtones),
            String(renderState.curveRedHighlights),
            String(renderState.curveGreenShadows),
            String(renderState.curveGreenMidtones),
            String(renderState.curveGreenHighlights),
            String(renderState.curveBlueShadows),
            String(renderState.curveBlueMidtones),
            String(renderState.curveBlueHighlights),
            String(renderState.blackPoint),
            String(renderState.whitePoint),
            String(renderState.rotationDegrees),
            String(renderState.mirrorHorizontal),
            String(renderState.mirrorVertical),
            renderState.filterPreset.rawValue
        ].joined(separator: "|")
    }

    var body: some View {
        IVEPlayerContainer(player: player)
            .task(id: url.absoluteString) {
                playerBuildToken &+= 1
                let token = playerBuildToken
                await rebuildPlayer(token: token)
            }
            .task(id: renderSignature) {
                renderUpdateToken &+= 1
                let token = renderUpdateToken
                await updateExistingPlayerRenderState(token: token)
            }
            .onDisappear {
                playerBuildToken &+= 1
                renderUpdateToken &+= 1
                removeTimeObserverIfNeeded()
                removePlaybackEndObserverIfNeeded()
                player?.pause()
                player = nil
            }
            .onChange(of: pauseToken) { _, _ in
                player?.pause()
            }
            .onChange(of: seekToken) { _, _ in
                guard let seekTimeSeconds, let player else { return }
                let target = clampedTimeForCurrentTrim(
                    CMTime(seconds: max(0, seekTimeSeconds), preferredTimescale: 600)
                )
                player.seek(to: target, toleranceBefore: .zero, toleranceAfter: .zero)
            }
    }

    private func makePlayer() async -> AVPlayer {
        let asset = AVURLAsset(url: url)
        let service = IVEVideoEditingService(asset: asset)
        return await service.makePreviewPlayer(
            cropRect: cropRect,
            cropMode: cropMode,
            trimRange: trimRange,
            renderState: renderState
        )
    }

    private func rebuildPlayer(token: UInt) async {
        let previousPlayer = player
        let shouldResumePlayback = previousPlayer?.timeControlStatus == .playing
        let previousTime = previousPlayer?.currentTime()
        let nextPlayer = await makePlayer()
        guard !Task.isCancelled, token == playerBuildToken else {
            nextPlayer.pause()
            return
        }

        if let previousTime {
            let targetTime = clampedTimeForCurrentTrim(previousTime)
            await nextPlayer.seek(to: targetTime, toleranceBefore: .zero, toleranceAfter: .zero)
        }
        if shouldResumePlayback {
            nextPlayer.play()
        }

        removeTimeObserverIfNeeded()
        installTimeObserverIfNeeded(for: nextPlayer)
        installPlaybackEndObserver(for: nextPlayer)
        onDisplayedTimeChange?(CMTimeGetSeconds(nextPlayer.currentTime()))
        previousPlayer?.pause()
        player = nextPlayer
    }

    private func updateExistingPlayerRenderState(token: UInt) async {
        guard let currentPlayer = player else { return }
        let shouldResumePlayback = currentPlayer.timeControlStatus == .playing
        let currentTime = currentPlayer.currentTime()

        let service = IVEVideoEditingService(asset: AVURLAsset(url: url))
        let composition = await service.makeVideoComposition(
            cropRect: cropRect,
            cropMode: cropMode,
            renderState: renderState
        )
        guard !Task.isCancelled, token == renderUpdateToken, currentPlayer === player else { return }

        await MainActor.run {
            guard currentPlayer === player, let item = currentPlayer.currentItem else { return }
            item.videoComposition = composition
            if let trimRange {
                let trimEnd = CMTimeAdd(trimRange.start, trimRange.duration)
                item.forwardPlaybackEndTime = CMTimeAdd(trimEnd, CMTime(seconds: 1.0 / 120.0, preferredTimescale: 600))
            } else {
                item.forwardPlaybackEndTime = .invalid
            }
        }
        installPlaybackEndObserver(for: currentPlayer)

        let targetTime = clampedTimeForCurrentTrim(currentTime)
        let timeDelta = abs(CMTimeGetSeconds(targetTime) - CMTimeGetSeconds(currentTime))
        if timeDelta > 0.001 {
            if shouldResumePlayback {
                currentPlayer.pause()
            }
            await currentPlayer.seek(to: targetTime, toleranceBefore: .zero, toleranceAfter: .zero)
            if shouldResumePlayback {
                currentPlayer.play()
            }
        }
    }

    private func installTimeObserverIfNeeded(for player: AVPlayer) {
        guard let onDisplayedTimeChange else { return }
        guard timeObserverToken == nil else { return }
        let interval = CMTime(seconds: 0.2, preferredTimescale: 600)
        timeObserverToken = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { time in
            MainActor.assumeIsolated {
                onDisplayedTimeChange(max(0, CMTimeGetSeconds(time)))
            }
        }
        timeObserverPlayer = player
    }

    private func removeTimeObserverIfNeeded() {
        guard let token = timeObserverToken else { return }
        if let timeObserverPlayer {
            timeObserverPlayer.removeTimeObserver(token)
        }
        timeObserverToken = nil
        timeObserverPlayer = nil
    }

    private func installPlaybackEndObserver(for player: AVPlayer) {
        guard let item = player.currentItem else { return }
        if itemEndObserverItem === item, itemEndObserverToken != nil {
            return
        }
        removePlaybackEndObserverIfNeeded()
        itemEndObserverItem = item
        let trimStart = trimRange?.start ?? .zero
        itemEndObserverToken = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak player] _ in
            guard let player else { return }
            player.pause()
            player.seek(to: trimStart, toleranceBefore: .zero, toleranceAfter: .zero)
        }
    }

    private func removePlaybackEndObserverIfNeeded() {
        if let itemEndObserverToken {
            NotificationCenter.default.removeObserver(itemEndObserverToken)
        }
        itemEndObserverToken = nil
        itemEndObserverItem = nil
    }

    private func clampedTimeForCurrentTrim(_ time: CMTime) -> CMTime {
        guard let trimRange else { return max(.zero, time) }
        let start = trimRange.start
        let end = CMTimeAdd(trimRange.start, trimRange.duration)
        let endPlaybackSafe = CMTimeMaximum(
            start,
            CMTimeSubtract(end, CMTime(seconds: 1.0 / 120.0, preferredTimescale: 600))
        )
        if time < start { return start }
        if time >= end { return endPlaybackSafe }
        return time
    }
}

private struct IVEPlayerContainer: View {
    let player: AVPlayer?

    var body: some View {
        #if os(iOS)
        IVEPlayerViewControllerHost(player: player)
        #elseif os(macOS)
        IVEMacPlayerViewHost(player: player)
        #else
        VideoPlayer(player: player)
        #endif
    }
}

#if os(iOS)
private struct IVEPlayerViewControllerHost: UIViewControllerRepresentable {
    let player: AVPlayer?

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let controller = AVPlayerViewController()
        controller.showsPlaybackControls = true
        controller.player = player
    
        return controller
    }

    func updateUIViewController(_ controller: AVPlayerViewController, context: Context) {
        if controller.player !== player {
            controller.player = player
        }
        controller.showsPlaybackControls = true
     
    }
}
#endif

#if os(macOS)
private struct IVEMacPlayerViewHost: NSViewRepresentable {
    let player: AVPlayer?

    func makeNSView(context: Context) -> AVPlayerView {
        let view = AVPlayerView()
        view.controlsStyle = .inline
        view.showsSharingServiceButton = false
        view.player = player
        return view
    }

    func updateNSView(_ view: AVPlayerView, context: Context) {
        if view.player !== player {
            view.player = player
        }
        view.controlsStyle = .inline
        view.showsSharingServiceButton = false
    }
}
#endif

private struct TrimRangePreview: View {
    let trimStart: Double
    let trimDuration: Double
    let originalClipStart: Double
    let originalClipDuration: Double

    var body: some View {
        let total = max(1, max(originalClipStart + originalClipDuration, trimStart + trimDuration))
        let normalizedStart = max(0, min(1, trimStart / total))
        let normalizedDuration = max(0.01, min(1 - normalizedStart, trimDuration / total))

        VStack(alignment: .leading, spacing: 6) {
            Text(iveL("Trim Range"))
                .font(.caption)
                .foregroundStyle(.secondary)

            GeometryReader { proxy in
                let width = proxy.size.width
                let startX = normalizedStart * width
                let activeWidth = max(2, normalizedDuration * width)

                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(Color.secondary.opacity(0.2))
                        .frame(height: 10)

                    Capsule()
                        .fill(Color.accentColor)
                        .frame(width: activeWidth, height: 10)
                        .offset(x: startX)
                }
            }
            .frame(height: 10)

        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(.thinMaterial)
        )
    }
}
