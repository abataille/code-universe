import Foundation
import SwiftUI

public struct IVECaptionSegment: Sendable, Equatable, Codable {
    public let startSeconds: Double
    public let endSeconds: Double
    public let text: String

    public init(startSeconds: Double, endSeconds: Double, text: String) {
        self.startSeconds = startSeconds
        self.endSeconds = endSeconds
        self.text = text
    }
}

public struct IVEReframeSuggestion: Sendable, Equatable, Codable {
    public let startSeconds: Double
    public let endSeconds: Double
    public let normalizedCenterX: Double
    public let normalizedCenterY: Double

    public init(startSeconds: Double, endSeconds: Double, normalizedCenterX: Double, normalizedCenterY: Double) {
        self.startSeconds = startSeconds
        self.endSeconds = endSeconds
        self.normalizedCenterX = normalizedCenterX
        self.normalizedCenterY = normalizedCenterY
    }
}

public enum IVEAIError: Error, Equatable {
    case providerUnavailable
    case processingFailed(String)
}

public protocol IVEAIProvider {
    func removeBackground(from sourceAssetID: UUID) throws -> UUID
    func generateCaptions(for sourceAssetID: UUID, languageCode: String?) throws -> [IVECaptionSegment]
    func suggestReframing(for sourceAssetID: UUID, aspectRatio: Double) throws -> [IVEReframeSuggestion]
}

public enum IVEAIFeatureRunner {
    public static func removeBackground(
        provider: IVEAIProvider?,
        sourceAssetID: UUID
    ) throws -> UUID {
        guard let provider else {
            throw IVEAIError.providerUnavailable
        }
        return try provider.removeBackground(from: sourceAssetID)
    }

    public static func generateCaptions(
        provider: IVEAIProvider?,
        sourceAssetID: UUID,
        languageCode: String? = nil
    ) throws -> [IVECaptionSegment] {
        guard let provider else {
            throw IVEAIError.providerUnavailable
        }
        return try provider.generateCaptions(for: sourceAssetID, languageCode: languageCode)
    }

    public static func suggestReframing(
        provider: IVEAIProvider?,
        sourceAssetID: UUID,
        aspectRatio: Double
    ) throws -> [IVEReframeSuggestion] {
        guard let provider else {
            throw IVEAIError.providerUnavailable
        }
        return try provider.suggestReframing(for: sourceAssetID, aspectRatio: aspectRatio)
    }
}


