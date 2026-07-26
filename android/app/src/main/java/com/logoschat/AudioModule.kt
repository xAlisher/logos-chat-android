package com.logoschat

import android.Manifest
import android.content.pm.PackageManager
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.util.Base64
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.security.MessageDigest
import org.json.JSONArray
import org.json.JSONObject

/**
 * AudioRecorder — voice-note capture + playback for the chat composer. Pure
 * Android (MediaRecorder / MediaPlayer), NO Rust / FFI: a voice note is recorded
 * to a small AAC/.m4a file, returned as base64 so it can ride the chat wire as an
 * attachment envelope (same shape as the image path — see [ImagePickerModule]),
 * then persisted content-addressed for local playback.
 *
 * Format mirrors legacy Status (status-mobile) voice notes: **AAC, mono**, a
 * voice-sized bitrate, and a hard duration cap. Status used AAC / mono / 22050 Hz
 * / 32 kbps via `@react-native-community/audio-toolkit`, with
 * `max-audio-duration-ms = 120000` (2 minutes). We keep the AAC/mono shape and the
 * 120 s cap, but drop the sample rate to 16 kHz @ ~24 kbps (voice is intelligible
 * far below music rates, and this keeps the base64 payload small enough to chunk
 * onto the chat wire). Like Status we poll the recorder's metering
 * (`getMaxAmplitude`) to build a compact amplitude waveform for the message bubble.
 *
 * Threading: all recorder + player state is confined to one dedicated
 * [HandlerThread] ("audio-recorder"); public @ReactMethods post onto it (same
 * single-thread discipline as [MeshCoreModule]). [saveBase64Audio] runs its own
 * worker thread for the decode+SHA-256+write (matching [ImagePickerModule]).
 *
 * Events (DeviceEventEmitter channel "AudioRecorderEvent", each with `eventType`):
 *   - {eventType:"maxDuration"}   — the 120 s cap was hit; recording was
 *                                    auto-finalized, so the UI should flip to the
 *                                    review/send state and call [stopRecording] to
 *                                    collect the already-captured note.
 *   - {eventType:"playbackEnded"} — a [playFile] playback finished on its own.
 *
 * TODO(manifest): recording needs RECORD_AUDIO in AndroidManifest.xml (another
 *   agent owns app wiring; not edited here). Runtime *requesting* belongs in the
 *   JS/UI layer; this module only checks the grant and rejects "permission" if
 *   it is missing.
 */
class AudioModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  companion object {
    private const val TAG = "audio-recorder"
    private const val JS_EVENT = "AudioRecorderEvent"

    // Recording format (voice-sized AAC, cf. Status status-mobile audio-toolkit).
    private const val SAMPLE_RATE = 16_000
    private const val BIT_RATE = 24_000
    private const val CHANNELS = 1

    // Hard duration cap — Status's `max-audio-duration-ms` (2 minutes).
    private const val MAX_DURATION_MS = 120_000L
    // Amplitude polling cadence for the waveform (Status metered every 25-50 ms;
    // 100 ms is plenty for a 40-point bar waveform and lighter on the main pipe).
    private const val POLL_INTERVAL_MS = 100L
    // Compact waveform: ~40 evenly-sampled bars, each normalised to 0..100.
    private const val WAVEFORM_POINTS = 40

