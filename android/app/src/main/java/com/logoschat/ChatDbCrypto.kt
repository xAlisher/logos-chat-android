package com.logoschat

import android.content.Context
import android.database.sqlite.SQLiteDatabase as PlainDb
import android.util.Log
import androidx.sqlite.db.SupportSQLiteOpenHelper
import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory
import java.io.File
import java.security.SecureRandom
import net.zetetic.database.sqlcipher.SQLiteDatabase as CipherDb
import net.zetetic.database.sqlcipher.SupportOpenHelperFactory

/**
 * #258 Phase 2: encrypt the app-side ChatDb (`logoschat_mls.db`) at rest with
 * SQLCipher, keyed by a passphrase that is itself Keystore-wrapped (KeystoreCrypto).
 * That DB holds the DECRYPTED message bodies / contacts the UI renders — the biggest
 * readable exposure on the device.
 *
 * [factory] is the single entry point ChatDb uses. It:
 *   1. gets-or-creates the passphrase (Keystore-wrapped; null if the Keystore is
 *      unusable → we DON'T encrypt rather than risk losing the key),
 *   2. one-time migrates an existing PLAINTEXT db to encrypted (backup + row-count
 *      verify + rollback; the plaintext is swapped out only after verification),
 *   3. returns the SQLCipher factory when encrypted, else the framework (plaintext)
 *      factory — so the node/app always opens and data is never lost.
 *
 * Threat model = data at rest (theft/forensics/root-after-power-off), NOT a live
 * rooted process. See #258.
 */
object ChatDbCrypto {
  private const val TAG = "logos-chat-bridge"
  private const val SECURE_PREFS = "logoschat_secure"
  private const val KEY_CHATDB_KEY_ENC = "chatDbKeyEnc" // Keystore-wrapped passphrase (hex)
  private const val KEY_CHATDB_ENCRYPTED = "chatDbEncrypted" // migration-done flag
  private const val DB_NAME = "logoschat_mls.db"

  /** The OpenHelper factory ChatDb should use: SQLCipher when the db is (now)
   *  encrypted, framework (plaintext) otherwise. Safe on every path. */
  fun factory(context: Context): SupportSQLiteOpenHelper.Factory {
    try {
      System.loadLibrary("sqlcipher")
    } catch (t: Throwable) {
      Log.e(TAG, "sqlcipher native load failed (${t.message}); ChatDb stays plaintext")
      return FrameworkSQLiteOpenHelperFactory()
    }
    val keyHex = keyHexOrNull(context)
    if (keyHex == null) {
      Log.w(TAG, "no secure ChatDb key (Keystore unusable); ChatDb stays plaintext")
      return FrameworkSQLiteOpenHelperFactory()
    }
    return if (migrateIfNeeded(context, keyHex)) {
      SupportOpenHelperFactory(keyHex.toByteArray(Charsets.UTF_8))
    } else {
      FrameworkSQLiteOpenHelperFactory()
    }
  }

  /** Keystore-wrapped hex passphrase, get-or-create. Null only if the Keystore is
   *  unusable (then we don't encrypt — never store the key in plaintext). */
  private fun keyHexOrNull(context: Context): String? {
    val prefs = context.getSharedPreferences(SECURE_PREFS, Context.MODE_PRIVATE)
    prefs.getString(KEY_CHATDB_KEY_ENC, null)?.let { blob ->
      try {
        return KeystoreCrypto.unwrap(blob)
      } catch (t: Throwable) {
        Log.e(TAG, "ChatDb key unwrap failed: ${t.message}")
        return null // don't silently re-key an existing encrypted db
      }
    }
    val bytes = ByteArray(32)
    SecureRandom().nextBytes(bytes)
    val hex = bytes.joinToString("") { "%02x".format(it) }
    return try {
      val blob = KeystoreCrypto.wrap(hex)
      if (KeystoreCrypto.unwrap(blob) == hex) {
        prefs.edit().putString(KEY_CHATDB_KEY_ENC, blob).commit()
        hex
      } else {
        Log.e(TAG, "ChatDb key Keystore round-trip mismatch; staying plaintext")
        null
      }
    } catch (t: Throwable) {
      Log.e(TAG, "ChatDb key Keystore wrap failed (${t.message}); staying plaintext")
      null
    }
  }

