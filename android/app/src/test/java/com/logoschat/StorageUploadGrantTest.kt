package com.logoschat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class StorageUploadGrantTest {
  @Test
  fun proofIsBoundToChallengeAndExactCiphertextLength() {
    val challenge = "ab".repeat(32)
    val nonce = StorageUploadGrant.solveProof(challenge, 1234, 8)

    assertTrue(StorageUploadGrant.proofValid(challenge, 1234, nonce, 8))
    assertFalse(StorageUploadGrant.proofValid(challenge, 1235, nonce, 8))
  }

  @Test
  fun uploadHeadersContainOneUseGrantAndNeverReusableAuthorization() {
    val grant = "cd".repeat(32)
    val headers = StorageUploadGrant.uploadHeaders(grant)

    assertEquals(grant, headers["X-Upload-Grant"])
    assertEquals("application/octet-stream", headers["Content-Type"])
    assertFalse(headers.containsKey("Authorization"))
  }

  @Test
  fun grantUrlsStayInsideTheConfiguredStorageApi() {
    val base = "https://msg.logos.live/s/api/storage/v1/"

    assertEquals(
        "https://msg.logos.live/s/api/storage/v1/data/upload-challenges",
        StorageUploadGrant.challengeUrl(base))
    assertEquals(
        "https://msg.logos.live/s/api/storage/v1/data/upload-grants",
        StorageUploadGrant.grantUrl(base))
  }

  @Test
  fun malformedOrExpiredChallengeFailsClosed() {
    assertFalse(StorageUploadGrant.validChallenge("ab".repeat(31), 18, 200, 100))
    assertFalse(StorageUploadGrant.validChallenge("zz".repeat(32), 18, 200, 100))
    assertFalse(StorageUploadGrant.validChallenge("ab".repeat(32), 0, 200, 100))
    assertFalse(StorageUploadGrant.validChallenge("ab".repeat(32), 31, 200, 100))
    assertFalse(StorageUploadGrant.validChallenge("ab".repeat(32), 18, 100, 100))
    assertTrue(StorageUploadGrant.validChallenge("ab".repeat(32), 18, 200, 100))
  }

  @Test
  fun invalidGrantOrDifficultyIsRejected() {
    assertFalse(StorageUploadGrant.validGrant("ef".repeat(31)))
    assertFalse(StorageUploadGrant.validGrant("EF".repeat(32)))
    assertTrue(StorageUploadGrant.validGrant("ef".repeat(32)))
    try {
      StorageUploadGrant.solveProof("ab".repeat(32), 10, 31)
      fail("excessive proof difficulty accepted")
    } catch (_: IllegalArgumentException) {}
  }

  @Test
  fun grantCaveatsMustMatchTheExactCiphertextAndRemainShortLived() {
    val grant = "ef".repeat(32)

    assertTrue(StorageUploadGrant.validGrantResponse(grant, 1234, 1234, 200, 100))
    assertFalse(StorageUploadGrant.validGrantResponse(grant, 1235, 1234, 200, 100))
    assertFalse(StorageUploadGrant.validGrantResponse(grant, 1234, 1234, 100, 100))
    assertFalse(StorageUploadGrant.validGrantResponse(grant, 1234, 1234, 1000, 100))
  }
}
