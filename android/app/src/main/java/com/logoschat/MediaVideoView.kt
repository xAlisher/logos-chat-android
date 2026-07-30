package com.logoschat

import android.graphics.SurfaceTexture
import android.os.Handler
import android.os.Looper
import android.view.Surface
import android.view.TextureView
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.RCTEventEmitter
import android.media.MediaPlayer

/**
 * #300: inline + fullscreen video player (TextureView + MediaPlayer, zero deps).
 *   - Inline (in a chat bubble): muted, looping, auto-playing — a live preview.
 *   - Fullscreen: audio + JS-drawn controls (play/pause, seek, time). The controls
 *     live in RN (VideoFullscreen) because Android's floating MediaController popup is
 *     unreliable inside a RN Modal (touches get intercepted, popup auto-hides). The
 *     view emits onVideoLoad / onVideoProgress and accepts `paused` + a `seek` command.
 */
class MediaVideoView(private val reactCtx: ThemedReactContext) :
    TextureView(reactCtx), TextureView.SurfaceTextureListener {
  private var player: MediaPlayer? = null
  private var path: String? = null
  private var surface: Surface? = null
  private var muted = true
  private var reportProgress = false
  private var paused = false
  private var prepared = false

  private val handler = Handler(Looper.getMainLooper())
  private val ticker = object : Runnable {
    override fun run() {
      val p = player
      if (p != null && prepared) {
        try {
          emit("onVideoProgress", Arguments.createMap().apply {
            putDouble("currentTime", p.currentPosition.toDouble())
            putBoolean("isPlaying", p.isPlaying)
          })
        } catch (_: Throwable) {}
      }
      handler.postDelayed(this, 300)
    }
  }

  init {
    surfaceTextureListener = this
  }

  private fun emit(name: String, data: WritableMap) {
    try {
      reactCtx.getJSModule(RCTEventEmitter::class.java).receiveEvent(id, name, data)
    } catch (_: Throwable) {}
  }

  fun setPath(p: String?) {
    if (p == path) return
    path = p
    if (surface != null) openPlayer()
  }

  fun setMuted(m: Boolean) {
    muted = m
    if (prepared) player?.setVolume(if (m) 0f else 1f, if (m) 0f else 1f)
  }

  /** Fullscreen turns this on → the view emits progress and JS draws the controls. */
  fun setReportProgress(r: Boolean) {
    reportProgress = r
    handler.removeCallbacks(ticker)
    if (r) handler.post(ticker)
  }

  fun setPaused(p: Boolean) {
    paused = p
    if (!prepared) return
    if (p) player?.pause() else player?.start()
  }

  fun seekTo(ms: Int) {
    if (prepared) player?.seekTo(ms)
  }

  private fun openPlayer() {
    release()
    val p = path ?: return
    val s = surface ?: return
    try {
      player = MediaPlayer().apply {
        setDataSource(p)
        setSurface(s)
        isLooping = true
        setVolume(if (muted) 0f else 1f, if (muted) 0f else 1f)
        setOnPreparedListener {
          prepared = true
          emit("onVideoLoad", Arguments.createMap().apply {
            putDouble("duration", it.duration.toDouble())
          })
          if (paused) it.seekTo(1) else it.start()
        }
        setOnErrorListener { _, _, _ -> true }
        prepareAsync()
      }
    } catch (_: Throwable) {
      release()
    }
  }

  fun release() {
    prepared = false
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
    if (path != null) openPlayer()
  }

  override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean {
    handler.removeCallbacks(ticker)
    release()
    surface?.release()
    surface = null
    return true
  }

  override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, w: Int, h: Int) {}
  override fun onSurfaceTextureUpdated(st: SurfaceTexture) {}
}

/** RN bridge for {@link MediaVideoView}: `<MediaVideo path=... muted=... paused=... />`. */
class MediaVideoViewManager(private val ctx: ReactApplicationContext) :
    SimpleViewManager<MediaVideoView>() {
  override fun getName() = "MediaVideo"

  override fun createViewInstance(reactContext: ThemedReactContext) = MediaVideoView(reactContext)

  @ReactProp(name = "path")
  fun setPath(view: MediaVideoView, path: String?) = view.setPath(path)

  @ReactProp(name = "muted", defaultBoolean = true)
  fun setMuted(view: MediaVideoView, muted: Boolean) = view.setMuted(muted)

  /** `controls=true` (fullscreen) makes the view report progress for JS-drawn controls. */
  @ReactProp(name = "controls", defaultBoolean = false)
  fun setControls(view: MediaVideoView, controls: Boolean) = view.setReportProgress(controls)

  @ReactProp(name = "paused", defaultBoolean = false)
  fun setPaused(view: MediaVideoView, paused: Boolean) = view.setPaused(paused)

  override fun getExportedCustomDirectEventTypeConstants(): Map<String, Any> =
      mapOf(
          "onVideoLoad" to mapOf("registrationName" to "onVideoLoad"),
          "onVideoProgress" to mapOf("registrationName" to "onVideoProgress"),
      )

  override fun receiveCommand(view: MediaVideoView, commandId: String?, args: ReadableArray?) {
    when (commandId) {
      "seek" -> if (args != null && args.size() > 0) view.seekTo(args.getInt(0))
    }
  }

  override fun onDropViewInstance(view: MediaVideoView) {
    super.onDropViewInstance(view)
    view.release()
  }
}
