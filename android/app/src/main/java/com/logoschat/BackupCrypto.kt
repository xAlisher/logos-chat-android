package com.logoschat

import android.util.Base64
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec
import org.json.JSONObject

/**
 * #361 — authenticated, passphrase-protected encryption for chat-data exports/backups.
 *
 * A backup is a portable file (it can be restored on another device), so it can't be tied to
 * this device's Keystore. Instead the user's passphrase is stretched with PBKDF2-HMAC-SHA256
 * into a 256-bit key and the backup JSON is sealed with AES-256-GCM (authenticated: a wrong
 * passphrase or any tampering fails the tag → decrypt throws). The envelope stores only the
 * KDF params + random salt/IV + ciphertext — never the passphrase or plaintext.
 *
 * KDF choice: PBKDF2 is used deliberately (no new native crypto dependency — see #366's
 * dependency-assurance goal). 600k iterations follows the OWASP 2023 guidance for
 * PBKDF2-HMAC-SHA256. A memory-hard KDF (Argon2id/scrypt) is a future upgrade if a vetted
 * dependency is adopted; the [KDF]/[iters] fields make the envelope forward-compatible.
 */
object BackupCrypto {
  const val FORMAT = "peers-backup-enc"
  const val VERSION = 1
  const val KDF = "pbkdf2-hmac-sha256"
  const val ITERS = 600_000
  private const val KEY_BITS = 256
  private const val SALT_LEN = 16
  private const val IV_LEN = 12
  private const val TAG_BITS = 128

  /** Filename prefix + extension of an exported backup file. */
  const val FILE_PREFIX = "logos-chat-backup-"
  const val FILE_EXT = ".peersenc"

  /** Name of the file an export stamped [ts] writes. */
  fun fileName(ts: String): String = "$FILE_PREFIX$ts$FILE_EXT"

  /** How long a just-written backup is kept before it's eligible for pruning — long enough
   *  for a share-sheet target to consume its one-shot content:// URI. */
  const val STALE_BACKUP_AGE_MS = 60 * 60 * 1000L // 1h

  /**
   * True if [name] is a backup file the export flow wrote. Pre-#361 exports used the same
   * prefix with a `.json` suffix, so stale *plaintext* backups still match and get pruned.
   */
  fun isBackupFile(name: String): Boolean = name.startsWith(FILE_PREFIX)

  /**
   * Delete stale backup temp files in [dir] last modified before [olderThan] (epoch ms) — and
   * *only* backup files.
   *
   * Two constraints, both from real Senti findings:
   *  - Filename-scoped (never a blanket wipe): the share-sheet cache dir also holds other
   *    outgoing attachments (e.g. `peers-identity.png` from `shareIdentityImage`) whose one-shot
   *    content:// URI may still be pending with a chooser target.
   *  - Age-scoped: a *just-created* backup can still be getting read by the share target after
   *    the sheet returns, so we only prune backups older than [olderThan] — never the fresh one.
   */
  fun pruneStaleBackups(dir: java.io.File, olderThan: Long) {
    dir.listFiles()?.forEach { f ->
      if (isBackupFile(f.name) && f.lastModified() < olderThan) runCatching { f.delete() }
    }
  }

  /** Encrypt [plaintext] under [passphrase] → a self-describing JSON envelope (no plaintext). */
  fun encrypt(passphrase: String, plaintext: String): String {
    require(passphrase.isNotEmpty()) { "empty passphrase" }
    val rng = SecureRandom()
    val salt = ByteArray(SALT_LEN).also { rng.nextBytes(it) }
    val iv = ByteArray(IV_LEN).also { rng.nextBytes(it) }
    val key = deriveKey(passphrase, salt, ITERS)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BITS, iv))
    val ct = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
    return JSONObject()
        .apply {
          put("format", FORMAT)
          put("v", VERSION)
          put("kdf", KDF)
          put("iters", ITERS)
          put("salt", b64(salt))
          put("iv", b64(iv))
          put("ct", b64(ct))
        }
        .toString()
  }

  /**
   * Decrypt an envelope produced by [encrypt]. Throws on a wrong passphrase or any tampering
   * (GCM tag failure), on an unrecognised format, or on malformed fields.
   */
  fun decrypt(passphrase: String, envelope: String): String {
    val o = JSONObject(envelope)
    require(o.optString("format") == FORMAT) { "unrecognised backup format" }
    val iters = o.getInt("iters").also { require(it in 1..10_000_000) { "bad iters" } }
    val salt = unb64(o.getString("salt"))
    val iv = unb64(o.getString("iv"))
    val ct = unb64(o.getString("ct"))
    val key = deriveKey(passphrase, salt, iters)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BITS, iv))
    return String(cipher.doFinal(ct), Charsets.UTF_8) // AEADBadTagException on wrong pw / tamper
  }

  private fun deriveKey(passphrase: String, salt: ByteArray, iters: Int): ByteArray {
    val spec = PBEKeySpec(passphrase.toCharArray(), salt, iters, KEY_BITS)
    return try {
      SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
    } finally {
      spec.clearPassword()
    }
  }

  private fun b64(b: ByteArray): String = Base64.encodeToString(b, Base64.NO_WRAP)

  private fun unb64(s: String): ByteArray = Base64.decode(s, Base64.NO_WRAP)
}
