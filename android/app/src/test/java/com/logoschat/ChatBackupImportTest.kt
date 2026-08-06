package com.logoschat

import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * #440 restore + the #443 review finding.
 *
 * THE REGRESSION THIS PINS: `importAndRestart` wipes the device, then calls
 * `ChatDb.importJson`. That import can throw on a backup this build's schema can't
 * read — the exported `schemaVersion` was never checked — and the throw was caught,
 * logged, and dropped. The node then reopened and the promise resolved, so the UI
 * said "Restored 0x…" while the user's conversations, messages and contacts had just
 * been discarded. A silent data-loss report as a success.
 *
 * So: a backup this build can't read must be REFUSED BY VALIDATION (before anything
 * destructive runs), and validation must not be so strict that a legitimate backup is
 * turned away.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class ChatBackupImportTest {

  private lateinit var db: ChatDb
  private val ADDR = "a".repeat(64)
  private val ADDR2 = "b".repeat(64)

  @Before
  fun setUp() {
    // name=null → fresh in-memory DB per test (SQLCipher can't run under Robolectric).
    db = ChatDb(RuntimeEnvironment.getApplication(), null, FrameworkSQLiteOpenHelperFactory())
  }

  private fun freshDb() =
      ChatDb(RuntimeEnvironment.getApplication(), null, FrameworkSQLiteOpenHelperFactory())

  /** Populate a device's worth of state, the way an export would find it. */
  private fun seed(source: ChatDb) {
    source.kvSet("displayName", "phone-a")
    val pk = source.insertConversation(ADDR, null, "peer", 1_000)
    source.insertMessage(pk, "out", "hello", 1_001, "sent")
    source.insertMessage(pk, "in", "hi back", 1_002, "received")
    source.insertConversation(ADDR2, null, "peer", 2_000)
  }

  /** The happy path the feature exists for: export → fresh device → import → same data. */
  @Test
  fun exportRoundTripsIntoAFreshDb() {
    seed(db)
    val json = db.exportJson()

    val target = freshDb()
    assertEquals(0 to 0, target.counts())
    target.importJson(json)

    assertEquals("phone-a", target.kvGet("displayName"))
    val pk = target.convoPkByAddress(ADDR)
    assertNotNull("conversation not restored", pk)
    assertNotNull(target.convoPkByAddress(ADDR2))
    assertEquals(2 to 2, target.counts())
    assertTrue(target.listMessagesJson(pk!!, 0, 50).contains("hello"))
  }

  /** Re-running a restore must not duplicate rows (INSERT OR REPLACE, one transaction). */
  @Test
  fun importIsIdempotent() {
    seed(db)
    val json = db.exportJson()
    val target = freshDb()
    target.importJson(json)
    target.importJson(json)
    assertEquals(2 to 2, target.counts())
  }

  /**
   * THE FINDING. A backup written by a NEWER schema carries a column this build's table
   * does not have. Before the fix that only blew up inside `importJson` — i.e. after the
   * wipe. Now validation refuses it, and refuses it BEFORE writing anything.
   */
  @Test
  fun newerSchemaBackupIsRefusedAndWritesNothing() {
    seed(db)
    val root = JSONObject(db.exportJson())
    root.put("schemaVersion", ChatDb.DB_VERSION + 1)
    // …and the column that future version added.
    root.getJSONArray("messages").getJSONObject(0).put("reaction_summary", "👍x3")

    val target = freshDb()
    val err = assertRefused(target, root.toString())
    assertTrue(
        "error must name the version problem, was: $err",
        err.contains("newer version") && err.contains("v${ChatDb.DB_VERSION + 1}"))
    // Nothing was written on the way to the refusal.
    assertEquals(0 to 0, target.counts())
    assertNull(target.kvGet("displayName"))
  }

  /**
   * Same schemaVersion, but a column this build's table doesn't have (a hand-edited or
   * corrupted backup). `INSERT INTO messages (…, bogus_col)` would raise SQLiteException
   * mid-import; validation has to catch it up front instead.
   */
  @Test
  fun unknownColumnIsRefusedAndWritesNothing() {
    seed(db)
    val root = JSONObject(db.exportJson())
    root.getJSONArray("conversations").getJSONObject(0).put("bogus_col", 1)

    val target = freshDb()
    val err = assertRefused(target, root.toString())
    assertTrue("error must name the column, was: $err", err.contains("bogus_col"))
    assertEquals(0 to 0, target.counts())
  }

  /** A file that decrypts but isn't a backup at all. */
  @Test
  fun foreignJsonIsRefused() {
    val err = assertRefused(freshDb(), """{"hello":"world"}""")
    assertTrue("was: $err", err.contains("not a Peers backup"))
  }

  /** Not JSON at all — must be a clean IllegalArgumentException, not a raw JSONException. */
  @Test
  fun garbageIsRefused() {
    val err = assertRefused(freshDb(), "not json at all")
    assertTrue("was: $err", err.contains("not a Peers backup"))
  }

  /** A pre-#38 payload with the right marker but no schemaVersion can't be gated — refuse. */
  @Test
  fun missingSchemaVersionIsRefused() {
    val root = JSONObject().apply { put("format", ChatDb.BACKUP_FORMAT) }
    val err = assertRefused(freshDb(), root.toString())
    assertTrue("was: $err", err.contains("schemaVersion"))
  }

  /** A table whose value isn't an array of objects must be caught by validation, not SQL. */
  @Test
  fun malformedTablePayloadIsRefused() {
    val root =
        JSONObject().apply {
          put("format", ChatDb.BACKUP_FORMAT)
          put("schemaVersion", ChatDb.DB_VERSION)
          put("kv", JSONArray().apply { put("a bare string, not a row") })
        }
    val err = assertRefused(freshDb(), root.toString())
    assertTrue("was: $err", err.contains("malformed"))
  }

  /**
   * An OLDER backup (fewer columns than this build) is a legitimate upgrade path and must
   * still import — validation checks that the backup's columns are known here, not that
   * this build's columns are all present.
   */
  @Test
  fun olderSchemaBackupStillImports() {
    seed(db)
    val root = JSONObject(db.exportJson())
    root.put("schemaVersion", 1)
    // Strip the columns a v1 export wouldn't have had.
    val convos = root.getJSONArray("conversations")
    for (i in 0 until convos.length()) {
      convos.getJSONObject(i).remove("transport")
      convos.getJSONObject(i).remove("is_group")
    }

    val target = freshDb()
    target.importJson(root.toString())
    assertNotNull(target.convoPkByAddress(ADDR))
  }

  /** The validation pass and the import loop must cover the same tables — no drift. */
  @Test
  fun restorableTablesAreAllRealTables() {
    val real = mutableSetOf<String>()
    db.readableDatabase
        .query("SELECT name FROM sqlite_master WHERE type='table'")
        .use { c -> while (c.moveToNext()) real.add(c.getString(0)) }
    for (t in ChatDb.RESTORABLE_TABLES) assertTrue("unknown restorable table $t", t in real)
    // conversations must precede the tables holding its pk, or the restore order is wrong.
    val order = ChatDb.RESTORABLE_TABLES
    assertTrue(order.indexOf("conversations") < order.indexOf("messages"))
    assertTrue(order.indexOf("conversations") < order.indexOf("group_members"))
  }

  /**
   * Assert [json] is refused by BOTH the standalone gate (what runs before the wipe) and
   * [ChatDb.importJson] itself, and return the message.
   */
  private fun assertRefused(target: ChatDb, json: String): String {
    var message: String? = null
    try {
      target.validateImportJson(json)
      fail("validateImportJson accepted a backup it cannot restore")
    } catch (e: IllegalArgumentException) {
      message = e.message
    }
    try {
      target.importJson(json)
      fail("importJson accepted a backup validation rejected")
    } catch (e: IllegalArgumentException) {
      // expected — importJson re-runs the gate so it is safe called directly
    }
    return message ?: ""
  }
}