  /**
   * Ensure the db file is encrypted with [keyHex]. Returns true if the db is (now)
   * encrypted, false if it must stay plaintext (migration failed → data preserved).
   * Idempotent via the KEY_CHATDB_ENCRYPTED flag.
   */
  private fun migrateIfNeeded(context: Context, keyHex: String): Boolean {
    val prefs = context.getSharedPreferences(SECURE_PREFS, Context.MODE_PRIVATE)
    if (prefs.getBoolean(KEY_CHATDB_ENCRYPTED, false)) return true

    val dbFile = context.getDatabasePath(DB_NAME)
    if (!dbFile.exists()) {
      // Fresh install: the SQLCipher factory will create the db encrypted.
      prefs.edit().putBoolean(KEY_CHATDB_ENCRYPTED, true).commit()
      return true
    }

    // Existing PLAINTEXT db → export into an encrypted copy, verify, swap.
    val dir = dbFile.parentFile
    val bak = File(dir, "$DB_NAME.migbak")
    val enc = File(dir, "$DB_NAME.enc")
    try {
      dbFile.copyTo(bak, overwrite = true)
      if (enc.exists()) enc.delete()

      // 1) Count rows in the PLAINTEXT db with the FRAMEWORK engine (SQLCipher's own
      //    open would try to decrypt the plaintext and fail). Checkpoint any WAL
      //    first so the main file is complete before we export it.
      val srcCount = run {
        val p = PlainDb.openDatabase(dbFile.path, null, PlainDb.OPEN_READWRITE)
        try {
          p.rawQuery("PRAGMA wal_checkpoint(FULL)", null).use { it.moveToFirst() }
          p.rawQuery("SELECT count(*) FROM conversations", null).use {
            if (it.moveToFirst()) it.getLong(0) else -1L
          }
        } finally {
          p.close()
        }
      }

      // 2) Export plaintext → encrypted. Open the ENCRYPTED target as `main` (with the
      //    key, so SQLCipher is happy), ATTACH the plaintext with an EMPTY key, and
      //    sqlcipher_export FROM the attached plaintext INTO main. keyHex is [0-9a-f]
      //    so the ATTACH string needs no escaping.
      val target = CipherDb.openOrCreateDatabase(enc.path, keyHex.toByteArray(Charsets.UTF_8), null, null)
      val encCount =
          try {
            target.rawExecSQL("ATTACH DATABASE '${dbFile.path}' AS plaintext KEY ''")
            target.rawExecSQL("SELECT sqlcipher_export('main', 'plaintext')")
            target.rawExecSQL("DETACH DATABASE plaintext")
            // sqlcipher_export copies tables + data but NOT PRAGMA user_version, so
            // carry the schema version across — else the OpenHelper sees v0 and
            // re-runs onCreate on the migrated db.
            target.rawExecSQL("PRAGMA user_version = ${ChatDb.DB_VERSION}")
            target.query("SELECT count(*) FROM conversations").use {
              if (it.moveToFirst()) it.getLong(0) else -2L
            }
          } finally {
            target.close()
          }
      if (encCount != srcCount) {
        throw IllegalStateException("row-count mismatch: plaintext=$srcCount encrypted=$encCount")
      }

      // Swap: drop the plaintext db (+ wal/shm/journal), promote the encrypted copy.
      listOf(dbFile, File("${dbFile.path}-wal"), File("${dbFile.path}-shm"), File("${dbFile.path}-journal"))
          .forEach { if (it.exists()) it.delete() }
      if (!enc.renameTo(dbFile)) throw IllegalStateException("rename enc→db failed")

      prefs.edit().putBoolean(KEY_CHATDB_ENCRYPTED, true).commit()
      bak.delete() // migration verified + committed
      Log.i(TAG, "ChatDb migrated to SQLCipher ($srcCount conversations)")
      return true
    } catch (t: Throwable) {
      Log.e(TAG, "ChatDb encryption migration failed (${t.message}); staying plaintext")
      // Rollback: make sure the plaintext db is intact; drop the partial encrypted copy.
      try {
        if (bak.exists() && (!dbFile.exists() || dbFile.length() == 0L)) {
          bak.copyTo(dbFile, overwrite = true)
        }
      } catch (r: Throwable) {
        Log.e(TAG, "ChatDb migration rollback also failed: ${r.message}")
      }
      if (enc.exists()) enc.delete()
      return false // stay plaintext — data preserved, just not encrypted
    }
  }
}
