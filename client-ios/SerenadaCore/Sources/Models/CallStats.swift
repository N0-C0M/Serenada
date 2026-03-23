import Foundation

/// Aggregated WebRTC call statistics.
public struct CallStats: Equatable {
    /// Available outgoing bitrate in kbps.
    public var bitrate: Double?
    /// Packet loss percentage (video or audio).
    public var packetLoss: Double?
    /// Audio jitter in milliseconds.
    public var jitter: Double?
    /// Active audio/video codec name.
    public var codec: String?
    /// Active ICE candidate pair description.
    public var iceCandidatePair: String?
    /// Round-trip time in milliseconds.
    public var roundTripTime: Double?
    /// Audio receive bitrate in kbps.
    public var audioRxKbps: Double?
    /// Audio transmit bitrate in kbps.
    public var audioTxKbps: Double?
    /// Video receive bitrate in kbps.
    public var videoRxKbps: Double?
    /// Video transmit bitrate in kbps.
    public var videoTxKbps: Double?
    /// Incoming video frames per second.
    public var videoFps: Double?
    /// Incoming video resolution (e.g. "1280x720").
    public var videoResolution: String?
    /// Timestamp of the last stats update (epoch milliseconds).
    public var updatedAtMs: Int64 = 0

    public static let empty = CallStats()

    public init() {}

    public init(from realtimeStats: RealtimeCallStats) {
        self.bitrate = realtimeStats.availableOutgoingKbps
        self.packetLoss = realtimeStats.videoRxPacketLossPct ?? realtimeStats.audioRxPacketLossPct
        self.jitter = realtimeStats.audioJitterMs
        self.roundTripTime = realtimeStats.rttMs
        self.audioRxKbps = realtimeStats.audioRxKbps
        self.audioTxKbps = realtimeStats.audioTxKbps
        self.videoRxKbps = realtimeStats.videoRxKbps
        self.videoTxKbps = realtimeStats.videoTxKbps
        self.videoFps = realtimeStats.videoFps
        self.videoResolution = realtimeStats.videoResolution
        self.iceCandidatePair = realtimeStats.transportPath
        self.updatedAtMs = realtimeStats.updatedAtMs
    }
}
