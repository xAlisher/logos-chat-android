package com.logoschat

import android.content.Context
import android.util.Base64
import java.io.File
import java.security.MessageDigest

/**
 * ImageFiles — where received/sent chat image bytes live on disk (#197). The chat
 * DB keeps only a small `img1v:<meta>␟<path>` marker; the actual JPEG bytes are
 * written here (content-addressed by SHA-256, so the same image sent twice reuses
 * one file). Both the receive path (ChatRepo) and the send-side local copy
 * (ImagePickerModule / LogosChatModule) go through this so the storage layout has
 * one owner.
 *
 * Kept under filesDir (app-private, survives restarts) rather than cacheDir — a
 * received photo should not evaporate under cache pressure.
 */
object ImageFiles {
  private const val DIR = "chat-images"

  private fun dir(context: Context): File =
      File(context.filesDir, DIR).apply { if (!exists()) mkdirs() }

  /** Decode [base64] JPEG bytes and write them content-addressed; return the path. */
  fun saveBase64(context: Context, base64: String): String {
    val bytes = Base64.decode(base64, Base64.DEFAULT)
    val name = sha256(bytes) + ".jpg"
    val f = File(dir(context), name)
    if (!f.exists()) f.writeBytes(bytes)
    return f.absolutePath
  }

  private fun sha256(bytes: ByteArray): String {
    val d = MessageDigest.getInstance("SHA-256").digest(bytes)
    val sb = StringBuilder(d.size * 2)
    for (b in d) sb.append("%02x".format(b))
    return sb.toString()
  }
}
