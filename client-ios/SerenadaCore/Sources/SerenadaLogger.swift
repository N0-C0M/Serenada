import Foundation

/// Log severity levels.
public enum SerenadaLogLevel: Int, Comparable, Sendable {
    case debug = 0, info, warning, error

    public static func < (lhs: Self, rhs: Self) -> Bool { lhs.rawValue < rhs.rawValue }
}

/// Custom logger interface. Implement to capture SDK log output.
public protocol SerenadaLogger: AnyObject, Sendable {
    func log(_ level: SerenadaLogLevel, tag: String, _ message: String)
}

/// Default logger that writes formatted messages to stdout via `print()`.
public final class PrintSerenadaLogger: SerenadaLogger {
    public init() {}

    public func log(_ level: SerenadaLogLevel, tag: String, _ message: String) {
        let levelLabel: String
        switch level {
        case .debug: levelLabel = "DEBUG"
        case .info: levelLabel = "INFO"
        case .warning: levelLabel = "WARN"
        case .error: levelLabel = "ERROR"
        }
        print("[\(levelLabel)] [\(tag)] \(message)")
    }
}
