package com.logoschat

import android.util.Base64
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * #388: peer-controlled media reference fields must be validated before they reach the storage
 * URL or the cache file path. Covers traversal, query-injection, cache-collision, oversized,
 * and malformed inputs. Robolectric only for android.util.Base64 in [StorageRef.validKeyB64].
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class StorageRefTest {

  private val goodCid = "zdj7WkRPBFP1234567890abcdefGHIJKLMNOPqrstuvwxyz" // base58-ish, alnum

  @Test
  fun validCid_acceptsNormal_rejectsTraversalAndInjection() {
    assertTrue(StorageRef.validCid(goodCid))
    assertTrue(StorageRef.validCid("bafybeigdyrabc123")) // base32 CIDv1 style
    // traversal
    assertFalse(StorageRef.validCid("../secret"))
    assertFalse(StorageRef.validCid(".."))
    assertFalse(StorageRef.validCid("a/b"))
    assertFalse(StorageRef.validCid("/etc/passwd"))
    // url / query injection chars
    assertFalse(StorageRef.validCid("cid?cap=x"))
    assertFalse(StorageRef.validCid("cid#frag"))
    assertFalse(StorageRef.validCid("cid&admin=1"))
    assertFalse(StorageRef.validCid("cid with space"))
    assertFalse(StorageRef.validCid("cid:extra"))
    // bounds
    assertFalse(StorageRef.validCid(""))
    assertFalse(StorageRef.validCid("a".repeat(StorageRef.MAX_CID_LEN + 1)))
  }

  @Test
  fun validCap_hexOrEmpty() {
    assertTrue(StorageRef.validCap("")) // legacy markers omit cap
    assertTrue(StorageRef.validCap("deadBEEF0123"))
    assertFalse(StorageRef.validCap("nothex!"))
    assertFalse(StorageRef.validCap("cap&x=1"))
    assertFalse(StorageRef.validCap("a".repeat(StorageRef.MAX_CAP_LEN + 1)))
  }

  @Test
  fun validKeyB64_requiresExactly32Bytes() {
    val key32 = Base64.encodeToString(ByteArray(32) { it.toByte() }, Base64.NO_WRAP)
    val key16 = Base64.encodeToString(ByteArray(16), Base64.NO_WRAP)
    val key33 = Base64.encodeToString(ByteArray(33), Base64.NO_WRAP)
    assertTrue(StorageRef.validKeyB64(key32))
    assertFalse(StorageRef.validKeyB64(key16))
    assertFalse(StorageRef.validKeyB64(key33))
    assertFalse(StorageRef.validKeyB64("not+valid+base64==="))
    assertFalse(StorageRef.validKeyB64(""))
  }

  @Test
  fun validMime_and_validDim() {
    assertTrue(StorageRef.validMime("image/gif"))
    assertTrue(StorageRef.validMime("video/mp4"))
    assertFalse(StorageRef.validMime("../etc"))
    assertFalse(StorageRef.validMime("noslash"))
    assertFalse(StorageRef.validMime("a/".plus("b".repeat(StorageRef.MAX_MIME_LEN))))
    assertTrue(StorageRef.validDim(1))
    assertTrue(StorageRef.validDim(4096))
    assertFalse(StorageRef.validDim(0))
    assertFalse(StorageRef.validDim(-1))
    assertFalse(StorageRef.validDim(StorageRef.MAX_DIM + 1))
  }

  @Test
  fun cacheName_isHashedNotRaw_deterministic_noPathChars() {
    val name = StorageRef.cacheName(goodCid)
    assertEquals(64, name.length) // sha-256 hex
    assertTrue(name.matches(Regex("^[0-9a-f]{64}$")))
    assertFalse(name.contains(goodCid)) // never the raw cid
    assertEquals(name, StorageRef.cacheName(goodCid)) // deterministic → cache still hits
    assertNotEquals(StorageRef.cacheName("cidA"), StorageRef.cacheName("cidB"))
    // even a traversal-shaped string hashes to a safe flat filename (defence in depth)
    val evil = StorageRef.cacheName("../../data/x")
    assertTrue(evil.matches(Regex("^[0-9a-f]{64}$")))
  }

  @Test
  fun buildDataUrl_encodesComponents_withAndWithoutCap() {
    val base = "https://storage.example.com"
    assertEquals("$base/data/$goodCid", StorageRef.buildDataUrl(base, goodCid, ""))
    assertEquals("$base/data/$goodCid?cap=deadbeef", StorageRef.buildDataUrl(base, goodCid, "deadbeef"))
    // trailing slash on base is normalised (no double slash)
    assertEquals("$base/data/$goodCid", StorageRef.buildDataUrl("$base/", goodCid, ""))
  }

  @Test
  fun effectiveCiphertextLimit_honorsTrustedVoiceBound() {
    assertEquals(2L * 1024 * 1024, StorageRef.effectiveCiphertextLimit(2.0 * 1024 * 1024))
    assertEquals(StorageRef.MAX_CIPHERTEXT_BYTES, StorageRef.effectiveCiphertextLimit(0.0))
    assertEquals(
        StorageRef.MAX_CIPHERTEXT_BYTES,
        StorageRef.effectiveCiphertextLimit(StorageRef.MAX_CIPHERTEXT_BYTES.toDouble() * 2),
    )
  }

  @Test
  fun cacheHit_requiresOriginalCiphertextWithinRequestedLimit() {
    val audioLimit = 2L * 1024 * 1024
    assertEquals(
        StorageRef.cacheName(goodCid) + ".ciphertext-size",
        StorageRef.cacheCiphertextSizeName(goodCid),
    )
    assertFalse(StorageRef.validCachedCiphertextSize(null, audioLimit))
    assertFalse(StorageRef.validCachedCiphertextSize(0L, audioLimit))
    assertFalse(StorageRef.validCachedCiphertextSize(audioLimit + 1, audioLimit))
    assertTrue(StorageRef.validCachedCiphertextSize(audioLimit, audioLimit))
  }

  @Test
  fun reusableCacheEntry_readsBoundedCiphertextMetadata() {
    val dir = Files.createTempDirectory("storage-cache-test").toFile()
    try {
      val cachedPlaintext = java.io.File(dir, StorageRef.cacheName(goodCid))
      val ciphertextSize = java.io.File(dir, StorageRef.cacheCiphertextSizeName(goodCid))
      cachedPlaintext.writeBytes(byteArrayOf(1))
      ciphertextSize.writeText("2097152", Charsets.US_ASCII)
      assertTrue(StorageRef.reusableCacheEntry(cachedPlaintext, ciphertextSize, 2L * 1024 * 1024))

      ciphertextSize.writeText("2097153", Charsets.US_ASCII)
      assertFalse(StorageRef.reusableCacheEntry(cachedPlaintext, ciphertextSize, 2L * 1024 * 1024))
      ciphertextSize.writeText("not-a-size", Charsets.US_ASCII)
      assertFalse(StorageRef.reusableCacheEntry(cachedPlaintext, ciphertextSize, 2L * 1024 * 1024))
      ciphertextSize.delete()
      assertFalse(StorageRef.reusableCacheEntry(cachedPlaintext, ciphertextSize, 2L * 1024 * 1024))
    } finally {
      dir.deleteRecursively()
    }
  }

  /**
   * Senti P2 on #543. The cache pair is keyed by SHA-256(cid) ALONE, so an image cached under the
   * 100 MiB visual bound and an `audio` mime reference to the SAME cid (the mime comes off the
   * sender's marker) share one pair. The stricter caller must be able to say "not for me" WITHOUT
   * discarding the entry — the first cut deleted both files, then failed its own 2 MiB
   * re-download, leaving mediaCache.ts memoising a path that no longer existed.
   */
  @Test
  fun oversizedForThisCaller_isRejected_notDiscarded() {
    val audioLimit = 2L * 1024 * 1024
    val visualLimit = 100L * 1024 * 1024
    val fiveMiB = 5L * 1024 * 1024
    // Same recorded entry, two callers: the visual one serves it, the audio one rejects it.
    assertEquals(StorageRef.CacheVerdict.REUSE, StorageRef.classifyCiphertextSize(fiveMiB, visualLimit))
    assertEquals(StorageRef.CacheVerdict.TOO_LARGE, StorageRef.classifyCiphertextSize(fiveMiB, audioLimit))
    // TOO_LARGE is distinct from REVALIDATE precisely so the caller can reject without deleting;
    // only unknown provenance (legacy/corrupt/absent) justifies a re-download.
    assertEquals(StorageRef.CacheVerdict.REVALIDATE, StorageRef.classifyCiphertextSize(null, audioLimit))
    assertEquals(StorageRef.CacheVerdict.REVALIDATE, StorageRef.classifyCiphertextSize(0L, audioLimit))
    assertEquals(StorageRef.CacheVerdict.REUSE, StorageRef.classifyCiphertextSize(audioLimit, audioLimit))
  }

  @Test
  fun strictCallerLeavesTheLooserCallersEntryReadable() {
    val audioLimit = 2L * 1024 * 1024
    val visualLimit = 100L * 1024 * 1024
    val dir = Files.createTempDirectory("storage-cache-share").toFile()
    try {
      val dest = java.io.File(dir, StorageRef.cacheName(goodCid))
      val size = java.io.File(dir, StorageRef.cacheCiphertextSizeName(goodCid))
      dest.writeBytes("image-plaintext".toByteArray())
      size.writeText((5L * 1024 * 1024).toString(), Charsets.US_ASCII)

      // The audio-bounded caller classifies the pair and, per TOO_LARGE, touches nothing.
      assertEquals(StorageRef.CacheVerdict.TOO_LARGE, StorageRef.classifyCacheEntry(dest, size, audioLimit))
      assertTrue(dest.isFile)
      assertTrue(size.isFile)
      // The visual caller that owns this entry can still read it — the regression's whole point.
      assertEquals(StorageRef.CacheVerdict.REUSE, StorageRef.classifyCacheEntry(dest, size, visualLimit))
      assertEquals("image-plaintext", dest.readText())
    } finally {
      dir.deleteRecursively()
    }
  }

  @Test
  fun publishCacheEntry_replacesBothFilesTogether() {
    val visualLimit = 100L * 1024 * 1024
    val dir = Files.createTempDirectory("storage-cache-publish").toFile()
    try {
      val dest = java.io.File(dir, StorageRef.cacheName(goodCid))
      val size = java.io.File(dir, StorageRef.cacheCiphertextSizeName(goodCid))
      dest.writeBytes("stale".toByteArray())
      size.writeText("999", Charsets.US_ASCII)
      val staged = java.io.File(dir, StorageRef.cacheName(goodCid) + ".part")
      staged.writeBytes("fresh".toByteArray())

      StorageRef.publishCacheEntry(staged, dest, size, 4096L)

      assertEquals("fresh", dest.readText())
      assertEquals("4096", size.readText(Charsets.US_ASCII))
      assertFalse(staged.exists()) // moved, not copied-and-left
      assertEquals(StorageRef.CacheVerdict.REUSE, StorageRef.classifyCacheEntry(dest, size, visualLimit))
    } finally {
      dir.deleteRecursively()
    }
  }

  /** A pair whose sidecar is gone mid-swap must read as REVALIDATE, never as a bogus REUSE. */
  @Test
  fun tornPairFailsClosed() {
    val dir = Files.createTempDirectory("storage-cache-torn").toFile()
    try {
      val dest = java.io.File(dir, StorageRef.cacheName(goodCid))
      val size = java.io.File(dir, StorageRef.cacheCiphertextSizeName(goodCid))
      dest.writeBytes("bytes".toByteArray())
      assertEquals(
          StorageRef.CacheVerdict.REVALIDATE,
          StorageRef.classifyCacheEntry(dest, size, 100L * 1024 * 1024),
      )
      // An absurdly long sidecar is metadata we refuse to parse, not a usable bound.
      size.writeText("1".repeat(64), Charsets.US_ASCII)
      assertEquals(
          StorageRef.CacheVerdict.REVALIDATE,
          StorageRef.classifyCacheEntry(dest, size, 100L * 1024 * 1024),
      )
      // Plaintext missing but metadata present is equally unusable.
      size.writeText("4096", Charsets.US_ASCII)
      dest.delete()
      assertEquals(
          StorageRef.CacheVerdict.REVALIDATE,
          StorageRef.classifyCacheEntry(dest, size, 100L * 1024 * 1024),
      )
    } finally {
      dir.deleteRecursively()
    }
  }
}
