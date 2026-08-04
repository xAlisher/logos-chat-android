package com.logoschat

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * #358 P0 regression: the ChatDb open decision must NEVER resolve to a plaintext open when
 * the DB is (or was meant to be) encrypted — including the case where crypto is available
 * but the one-time plaintext→encrypted migration failed. The pre-#358 code returned a
 * plaintext framework factory in that case; [decideOpen] now fails closed.
 *
 * Pure decision table — no Keystore / SQLCipher needed (they can't run under Robolectric).
 */
class ChatDbCryptoDecisionTest {

  @Test
  fun encryptedOnlyWhenEngineKeyAndEncryptedDbAllPresent() {
    assertEquals(
        DbOpenDecision.ENCRYPTED,
        decideOpen(sqlcipherLoaded = true, keyAvailable = true, dbEncrypted = true))
  }

  @Test
  fun migrationFailedFailsClosed_neverPlaintext() {
    // crypto available (engine + key) but migration of an existing plaintext db failed.
    // This is the exact P0 branch: it must fail closed, not open plaintext.
    assertEquals(
        DbOpenDecision.FAIL_CLOSED,
        decideOpen(sqlcipherLoaded = true, keyAvailable = true, dbEncrypted = false))
  }

  @Test
  fun noEngineFailsClosed() {
    assertEquals(
        DbOpenDecision.FAIL_CLOSED,
        decideOpen(sqlcipherLoaded = false, keyAvailable = true, dbEncrypted = true))
  }

  @Test
  fun noKeyFailsClosed() {
    assertEquals(
        DbOpenDecision.FAIL_CLOSED,
        decideOpen(sqlcipherLoaded = true, keyAvailable = false, dbEncrypted = true))
  }

  /** Exhaustive: ENCRYPTED iff all three true; every other combination fails closed. */
  @Test
  fun fullTruthTable_neverPlaintextUnlessFullyReady() {
    for (engine in listOf(false, true)) {
      for (key in listOf(false, true)) {
        for (enc in listOf(false, true)) {
          val expected =
              if (engine && key && enc) DbOpenDecision.ENCRYPTED else DbOpenDecision.FAIL_CLOSED
          assertEquals(
              "decideOpen(engine=$engine, key=$key, enc=$enc)",
              expected,
              decideOpen(engine, key, enc))
        }
      }
    }
  }
}
