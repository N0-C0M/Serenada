import Foundation

/// Signaling transport type.
public enum SerenadaTransport: String, Equatable, Sendable {
    case ws
    case sse
}

/// SDK configuration.
public struct SerenadaConfig: Equatable, Sendable {
    /// Server host or origin (e.g. "serenada.app" or "localhost:8080").
    public let serverHost: String
    /// Whether audio is enabled when joining a call. Defaults to `true`.
    public var defaultAudioEnabled: Bool
    /// Whether video is enabled when joining a call. Defaults to `true`.
    public var defaultVideoEnabled: Bool
    /// Preferred signaling transports in priority order. Defaults to `[.ws, .sse]`.
    public var transports: [SerenadaTransport]

    public init(
        serverHost: String,
        defaultAudioEnabled: Bool = true,
        defaultVideoEnabled: Bool = true,
        transports: [SerenadaTransport] = [.ws, .sse]
    ) {
        self.serverHost = serverHost
        self.defaultAudioEnabled = defaultAudioEnabled
        self.defaultVideoEnabled = defaultVideoEnabled
        self.transports = transports
    }
}
