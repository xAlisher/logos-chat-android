package com.logoschat

import android.content.Intent
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

/**
 * #479: share a decrypted media file (photo/gif/video) via the OS share sheet.
 *
 * The source lives under the app's internal dirs (inline photos in filesDir,
 * decrypted store blobs in cache). Rather than expose those directly, we copy the
 * file into cacheDir/exports/ — the ONLY dir published by @xml/file_paths for the
 * `${applicationId}.fileprovider` authority — and fire ACTION_SEND with a
 * content:// URI. The share sheet gets a scoped, read-only grant to that one file.
 */
class MediaShareModule(private val reactCtx: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactCtx) {

  override fun getName() = "MediaShare"

  @ReactMethod
  fun shareFile(path: String, mime: String, promise: Promise) {
    try {
      val src = File(path)
      if (!src.exists()) {
        promise.reject("no_file", "media file not found")
        return
      }
      val exports = File(reactCtx.cacheDir, "exports").apply { mkdirs() }
      val ext = src.extension.ifEmpty { mimeExt(mime) }
      val out = File(exports, "share-${System.nanoTime()}.$ext")
      src.copyTo(out, overwrite = true)

      val uri =
          FileProvider.getUriForFile(
              reactCtx, "${reactCtx.packageName}.fileprovider", out)
      val send =
          Intent(Intent.ACTION_SEND).apply {
            type = mime
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
          }
      val chooser =
          Intent.createChooser(send, null).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          }
      (reactCtx.currentActivity ?: reactCtx).startActivity(chooser)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("share_failed", e.message, e)
    }
  }

  private fun mimeExt(mime: String): String =
      when {
        mime.contains("gif") -> "gif"
        mime.contains("png") -> "png"
        mime.contains("webp") -> "webp"
        mime.startsWith("video/") -> "mp4"
        else -> "jpg"
      }
}
