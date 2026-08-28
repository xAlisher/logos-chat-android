package com.logoschat

import android.util.Base64
import java.net.URLEncoder
import java.security.MessageDigest

/**
 * #388 — pure, unit-testable validation + safe URL/cache-name derivation for peer-controlled
 * media references (the `store1:`/`store2:` marker fields). These flow from an untrusted
 * sender straight into an authenticated storage URL and a cache file path, so every field is
 * validated with a strict allowlist + length bound BEFORE any network or file use, the cache
 * filename is derived from SHA-256(CID) (never the raw CID → no path traversal), and URL
 * components are percent-encoded (defence in depth on top of the allowlists).
 *
 * Kept side-effect-free and separate from [StorageModule] so it can be exercised directly by
 * StorageRefTest (traversal, query-injection, cache-collision, oversized, malformed inputs).
 */
object StorageRef {
  // Field length ceilings (a legit Codex CID is ~46-59 chars; caps are short hex HMACs).
  const val MAX_CID_LEN = 128
  const val MAX_CAP_LEN = 256
  const val MAX_MIME_LEN = 128
  const val MAX_DIM = 100_000 // sane upper bound for width/height in px
  const val KEY_BYTES = 32 // AES-256 key

  // Ciphertext ceiling: bounds an unbounded/OOM download. Generous for gifs/short video while
  // still capping abuse. The blob is read with a streaming counter that aborts past this.
  const val MAX_CIPHERTEXT_BYTES = 100L * 1024 * 1024 // 100 MiB

  /** Clamp a trusted per-media ceiling to the process-wide hard maximum. */
  fun effectiveCiphertextLimit(requestedBytes: Double): Long {
    if (!requestedBytes.isFinite() || requestedBytes <= 0.0) return MAX_CIPHERTEXT_BYTES
    return requestedBytes.toLong().coerceIn(1L, MAX_CIPHERTEXT_BYTES)
  }

  // CID: multibase base58btc / base32 are alphanumeric; allow unreserved marks too but NEVER
  // '/', ':', '?', '#', '&', '.', whitespace or control chars (traversal / injection).
  private val CID_RE = Regex("^[A-Za-z0-9_~-]{1,$MAX_CID_LEN}$")
  // cap: hex HMAC issued by the proxy (optional).
  private val CAP_RE = Regex("^[A-Fa-f0-9]{1,$MAX_CAP_LEN}$")
  // mime: type/subtype from RFC6838 token chars.
  private val MIME_RE = Regex("^[A-Za-z0-9][A-Za-z0-9!#\$&^_.+-]{0,63}/[A-Za-z0-9][A-Za-z0-9!#\$&^_.+-]{0,63}$")

  fun validCid(cid: String): Boolean = CID_RE.matches(cid)

  /** cap is optional; empty is allowed (legacy markers), any non-empty value must be hex. */
  fun validCap(cap: String): Boolean = cap.isEmpty() || (cap.length <= MAX_CAP_LEN && CAP_RE.matches(cap))

  fun validMime(mime: String): Boolean = mime.length <= MAX_MIME_LEN && MIME_RE.matches(mime)

  fun validDim(d: Int): Boolean = d in 1..MAX_DIM

  /** A base64 (NO_WRAP, standard alphabet) key that decodes to exactly 32 bytes. */
  fun validKeyB64(keyB64: String): Boolean =
      try {
        Base64.decode(keyB64, Base64.NO_WRAP).size == KEY_BYTES
      } catch (_: Throwable) {
        false
      }

  /**
   * Cache filename for a CID: lowercase hex SHA-256. Never the raw CID, so a crafted CID can
   * never escape the media cache dir or collide by path. Deterministic (a real cache hit still
   * works) and 1:1 with the CID for practical purposes (collision-resistant).
   */
  fun cacheName(cid: String): String {
    val d = MessageDigest.getInstance("SHA-256").digest(cid.toByteArray(Charsets.UTF_8))
    return d.joinToString("") { "%02x".format(it) }
  }

  /**
   * Build the storage GET URL with percent-encoded components. [cid]/[cap] MUST already have
   * passed [validCid]/[validCap]; encoding here is defence in depth (validated values are
   * unreserved so they pass through unchanged, but a bug upstream can't inject a new path
   * segment or query param).
   */
  fun buildDataUrl(base: String, cid: String, cap: String): String {
    val root = base.trimEnd('/')
    val encCid = URLEncoder.encode(cid, "UTF-8")
    return if (cap.isNotEmpty()) {
      "$root/data/$encCid?cap=" + URLEncoder.encode(cap, "UTF-8")
    } else {
      "$root/data/$encCid"
    }
  }
}
