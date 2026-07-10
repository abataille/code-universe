import XCTest
@testable import IVEEditorAI

final class IVEEditorAITests: XCTestCase {
    func testProviderUnavailable() {
        do {
            _ = try IVEAIFeatureRunner.removeBackground(provider: nil, sourceAssetID: UUID())
            XCTFail("Expected providerUnavailable")
        } catch {
            XCTAssertEqual(error as? IVEAIError, .providerUnavailable)
        }
    }

    func testProviderSuccessAndFailurePath() {
        let good = StubAIProvider(mode: .success)
        do {
            let result = try IVEAIFeatureRunner.removeBackground(provider: good, sourceAssetID: UUID())
            XCTAssertNotNil(result)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }

        let bad = StubAIProvider(mode: .failure)
        do {
            _ = try IVEAIFeatureRunner.removeBackground(provider: bad, sourceAssetID: UUID())
            XCTFail("Expected failure")
        } catch {
            XCTAssertEqual(error as? IVEAIError, .processingFailed("stub"))
        }
    }
}

private struct StubAIProvider: IVEAIProvider {
    enum Mode {
        case success
        case failure
    }

    let mode: Mode

    func removeBackground(from sourceAssetID: UUID) throws -> UUID {
        switch mode {
        case .success:
            return UUID()
        case .failure:
            throw IVEAIError.processingFailed("stub")
        }
    }

    func generateCaptions(for sourceAssetID: UUID, languageCode: String?) throws -> [IVECaptionSegment] {
        switch mode {
        case .success:
            return [IVECaptionSegment(startSeconds: 0, endSeconds: 1, text: "hello")]
        case .failure:
            throw IVEAIError.processingFailed("stub")
        }
    }

    func suggestReframing(for sourceAssetID: UUID, aspectRatio: Double) throws -> [IVEReframeSuggestion] {
        switch mode {
        case .success:
            return [IVEReframeSuggestion(startSeconds: 0, endSeconds: 1, normalizedCenterX: 0.5, normalizedCenterY: 0.5)]
        case .failure:
            throw IVEAIError.processingFailed("stub")
        }
    }
}
