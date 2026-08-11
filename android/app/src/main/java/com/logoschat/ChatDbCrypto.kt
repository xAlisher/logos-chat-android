package com.logoschat

import android.content.Context
import android.database.sqlite.SQLiteDatabase as PlainDb
import android.util.Log
import androidx.sqlite.db.SupportSQLiteOpenHelper
import java.io.File
import java.security.SecureRandom
import net.zetetic.database.sqlcipher.SQLiteDatabase as CipherDb
import net.zetetic.database.sqlcipher.SupportOpenHelperFactory

/**
 * #358 — the ChatDb open decision, factored out of [ChatDbCrypto.factory]'s I/O so it is
 * unit-testable (Keystore + SQLCipher can't run under Robolectric). There is deliberately
 * NO plaintext outcome: the DB opens encrypted only when everything is ready, otherwise we
 * refuse to open it (data is preserved on disk for recovery). See ChatDbCryptoDecisionTest.
 */
internal enum class DbOpenDecision {
  ENCRYPTED,
  FAIL_CLOSED,
}

/**
 * @param sqlcipherLoaded the SQLCipher native engine loaded
 * @param keyAvailable a usable Keystore-wrapped passphrase was obtained/created
 * @param dbEncrypted the db is (now) encrypted — i.e. migration succeeded / fresh-encrypted
 */
internal fun decideOpen(
    sqlcipherLoaded: Boolean,
    keyAvailable: Boolean,
    dbEncrypted: Boolean,
): DbOpenDecision =
    if (sqlcipherLoaded && keyAvailable && dbEncrypted) DbOpenDecision.ENCRYPTED
    else DbOpenDecision.FAIL_CLOSED

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
 *   3. returns the SQLCipher factory when encrypted; #358: FAILS CLOSED (throws)
 *      rather than downgrading an encrypted / supposed-to-be-encrypted DB to
 *      plaintext when crypto is unavailable — see [factory].
 *
 * Threat model = data at rest (theft/forensics/root-after-power-off), NOT a live
 * rooted process. See #258 / #358.
 */
object ChatDbCrypto {
  private const val TAG = "logos-chat-bridge"
  private const val SECURE_PREFS = "logoschat_secure"
  private const val KEY_CHATDB_KEY_ENC = "chatDbKeyEnc" // Keystore-wrapped passphrase (hex)
  private const val KEY_CHATDB_ENCRYPTED = "chatDbEncrypted" // migration-done flag
  private const val DB_NAME = "logoschat_mls.db"

