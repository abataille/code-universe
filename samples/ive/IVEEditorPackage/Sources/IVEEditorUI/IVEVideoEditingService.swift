@preconcurrency import AVFoundation
import CoreGraphics
import CoreImage
import CoreImage.CIFilterBuiltins
import Foundation
import IVEEditorCore

private func iveLocalized(_ key: String) -> String {
    NSLocalizedString(
        key,
        tableName: "Localizable",
        bundle: .module,
        value: key,
        comment: ""
    )
}

struct IVEVideoEditingService {
    let asset: AVAsset

    func makePreviewPlayer(
        cropRect: IVENormalizedRect,
        cropMode: IVEVideoCropMode,
        trimRange: CMTimeRange?,
        renderState: VideoRenderState
    ) async -> AVPlayer {
        let clampedTrimRange = await clampedPreviewTrimRange(trimRange)
        let item = await MainActor.run { AVPlayerItem(asset: asset) }
        let composition = await makeVideoComposition(
            cropRect: cropRect,
            cropMode: cropMode,
            renderState: renderState
        )
        await MainActor.run {
            item.videoComposition = composition
        }
        if let clampedTrimRange {
            await MainActor.run {
                let trimEnd = CMTimeAdd(clampedTrimRange.start, clampedTrimRange.duration)
                item.forwardPlaybackEndTime = CMTimeAdd(trimEnd, CMTime(seconds: 1.0 / 120.0, preferredTimescale: 600))
            }
        } else {
            await MainActor.run {
                item.forwardPlaybackEndTime = .invalid
            }
        }

        let player = await MainActor.run { AVPlayer(playerItem: item) }
        await MainActor.run {
            player.actionAtItemEnd = .pause
        }
        let previewStart = clampedTrimRange?.start ?? .zero
        await player.seek(to: previewStart, toleranceBefore: .zero, toleranceAfter: .zero)
        if clampedTrimRange == nil {
            await MainActor.run {
                item.reversePlaybackEndTime = .invalid
            }
        }
        return player
    }

    func makeVideoComposition(
        cropRect: IVENormalizedRect,
        cropMode: IVEVideoCropMode,
        renderState: VideoRenderState
    ) async -> AVVideoComposition {
        let track = await loadVideoTrack()
        let metrics = await videoMetrics(for: track)
        let normalized = normalizedCropRect(cropRect)
        let renderSize = renderOutputSize(
            mode: cropMode,
            normalizedCropRect: normalized,
            orientedSize: metrics.orientedSize
        )

        let sourceAsset = asset
        return await withCheckedContinuation { continuation in
            AVVideoComposition.videoComposition(
                with: sourceAsset,
                applyingCIFiltersWithHandler: { request in
                    let processed = Self.processedImage(
                        source: request.sourceImage,
                        preferredTransform: metrics.preferredTransform,
                        orientedSize: metrics.orientedSize,
                        cropRect: normalized,
                        renderState: renderState,
                        outputSize: renderSize
                    )
                    request.finish(with: processed, context: nil)
                },
                completionHandler: { composition, _ in
                    if let composition {
                        if let mutable = composition.mutableCopy() as? AVMutableVideoComposition {
                            mutable.renderSize = renderSize
                            continuation.resume(returning: mutable)
                        } else {
                            continuation.resume(returning: composition)
                        }
                    } else {
                        continuation.resume(returning: AVVideoComposition())
                    }
                }
            )
        }
    }

    func exportEditedVideo(
        to outputURL: URL,
        cropRect: IVENormalizedRect,
        cropMode: IVEVideoCropMode,
        trimRange: CMTimeRange?,
        renderState: VideoRenderState
    ) async throws {
        guard let exporter = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetHighestQuality) else {
            throw NSError(domain: "IVEEditor", code: 2002, userInfo: [NSLocalizedDescriptionKey: iveLocalized("Unable to create video exporter.")])
        }

        if FileManager.default.fileExists(atPath: outputURL.path) {
            try FileManager.default.removeItem(at: outputURL)
        }

        exporter.outputURL = outputURL
        exporter.outputFileType = .mov
        exporter.shouldOptimizeForNetworkUse = true
        exporter.videoComposition = await makeVideoComposition(
            cropRect: cropRect,
            cropMode: cropMode,
            renderState: renderState
        )
        if let trimRange {
            exporter.timeRange = trimRange
        }

