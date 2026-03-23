package app.serenada.core.call

internal class LiveSessionClock : SessionClock {
    override fun nowMs(): Long = System.currentTimeMillis()
}
