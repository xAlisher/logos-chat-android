package com.logoschat

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * #323: tests for the media size-padding metadata-privacy guarantee (#320).
 * Pure — no Android context needed.
 */
class MediaPaddingTest {

  // --- Padmé bucketing guarantees ------------------------------------------

  @Test
  fun bucketIsNeverSmallerThanInput() {
    var l = 1L
    while (l < (64L shl 20)) { // up to 64 MiB
      assertTrue("bucket($l) >= $l", MediaPadding.padmeBucket(l) >= l)
      l = (l * 3) / 2 + 1
    }
  }

  @Test
  fun bucketIsMonotonic() {
    var prev = 0L
    var l = 1L
    while (l < (16L shl 20)) {
      val b = MediaPadding.padmeBucket(l)
      assertTrue("monotonic at $l", b >= prev)
      prev = b
      l += 997 // stride through many sizes
    }
  }

  @Test
  fun overheadIsBounded() {
    // Padmé bounds overhead to ~1/floor(log2 l); ≤ ~12% for anything past a few KiB.
    var l = 4096L
    while (l < (32L shl 20)) {
      val b = MediaPadding.padmeBucket(l)
      val overhead = (b - l).toDouble() / l
      assertTrue("overhead ${overhead} too high at $l (bucket=$b)", overhead <= 0.12)
      l = (l * 5) / 4 + 1
    }
  }

  @Test
  fun collapsesManySizesIntoAnAnonymitySet() {
    // A realistic media range (roughly 50–64 KiB) must collapse to a handful of buckets,
    // so distinct files share an on-wire size (the whole point).
    val buckets = mutableSetOf<Long>()
    var l = 50_000L
    while (l <= 64_000L) {
      buckets.add(MediaPadding.padmeBucket(l))
      l += 1
    }
    // ~14k distinct input sizes → very few distinct on-wire sizes.
    assertTrue("expected a small anonymity-set of buckets, got ${buckets.size}", buckets.size <= 8)
  }

  @Test
  fun knownRegressionAnchor() {
    // The on-device capture: a ~51,862-byte GIF (+4 header) → bucket 53,248 = 26 * 2048.
    assertEquals(53_248L, MediaPadding.padmeBucket(51_866L))
    assertEquals(0L, 53_248L % 2048L)
  }

  // --- pad / strip round-trip (content integrity under padding) --------------

  @Test
  fun padStripRoundTripsForManySizes() {
    for (n in intArrayOf(0, 1, 2, 15, 16, 100, 4095, 4096, 51_862, 1_000_000)) {
      val raw = ByteArray(n) { (it * 31 + 7).toByte() }
      val padded = MediaPadding.pad(raw)
      // The on-wire (pre-encryption) size is a Padmé bucket, not the file size.
      assertEquals("padded size is bucketed for n=$n",
          MediaPadding.padmeBucket((MediaPadding.HEADER + n).toLong()), padded.size.toLong())
      assertTrue("padded ($padded.size) >= raw+header for n=$n", padded.size >= n + MediaPadding.HEADER)
      // Content survives the round-trip exactly.
      assertArrayEquals("round-trip for n=$n", raw, MediaPadding.strip(padded))
    }
  }

  @Test
  fun differentContentsOfSameSizeHaveIdenticalOnWireSize() {
    val a = ByteArray(51_862) { 1 }
    val b = ByteArray(51_862) { 2 }
    assertEquals(MediaPadding.pad(a).size, MediaPadding.pad(b).size)
  }

  @Test
  fun aRangeOfFileSizesYieldsOneOnWireSize() {
    // At this size class the bucket granularity is 2048 B, so files whose total (data+header)
    // lands in the same 2048-window pad to the SAME on-wire size (a shared anonymity set).
    // 4+size ∈ (51200, 53248] → bucket 53248.
    val sizes = intArrayOf(51_862, 52_504, 53_000, 53_244)
    val onWire = sizes.map { MediaPadding.pad(ByteArray(it)).size }.toSet()
    assertEquals("expected one shared on-wire size, got $onWire", 1, onWire.size)
    assertEquals(53_248, onWire.first())
  }

  @Test
  fun stripRejectsMalformed() {
    try {
      MediaPadding.strip(ByteArray(2)) // shorter than the header
      fail("expected too-short to throw")
    } catch (_: IllegalArgumentException) {}
    try {
      // header claims a length longer than the buffer
      MediaPadding.strip(byteArrayOf(0x7f, 0x7f, 0x7f, 0x7f, 0, 0))
      fail("expected bad-length to throw")
    } catch (_: IllegalArgumentException) {}
  }
}
