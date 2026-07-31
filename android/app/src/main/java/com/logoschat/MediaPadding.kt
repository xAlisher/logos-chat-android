package com.logoschat

/**
 * #320 / #323: pure, testable media size-padding — the size-privacy guarantee.
 *
 * A blob's plaintext is wrapped as `[4-byte BE realLen][data][zero pad → Padmé bucket]`
 * before AES-GCM, so the storage node sees only a bucketed size, not the exact file size.
 * The true length rides inside the ciphertext (E2E). Kept context-free so the guarantees
 * can be unit-tested directly (MediaPaddingTest).
 */
object MediaPadding {
  const val HEADER = 4 // bytes: big-endian real length

  /**
   * Padmé (Nym / PURB): round `l` up to a size class. Overhead is bounded to
   * ~≤ 1/floor(log2 l) (≈12% for small blobs, less for large), and the number of distinct
   * on-wire sizes collapses to O(log log), giving each blob a large size-anonymity set.
   */
  fun padmeBucket(l: Long): Long {
    if (l < 2L) return 2L
    val e = 63 - java.lang.Long.numberOfLeadingZeros(l) // floor(log2 l)
    val s = (63 - java.lang.Long.numberOfLeadingZeros(e.toLong())) + 1 // floor(log2 e)+1
    val lastBits = e - s
    if (lastBits <= 0) return l // tiny blobs: not worth bucketing
    val mask = (1L shl lastBits) - 1
    return (l + mask) and mask.inv() // round up to a multiple of 2^lastBits
  }

  /** Wrap raw plaintext with the length header and zero-pad to the Padmé bucket. */
  fun pad(raw: ByteArray): ByteArray {
    val realLen = raw.size
    val target = padmeBucket((HEADER + realLen).toLong()).toInt()
    val out = ByteArray(target)
    out[0] = (realLen ushr 24).toByte()
    out[1] = (realLen ushr 16).toByte()
    out[2] = (realLen ushr 8).toByte()
    out[3] = realLen.toByte()
    System.arraycopy(raw, 0, out, HEADER, realLen)
    return out
  }

  /** Recover the original plaintext from a padded blob (strip header + zero padding). */
  fun strip(padded: ByteArray): ByteArray {
    if (padded.size < HEADER) throw IllegalArgumentException("padded blob too short")
    val realLen =
        ((padded[0].toInt() and 0xff) shl 24) or
            ((padded[1].toInt() and 0xff) shl 16) or
            ((padded[2].toInt() and 0xff) shl 8) or
            (padded[3].toInt() and 0xff)
    if (realLen < 0 || HEADER + realLen > padded.size) {
      throw IllegalArgumentException("bad padded length: $realLen")
    }
    return padded.copyOfRange(HEADER, HEADER + realLen)
  }
}
