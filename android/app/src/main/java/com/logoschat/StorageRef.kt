package com.logoschat

import android.util.Base64
import java.io.File
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

  /** Sidecar containing the original downloaded ciphertext byte count for cache-limit checks. */
  fun cacheCiphertextSizeName(cid: String): String = cacheName(cid) + ".ciphertext-size"

  /**
   * #542/#543 — how one caller may use the cache pair for a CID. The pair is keyed by the CID
   * ALONE, but the ciphertext bound is per-caller (audio is far stricter than visual media), so
   * a caller that cannot use an entry must never destroy it for the caller that can.
   */
  enum class CacheVerdict {
    /** Original ciphertext size is known and within this caller's bound → serve the entry. */
    REUSE,
    /** Known size, above THIS caller's bound → reject the request, leave the pair untouched. */
    TOO_LARGE,
    /** Legacy/missing/corrupt metadata → re-download under this bound, then replace the pair. */
    REVALIDATE,
  }

  /** Cached plaintext is reusable only when its original ciphertext size is known and allowed. */
  fun validCachedCiphertextSize(ciphertextBytes: Long?, maxCiphertextBytes: Long): Boolean =
      classifyCiphertextSize(ciphertextBytes, maxCiphertextBytes) == CacheVerdict.REUSE

  /** Pure verdict for a recorded ciphertext size against one caller's bound. */
  fun classifyCiphertextSize(ciphertextBytes: Long?, maxCiphertextBytes: Long): CacheVerdict =
      when {
        ciphertextBytes == null || ciphertextBytes <= 0L -> CacheVerdict.REVALIDATE
        ciphertextBytes <= maxCiphertextBytes -> CacheVerdict.REUSE
        else -> CacheVerdict.TOO_LARGE
      }

  /** Read the tiny app-private size sidecar and classify the pair for this caller's bound. */
  fun classifyCacheEntry(
      cachedPlaintext: File,
      ciphertextSizeFile: File,
      maxCiphertextBytes: Long,
  ): CacheVerdict {
    if (!cachedPlaintext.isFile || cachedPlaintext.length() <= 0) return CacheVerdict.REVALIDATE
    if (!ciphertextSizeFile.isFile || ciphertextSizeFile.length() !in 1L..20L) {
      return CacheVerdict.REVALIDATE
    }
    val ciphertextBytes =
        try {
          ciphertextSizeFile.readText(Charsets.US_ASCII).trim().toLongOrNull()
        } catch (_: Throwable) {
          null
        }
    return classifyCiphertextSize(ciphertextBytes, maxCiphertextBytes)
  }

  /** Read the tiny app-private size sidecar and decide whether this cache entry is reusable. */
  fun reusableCacheEntry(
      cachedPlaintext: File,
      ciphertextSizeFile: File,
      maxCiphertextBytes: Long,
  ): Boolean = classifyCacheEntry(cachedPlaintext, ciphertextSizeFile, maxCiphertextBytes) ==
      CacheVerdict.REUSE

  /**
   * #543 — replace a cache pair with a freshly verified download, atomically enough that no
   * concurrent reader can observe new metadata over old bytes. Order matters: drop the sidecar
   * FIRST (the pair now classifies REVALIDATE — fail-closed, worst case a redundant download),
   * then move the verified plaintext into place, then record its ciphertext size. The previous
   * plaintext is only ever overwritten by a complete download — never unlinked speculatively.
   */
  fun publishCacheEntry(
      verifiedPlaintext: File,
      cachedPlaintext: File,
      ciphertextSizeFile: File,
      ciphertextBytes: Long,
  ) {
    ciphertextSizeFile.delete()
    if (!verifiedPlaintext.renameTo(cachedPlaintext)) {
      // Same directory, so rename is normally atomic; fall back to a copy if the FS refuses.
      cachedPlaintext.writeBytes(verifiedPlaintext.readBytes())
      verifiedPlaintext.delete()
    }
    ciphertextSizeFile.writeText(ciphertextBytes.toString(), Charsets.US_ASCII)
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
