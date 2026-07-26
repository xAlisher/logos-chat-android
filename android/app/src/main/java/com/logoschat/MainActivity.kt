package com.logoschat

import android.content.Intent
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  companion object {
    /**
     * convoPk from a tapped message notification (#26), consumed once by JS via
     * `LogosChat.consumeLaunchConvo()`. Held statically because the tap can
     * arrive before (cold start) or after (singleTask onNewIntent) JS is ready.
     */
    @Volatile private var launchConvoPk: Long = 0L

    @JvmStatic
    fun consumeLaunchConvoPk(): Long {
      val v = launchConvoPk
      launchConvoPk = 0L
      return v
    }

    private fun capture(intent: Intent?) {
      val pk = intent?.getLongExtra(MessageNotifier.EXTRA_CONVO_PK, 0L) ?: 0L
      if (pk != 0L) launchConvoPk = pk
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    // Pass null, never the saved bundle: react-native-screens crashes with
    // "Screen fragments should never be restored" if Android tries to restore the
    // fragment back-stack after process-death / config-change / returning from the
    // background (RN owns navigation state, not the Android fragment manager). This
    // was causing crash-on-resume + blank/black screens on the test phones. See
    // github.com/software-mansion/react-native-screens/issues/17.
    super.onCreate(null)
    capture(intent)
    // Auto-start is driven from JS on launch (nodeStore.autoStart) so it can fetch
    // the address once the node is running. The headless START_STICKY path
    // (ChatService.autoRestartIfWanted) still covers process-death when JS is absent.
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    capture(intent)
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "logoschat"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
