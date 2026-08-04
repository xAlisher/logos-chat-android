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

  @Test
  fun isBackupFile_matchesBackupsNotAttachments() {
    assertTrue(BackupCrypto.isBackupFile(BackupCrypto.fileName("20260804-120000")))
    assertTrue(BackupCrypto.isBackupFile("logos-chat-backup-old.json")) // pre-#361 plaintext
    assertFalse(BackupCrypto.isBackupFile("peers-identity.png")) // shareIdentityImage attachment
    assertFalse(BackupCrypto.isBackupFile("something-else.dat"))
    assertTrue(BackupCrypto.fileName("ts").endsWith(BackupCrypto.FILE_EXT))
  }

  /**
   * #405 P2 (both findings): cleanup must delete only *backup* files (never a co-located share
   * attachment), and only *old* ones — a just-written backup can still be getting read by a
   * share target after the sheet returns.
   */
  @Test
  fun pruneStaleBackups_deletesOldBackupsOnly_sparesRecentAndAttachments() {
    val dir = java.nio.file.Files.createTempDirectory("exports").toFile()
    val now = System.currentTimeMillis()
    val twoHoursAgo = now - 2 * 60 * 60 * 1000L
    val oldEnc =
        java.io.File(dir, BackupCrypto.fileName("20200101-000000")).apply {
          writeText("x"); setLastModified(twoHoursAgo)
        }
    val oldJson =
        java.io.File(dir, "logos-chat-backup-old.json").apply {
          writeText("x"); setLastModified(twoHoursAgo)
        }
    val recentEnc =
        java.io.File(dir, BackupCrypto.fileName("20260804-120000")).apply {
          writeText("x"); setLastModified(now)
        }
    val identity =
        java.io.File(dir, "peers-identity.png").apply { writeText("x"); setLastModified(twoHoursAgo) }
    val unrelated =
        java.io.File(dir, "something-else.dat").apply { writeText("x"); setLastModified(twoHoursAgo) }

    BackupCrypto.pruneStaleBackups(dir, now - BackupCrypto.STALE_BACKUP_AGE_MS)

    assertFalse("old .peersenc backup should be pruned", oldEnc.exists())
    assertFalse("old legacy .json backup should be pruned", oldJson.exists())
    assertTrue("recent backup (share may still be reading it) must be spared", recentEnc.exists())
    assertTrue("shareIdentityImage attachment must be spared", identity.exists())
    assertTrue("unrelated file must be spared", unrelated.exists())
  }
}
