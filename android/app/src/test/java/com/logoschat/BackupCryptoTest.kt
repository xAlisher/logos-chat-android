package com.logoschat

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * #361: passphrase-protected, authenticated backup encryption. Covers round-trip, wrong
 * password, tampering, no-plaintext output, and unique salt/IV. Robolectric for
 * android.util.Base64. (Uses a small iters override via a re-encrypt is not needed — the real
 * 600k KDF runs once per test and is fast enough.)
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class BackupCryptoTest {

  private val plaintext = """{"format":"logos-chat-backup","secret":"TOP_SECRET_HISTORY"}"""
  private val pass = "correct horse battery staple"

  @Test
  fun roundTrip() {
    val env = BackupCrypto.encrypt(pass, plaintext)
    assertEquals(plaintext, BackupCrypto.decrypt(pass, env))
  }

  @Test
  fun wrongPasswordFails() {
    val env = BackupCrypto.encrypt(pass, plaintext)
    try {
      BackupCrypto.decrypt("wrong passphrase", env)
      fail("decrypt must fail with a wrong passphrase")
    } catch (e: Exception) {
      // expected (AEADBadTagException / GeneralSecurityException)
    }
  }

  @Test
  fun tamperingFails() {
    val env = BackupCrypto.encrypt(pass, plaintext)
    val o = JSONObject(env)
    // flip a character in the ciphertext
    val ct = o.getString("ct")
    val tampered = ct.substring(0, ct.length - 2) + (if (ct.last() == 'A') "B=" else "A=")
    o.put("ct", tampered)
    try {
      BackupCrypto.decrypt(pass, o.toString())
      fail("decrypt must fail on tampered ciphertext")
    } catch (e: Exception) {
      // expected
    }
  }

  @Test
  fun envelopeContainsNoPlaintext() {
    val env = BackupCrypto.encrypt(pass, plaintext)
    assertFalse(env.contains("TOP_SECRET_HISTORY"))
    assertFalse(env.contains("logos-chat-backup")) // the inner plaintext marker
    assertFalse(env.contains(pass))
    // it IS a self-describing envelope
    val o = JSONObject(env)
    assertEquals(BackupCrypto.FORMAT, o.getString("format"))
    assertEquals(BackupCrypto.KDF, o.getString("kdf"))
    assertEquals(BackupCrypto.ITERS, o.getInt("iters"))
  }

  @Test
  fun saltAndIvAreUniquePerEncryption() {
    val a = JSONObject(BackupCrypto.encrypt(pass, plaintext))
    val b = JSONObject(BackupCrypto.encrypt(pass, plaintext))
    assertNotEquals(a.getString("salt"), b.getString("salt"))
    assertNotEquals(a.getString("iv"), b.getString("iv"))
    assertNotEquals(a.getString("ct"), b.getString("ct")) // different IV → different ct
  }

  @Test
  fun unrecognisedFormatRejected() {
    try {
      BackupCrypto.decrypt(pass, """{"format":"nope","iters":1,"salt":"AA==","iv":"AA==","ct":"AA=="}""")
      fail("must reject an unrecognised format")
    } catch (e: Exception) {
      assertTrue(true)
    }
  }
}