    private const val MIME = "audio/mp4"
  }

  override fun getName() = "AudioRecorder"

  // All recorder + player state below is confined to [handler]'s thread.
  private val handlerThread = HandlerThread("audio-recorder").apply { start() }
  private val handler = Handler(handlerThread.looper)

  private var recorder: MediaRecorder? = null
  private var outputFile: File? = null
  private var player: MediaPlayer? = null

  /** Raw `getMaxAmplitude()` samples (one per poll), collapsed to a waveform at stop. */
  private val rawAmplitudes = ArrayList<Int>()
  private var startTimeMs: Long = 0L
  private var recordedDurationMs: Long = 0L

  /** True between start and finalize. */
  private var recording = false
  /** True once the recorder has been stopped+released and its file is ready to read. */
  private var finalized = false

  // ==========================================================================
  //  Public @ReactMethods
  // ==========================================================================

  /**
   * Begin recording a voice note to a temp AAC/.m4a file under cacheDir. Resolves
   * null once capture has started. Rejects "permission" if RECORD_AUDIO is not
   * granted, "busy" if a recording is already in progress, or "start_failed" on a
   * MediaRecorder error. Auto-stops (and emits {eventType:"maxDuration"}) at the
   * 120 s cap — the captured note is then collectable via [stopRecording].
   */
  @ReactMethod
  fun startRecording(promise: Promise) {
    handler.post {
      if (recording) {
        promise.reject("busy", "a recording is already in progress")
        return@post
      }
      if (!hasRecordPermission()) {
        promise.reject("permission", "RECORD_AUDIO not granted (see manifest TODO)")
        return@post
      }
      val ctx = reactApplicationContext
      val out = File(ctx.cacheDir, "rec-${System.currentTimeMillis()}.m4a")
      val rec =
          try {
            @Suppress("DEPRECATION")
            val r =
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(ctx)
                else MediaRecorder()
            r.setAudioSource(MediaRecorder.AudioSource.MIC)
            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            r.setAudioChannels(CHANNELS)
            r.setAudioSamplingRate(SAMPLE_RATE)
            r.setAudioEncodingBitRate(BIT_RATE)
            r.setOutputFile(out.absolutePath)
            r.prepare()
            r.start()
            r
          } catch (t: Throwable) {
            Log.w(TAG, "start failed", t)
            try {
              out.delete()
            } catch (_: Throwable) {}
            promise.reject("start_failed", t.message ?: "could not start recording")
            return@post
          }
      recorder = rec
      outputFile = out
      rawAmplitudes.clear()
      startTimeMs = System.currentTimeMillis()
      recordedDurationMs = 0L
      recording = true
      finalized = false
      handler.postDelayed(pollRunnable, POLL_INTERVAL_MS)
      promise.resolve(null)
    }
  }

  /**
   * Stop recording and resolve a STRINGIFIED JSON note:
   *   {"base64":<m4a bytes, NO_WRAP>, "durationMs":<int>, "mime":"audio/mp4",
   *    "waveform":[<0..100 ints>]}.
   * Tolerant of the auto-stop at the cap (recording already finalized). Rejects
   * "not_recording" if nothing was captured, or "empty" if the file is unusable
   * (e.g. a tap too short to encode a frame). The temp cache file is deleted after
   * the bytes are read — persist via [saveBase64Audio].
   */
  @ReactMethod
  fun stopRecording(promise: Promise) {
    handler.post {
      if (!recording && !finalized) {
        promise.reject("not_recording", "no recording in progress")
        return@post
      }
      if (recording) finalizeRecorder()
      val file = outputFile
      if (file == null || !file.exists() || file.length() == 0L) {
        cleanupRecording(deleteFile = true)
        promise.reject("empty", "no audio was captured")
        return@post
      }
      try {
        val bytes = file.readBytes()
        val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
        val waveform = buildWaveform(rawAmplitudes, WAVEFORM_POINTS)
        val json =
            JSONObject()
                .put("base64", b64)
                .put("durationMs", recordedDurationMs)
                .put("mime", MIME)
                .put("waveform", JSONArray(waveform))
                .toString()
        promise.resolve(json)
      } catch (t: Throwable) {
        Log.w(TAG, "read failed", t)
        promise.reject("read_failed", t.message ?: "could not read recording")
      } finally {
        cleanupRecording(deleteFile = true)
      }
    }
  }

  /**
   * Abort the current recording and delete its temp file. Resolves null (a no-op
   * if nothing is recording).
   */
  @ReactMethod
  fun cancelRecording(promise: Promise) {
    handler.post {
      if (recording) finalizeRecorder()
      cleanupRecording(deleteFile = true)
      promise.resolve(null)
    }
  }

  /**
   * Persist a base64 AAC/.m4a payload content-addressed as `SHA256(bytes).m4a`
   * under filesDir/chat-audio, and resolve its absolute path. Content-addressing
   * dedupes identical notes and lets a bubble render from a file rather than a
   * giant base64 string held in JS (cf. [ImagePickerModule.saveBase64Jpeg]).
   */
  @ReactMethod
  fun saveBase64Audio(base64: String, promise: Promise) {
    Thread {
          try {
            val bytes = Base64.decode(base64, Base64.DEFAULT)
            val dir = File(reactApplicationContext.filesDir, "chat-audio")
            if (!dir.exists()) dir.mkdirs()
            val name = MessageDigest.getInstance("SHA-256").digest(bytes).toHex() + ".m4a"
            val file = File(dir, name)
            if (!file.exists()) file.writeBytes(bytes)
            promise.resolve(file.absolutePath)
          } catch (t: Throwable) {
            Log.w(TAG, "save failed", t)
            promise.reject("save_failed", t.message ?: "could not save audio")
          }
        }
        .start()
  }

  /**
   * Play the AAC/.m4a file at [path] (stopping any current playback first).
   * Resolves null once playback has started (prepared asynchronously); emits
   * {eventType:"playbackEnded"} when it finishes on its own.
   */
  @ReactMethod
  fun playFile(path: String, promise: Promise) {
    handler.post {
      stopPlayerInternal()
      try {
        val mp = MediaPlayer()
        mp.setDataSource(path)
        mp.setOnPreparedListener { it.start() }
        mp.setOnCompletionListener {
          handler.post {
            stopPlayerInternal()
            emit("playbackEnded")
          }
        }
        mp.setOnErrorListener { _, what, extra ->
          Log.w(TAG, "playback error what=$what extra=$extra")
          handler.post { stopPlayerInternal() }
          true
        }
        mp.prepareAsync()
        player = mp
        promise.resolve(null)
      } catch (t: Throwable) {
        Log.w(TAG, "play failed", t)
        stopPlayerInternal()
        promise.reject("play_failed", t.message ?: "could not play audio")
      }
    }
  }

  /** Stop any current playback. Resolves null. */
  @ReactMethod
  fun stopPlaying(promise: Promise) {
    handler.post {
      stopPlayerInternal()
      promise.resolve(null)
    }
  }

  // Required by the RN event-emitter contract; events flow via DeviceEventEmitter.
  @ReactMethod fun addListener(eventName: String) { /* no-op */ }

  @ReactMethod fun removeListeners(count: Double) { /* no-op */ }

  // ==========================================================================
  //  Recording mechanics (all on [handler]'s thread)
  // ==========================================================================

  /** Poll `getMaxAmplitude()` into the waveform buffer; auto-stop at the cap. */
  private val pollRunnable =
      object : Runnable {
        override fun run() {
          val rec = recorder ?: return
          try {
            rawAmplitudes.add(rec.maxAmplitude)
          } catch (t: Throwable) {
            Log.w(TAG, "getMaxAmplitude: ${t.message}")
          }
          if (System.currentTimeMillis() - startTimeMs >= MAX_DURATION_MS) {
            finalizeRecorder()
            emit("maxDuration")
            return
          }
          handler.postDelayed(this, POLL_INTERVAL_MS)
        }
      }

  /** Stop + release the recorder, freezing [recordedDurationMs]. Leaves the file
   *  and waveform intact for [stopRecording] to consume. */
  private fun finalizeRecorder() {
    handler.removeCallbacks(pollRunnable)
    recordedDurationMs =
        (System.currentTimeMillis() - startTimeMs).coerceIn(0L, MAX_DURATION_MS)
    val rec = recorder
    recorder = null
    recording = false
    finalized = true
    if (rec != null) {
      try {
        rec.stop()
      } catch (t: Throwable) {
        // stop() throws if the clip was too short to encode a frame; the file is
        // then likely 0 bytes, which stopRecording detects and rejects "empty".
        Log.w(TAG, "stop: ${t.message}")
      }
      try {
        rec.release()
      } catch (t: Throwable) {
        Log.w(TAG, "release: ${t.message}")
      }
    }
  }

  private fun cleanupRecording(deleteFile: Boolean) {
    handler.removeCallbacks(pollRunnable)
    if (deleteFile) {
      try {
        outputFile?.delete()
      } catch (_: Throwable) {}
    }
    outputFile = null
    rawAmplitudes.clear()
    recording = false
    finalized = false
    recordedDurationMs = 0L
  }

  /**
   * Collapse raw amplitude samples into [points] bars normalised to 0..100.
   * Buckets the samples evenly and averages each bucket, then scales by the peak
   * amplitude so the waveform uses the full 0..100 range regardless of mic gain.
   */
  private fun buildWaveform(raw: List<Int>, points: Int): List<Int> {
    if (raw.isEmpty()) return List(points) { 0 }
    val peak = raw.maxOrNull() ?: 0
    val n = raw.size
    val out = ArrayList<Int>(points)
    for (i in 0 until points) {
      val start = (i.toLong() * n / points).toInt()
      val end = ((i + 1).toLong() * n / points).toInt()
      val avg =
          if (end <= start) {
            raw[start.coerceIn(0, n - 1)]
          } else {
            var sum = 0L
            for (j in start until end) sum += raw[j]
            (sum / (end - start)).toInt()
          }
      out.add(if (peak > 0) ((avg * 100) / peak).coerceIn(0, 100) else 0)
    }
    return out
  }

  // ==========================================================================
  //  Playback + helpers
  // ==========================================================================

  private fun stopPlayerInternal() {
    val mp = player ?: return
    player = null
    try {
      if (mp.isPlaying) mp.stop()
    } catch (t: Throwable) {
      Log.w(TAG, "player stop: ${t.message}")
    }
    try {
      mp.release()
    } catch (t: Throwable) {
      Log.w(TAG, "player release: ${t.message}")
    }
  }

  private fun hasRecordPermission(): Boolean =
      ContextCompat.checkSelfPermission(
          reactApplicationContext, Manifest.permission.RECORD_AUDIO) ==
          PackageManager.PERMISSION_GRANTED

  private fun emit(eventType: String) {
    val params: WritableMap = Arguments.createMap().apply { putString("eventType", eventType) }
    val ctx = reactApplicationContext
    if (!ctx.hasActiveReactInstance()) {
      Log.w(TAG, "JS not alive; event '$eventType' dropped")
      return
    }
    ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(JS_EVENT, params)
  }

  private fun ByteArray.toHex(): String {
    val sb = StringBuilder(size * 2)
    for (b in this) {
      val v = b.toInt() and 0xFF
      sb.append("0123456789abcdef"[v ushr 4])
      sb.append("0123456789abcdef"[v and 0x0F])
    }
    return sb.toString()
  }
}
