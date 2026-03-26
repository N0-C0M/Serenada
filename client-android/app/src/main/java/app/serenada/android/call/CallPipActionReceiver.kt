package app.serenada.android.call

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import app.serenada.android.SerenadaApp

class CallPipActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        val callManager = (context.applicationContext as? SerenadaApp)?.callManager ?: return
        when (action) {
            ACTION_TOGGLE_MICROPHONE -> callManager.toggleAudio()
            ACTION_TOGGLE_CAMERA -> callManager.toggleVideo()
            ACTION_END_CALL -> callManager.endCall()
        }
    }

    companion object {
        const val ACTION_TOGGLE_MICROPHONE = "app.serenada.android.action.PIP_TOGGLE_MICROPHONE"
        const val ACTION_TOGGLE_CAMERA = "app.serenada.android.action.PIP_TOGGLE_CAMERA"
        const val ACTION_END_CALL = "app.serenada.android.action.PIP_END_CALL"
    }
}
