package com.logoschat

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import androidx.core.content.FileProvider
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.ByteArrayOutputStream
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

/**
 * ImagePicker — lets the user pick an image from the gallery and returns it
 * already DOWNSCALED + JPEG-recompressed, as base64, so the JS side never touches
 * a multi-megabyte original. The resize/compress lives here (Kotlin BitmapFactory)
 * because that is the only place we can bound the payload before it enters the
 * chat wire, which sends UTF-8 text only (image attachments ride as a base64
 * `img1:` envelope, chunked under the message-size cap — see chatStore).
 *
 * Pure Android — no Rust/FFI. Uses ACTION_GET_CONTENT + the ActivityEventListener
 * result path (dispatched by ReactActivityDelegate), matching the app's
 * dependency-free native-module style (cf. the FileProvider export in
 * LogosChatModule).
 */
class ImagePickerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), ActivityEventListener {

  companion object {
    private const val TAG = "image-picker"
    private const val REQ_PICK = 0xC0DE
    private const val REQ_MULTI = 0xC0DF
    private const val REQ_CAPTURE = 0xC0E0
  }

  init {
    reactContext.addActivityEventListener(this)
  }

  override fun getName() = "ImagePicker"

  @Volatile private var pending: Promise? = null
  @Volatile private var pendingMaxDim = 1280
  @Volatile private var pendingBudget = 120_000
  @Volatile private var pendingMaxCount = 10
  @Volatile private var pendingCaptureUri: Uri? = null

