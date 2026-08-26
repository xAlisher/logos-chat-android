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
import org.json.JSONObject

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
 * marker (never to the node). Uploads use anonymous short-lived one-use grants; the legacy
 * BuildConfig bearer is retained only for capless legacy downloads. All network/crypto runs off
 * the RN thread.
 */
class StorageModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "Storage"

  private val base = BuildConfig.STORAGE_BASE
  private val token = BuildConfig.STORAGE_TOKEN
  private val IV_LEN = 12
  private val TAG_BITS = 128
  // #517 path 4: how long a media request waits for Tor to finish bootstrapping (Private
  // mode intended) before failing closed instead of egressing directly.
  private val PRIVATE_MODE_MEDIA_WAIT_MS = 30_000L

  // #318 (metadata privacy): when on, media upload/download is routed through a local SOCKS5
  // proxy (Tor) so the storage node sees a Tor exit IP, not the user's real IP. Set from JS
  // (settingsStore) via setTorRouting; the embedded/Orbot Tor listens on `torSocksPort`.
  @Volatile private var torEnabled = false
  @Volatile private var torSocksPort = 9050
  // #517 path 4: Private mode is INTENDED but Tor hasn't finished bootstrapping yet, so
  // `torEnabled` is still false. During that window a media request must NOT egress directly
  // (real IP + bearer token + CID to the storage node). JS sets this true the moment the user
  // enables Private mode — before the 100%-bootstrap setTorRouting call — so openConn can
  // wait for the route (bounded) and then fail closed, mirroring the delivery-side gate.
  @Volatile private var privateModePending = false

  private fun uploadConfigured(): Boolean = base.isNotEmpty()

  private data class UploadChallenge(
      val challenge: String,
      val difficulty: Int,
      val expiresAt: Long,
  )

  private fun readBoundedText(conn: HttpURLConnection, error: Boolean = false): String {
    val stream = if (error) conn.errorStream else conn.inputStream
    if (stream == null) return ""
    return stream.use { input ->
      val out = java.io.ByteArrayOutputStream()
      val chunk = ByteArray(1024)
      while (true) {
        val n = input.read(chunk)
        if (n < 0) break
        if (out.size() + n > 4096) throw RuntimeException("storage response too large")
        out.write(chunk, 0, n)
      }
      out.toString(Charsets.UTF_8.name())
    }
  }

  private fun requestUploadGrant(blobBytes: Int): String {
    val challengeConn = openConn(StorageUploadGrant.challengeUrl(base)).apply {
      requestMethod = "POST"
      instanceFollowRedirects = false
      connectTimeout = 15000
      readTimeout = 30000
      setFixedLengthStreamingMode(0)
      doOutput = true
    }
    val challengeBody: String
    try {
      challengeConn.outputStream.close()
      val code = challengeConn.responseCode
      if (code in 300..399) throw RuntimeException("unexpected grant redirect ($code)")
      if (code !in 200..299) {
        readBoundedText(challengeConn, error = true)
        throw RuntimeException("upload challenge failed ($code)")
      }
      challengeBody = readBoundedText(challengeConn)
    } finally {
      challengeConn.disconnect()
    }

    val challenge =
        try {
          val json = JSONObject(challengeBody)
          UploadChallenge(
              challenge = json.getString("challenge"),
              difficulty = json.getInt("difficulty"),
              expiresAt = json.getLong("expires_at"),
          )
        } catch (_: Throwable) {
          throw RuntimeException("invalid upload challenge response")
        }
    val nowSeconds = System.currentTimeMillis() / 1000L
    if (!StorageUploadGrant.validChallenge(
            challenge.challenge, challenge.difficulty, challenge.expiresAt, nowSeconds)) {
      throw RuntimeException("invalid or expired upload challenge")
    }
    val nonce =
        StorageUploadGrant.solveProof(challenge.challenge, blobBytes.toLong(), challenge.difficulty)
    val requestBytes =
        JSONObject()
            .put("challenge", challenge.challenge)
            .put("bytes", blobBytes)
            .put("nonce", nonce)
            .toString()
            .toByteArray(Charsets.UTF_8)
    val grantConn = openConn(StorageUploadGrant.grantUrl(base)).apply {
      requestMethod = "POST"
      instanceFollowRedirects = false
      connectTimeout = 15000
      readTimeout = 30000
      doOutput = true
      setFixedLengthStreamingMode(requestBytes.size)
      setRequestProperty("Content-Type", "application/json")
    }
    val grantBody: String
    try {
      grantConn.outputStream.use { it.write(requestBytes) }
      val code = grantConn.responseCode
      if (code in 300..399) throw RuntimeException("unexpected grant redirect ($code)")
      if (code !in 200..299) {
        readBoundedText(grantConn, error = true)
        throw RuntimeException("upload grant failed ($code)")
      }
      grantBody = readBoundedText(grantConn)
    } finally {
      grantConn.disconnect()
    }

    val grantJson =
        try {
          JSONObject(grantBody)
        } catch (_: Throwable) {
          throw RuntimeException("invalid upload grant response")
        }
    val grant: String
    val maxBytes: Long
    val expiresAt: Long
    try {
      grant = grantJson.getString("grant")
      maxBytes = grantJson.getLong("max_bytes")
      expiresAt = grantJson.getLong("expires_at")
    } catch (_: Throwable) {
      throw RuntimeException("invalid upload grant response")
    }
    if (!StorageUploadGrant.validGrantResponse(
            grant,
            maxBytes,
            blobBytes.toLong(),
            expiresAt,
            System.currentTimeMillis() / 1000L)) {
      throw RuntimeException("invalid upload grant caveats")
    }
    return grant
  }

  /**
   * #318/#363: open a connection, routed through the local Tor SOCKS proxy when Private mode
   * is on. A Tor-selected request NEVER silently falls back to a direct connection — if the
   * proxy port is unusable we throw, and if the proxy is down the connect() itself fails.
   * The only direct path is when Tor is explicitly off.
   */
  private fun persistedPrivateModeEnabled(): Boolean {
    var faulted = false
    val value =
        try {
          ChatRepo.requireDb().kvGet(NodeRuntime.KV_MEDIA_OVER_TOR)
        } catch (_: Throwable) {
          faulted = true
          null
        }
    return TorRelayGate.privateModeFromRead(value, faulted)
  }

  private fun openConn(urlStr: String): HttpURLConnection {
    val url = URL(urlStr)
    // The native persisted read closes the cold-start window before JS hydrates settings and
    // arms privateModePending. A read fault is unknown, therefore armed. Re-read while waiting
    // so a healthy "off" value or user cancellation releases promptly instead of timing out.
    var persistedPrivateMode = !torEnabled && persistedPrivateModeEnabled()
    val deadline = System.currentTimeMillis() + PRIVATE_MODE_MEDIA_WAIT_MS
    while (TorRelayGate.mustWaitForMedia(persistedPrivateMode, privateModePending, torEnabled) &&
        System.currentTimeMillis() < deadline) {
      Thread.sleep(100)
      persistedPrivateMode = !torEnabled && persistedPrivateModeEnabled()
    }
    if (TorRelayGate.mustWaitForMedia(persistedPrivateMode, privateModePending, torEnabled)) {
      throw IllegalStateException(
          "Private mode is on but Tor is not ready yet — not sending media over a direct connection")
    }
    return if (torEnabled) {
      // #363: fail visibly rather than fall back to direct networking.
      if (torSocksPort <= 0) {
        throw IllegalStateException("Private mode is on but the Tor proxy port is unset")
      }
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
    // Once routing is live the pending window is over; clearing it also releases any
    // openConn wait blocked below.
    if (enabled) privateModePending = false
  }

  /**
   * #517 path 4: JS marks Private mode as INTENDED at the moment the user enables it —
   * before Tor finishes bootstrapping and before [setTorRouting] flips routing on at 100%.
   * While pending, a media request waits for the route (bounded) and then fails closed
   * rather than egressing directly. Cleared on disable/cancel (and when routing goes live).
   */
  @ReactMethod
  fun setPrivateModePending(pending: Boolean) {
    privateModePending = pending
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
        if (!uploadConfigured()) throw IllegalStateException("storage upload not configured")
        // #320: size padding — [4-byte realLen][data][zero pad → Padmé bucket] so the node
        // sees only a bucketed size, not the exact file size (MediaPadding, unit-tested #323).
        val plain = MediaPadding.pad(File(localPath).readBytes())
        // AES-256-GCM: fresh key + IV; store IV as the first bytes of the blob.
        val key = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val iv = ByteArray(IV_LEN).also { SecureRandom().nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BITS, iv))
        val ct = cipher.doFinal(plain)
        val blob = iv + ct // IV || ciphertext(+tag)

        val uploadGrant = requestUploadGrant(blob.size)

        val conn = openConn("$base/data").apply {
          requestMethod = "POST"
          instanceFollowRedirects = false
          doOutput = true
          connectTimeout = 15000
          readTimeout = 60000
          setFixedLengthStreamingMode(blob.size)
          for ((name, value) in StorageUploadGrant.uploadHeaders(uploadGrant)) {
            setRequestProperty(name, value)
          }
        }
        val body = try {
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
          if (code in 300..399) throw RuntimeException("unexpected upload redirect ($code)")
          if (code !in 200..299) {
            readBoundedText(conn, error = true)
            throw RuntimeException("upload failed ($code)")
          }
          readBoundedText(conn).trim()
        } finally {
          conn.disconnect()
        }
        // #302: the capgate proxy returns "cid:cap" (cap = per-blob fetch capability).
        val sep = body.indexOf(':')
        if (sep <= 0 || sep != body.lastIndexOf(':')) {
          throw RuntimeException("invalid hosted-media reference from storage")
        }
        val cid = body.substring(0, sep)
        val cap = body.substring(sep + 1)
        if (!StorageRef.validCid(cid) || !StorageRef.validCap(cap) || cap.isEmpty()) {
          throw RuntimeException("invalid hosted-media reference from storage")
        }

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

  @ReactMethod
  fun downloadDecrypt(cid: String, keyB64: String, cap: String, padded: Boolean, promise: Promise) {
    Thread {
      try {
        // #388: the CID / key / cap come from an untrusted sender's marker. Validate with a
        // strict allowlist + length bound BEFORE any network or file use.
        if (!StorageRef.validCid(cid)) throw IllegalArgumentException("invalid media cid")
        if (!StorageRef.validKeyB64(keyB64)) throw IllegalArgumentException("invalid media key")
        if (!StorageRef.validCap(cap)) throw IllegalArgumentException("invalid media cap")
        if (base.isEmpty() || !StorageAuthorization.canDownload(token, cap)) {
          throw IllegalStateException("storage download not authorized")
        }

        // #388: cache filename is SHA-256(cid), never the raw cid → no path traversal / collision.
        val dir = File(reactApplicationContext.cacheDir, "media").apply { mkdirs() }
        val dest = File(dir, StorageRef.cacheName(cid))
        if (dest.exists() && dest.length() > 0) {
          promise.resolve(dest.absolutePath)
          return@Thread
        }
        // #302: present the per-blob capability on GET (proxy 403s without a valid one).
        // #388: URL components are percent-encoded (defence in depth on top of validation).
        val url = StorageRef.buildDataUrl(base, cid, cap)
        val conn = openConn(url).apply {
          requestMethod = "GET"
          instanceFollowRedirects = false // #388: never follow a redirect off the storage node
          connectTimeout = 15000
          readTimeout = 60000
          val bearer = StorageAuthorization.bearerHeader(token, cap)
          if (bearer.isNotEmpty()) setRequestProperty("Authorization", bearer)
        }
        val code = conn.responseCode
        if (code in 300..399) throw RuntimeException("unexpected redirect ($code)")
        if (code !in 200..299) {
          val err = conn.errorStream?.bufferedReader()?.readText() ?: "http $code"
          throw RuntimeException("download failed ($code): ${err.take(200)}")
        }
        // #388: reject an unexpected response type (an HTML error/login page is not media).
        val ctype = conn.contentType ?: ""
        if (ctype.startsWith("text/html") || ctype.startsWith("application/json")) {
          throw RuntimeException("unexpected content-type: $ctype")
        }
        // #388: bound the download. Reject up-front on an oversized Content-Length, then read
        // with a streaming counter that aborts past the ciphertext ceiling (no unbounded read).
        val max = StorageRef.MAX_CIPHERTEXT_BYTES
        val declared = conn.contentLengthLong
        if (declared in 1..Long.MAX_VALUE && declared > max) {
          throw RuntimeException("media too large ($declared > $max)")
        }
        val blob =
            conn.inputStream.use { ins ->
              val out = java.io.ByteArrayOutputStream()
              val chunk = ByteArray(64 * 1024)
              var total = 0L
              while (true) {
                val n = ins.read(chunk)
                if (n < 0) break
                total += n
                if (total > max) throw RuntimeException("media exceeds max size ($max bytes)")
                out.write(chunk, 0, n)
              }
              out.toByteArray()
            }
        conn.disconnect()
        if (blob.size <= IV_LEN) throw RuntimeException("blob too short")

        val key = Base64.decode(keyB64, Base64.NO_WRAP)
        val iv = blob.copyOfRange(0, IV_LEN)
        val ct = blob.copyOfRange(IV_LEN, blob.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BITS, iv))
        val decrypted = cipher.doFinal(ct)

        // #320: store2 blobs are size-padded — strip the header + zero pad (MediaPadding).
        val plain = if (padded) MediaPadding.strip(decrypted) else decrypted

        dest.writeBytes(plain)
        promise.resolve(dest.absolutePath)
      } catch (t: Throwable) {
        promise.reject("storage_download", t.message, t)
      }
    }.start()
  }
}
