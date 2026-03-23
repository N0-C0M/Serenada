package app.serenada.core.call

internal interface SessionAudioController {
    fun activate()
    fun deactivate()
    fun shouldPauseVideoForProximity(isScreenSharing: Boolean): Boolean
}
