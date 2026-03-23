package app.serenada.core

import app.serenada.core.call.RealtimeCallStats

/**
 * Aggregated call statistics exposed to SDK consumers.
 * Populated from WebRTC getStats() periodically during an active call.
 */
data class CallStats(
    /** Aggregate bitrate in kbps. */
    val bitrate: Double? = null,
    /** Packet loss percentage (0-100). */
    val packetLoss: Double? = null,
    /** Network jitter in milliseconds. */
    val jitter: Double? = null,
    /** Active audio/video codec name. */
    val codec: String? = null,
    /** Active ICE candidate pair description. */
    val iceCandidatePair: String? = null,
    /** Network round-trip time in milliseconds. */
    val roundTripTime: Double? = null,
    /** Audio receive bitrate in kbps. */
    val audioRxKbps: Double? = null,
    /** Audio transmit bitrate in kbps. */
    val audioTxKbps: Double? = null,
    /** Video receive bitrate in kbps. */
    val videoRxKbps: Double? = null,
    /** Video transmit bitrate in kbps. */
    val videoTxKbps: Double? = null,
    /** Current video frames per second. */
    val videoFps: Double? = null,
    /** Current video resolution (e.g. "1280x720"). */
    val videoResolution: String? = null,
    /** Real-time per-frame statistics. */
    val realtimeStats: RealtimeCallStats? = null,
    /** Timestamp of last stats update (epoch millis). */
    val updatedAtMs: Long = 0L,
)
