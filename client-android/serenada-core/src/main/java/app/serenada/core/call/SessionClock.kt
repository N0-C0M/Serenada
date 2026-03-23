package app.serenada.core.call

internal interface SessionClock {
    fun nowMs(): Long
}
