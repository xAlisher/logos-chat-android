package com.logoschat

import android.content.Context
import android.graphics.SurfaceTexture
import android.media.MediaPlayer
import android.view.Surface
import android.view.TextureView
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

/**
 * #300: inline video-gif player — a muted, looping, auto-playing TextureView backed by
 * MediaPlayer (zero extra deps). Used to render short mp4 "video-gif" clips fetched +
 * decrypted from Logos Storage. Composites like a normal view (TextureView, not a
 * z-ordered SurfaceView), so it sits inside a chat bubble cleanly.
 */
class MediaVideoView(context: Context) : TextureView(context), TextureView.SurfaceTextureListener {
  private var player: MediaPlayer? = null
  private var path: String? = null
  private var surface: Surface? = null

  init {
    surfaceTextureListener = this
  }

  fun setPath(p: String?) {
    if (p == path) return
    path = p
    if (surface != null) start()
  }

  private fun start() {
    release()
    val p = path ?: return
    val s = surface ?: return
    try {
      player = MediaPlayer().apply {
        setDataSource(p)
        setSurface(s)
        isLooping = true
        setVolume(0f, 0f) // video-gif: muted
        setOnPreparedListener { it.start() }
        setOnErrorListener { _, _, _ -> true }
        prepareAsync()
      }
    } catch (_: Throwable) {
      release()
    }
  }

  fun release() {
    player?.let {
      try {
        it.stop()
      } catch (_: Throwable) {}
      it.release()
    }
    player = null
  }

  override fun onSurfaceTextureAvailable(st: SurfaceTexture, w: Int, h: Int) {
    surface = Surface(st)
    if (path != null) start()
  }

  override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean {
    release()
    surface?.release()
    surface = null
    return true
  }

  override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, w: Int, h: Int) {}
  override fun onSurfaceTextureUpdated(st: SurfaceTexture) {}
}

/** RN bridge for {@link MediaVideoView}: `<MediaVideo path=... style=... />`. */
class MediaVideoViewManager(private val ctx: ReactApplicationContext) :
    SimpleViewManager<MediaVideoView>() {
  override fun getName() = "MediaVideo"

  override fun createViewInstance(reactContext: ThemedReactContext) = MediaVideoView(reactContext)

  @ReactProp(name = "path")
  fun setPath(view: MediaVideoView, path: String?) {
    view.setPath(path)
  }

  override fun onDropViewInstance(view: MediaVideoView) {
    super.onDropViewInstance(view)
    view.release()
  }
}
