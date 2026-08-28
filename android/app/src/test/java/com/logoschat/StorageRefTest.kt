package com.logoschat

import android.util.Base64
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
}