  /**
   * The OpenHelper factory ChatDb should use: the SQLCipher factory when the db can
   * be opened encrypted, otherwise THROW (never plaintext).
   *
   * #358 — FAIL CLOSED. Previously any crypto problem could silently return the
   * plaintext framework factory. The decision is now a single pure gate
   * ([decideOpen]): the encrypted factory is returned ONLY when the SQLCipher engine
   * loaded AND a Keystore-wrapped key is available AND the db is (now) encrypted —
   * i.e. either a genuine first run (created encrypted) or migration succeeded. Every
   * other case fails closed:
   *   - sqlcipher can't load, or the key can't be unwrapped/created (Keystore unusable);
   *   - migration of a not-yet-encrypted plaintext db FAILED while crypto was available
   *     (the old code returned a plaintext factory here — the P0 this fix closes).
   * In every fail-closed case the on-disk data (plaintext db + any `.migbak`) is left
   * intact for recovery/export.
   * TODO(#358): surface a 'secure storage unavailable' + export screen instead of a crash.
   */
  fun factory(context: Context): SupportSQLiteOpenHelper.Factory {
    val prefs = context.getSharedPreferences(SECURE_PREFS, Context.MODE_PRIVATE)
    // "This DB is (or was meant to be) encrypted" — either the migration flag is
    // set OR a Keystore-wrapped passphrase already exists. Logged for diagnostics.
    val wasEncrypted =
        prefs.getBoolean(KEY_CHATDB_ENCRYPTED, false) ||
            prefs.getString(KEY_CHATDB_KEY_ENC, null) != null

    val sqlcipherLoaded =
        try {
          System.loadLibrary("sqlcipher")
          true
        } catch (t: Throwable) {
          Log.e(TAG, "sqlcipher native load failed (${t.message})")
          false
        }

    // Only touch the key / run migration when the engine is present (both have side
    // effects: keyHexOrNull may create+store a key, migrateIfNeeded may re-encrypt).
    val keyHex = if (sqlcipherLoaded) keyHexOrNull(context) else null
    val dbEncrypted = sqlcipherLoaded && keyHex != null && migrateIfNeeded(context, keyHex)

    return when (decideOpen(sqlcipherLoaded, keyHex != null, dbEncrypted)) {
      DbOpenDecision.ENCRYPTED -> SupportOpenHelperFactory(keyHex!!.toByteArray(Charsets.UTF_8))
      DbOpenDecision.FAIL_CLOSED -> {
        // #358 P0 — never open (or create) the DB in plaintext when it is, or was meant
        // to be, encrypted. This now INCLUDES the case where crypto is available but the
        // one-time plaintext→encrypted migration failed (the pre-#358 code returned a
        // plaintext framework factory here, allowing plaintext reads/writes). The on-disk
        // data (plaintext db + any .migbak from migrateIfNeeded) is left intact for
        // recovery/export.
        // TODO(#358): needs a user-facing 'secure storage unavailable' + export screen instead of a crash
        Log.e(
            TAG,
            "ChatDb secure open unavailable (sqlcipher=$sqlcipherLoaded key=${keyHex != null} enc=$dbEncrypted wasEnc=$wasEncrypted); refusing plaintext")
        throw IllegalStateException(
            "secure storage unavailable — refusing to open the database in plaintext")
      }
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
        // #488: fail loud if the wrapped key doesn't persist — otherwise the next
        // launch derives a DIFFERENT key, the keyed-open fails, and the DB is lost.
        check(prefs.edit().putString(KEY_CHATDB_KEY_ENC, blob).commit()) {
          "ChatDb: failed to persist wrapped key"
        }
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
    // Fresh start: no db, a 0-byte file, or a leftover "phantom" that exists() reports
    // but which is NOT a readable plaintext Peers db. The last case is #445: on GrapheneOS
    // (and similar) SECURE_PREFS / the Keystore-wrapped key can survive an uninstall while
    // the db does not, so `wasEnc` is true with nothing real on disk. There is nothing to
    // migrate — drop any leftover and let the SQLCipher factory create the db fresh +
    // encrypted. Previously this fell through to the migration path, threw opening the
    // missing/invalid db, and failed CLOSED, which blocked restore after the v0.9.0
    // signing-key reinstall (ChatRepo.init could never open the db).
    if (!dbFile.exists() || dbFile.length() == 0L || !isReadablePlaintextDb(dbFile)) {
      // #488: "not a readable plaintext db" is NOT the same as "nothing real on
      // disk" — a valid SQLCipher db also fails a plaintext open (its header is
      // encrypted). Before deleting, try a KEYED open with the key we already hold.
      // If it opens, this IS the user's real encrypted database — e.g. a crash
      // between the migration rename (db already encrypted) and the flag commit
      // left it encrypted with KEY_CHATDB_ENCRYPTED still false. Keep it; just set
      // the flag. Only a file that fails BOTH a plaintext and a keyed open is a
      // genuine #445 phantom, which we still delete.
      if (dbFile.exists() && dbFile.length() > 0L && isReadableEncryptedDb(dbFile, keyHex)) {
        check(prefs.edit().putBoolean(KEY_CHATDB_ENCRYPTED, true).commit()) {
          "ChatDb: failed to persist encrypted flag for an existing encrypted db"
        }
        return true
      }
      listOf(dbFile, File("${dbFile.path}-wal"), File("${dbFile.path}-shm"), File("${dbFile.path}-journal"))
          .forEach { if (it.exists()) runCatching { it.delete() } }
      check(prefs.edit().putBoolean(KEY_CHATDB_ENCRYPTED, true).commit()) {
        "ChatDb: failed to persist encrypted flag after phantom cleanup"
      }
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

  /**
   * #445: true only if [dbFile] opens as a real plaintext Peers db (its `conversations`
   * table is queryable). A leftover/phantom entry that survived an uninstall — exists()
   * true but not a usable db — returns false, so [migrateIfNeeded] treats it as a fresh
   * run and creates a clean encrypted db instead of failing the (impossible) migration.
   * Read-only + fully guarded: any failure means "no real plaintext data to migrate".
   */
  private fun isReadablePlaintextDb(dbFile: File): Boolean =
      try {
        val p = PlainDb.openDatabase(dbFile.path, null, PlainDb.OPEN_READONLY)
        try {
          p.rawQuery("SELECT count(*) FROM conversations", null).use { it.moveToFirst() }
          true
        } finally {
          p.close()
        }
      } catch (t: Throwable) {
        false
      }

  /**
   * #488: true only if [dbFile] opens as a real SQLCipher Peers db under [keyHex]
   * (its `conversations` table is queryable). This distinguishes the user's actual
   * encrypted database — which fails [isReadablePlaintextDb] because its header is
   * encrypted — from a #445 phantom (wrong key / not a db), which throws. Read-only
   * + fully guarded: any failure means "not our encrypted db under this key", so a
   * genuine phantom is still deleted.
   */
  private fun isReadableEncryptedDb(dbFile: File, keyHex: String): Boolean =
      try {
        // Guarded by the caller to exist() && length > 0, so this opens the
        // existing file (it never creates/overwrites a non-empty db); a wrong key
        // or a non-db file throws.
        val c =
            CipherDb.openOrCreateDatabase(
                dbFile.path,
                keyHex.toByteArray(Charsets.UTF_8),
                null,
                null,
            )
        try {
          c.rawQuery("SELECT count(*) FROM conversations", null).use { it.moveToFirst() }
          true
        } finally {
          c.close()
        }
      } catch (t: Throwable) {
        false
      }
}
