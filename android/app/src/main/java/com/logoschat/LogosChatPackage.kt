package com.logoschat

import android.view.View
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ReactShadowNode
import com.facebook.react.uimanager.ViewManager

class LogosChatPackage : ReactPackage {

  @Suppress("UNCHECKED_CAST")
  override fun createViewManagers(
      reactContext: ReactApplicationContext
  ): MutableList<ViewManager<View, ReactShadowNode<*>>> =
      mutableListOf<ViewManager<*, *>>(MediaVideoViewManager(reactContext))
          as MutableList<ViewManager<View, ReactShadowNode<*>>>

  override fun createNativeModules(
      reactContext: ReactApplicationContext
  ): MutableList<NativeModule> =
      mutableListOf(
          LogosChatModule(reactContext),
          MeshCoreModule(reactContext),
          BleMeshModule(reactContext),
          ImagePickerModule(reactContext),
          LocationModule(reactContext),
          AudioModule(reactContext),
          StorageModule(reactContext),
      )
}
