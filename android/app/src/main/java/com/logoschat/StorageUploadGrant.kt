package com.logoschat

import java.security.MessageDigest
import org.json.JSONObject
import org.json.JSONTokener

/** Pure upload-grant protocol helpers, separated from Android networking for JVM tests. */
object StorageUploadGrant {
  const val HEADER = "X-Upload-Grant"
  private val OPAQUE_RE = Regex("^[0-9a-f]{64}$")
  private const val MAX_DIFFICULTY = 24
  private const val MAX_CLOCK_HORIZON_SECONDS = 5 * 60L

  data class ChallengeJson(
      val challenge: String,
      val difficulty: Int,
      val expiresAt: Long,
  )

  data class GrantJson(
      val grant: String,
      val maxBytes: Long,
      val expiresAt: Long,
  )

  private fun strictObject(body: String, expectedKeys: Set<String>): JSONObject {
    try {
      val tokener = JSONTokener(body)
      val value = tokener.nextValue()
      require(value is JSONObject)
      require(tokener.nextClean() == 0.toChar())
      val actualKeys = mutableSetOf<String>()
      val keys = value.keys()
      while (keys.hasNext()) actualKeys += keys.next()
      require(actualKeys == expectedKeys)
      return value
    } catch (_: Throwable) {
      throw IllegalArgumentException("invalid upload grant JSON")
    }
  }

  private fun exactLong(json: JSONObject, key: String): Long =
      when (val value = json.get(key)) {
        is Int -> value.toLong()
        is Long -> value
        else -> throw IllegalArgumentException("invalid upload grant JSON")
      }

  fun parseChallengeJson(body: String): ChallengeJson {
    val json = strictObject(body, setOf("challenge", "difficulty", "expires_at"))
    val challenge = json.get("challenge") as? String
        ?: throw IllegalArgumentException("invalid upload grant JSON")
    val difficulty = exactLong(json, "difficulty")
    require(difficulty in Int.MIN_VALUE.toLong()..Int.MAX_VALUE.toLong())
    return ChallengeJson(challenge, difficulty.toInt(), exactLong(json, "expires_at"))
  }

  fun parseGrantJson(body: String): GrantJson {
    val json = strictObject(body, setOf("grant", "max_bytes", "expires_at"))
    val grant = json.get("grant") as? String
        ?: throw IllegalArgumentException("invalid upload grant JSON")
    return GrantJson(grant, exactLong(json, "max_bytes"), exactLong(json, "expires_at"))
  }

  fun challengeUrl(base: String): String = "${base.trimEnd('/')}/data/upload-challenges"

  fun grantUrl(base: String): String = "${base.trimEnd('/')}/data/upload-grants"

  fun validChallenge(
      challenge: String,
      difficulty: Int,
      expiresAtSeconds: Long,
      nowSeconds: Long,
  ): Boolean =
      OPAQUE_RE.matches(challenge) &&
          difficulty in 1..MAX_DIFFICULTY &&
          expiresAtSeconds > nowSeconds &&
          expiresAtSeconds <= nowSeconds + MAX_CLOCK_HORIZON_SECONDS

  fun validGrant(grant: String): Boolean = OPAQUE_RE.matches(grant)

  fun validGrantResponse(
      grant: String,
      maxBytes: Long,
      expectedBytes: Long,
      expiresAtSeconds: Long,
      nowSeconds: Long,
  ): Boolean =
      validGrant(grant) &&
          maxBytes == expectedBytes &&
          expiresAtSeconds > nowSeconds &&
          expiresAtSeconds <= nowSeconds + MAX_CLOCK_HORIZON_SECONDS

  fun uploadHeaders(grant: String): Map<String, String> {
    require(validGrant(grant)) { "invalid upload grant" }
    return mapOf(
        HEADER to grant,
        "Content-Type" to "application/octet-stream",
    )
  }

  fun solveProof(challenge: String, bytes: Long, difficulty: Int): Long {
    require(OPAQUE_RE.matches(challenge)) { "invalid upload challenge" }
    require(bytes in 1..StorageRef.MAX_CIPHERTEXT_BYTES) { "invalid ciphertext length" }
    require(difficulty in 1..MAX_DIFFICULTY) { "invalid proof difficulty" }
    val digest = MessageDigest.getInstance("SHA-256")
    val prefix = "$challenge:$bytes:"
    var nonce = 0L
    while (nonce >= 0) {
      val proof = digest.digest((prefix + nonce).toByteArray(Charsets.UTF_8))
      if (leadingZeroBits(proof) >= difficulty) return nonce
      nonce++
    }
    throw IllegalStateException("upload proof nonce exhausted")
  }

  fun proofValid(challenge: String, bytes: Long, nonce: Long, difficulty: Int): Boolean {
    if (nonce < 0 || difficulty !in 1..MAX_DIFFICULTY) return false
    val input = "$challenge:$bytes:$nonce".toByteArray(Charsets.UTF_8)
    val digest = MessageDigest.getInstance("SHA-256").digest(input)
    return leadingZeroBits(digest) >= difficulty
  }

  private fun leadingZeroBits(digest: ByteArray): Int {
    var bits = 0
    for (raw in digest) {
      val value = raw.toInt() and 0xff
      if (value == 0) {
        bits += 8
        continue
      }
      bits += Integer.numberOfLeadingZeros(value) - 24
      break
    }
    return bits
  }
}