  /**
   * Open the system image picker. Resolves a stringified JSON
   * {mime, width, height, base64, byteLength} for the downscaled JPEG, or null if
   * the user cancelled. [maxDim] caps the longest edge; [budgetBytes] is the
   * target JPEG size — quality is stepped down (and the image scaled) to land
   * under it, so the base64 fits one chat message (see #197).
   */
  @ReactMethod
  fun pickImage(maxDim: Int, budgetBytes: Int, promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("no_activity", "no foreground activity")
      return
    }
    if (pending != null) {
      promise.reject("busy", "a pick is already in progress")
      return
    }
    pending = promise
    pendingMaxDim = if (maxDim > 0) maxDim else 1280
    pendingBudget = if (budgetBytes > 0) budgetBytes else 120_000
    try {
      val intent =
          Intent(Intent.ACTION_GET_CONTENT).apply {
            type = "image/*"
            addCategory(Intent.CATEGORY_OPENABLE)
          }
      activity.startActivityForResult(
          Intent.createChooser(intent, "Choose an image"), REQ_PICK)
    } catch (t: Throwable) {
      pending = null
      promise.reject("launch_failed", t.message ?: "could not open picker")
    }
  }

  /**
   * #207: pick MULTIPLE images (an album). Resolves a stringified JSON ARRAY of
   * {mime,width,height,base64,byteLength}, capped to [maxCount], or null if
   * cancelled. Each is downscaled to [budgetBytes] like {@link pickImage}.
   */
  @ReactMethod
  fun pickImages(maxDim: Int, budgetBytes: Int, maxCount: Int, promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("no_activity", "no foreground activity")
      return
    }
    if (pending != null) {
      promise.reject("busy", "a pick is already in progress")
      return
    }
    pending = promise
    pendingMaxDim = if (maxDim > 0) maxDim else 1280
    pendingBudget = if (budgetBytes > 0) budgetBytes else 120_000
    pendingMaxCount = if (maxCount > 0) maxCount else 10
    try {
      val intent =
          Intent(Intent.ACTION_GET_CONTENT).apply {
            type = "image/*"
            addCategory(Intent.CATEGORY_OPENABLE)
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
          }
      activity.startActivityForResult(
          Intent.createChooser(intent, "Choose images"), REQ_MULTI)
    } catch (t: Throwable) {
      pending = null
      promise.reject("launch_failed", t.message ?: "could not open picker")
    }
  }

  /**
   * #203: capture a photo with the camera and return it downscaled, same shape as
   * {@link pickImage}. Requires the CAMERA runtime permission (requested JS-side).
   */
  @ReactMethod
  fun capturePhoto(maxDim: Int, budgetBytes: Int, promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("no_activity", "no foreground activity")
      return
    }
    if (pending != null) {
      promise.reject("busy", "a capture is already in progress")
      return
    }
    try {
      val dir = File(reactApplicationContext.cacheDir, "cam").apply { mkdirs() }
      val f = File(dir, "capture_${System.nanoTime()}.jpg")
      val uri =
          FileProvider.getUriForFile(
              reactApplicationContext,
              "${reactApplicationContext.packageName}.fileprovider",
              f)
      pending = promise
      pendingMaxDim = if (maxDim > 0) maxDim else 1280
      pendingBudget = if (budgetBytes > 0) budgetBytes else 120_000
      pendingCaptureUri = uri
      val intent =
          Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
            putExtra(MediaStore.EXTRA_OUTPUT, uri)
            addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
          }
      if (intent.resolveActivity(reactApplicationContext.packageManager) == null) {
        pending = null
        promise.reject("no_camera", "no camera app available")
        return
      }
      activity.startActivityForResult(intent, REQ_CAPTURE)
    } catch (t: Throwable) {
      pending = null
      promise.reject("launch_failed", t.message ?: "could not open camera")
    }
  }

  override fun onActivityResult(
      activity: Activity,
      requestCode: Int,
      resultCode: Int,
      data: Intent?,
  ) {
    when (requestCode) {
      REQ_PICK -> handleSingle(data?.data, resultCode)
      REQ_CAPTURE -> handleSingle(pendingCaptureUri.also { pendingCaptureUri = null }, resultCode)
      REQ_MULTI -> handleMulti(data, resultCode)
      else -> return
    }
  }

  private fun handleSingle(uri: Uri?, resultCode: Int) {
    val promise = pending ?: return
    pending = null
    if (resultCode != Activity.RESULT_OK || uri == null) {
      promise.resolve(null) // cancelled
      return
    }
    Thread {
          try {
            promise.resolve(decodeResizeEncode(uri, pendingMaxDim, pendingBudget))
          } catch (t: Throwable) {
            Log.w(TAG, "decode failed", t)
            promise.reject("decode_failed", t.message ?: "could not read image")
          }
        }
        .start()
  }

  private fun handleMulti(data: Intent?, resultCode: Int) {
    val promise = pending ?: return
    pending = null
    if (resultCode != Activity.RESULT_OK || data == null) {
      promise.resolve(null)
      return
    }
    val uris = ArrayList<Uri>()
    val clip = data.clipData
    if (clip != null) {
      for (i in 0 until clip.itemCount) {
        if (uris.size >= pendingMaxCount) break
        clip.getItemAt(i).uri?.let { uris.add(it) }
      }
    } else {
      data.data?.let { uris.add(it) }
    }
    if (uris.isEmpty()) {
      promise.resolve(null)
      return
    }
    Thread {
          val arr = JSONArray()
          for (u in uris) {
            try {
              arr.put(JSONObject(decodeResizeEncode(u, pendingMaxDim, pendingBudget)))
            } catch (t: Throwable) {
              Log.w(TAG, "skip undecodable image: ${t.message}")
            }
          }
          promise.resolve(arr.toString())
        }
        .start()
  }

  /**
   * #201 Save: copy a stored image file into the device gallery (MediaStore →
   * Pictures/LogosChat). Scoped-storage friendly (no permission on Android 10+).
   */
  @ReactMethod
  fun saveImageToGallery(path: String, promise: Promise) {
    Thread {
          try {
            val src = File(path)
            val cv =
                android.content.ContentValues().apply {
                  put(MediaStore.Images.Media.DISPLAY_NAME, src.name)
                  put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
                  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    put(
                        MediaStore.Images.Media.RELATIVE_PATH,
                        android.os.Environment.DIRECTORY_PICTURES + "/LogosChat")
                  }
                }
            val resolver = reactApplicationContext.contentResolver
            val uri =
                resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cv)
                    ?: throw IllegalStateException("MediaStore insert failed")
            resolver.openOutputStream(uri).use { out ->
              src.inputStream().use { it.copyTo(out!!) }
            }
            promise.resolve(uri.toString())
          } catch (t: Throwable) {
            promise.reject("save_failed", t.message ?: "could not save to gallery")
          }
        }
        .start()
  }

  /**
   * #201: read a stored blob file back to base64 (NO_WRAP) — used to FORWARD a
   * media message (its DB row holds only a local path; re-transmitting needs bytes).
   */
  @ReactMethod
  fun readFileBase64(path: String, promise: Promise) {
    Thread {
          try {
            val bytes = File(path).readBytes()
            promise.resolve(Base64.encodeToString(bytes, Base64.NO_WRAP))
          } catch (t: Throwable) {
            promise.reject("read_failed", t.message ?: "could not read file")
          }
        }
        .start()
  }

  /**
   * Persist a base64 JPEG to app storage and resolve its file path (#197) — used
   * for the sender's own local copy so the outgoing bubble renders from a file,
   * not a giant base64 string held in JS.
   */
  @ReactMethod
  fun saveBase64Jpeg(base64: String, promise: Promise) {
    Thread {
          try {
            promise.resolve(ImageFiles.saveBase64(reactApplicationContext, base64))
          } catch (t: Throwable) {
            promise.reject("save_failed", t.message ?: "could not save image")
          }
        }
        .start()
  }

  override fun onNewIntent(intent: Intent) {}

  /**
   * Read [uri], downscale to [maxDim] longest edge, then JPEG-compress stepping
   * quality (and scaling as a last resort) until the payload fits [budgetBytes]
   * — Status's compress-to-fit approach so the image is one chat message.
   */
  private fun decodeResizeEncode(uri: Uri, maxDim: Int, budgetBytes: Int): String {
    val resolver = reactApplicationContext.contentResolver

    // Pass 1: bounds only, so we can pick an inSampleSize without allocating.
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    val srcW = bounds.outWidth
    val srcH = bounds.outHeight
    if (srcW <= 0 || srcH <= 0) throw IllegalStateException("not a decodable image")

    // Pass 2: decode at a power-of-two subsample near the target.
    var sample = 1
    while (srcW / (sample * 2) >= maxDim || srcH / (sample * 2) >= maxDim) sample *= 2
    val opts = BitmapFactory.Options().apply { inSampleSize = sample }
    var bmp =
        resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) }
            ?: throw IllegalStateException("decode returned null")

    // Exact scale so the longest edge == maxDim (sub-sampling only gets us close).
    val longest = maxOf(bmp.width, bmp.height)
    if (longest > maxDim) {
      val scale = maxDim.toFloat() / longest
      val scaled =
          Bitmap.createScaledBitmap(
              bmp, (bmp.width * scale).toInt(), (bmp.height * scale).toInt(), true)
      if (scaled != bmp) bmp.recycle()
      bmp = scaled
    }

    // Respect EXIF rotation (gallery photos; screenshots usually have none).
    bmp = applyExif(uri, bmp)

    // Compress-to-fit: step quality 85→45; if still over budget, scale the bitmap
    // to 85% and retry the quality sweep. Bounded so we always terminate.
    var bytes: ByteArray = ByteArray(0)
    var scaleTries = 0
    while (true) {
      var quality = 85
      var best: ByteArray? = null
      while (quality >= 45) {
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.JPEG, quality, out)
        best = out.toByteArray()
        if (best.size <= budgetBytes) break
        quality -= 10
      }
      bytes = best ?: ByteArray(0)
      if (bytes.size <= budgetBytes || scaleTries >= 4 || minOf(bmp.width, bmp.height) <= 200) {
        break
      }
      // Too big even at min quality — shrink and retry.
      val scaled =
          Bitmap.createScaledBitmap(
              bmp, (bmp.width * 0.85f).toInt(), (bmp.height * 0.85f).toInt(), true)
      if (scaled != bmp) bmp.recycle()
      bmp = scaled
      scaleTries += 1
    }

    val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
    val w = bmp.width
    val h = bmp.height
    bmp.recycle()

    return JSONObject()
        .put("mime", "image/jpeg")
        .put("width", w)
        .put("height", h)
        .put("byteLength", bytes.size)
        .put("base64", b64)
        .toString()
  }

  private fun applyExif(uri: Uri, bmp: Bitmap): Bitmap {
    val orientation =
        try {
          reactApplicationContext.contentResolver.openInputStream(uri)?.use {
            ExifInterface(it)
                .getAttributeInt(
                    ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
          } ?: ExifInterface.ORIENTATION_NORMAL
        } catch (t: Throwable) {
          ExifInterface.ORIENTATION_NORMAL
        }
    val m = Matrix()
    when (orientation) {
      ExifInterface.ORIENTATION_ROTATE_90 -> m.postRotate(90f)
      ExifInterface.ORIENTATION_ROTATE_180 -> m.postRotate(180f)
      ExifInterface.ORIENTATION_ROTATE_270 -> m.postRotate(270f)
      else -> return bmp
    }
    val rotated = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
    if (rotated != bmp) bmp.recycle()
    return rotated
  }
}
