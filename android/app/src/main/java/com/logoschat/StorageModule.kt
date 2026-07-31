package com.logoschat

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import android.util.Base64

/**
 * #297/#300 — client side of Logos Storage (Codex) media hosting.
 *
 * Big media (gifs, video) can't ride a Waku message (~120KB cap), so we host it on our own
 * storage node and send only a tiny `store1:` marker over MLS. This module is the encrypt →
 * upload and download → decrypt half:
 *   - uploadEncrypted(path): AES-256-GCM encrypt the file with a fresh random key, POST the
 *     ciphertext (IV||ct) to the node → get a CID. Resolves {cid, key(base64)}.
 *   - downloadDecrypt(cid, keyB64, destPath): GET the ciphertext by CID, decrypt, write to
 *     destPath. Resolves the path.
 *
 * The node only ever sees ciphertext; the KEY is returned to JS and travels E2E in the
 * marker (never to the node). Endpoint + bearer token come from BuildConfig (injected at
 * build time, kept out of git). All network/crypto runs off the RN thread.
 */
class StorageModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "Storage"

  private val base = BuildConfig.STORAGE_BASE
  private val token = BuildConfig.STORAGE_TOKEN
  private val IV_LEN = 12
  private val TAG_BITS = 128

  // #318 (metadata privacy): when on, media upload/download is routed through a local SOCKS5
  // proxy (Tor) so the storage node sees a Tor exit IP, not the user's real IP. Set from JS
  // (settingsStore) via setTorRouting; the embedded/Orbot Tor listens on `torSocksPort`.
  @Volatile private var torEnabled = false
  @Volatile private var torSocksPort = 9050

  private fun configured(): Boolean = base.isNotEmpty() && token.isNotEmpty()

  /** #318: open a connection, routed through the local Tor SOCKS proxy when enabled. */
  private fun openConn(urlStr: String): HttpURLConnection {
    val url = URL(urlStr)
    return if (torEnabled) {
      val proxy = java.net.Proxy(
          java.net.Proxy.Type.SOCKS,
          java.net.InetSocketAddress("127.0.0.1", torSocksPort),
      )
      url.openConnection(proxy) as HttpURLConnection
    } else {
      url.openConnection() as HttpURLConnection
    }
  }

  /** #318: JS toggles Tor routing for media (settingsStore.mediaOverTor). */
  @ReactMethod
  fun setTorRouting(enabled: Boolean, socksPort: Int) {
    torEnabled = enabled
    if (socksPort > 0) torSocksPort = socksPort
  }

  /** #308: emit an upload-progress device event so the "sending" ring can fill. */
  private fun emitSending(id: String, progress: Double) {
    if (id.isEmpty()) return
    val map = Arguments.createMap().apply {
      putString("id", id)
      putString("phase", "sending")
      putDouble("progress", progress.coerceIn(0.0, 1.0))
    }
    try {
      reactApplicationContext
          .getJSModule(com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit("mediaProgress", map)
    } catch (_: Throwable) {}
  }

  @ReactMethod
  fun uploadEncrypted(localPath: String, id: String, promise: Promise) {
    Thread {
      try {
        if (!configured()) throw IllegalStateException("storage not configured")
        // #320: size padding. Encrypt [4-byte BE realLen][data][zero pad → Padmé bucket]
        // so the storage node sees only a bucketed size, not the exact file size. The true
        // length rides inside the ciphertext (E2E); the store2: marker tells the receiver to
        // strip it. Padmé bounds overhead to ~<=12% while collapsing sizes into few classes.
        val raw = File(localPath).readBytes()
        val realLen = raw.size
        val target = padme((4 + realLen).toLong()).toInt()
        val plain = ByteArray(target)
        plain[0] = (realLen ushr 24).toByte()
        plain[1] = (realLen ushr 16).toByte()
        plain[2] = (realLen ushr 8).toByte()
        plain[3] = realLen.toByte()
        System.arraycopy(raw, 0, plain, 4, realLen)
        // bytes [4+realLen, target) stay zero (padding)
        // AES-256-GCM: fresh key + IV; store IV as the first bytes of the blob.
        val key = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val iv = ByteArray(IV_LEN).also { SecureRandom().nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BITS, iv))
        val ct = cipher.doFinal(plain)
        val blob = iv + ct // IV || ciphertext(+tag)

        val conn = openConn("$base/data").apply {
          requestMethod = "POST"
          doOutput = true
          connectTimeout = 15000
          readTimeout = 60000
          setFixedLengthStreamingMode(blob.size)
          setRequestProperty("Authorization", "Bearer $token")
          setRequestProperty("Content-Type", "application/octet-stream")
        }
        // #308: stream in chunks so we can report real byte-level upload progress.
        conn.outputStream.use { os ->
          val chunk = 64 * 1024
          var off = 0
          emitSending(id, 0.0)
          while (off < blob.size) {
            val n = minOf(chunk, blob.size - off)
            os.write(blob, off, n)
            off += n
            emitSending(id, off.toDouble() / blob.size)
          }
          os.flush()
        }
        val code = conn.responseCode
        if (code !in 200..299) {
          val err = conn.errorStream?.bufferedReader()?.readText() ?: "http $code"
          throw RuntimeException("upload failed ($code): ${err.take(200)}")
        }
        // #302: the capgate proxy returns "cid:cap" (cap = per-blob fetch capability).
        val body = conn.inputStream.bufferedReader().readText().trim()
        conn.disconnect()
        if (body.isEmpty()) throw RuntimeException("empty CID from storage")
        val sep = body.indexOf(':')
        val cid = if (sep >= 0) body.substring(0, sep) else body
        val cap = if (sep >= 0) body.substring(sep + 1) else ""

        val out = Arguments.createMap()
        out.putString("cid", cid)
        out.putString("key", Base64.encodeToString(key, Base64.NO_WRAP))
        out.putString("cap", cap)
        promise.resolve(out)
      } catch (t: Throwable) {
        promise.reject("storage_upload", t.message, t)
      }
    }.start()
  }

  /**
   * #320: Padmé (Nym / PURB) — round `l` up to a size class. Overhead is bounded to
   * ~<=1/floor(log2 l) (≈12% for small blobs, less for large), and the number of distinct
   * on-wire sizes collapses to O(log log), giving each blob a large size-anonymity set.
   */
  private fun padme(l: Long): Long {
    if (l < 2L) return 2L
    val e = 63 - java.lang.Long.numberOfLeadingZeros(l) // floor(log2 l)
    val s = (63 - java.lang.Long.numberOfLeadingZeros(e.toLong())) + 1 // floor(log2 e)+1
    val lastBits = e - s
    if (lastBits <= 0) return l // tiny blobs: not worth bucketing
    val mask = (1L shl lastBits) - 1
    return (l + mask) and mask.inv() // round up to a multiple of 2^lastBits
  }

  @ReactMethod
  fun downloadDecrypt(cid: String, keyB64: String, cap: String, padded: Boolean, promise: Promise) {
    Thread {
      try {
        if (!configured()) throw IllegalStateException("storage not configured")
        // Cache decrypted blobs under cacheDir/media/<cid>; serve a cache hit immediately.
        val dir = File(reactApplicationContext.cacheDir, "media").apply { mkdirs() }
        val dest = File(dir, cid)
        if (dest.exists() && dest.length() > 0) {
          promise.resolve(dest.absolutePath)
          return@Thread
        }
        // #302: present the per-blob capability on GET (proxy 403s without a valid one).
        val url = if (cap.isNotEmpty()) "$base/data/$cid?cap=$cap" else "$base/data/$cid"
        val conn = openConn(url).apply {
          requestMethod = "GET"
          connectTimeout = 15000
          readTimeout = 60000
          setRequestProperty("Authorization", "Bearer $token")
        }
        val code = conn.responseCode
        if (code !in 200..299) {
          val err = conn.errorStream?.bufferedReader()?.readText() ?: "http $code"
          throw RuntimeException("download failed ($code): ${err.take(200)}")
        }
        val blob = conn.inputStream.readBytes()
        conn.disconnect()
        if (blob.size <= IV_LEN) throw RuntimeException("blob too short")

        val key = Base64.decode(keyB64, Base64.NO_WRAP)
        val iv = blob.copyOfRange(0, IV_LEN)
        val ct = blob.copyOfRange(IV_LEN, blob.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BITS, iv))
        val decrypted = cipher.doFinal(ct)

        // #320: store2 blobs are size-padded — strip the 4-byte length header + zero pad.
        val plain = if (padded) {
          if (decrypted.size < 4) throw RuntimeException("padded blob too short")
          val realLen = ((decrypted[0].toInt() and 0xff) shl 24) or
            ((decrypted[1].toInt() and 0xff) shl 16) or
            ((decrypted[2].toInt() and 0xff) shl 8) or
            (decrypted[3].toInt() and 0xff)
          if (realLen < 0 || 4 + realLen > decrypted.size) throw RuntimeException("bad padded length")
          decrypted.copyOfRange(4, 4 + realLen)
        } else {
          decrypted
        }

        dest.writeBytes(plain)
        promise.resolve(dest.absolutePath)
      } catch (t: Throwable) {
        promise.reject("storage_download", t.message, t)
      }
    }.start()
  }
}
