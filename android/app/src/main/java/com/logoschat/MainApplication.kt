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
    // Durable store opens with the process — before RN, before the node — so the
    // persist-before-forward path never races the JS bundle.
    ChatRepo.init(this)
    NodeRuntime.attachContext(this)
    // Load libc++_shared -> librln -> liblogosdelivery -> liblogoschat -> the bridge
    // at app start so a broken chain fails loudly here, not on first JS call.
    NodeBridge.load(this)
    loadReactNative(this)
  }
}
