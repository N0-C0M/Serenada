package app.serenada.core

/**
 * Configuration for the Serenada SDK.
 */
data class SerenadaConfig(
    /** Server host or origin (e.g. "serenada.app" or "http://localhost:8080"). */
    val serverHost: String,
    /** Whether audio starts enabled (default true). */
    val defaultAudioEnabled: Boolean = true,
    /** Whether video starts enabled (default true). */
    val defaultVideoEnabled: Boolean = true,
    /** Enable experimental HD video capture. */
    val isHdVideoExperimentalEnabled: Boolean = false,
    /** Preferred signaling transports in priority order (default: WS then SSE). */
    val transports: List<SerenadaTransport> = listOf(SerenadaTransport.WS, SerenadaTransport.SSE),
)

/** Available signaling transport types. */
enum class SerenadaTransport {
    /** WebSocket transport. */
    WS,
    /** Server-Sent Events transport. */
    SSE,
}
