package com.logoschat

import android.content.Context
import android.util.Base64
import java.io.File
import java.security.MessageDigest

/**
 * BlobFiles — content-addressed storage for non-text message payloads (voice
 * notes #205; generalises the image store in ImageFiles). The chat DB keeps only
 * a small `<kind>v:<meta>␟<path>` marker; the bytes live here under filesDir so a
 * received voice note survives restarts + cache pressure.
 */
object BlobFiles {
  /** Save [base64] bytes under filesDir/[subdir], named by content hash + [ext]. */
  fun save(context: Context, base64: String, subdir: String, ext: String): String {
    val bytes = Base64.decode(base64, Base64.DEFAULT)
    val dir = File(context.filesDir, subdir).apply { if (!exists()) mkdirs() }
    val f = File(dir, sha256(bytes) + "." + ext)
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