        if #available(iOS 18, macOS 15, *) {
            try await exporter.export(to: outputURL, as: .mov)
        } else {
            try await withCheckedThrowingContinuation { continuation in
                exporter.exportAsynchronously {
                    continuation.resume()
                }
            }
            switch exporter.status {
            case .completed:
                break
            case .failed:
                throw exporter.error ?? NSError(domain: "IVEEditor", code: 2003, userInfo: [NSLocalizedDescriptionKey: iveLocalized("Video export failed.")])
            case .cancelled:
                throw exporter.error ?? NSError(domain: "IVEEditor", code: 2004, userInfo: [NSLocalizedDescriptionKey: iveLocalized("Video export cancelled.")])
            default:
                throw exporter.error ?? NSError(domain: "IVEEditor", code: 2005, userInfo: [NSLocalizedDescriptionKey: iveLocalized("Video export did not finish.")])
            }
        }
    }

    private func loadVideoTrack() async -> AVAssetTrack? {
        (try? await asset.loadTracks(withMediaType: .video))?.first
    }

    private func clampedPreviewTrimRange(_ trimRange: CMTimeRange?) async -> CMTimeRange? {
        guard let trimRange else { return nil }
        let durationSeconds = CMTimeGetSeconds((try? await asset.load(.duration)) ?? .invalid)
        guard durationSeconds.isFinite, durationSeconds > 0 else {
            return trimRange
        }

        var startSeconds = max(0, CMTimeGetSeconds(trimRange.start))
        if !startSeconds.isFinite {
            startSeconds = 0
        }
        if startSeconds >= durationSeconds {
            startSeconds = max(0, durationSeconds - 0.1)
        }

        let availableSeconds = max(0.1, durationSeconds - startSeconds)
        var requestedDuration = CMTimeGetSeconds(trimRange.duration)
        if !requestedDuration.isFinite {
            requestedDuration = availableSeconds
        }
        requestedDuration = min(availableSeconds, max(0.1, requestedDuration))

        return CMTimeRange(
            start: CMTime(seconds: startSeconds, preferredTimescale: 600),
            duration: CMTime(seconds: requestedDuration, preferredTimescale: 600)
        )
    }

    private func renderOutputSize(
        mode: IVEVideoCropMode,
        normalizedCropRect: IVENormalizedRect,
        orientedSize: CGSize
    ) -> CGSize {
        switch mode {
        case .fit:
            return CGSize(
                width: max(1, orientedSize.width.rounded()),
                height: max(1, orientedSize.height.rounded())
            )
        case .trueCrop:
            let width = max(1, (orientedSize.width * normalizedCropRect.width).rounded())
            let height = max(1, (orientedSize.height * normalizedCropRect.height).rounded())
            return CGSize(width: width, height: height)
        }
    }

    private func videoMetrics(for track: AVAssetTrack?) async -> VideoMetrics {
        guard let track else {
            return VideoMetrics(preferredTransform: .identity, orientedSize: CGSize(width: 1920, height: 1080))
        }

        let naturalSize = (try? await track.load(.naturalSize)) ?? CGSize(width: 1920, height: 1080)
        let preferredTransform = (try? await track.load(.preferredTransform)) ?? .identity
        let orientedRect = CGRect(origin: .zero, size: naturalSize).applying(preferredTransform)
        let orientedSize = CGSize(width: abs(orientedRect.width), height: abs(orientedRect.height))
        return VideoMetrics(preferredTransform: preferredTransform, orientedSize: orientedSize)
    }

    private static func processedImage(
        source: CIImage,
        preferredTransform: CGAffineTransform,
        orientedSize: CGSize,
        cropRect: IVENormalizedRect,
        renderState: VideoRenderState,
        outputSize: CGSize
    ) -> CIImage {
        let sourceSize = CGSize(width: abs(source.extent.width), height: abs(source.extent.height))
        let shouldApplyPreferredTransform =
            preferredTransform != .identity &&
            !sizesApproximatelyEqual(sourceSize, orientedSize)

        let orientedRaw = shouldApplyPreferredTransform
            ? source.transformed(by: preferredTransform)
            : source
        let orientedExtent = orientedRaw.extent
        let oriented = orientedRaw.transformed(
            by: CGAffineTransform(translationX: -orientedExtent.minX, y: -orientedExtent.minY)
        )
        let extent = oriented.extent
        let flippedY = 1 - cropRect.y - cropRect.height
        let selectedRect = CGRect(
            x: cropRect.x * extent.width,
            y: flippedY * extent.height,
            width: cropRect.width * extent.width,
            height: cropRect.height * extent.height
        )
        let clampedRect = selectedRect.intersection(extent)
        let sampleRect = (clampedRect.isNull || clampedRect.width < 1 || clampedRect.height < 1) ? extent : clampedRect

        var result = oriented.cropped(to: sampleRect)
            .transformed(by: CGAffineTransform(translationX: -sampleRect.minX, y: -sampleRect.minY))

        let safeOutputSize = CGSize(width: max(1, outputSize.width), height: max(1, outputSize.height))
        let fillScale = max(
            safeOutputSize.width / max(1, sampleRect.width),
            safeOutputSize.height / max(1, sampleRect.height)
        )
        if abs(fillScale - 1) > 0.001 {
            result = result.transformed(by: CGAffineTransform(scaleX: fillScale, y: fillScale))
        }
        if !result.extent.isNull {
            let extent = result.extent
            let translation = CGAffineTransform(
                translationX: (safeOutputSize.width - extent.width) * 0.5 - extent.minX,
                y: (safeOutputSize.height - extent.height) * 0.5 - extent.minY
            )
            result = result.transformed(by: translation)
        }

        let controls = CIFilter.colorControls()
        controls.inputImage = result
        controls.brightness = Float((renderState.exposure * 0.2) + renderState.filterBrightness)
        controls.contrast = Float(renderState.contrast * renderState.filterContrast)
        controls.saturation = Float(renderState.saturation * renderState.filterSaturation)
        result = controls.outputImage ?? result

        if abs(renderState.temperature) > 0.0001 || abs(renderState.tint) > 0.0001 {
            let vectors = colorCorrectionVectors(
                temperature: renderState.temperature,
                tint: renderState.tint
            )
            let correction = CIFilter.temperatureAndTint()
            correction.inputImage = result
            correction.neutral = vectors.neutral
            correction.targetNeutral = vectors.targetNeutral
            result = correction.outputImage ?? result
        }

        result = applyToneCurve(to: result, settings: renderState.colorCurveSettings)

        if renderState.filterHueRotationDegrees != 0 {
            let hue = CIFilter.hueAdjust()
            hue.inputImage = result
            hue.angle = Float(renderState.filterHueRotationDegrees * .pi / 180)
            result = hue.outputImage ?? result
        }

        var transform = CGAffineTransform.identity
        if renderState.mirrorHorizontal || renderState.mirrorVertical {
            let sx: CGFloat = renderState.mirrorHorizontal ? -1 : 1
            let sy: CGFloat = renderState.mirrorVertical ? -1 : 1
            transform = transform
                .translatedBy(x: result.extent.midX, y: result.extent.midY)
                .scaledBy(x: sx, y: sy)
                .translatedBy(x: -result.extent.midX, y: -result.extent.midY)
        }
        if renderState.rotationDegrees != 0 {
            let radians = CGFloat(renderState.rotationDegrees * .pi / 180)
            transform = transform
                .translatedBy(x: result.extent.midX, y: result.extent.midY)
                .rotated(by: radians)
                .translatedBy(x: -result.extent.midX, y: -result.extent.midY)
        }
        if transform != .identity {
            result = result.transformed(by: transform)
        }

        let targetRect = CGRect(
            x: result.extent.midX - (safeOutputSize.width * 0.5),
            y: result.extent.midY - (safeOutputSize.height * 0.5),
            width: safeOutputSize.width,
            height: safeOutputSize.height
        )
        let cropped = result.cropped(to: targetRect)
        return cropped.transformed(
            by: CGAffineTransform(translationX: -targetRect.minX, y: -targetRect.minY)
        )
    }

    private func normalizedCropRect(_ rect: IVENormalizedRect) -> IVENormalizedRect {
        let minSize = 0.02
        let width = min(1, max(minSize, rect.width))
        let height = min(1, max(minSize, rect.height))
        let x = min(1 - width, max(0, rect.x))
        let y = min(1 - height, max(0, rect.y))
        return IVENormalizedRect(x: x, y: y, width: width, height: height)
    }

    private static func colorCorrectionVectors(temperature: Double, tint: Double) -> (neutral: CIVector, targetNeutral: CIVector) {
        let clampedTemperature = max(-4000, min(4000, temperature))
        let clampedTint = max(-200, min(200, tint))
        let neutral = CIVector(x: 6500, y: 0)
        let targetNeutral = CIVector(
            x: 6500 + clampedTemperature,
            y: clampedTint
        )
        return (neutral, targetNeutral)
    }

    private static func applyToneCurve(to image: CIImage, settings: IVEColorCurveSettings) -> CIImage {
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

    private static func sizesApproximatelyEqual(_ lhs: CGSize, _ rhs: CGSize, tolerance: CGFloat = 1.0) -> Bool {
        abs(lhs.width - rhs.width) <= tolerance && abs(lhs.height - rhs.height) <= tolerance
    }
}

private struct VideoMetrics {
    let preferredTransform: CGAffineTransform
    let orientedSize: CGSize
}
