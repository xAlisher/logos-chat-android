package com.logoschat

import android.app.Application
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
    // Load c++_shared -> logoschat -> logoschat_bridge at app start so a broken
    // bridge fails loudly here, not on first JS call (#11 AC: logcat 'ok').
    LogosChatModule.ensureLoaded()
    loadReactNative(this)
  }
}
