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
    super.onCreate(savedInstanceState)
    capture(intent)
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
