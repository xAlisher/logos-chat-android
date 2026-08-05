package com.logoschat

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.media.MediaMuxer
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLSurface
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.util.Log
import android.view.Surface
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.Arguments
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.util.concurrent.Executors

/**
 * #305: on-device video compression. Re-encodes a picked clip to H.264 at ~720p and a modest
 * bitrate (audio passed through untouched), so real phone videos fit a sane upload budget instead
 * of being rejected at 8MB. Pure MediaCodec + GL (no third-party deps): decoder renders each frame
 * to a SurfaceTexture, a tiny GL program draws it onto the encoder's input Surface (this is what
 * lets us downscale), the encoder emits H.264, and a MediaMuxer writes the MP4. Progress is emitted
 * as `mediaProgress` device events keyed by the caller's [id] so #308 can drive the "compressing"
 * ring.
 */
class VideoTranscoder(private val ctx: ReactApplicationContext) :
    ReactContextBaseJavaModule(ctx) {
  override fun getName() = "VideoTranscoder"

  private companion object {
    const val TAG = "VideoTranscoder"
    const val OUTPUT_MIME = "video/avc"
    const val MAX_LONG_SIDE = 1280 // 720p-class
    const val FRAME_RATE = 30
    const val IFRAME_INTERVAL = 2
    const val TIMEOUT_US = 10_000L
  }

  // #385: bound media processing. Every transcode runs on ONE background thread — concurrent
  // requests queue rather than each spawning its own MediaCodec encode session (unbounded before
  // → OOM/codec exhaustion on weak phones under rapid picks). Daemon + below-normal priority so it
  // never keeps the process alive on its own nor starves the UI.
  private val transcodeExecutor = Executors.newSingleThreadExecutor { r ->
    Thread(r, "logoschat-transcode").apply {
      isDaemon = true
      priority = Thread.NORM_PRIORITY - 1
    }
  }
  private val gate = TranscodeGate()

  /** Thrown from [doTranscode] when [gate] reports the id was cancelled mid-encode. */
  private class TranscodeCancelled : Exception()

  override fun invalidate() {
    transcodeExecutor.shutdownNow()
    super.invalidate()
  }

  private fun emitProgress(id: String, progress: Double) {
    val map: WritableMap = Arguments.createMap().apply {
      putString("id", id)
      putString("phase", "compressing")
      putDouble("progress", progress.coerceIn(0.0, 1.0))
    }
    try {
      ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit("mediaProgress", map)
    } catch (_: Throwable) {}
  }

  /**
   * Transcode [inputPath] → an MP4 in the cache dir. Resolves {path, width, height} (display dims,
   * rotation-aware). On any failure resolves {path: inputPath, skipped: true} so the caller can
   * still send the original rather than blocking the user.
   */
  @ReactMethod
  fun transcode(inputPath: String, id: String, promise: Promise) {
    // #385: admit the id BEFORE queueing, on this thread — a cancel that lands while the job is
    // still behind another transcode must be seen by the worker, and a cancel for an id that is
    // not admitted (already finished / never started) must stay a no-op.
    gate.begin(id)
    transcodeExecutor.execute {
      // Cancelled while still queued behind another transcode → skip before opening any codec.
      if (gate.isCancelled(id)) {
        gate.clear(id)
        promise.resolve(cancelledResult(inputPath))
        return@execute
      }
      val outFile = File(ctx.cacheDir, "media-out/enc_${System.currentTimeMillis()}.mp4")
      outFile.parentFile?.mkdirs()
      try {
        val dims = doTranscode(inputPath, outFile.absolutePath, id)
        val out = Arguments.createMap().apply {
          putString("path", outFile.absolutePath)
          putInt("width", dims[0])
          putInt("height", dims[1])
        }
        promise.resolve(out)
      } catch (c: TranscodeCancelled) {
        Log.i(TAG, "transcode cancelled: $id")
        outFile.delete() // discard the partial output
        promise.resolve(cancelledResult(inputPath))
      } catch (t: Throwable) {
        Log.w(TAG, "transcode failed, sending original", t)
        outFile.delete()
        // graceful fallback: upload the original untouched
        promise.resolve(skippedResult(inputPath))
      } finally {
        // Retire the id: it is no longer live, so a late cancel for it is a no-op and a future
        // transcode reusing the id is never pre-skipped.
        gate.clear(id)
      }
    }
  }

  /** #385: cancel a queued or in-flight transcode by [id]. No-op if there is no such transcode. */
  @ReactMethod
  fun cancelTranscode(id: String) {
    gate.requestCancel(id)
  }

  private fun cancelledResult(inputPath: String): WritableMap =
      Arguments.createMap().apply {
        putString("path", inputPath)
        putBoolean("skipped", true)
        putBoolean("cancelled", true)
      }

  private fun skippedResult(inputPath: String): WritableMap =
      Arguments.createMap().apply {
        putString("path", inputPath)
        putBoolean("skipped", true)
      }

  /** @return [displayWidth, displayHeight] */
  private fun doTranscode(inputPath: String, outputPath: String, id: String): IntArray {
    val retr = MediaMetadataRetriever()
    var rotation = 0
    var durationUs = 0L
    var codedW: Int
    var codedH: Int
    try {
      retr.setDataSource(inputPath)
      rotation = retr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
      durationUs = (retr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L) * 1000L
      codedW = retr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
      codedH = retr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
    } finally {
      retr.release()
    }
    require(codedW > 0 && codedH > 0) { "no video dimensions" }

    // #311: work in DISPLAY orientation and BAKE the rotation into the pixels (rotate in GL),
    // so the output is a plain upright clip (orientation hint 0). Encoding coded dims + a hint
    // stretched the video because our player (TextureView) doesn't apply the hint.
    val portrait = rotation == 90 || rotation == 270
    val displayW = if (portrait) codedH else codedW
    val displayH = if (portrait) codedW else codedH
    // Target display size: scale longest side to MAX_LONG_SIDE, keep AR, force even dims.
    val scale = minOf(1.0, MAX_LONG_SIDE.toDouble() / maxOf(displayW, displayH))
    val targetW = (displayW * scale).toInt().let { if (it % 2 == 0) it else it - 1 }.coerceAtLeast(2)
    val targetH = (displayH * scale).toInt().let { if (it % 2 == 0) it else it - 1 }.coerceAtLeast(2)
    val bitrate = (targetW.toLong() * targetH * 4).toInt().coerceIn(600_000, 4_000_000)
    Log.i(TAG, "GEOM coded=${codedW}x${codedH} rot=$rotation display=${displayW}x${displayH} target=${targetW}x${targetH}")

    // #385: hold every native resource in nullable vars and release them in a single `finally`,
    // so a mid-encode throw — a decode error OR a cancellation — never leaks a MediaCodec/muxer
    // (the old code released only on the success path).
    val extractor = MediaExtractor()
    var encoderRef: MediaCodec? = null
    var decoderRef: MediaCodec? = null
    var glSurfaceRef: EglSurface? = null
    var muxerRef: MediaMuxer? = null
    try {
    extractor.setDataSource(inputPath)
    val videoTrack = firstTrack(extractor, "video/")
    val audioTrack = firstTrack(extractor, "audio/")
    require(videoTrack >= 0) { "no video track" }
    val inFormat = extractor.getTrackFormat(videoTrack)

    // Encoder → its input Surface (the GL target).
    val encFormat = MediaFormat.createVideoFormat(OUTPUT_MIME, targetW, targetH).apply {
      setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
      setInteger(MediaFormat.KEY_BIT_RATE, bitrate)
      setInteger(MediaFormat.KEY_FRAME_RATE, FRAME_RATE)
      setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, IFRAME_INTERVAL)
    }
    val encoder = MediaCodec.createEncoderByType(OUTPUT_MIME).also { encoderRef = it }
    encoder.configure(encFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    // #311: the decoder applies the source rotation itself when rendering to a Surface, so the
    // frames arriving in our SurfaceTexture are ALREADY display-oriented → draw straight (0),
    // don't rotate again. We only need to size the encoder to DISPLAY dims (above).
    val glSurface = EglSurface(encoder.createInputSurface(), 0).also { glSurfaceRef = it }
    encoder.start()

    // Decoder → renders onto the GL SurfaceTexture.
    val decoder =
        MediaCodec.createDecoderByType(inFormat.getString(MediaFormat.KEY_MIME)!!)
            .also { decoderRef = it }
    decoder.configure(inFormat, glSurface.decoderSurface, null, 0)
    decoder.start()
    extractor.selectTrack(videoTrack)

    // #311: rotation is baked into the pixels below → output is upright, no hint.
    val muxer =
        MediaMuxer(outputPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            .also { muxerRef = it }

    var muxerStarted = false
    var muxVideoIdx = -1
    var muxAudioIdx = -1
    val bufInfo = MediaCodec.BufferInfo()

    var inputDone = false
    var decodeDone = false
    var encodeDone = false
    var lastPct = -1 // #308: only emit on a whole-percent change (throttle bridge spam)

    while (!encodeDone) {
      // #385: honour a cancellation between frames — bail out cleanly (finally releases codecs;
      // the caller deletes the partial file).
      if (gate.isCancelled(id)) throw TranscodeCancelled()
      // 1) feed decoder from the extractor
      if (!inputDone) {
        val inIdx = decoder.dequeueInputBuffer(TIMEOUT_US)
        if (inIdx >= 0) {
          val buf = decoder.getInputBuffer(inIdx)!!
          val sz = extractor.readSampleData(buf, 0)
          if (sz < 0) {
            decoder.queueInputBuffer(inIdx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
            inputDone = true
          } else {
            decoder.queueInputBuffer(inIdx, 0, sz, extractor.sampleTime, 0)
            extractor.advance()
          }
        }
      }

      // 2) drain decoder → render to encoder surface
      if (!decodeDone) {
        val outIdx = decoder.dequeueOutputBuffer(bufInfo, TIMEOUT_US)
        if (outIdx >= 0) {
          val eos = bufInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
          val render = bufInfo.size != 0
          decoder.releaseOutputBuffer(outIdx, render)
          if (render) {
            glSurface.awaitNewImage()
            glSurface.drawImage()
            glSurface.setPresentationTime(bufInfo.presentationTimeUs * 1000L)
            glSurface.swapBuffers()
            if (durationUs > 0) {
              val pct = ((bufInfo.presentationTimeUs.toDouble() / durationUs) * 100).toInt()
              if (pct > lastPct) {
                lastPct = pct
                emitProgress(id, pct / 100.0)
              }
            }
          }
          if (eos) {
            decodeDone = true
            encoder.signalEndOfInputStream()
          }
        }
      }

      // 3) drain encoder → muxer
      var encOut = encoder.dequeueOutputBuffer(bufInfo, TIMEOUT_US)
      while (encOut >= 0) {
        val data = encoder.getOutputBuffer(encOut)!!
        if (bufInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) bufInfo.size = 0
        if (bufInfo.size > 0 && muxerStarted) {
          data.position(bufInfo.offset)
          data.limit(bufInfo.offset + bufInfo.size)
          muxer.writeSampleData(muxVideoIdx, data, bufInfo)
        }
        val eos = bufInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
        encoder.releaseOutputBuffer(encOut, false)
        if (eos) { encodeDone = true; break }
        encOut = encoder.dequeueOutputBuffer(bufInfo, TIMEOUT_US)
      }
      if (encOut == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED && !muxerStarted) {
        muxVideoIdx = muxer.addTrack(encoder.outputFormat)
        if (audioTrack >= 0) muxAudioIdx = muxer.addTrack(extractor.getTrackFormat(audioTrack))
        muxer.start()
        muxerStarted = true
      }
    }

    // audio passthrough (copy compressed audio samples verbatim)
    if (audioTrack >= 0 && muxAudioIdx >= 0) {
      copyAudio(inputPath, audioTrack, muxer, muxAudioIdx)
    }

    emitProgress(id, 1.0)
    // Output is already display-oriented (rotation baked in) → dims are the marker AR.
    return intArrayOf(targetW, targetH)
    } finally {
      // #385: release native resources on EVERY exit — success, decode error, or cancellation —
      // so a bounded, serialized pipeline never leaks a MediaCodec/muxer handle. Each guarded
      // independently; muxer.stop() throws if it was never started (cancel before first frame).
      try { decoderRef?.stop() } catch (_: Throwable) {}
      try { decoderRef?.release() } catch (_: Throwable) {}
      try { encoderRef?.stop() } catch (_: Throwable) {}
      try { encoderRef?.release() } catch (_: Throwable) {}
      try { glSurfaceRef?.release() } catch (_: Throwable) {}
      try { muxerRef?.stop() } catch (_: Throwable) {}
      try { muxerRef?.release() } catch (_: Throwable) {}
      try { extractor.release() } catch (_: Throwable) {}
    }
  }

  private fun copyAudio(path: String, track: Int, muxer: MediaMuxer, muxIdx: Int) {
    val ex = MediaExtractor()
    try {
      ex.setDataSource(path)
      ex.selectTrack(track)
      val fmt = ex.getTrackFormat(track)
      val maxIn = if (fmt.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE))
        fmt.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE) else 256 * 1024
      val buf = ByteBuffer.allocate(maxIn)
      val info = MediaCodec.BufferInfo()
      while (true) {
        val sz = ex.readSampleData(buf, 0)
        if (sz < 0) break
        info.offset = 0
        info.size = sz
        info.presentationTimeUs = ex.sampleTime
        info.flags = if (ex.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0)
          MediaCodec.BUFFER_FLAG_KEY_FRAME else 0
        muxer.writeSampleData(muxIdx, buf, info)
        ex.advance()
      }
    } finally {
      ex.release()
    }
  }

  private fun firstTrack(ex: MediaExtractor, prefix: String): Int {
    for (i in 0 until ex.trackCount) {
      val m = ex.getTrackFormat(i).getString(MediaFormat.KEY_MIME) ?: continue
      if (m.startsWith(prefix)) return i
    }
    return -1
  }

  // ── minimal EGL/GL bridge: decoder SurfaceTexture → encoder input Surface ──
  private class EglSurface(encoderSurface: Surface, private val rotationDeg: Int) {
    private val display: EGLDisplay
    private val context: EGLContext
    private val eglSurface: EGLSurface
    val decoderSurface: Surface
    private val surfaceTexture: android.graphics.SurfaceTexture
    private val lock = Object()
    private var frameAvailable = false
    private val texId: Int
    private val program: Int
    private val stMatrix = FloatArray(16)
    private val aPos: Int
    private val aTex: Int
    private val uMatrix: Int
    private val vertexBuf: FloatBuffer

    init {
      display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
      val ver = IntArray(2)
      EGL14.eglInitialize(display, ver, 0, ver, 1)
      val attribs = intArrayOf(
          EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8,
          EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
          0x3142 /* EGL_RECORDABLE_ANDROID */, 1,
          EGL14.EGL_NONE)
      val configs = arrayOfNulls<EGLConfig>(1)
      val n = IntArray(1)
      EGL14.eglChooseConfig(display, attribs, 0, configs, 0, 1, n, 0)
      context = EGL14.eglCreateContext(display, configs[0], EGL14.EGL_NO_CONTEXT,
          intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE), 0)
      eglSurface = EGL14.eglCreateWindowSurface(display, configs[0], encoderSurface,
          intArrayOf(EGL14.EGL_NONE), 0)
      EGL14.eglMakeCurrent(display, eglSurface, eglSurface, context)

      // external-OES texture + SurfaceTexture the decoder renders into
      val tex = IntArray(1)
      GLES20.glGenTextures(1, tex, 0)
      texId = tex[0]
      GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, texId)
      GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
      GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
      GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
      GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
      surfaceTexture = android.graphics.SurfaceTexture(texId)
      surfaceTexture.setOnFrameAvailableListener {
        synchronized(lock) { frameAvailable = true; lock.notifyAll() }
      }
      decoderSurface = Surface(surfaceTexture)

      // full-screen quad + OES sampler shader
      program = buildProgram()
      aPos = GLES20.glGetAttribLocation(program, "aPosition")
      aTex = GLES20.glGetAttribLocation(program, "aTexCoord")
      uMatrix = GLES20.glGetUniformLocation(program, "uSTMatrix")
      // #311: bake the source rotation into the pixels by PERMUTING the quad's texcoords
      // (unambiguous — no matrix math fighting the OES flip). Corners: BL, BR, TL, TR.
      val tc = when (((rotationDeg % 360) + 360) % 360) {
        90 -> floatArrayOf(1f, 0f, 1f, 1f, 0f, 0f, 0f, 1f)
        180 -> floatArrayOf(1f, 1f, 0f, 1f, 1f, 0f, 0f, 0f)
        270 -> floatArrayOf(0f, 1f, 0f, 0f, 1f, 1f, 1f, 0f)
        else -> floatArrayOf(0f, 0f, 1f, 0f, 0f, 1f, 1f, 1f)
      }
      val verts = floatArrayOf(
          -1f, -1f, tc[0], tc[1],
           1f, -1f, tc[2], tc[3],
          -1f,  1f, tc[4], tc[5],
           1f,  1f, tc[6], tc[7])
      vertexBuf = ByteBuffer.allocateDirect(verts.size * 4).order(ByteOrder.nativeOrder())
          .asFloatBuffer().apply { put(verts); position(0) }
    }

    fun awaitNewImage() {
      synchronized(lock) {
        val end = System.currentTimeMillis() + 2500
        while (!frameAvailable) {
          val wait = end - System.currentTimeMillis()
          if (wait <= 0) throw RuntimeException("frame wait timeout")
          lock.wait(wait)
        }
        frameAvailable = false
      }
      surfaceTexture.updateTexImage()
      surfaceTexture.getTransformMatrix(stMatrix)
    }

    fun drawImage() {
      GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
      GLES20.glUseProgram(program)
      GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
      GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, texId)
      vertexBuf.position(0)
      GLES20.glVertexAttribPointer(aPos, 2, GLES20.GL_FLOAT, false, 16, vertexBuf)
      GLES20.glEnableVertexAttribArray(aPos)
      vertexBuf.position(2)
      GLES20.glVertexAttribPointer(aTex, 2, GLES20.GL_FLOAT, false, 16, vertexBuf)
      GLES20.glEnableVertexAttribArray(aTex)
      GLES20.glUniformMatrix4fv(uMatrix, 1, false, stMatrix, 0)
      GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
      GLES20.glFinish()
    }

    fun setPresentationTime(nsecs: Long) {
      android.opengl.EGLExt.eglPresentationTimeANDROID(display, eglSurface, nsecs)
    }

    fun swapBuffers() {
      EGL14.eglSwapBuffers(display, eglSurface)
    }

    fun release() {
      try { decoderSurface.release() } catch (_: Throwable) {}
      try { surfaceTexture.release() } catch (_: Throwable) {}
      try { EGL14.eglDestroySurface(display, eglSurface) } catch (_: Throwable) {}
      try { EGL14.eglDestroyContext(display, context) } catch (_: Throwable) {}
    }

    private fun buildProgram(): Int {
      val vs = """
        attribute vec4 aPosition;
        attribute vec4 aTexCoord;
        uniform mat4 uSTMatrix;
        varying vec2 vTexCoord;
        void main() {
          gl_Position = aPosition;
          vTexCoord = (uSTMatrix * aTexCoord).xy;
        }
      """.trimIndent()
      val fs = """
        #extension GL_OES_EGL_image_external : require
        precision mediump float;
        varying vec2 vTexCoord;
        uniform samplerExternalOES sTexture;
        void main() { gl_FragColor = texture2D(sTexture, vTexCoord); }
      """.trimIndent()
      val v = compile(GLES20.GL_VERTEX_SHADER, vs)
      val f = compile(GLES20.GL_FRAGMENT_SHADER, fs)
      val p = GLES20.glCreateProgram()
      GLES20.glAttachShader(p, v)
      GLES20.glAttachShader(p, f)
      GLES20.glLinkProgram(p)
      return p
    }

    private fun compile(type: Int, src: String): Int {
      val s = GLES20.glCreateShader(type)
      GLES20.glShaderSource(s, src)
      GLES20.glCompileShader(s)
      return s
    }
  }
}
