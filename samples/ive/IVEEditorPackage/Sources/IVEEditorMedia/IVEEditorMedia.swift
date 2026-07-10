import Foundation
import IVEEditorCore

public struct IVEIngestedAsset: Sendable, Equatable {
    public let asset: IVEMediaAssetRef
    public let thumbnailID: String
    public let proxyAssetID: String?

    public init(asset: IVEMediaAssetRef, thumbnailID: String, proxyAssetID: String?) {
        self.asset = asset
        self.thumbnailID = thumbnailID
        self.proxyAssetID = proxyAssetID
    }
}

public protocol IVEThumbnailPipeline: Sendable {
    func thumbnailIdentifier(for asset: IVEMediaAssetRef) throws -> String
}

public protocol IVEProxyPipeline: Sendable {
    func proxyIdentifier(for asset: IVEMediaAssetRef) throws -> String?
}

public struct IVETranscodeRequest: Sendable, Equatable {
    public let sourceAssetID: UUID
    public let targetCodec: String

    public init(sourceAssetID: UUID, targetCodec: String) {
        self.sourceAssetID = sourceAssetID
        self.targetCodec = targetCodec
    }
}

public protocol IVETranscodingAdapter: Sendable {
    func transcode(_ request: IVETranscodeRequest) throws -> UUID
}

public final class IVEIngestPipeline {
    private let mediaStore: IVEMediaStore
    private let thumbnails: IVEThumbnailPipeline
    private let proxies: IVEProxyPipeline

    public init(mediaStore: IVEMediaStore, thumbnails: IVEThumbnailPipeline, proxies: IVEProxyPipeline) {
        self.mediaStore = mediaStore
        self.thumbnails = thumbnails
        self.proxies = proxies
    }

    public func ingest(
        localIdentifier: String,
        kind: IVEMediaKind,
        into project: IVEProjectHandle
    ) throws -> IVEIngestedAsset {
        let asset = try mediaStore.ingestMedia(localIdentifier: localIdentifier, kind: kind, into: project)
        let thumbnailID = try thumbnails.thumbnailIdentifier(for: asset)
        let proxyID = try proxies.proxyIdentifier(for: asset)
        return IVEIngestedAsset(asset: asset, thumbnailID: thumbnailID, proxyAssetID: proxyID)
    }
}
