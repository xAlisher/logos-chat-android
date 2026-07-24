package com.logoschat

import android.app.Application
import android.os.Build
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          add(LogosChatPackage()) // the embedded liblogoschat node bridge
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    // The ProcessPhoenix relauncher (#59) runs in a SEPARATE process (":phoenix").
    // onCreate fires for EVERY process; skip the heavy init there — the restarter
    // only needs to relaunch MainActivity, not dlopen the 24-28 MB .so or boot RN.
    if (isPhoenixProcess()) return
    // Durable store opens with the process — before RN, before the node — so the
    // persist-before-forward path (#21) never races the JS bundle.
    ChatRepo.init(this)
    // Load c++_shared -> the persisted liblogoschat VARIANT (std/mix) -> the bridge
    // at app start so a broken chain fails loudly here, not on first JS call
    // (#11 AC: logcat 'ok'). Dual-binary #51 — the variant is a SharedPreferences
    // flag rewritten by the Private routing toggle, which then restarts the process.
    NodeBridge.load(this)
    loadReactNative(this)
  }

  /** True in the ":phoenix" restarter process (#59). getProcessName is API 28+; on
   * 24-27 fall back to /proc/self/cmdline. */
  private fun isPhoenixProcess(): Boolean {
    val name =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
          getProcessName()
        } else {
          try {
            java.io.File("/proc/self/cmdline").readText().trim { it <= ' ' }
          } catch (_: Throwable) {
            null
          }
        }
    return name != null && name.endsWith(PhoenixActivity.PROCESS_SUFFIX)
  }
}
