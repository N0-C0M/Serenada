package app.serenada.android

import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.app.PendingIntent
import android.content.Intent
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Rational
import androidx.activity.compose.setContent
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import app.serenada.android.ui.SerenadaAppRoot
import androidx.compose.foundation.layout.Box
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.semantics.testTagsAsResourceId
import app.serenada.android.call.CallPipActionReceiver
import app.serenada.core.call.CallPhase

@OptIn(ExperimentalComposeUiApi::class)
class MainActivity : AppCompatActivity() {
    companion object {
        private const val STATE_PENDING_DEEP_LINK = "pending_deep_link"
        private val CALL_PIP_ASPECT_RATIO = Rational(16, 9)
        private const val REQUEST_CODE_PIP_TOGGLE_MICROPHONE = 701
        private const val REQUEST_CODE_PIP_TOGGLE_CAMERA = 702
        private const val REQUEST_CODE_PIP_END_CALL = 703
    }

    private val callManager by lazy { (application as SerenadaApp).callManager }
    private var pendingDeepLinkUri by mutableStateOf<Uri?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        pendingDeepLinkUri = restorePendingDeepLink(savedInstanceState)
        setContent {
            Box(modifier = Modifier.semantics { testTagsAsResourceId = true }) {
                SerenadaAppRoot(
                    callManager = callManager,
                    deepLinkUri = pendingDeepLinkUri,
                    onDeepLinkConsumed = { pendingDeepLinkUri = null }
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        pendingDeepLinkUri = intent.data
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString(STATE_PENDING_DEEP_LINK, pendingDeepLinkUri?.toString())
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        enterCallPictureInPictureIfNeeded()
    }

    private fun restorePendingDeepLink(savedInstanceState: Bundle?): Uri? {
        if (savedInstanceState?.containsKey(STATE_PENDING_DEEP_LINK) == true) {
            return savedInstanceState
                .getString(STATE_PENDING_DEEP_LINK)
                ?.takeIf { it.isNotBlank() }
                ?.let(Uri::parse)
        }
        return intent?.data
    }

    private fun enterCallPictureInPictureIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        if (isInPictureInPictureMode || isFinishing) return
        if (!isCallPictureInPictureEligible()) return

        val params = PictureInPictureParams.Builder()
            .setAspectRatio(CALL_PIP_ASPECT_RATIO)
            .setActions(buildCallPictureInPictureActions())
            .build()
        runCatching { enterPictureInPictureMode(params) }
    }

    private fun isCallPictureInPictureEligible(): Boolean {
        if (!callManager.isCallPictureInPictureEnabled.value) return false
        val phase = callManager.uiState.value.phase
        return phase == CallPhase.Waiting || phase == CallPhase.InCall
    }

    private fun buildCallPictureInPictureActions(): List<RemoteAction> {
        return listOf(
            buildCallPictureInPictureAction(
                requestCode = REQUEST_CODE_PIP_TOGGLE_MICROPHONE,
                action = CallPipActionReceiver.ACTION_TOGGLE_MICROPHONE,
                iconResId = android.R.drawable.ic_lock_silent_mode,
                titleResId = R.string.call_pip_action_toggle_microphone,
            ),
            buildCallPictureInPictureAction(
                requestCode = REQUEST_CODE_PIP_TOGGLE_CAMERA,
                action = CallPipActionReceiver.ACTION_TOGGLE_CAMERA,
                iconResId = android.R.drawable.ic_menu_camera,
                titleResId = R.string.call_pip_action_toggle_camera,
            ),
            buildCallPictureInPictureAction(
                requestCode = REQUEST_CODE_PIP_END_CALL,
                action = CallPipActionReceiver.ACTION_END_CALL,
                iconResId = android.R.drawable.ic_menu_close_clear_cancel,
                titleResId = R.string.call_pip_action_end_call,
            ),
        )
    }

    private fun buildCallPictureInPictureAction(
        requestCode: Int,
        action: String,
        iconResId: Int,
        titleResId: Int,
    ): RemoteAction {
        val intent = Intent(this, CallPipActionReceiver::class.java).apply {
            this.action = action
        }
        val pendingIntent = PendingIntent.getBroadcast(
            this,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val title = getString(titleResId)
        return RemoteAction(
            Icon.createWithResource(this, iconResId),
            title,
            title,
            pendingIntent,
        )
    }
}
