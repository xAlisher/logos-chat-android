package com.logoschat

import java.io.File
import java.io.FileFilter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * #492 (Senti review) P2 regression: the duress/reset wipe must REPORT completeness.
 *
 * THE BUG THIS PINS: the databases/ sweep added for #492 removes the plaintext
 * `peers_chat.db.migbak` (a decrypted copy of the whole chat history) — but it only
 * logged when `listFiles()` came back null or a `delete()` returned false, and
 * `wipeAndReinit` returned nothing. `NodeRuntime.wipeAndRestart` therefore kept
 * `wipeOk = true` and told the user the reset succeeded while the plaintext history was
 * still on disk. That is the exact false-success partial wipe #490 exists to prevent.
 *
 * [sweepSiblings] is the file-level primitive behind the sweep, so the failure modes can
 * be driven directly: a real temp dir for the happy path, and File subclasses for the
 * two failures a real device produces but a temp dir will not (an unreadable listing and
 * a delete the filesystem refuses).
 */
@RunWith(RobolectricTestRunner::class)
// Plain Application: the real one opens ChatDb (SQLCipher/Keystore) at startup, which
// cannot run under Robolectric. This test only needs android.util.Log.
@Config(sdk = [34], application = android.app.Application::class)
class ChatRepoWipeSweepTest {

  @get:Rule val tmp = TemporaryFolder()

  private val TAG = "logos-chat-db-test"
  private val DB = "peers_chat.db"

  private fun touch(dir: File, name: String): File =
      File(dir, name).apply { writeText("x") }

  @Test
  fun deletesEveryPrefixedSibling_andReportsComplete() {
    val dir = tmp.newFolder("databases")
    val migbak = touch(dir, "$DB.migbak") // PLAINTEXT history copy — the whole point
    val enc = touch(dir, "$DB.enc")
    val wal = touch(dir, "$DB-wal")
    val db = touch(dir, DB)
    val unrelated = touch(dir, "other.db")

    assertTrue(sweepSiblings(dir, DB, TAG))

    assertFalse("plaintext .migbak survived the wipe", migbak.exists())
    assertFalse(enc.exists())
    assertFalse(wal.exists())
    assertFalse(db.exists())
    assertTrue("the sweep must not touch unrelated databases", unrelated.exists())
  }

  @Test
  fun emptyDirIsComplete() {
    assertTrue(sweepSiblings(tmp.newFolder("databases"), DB, TAG))
  }

  @Test
  fun missingDirIsComplete_nothingSurvived() {
    val gone = File(tmp.root, "no-such-databases")
    assertTrue(sweepSiblings(gone, DB, TAG))
  }

  @Test
  fun nullDirIsIncomplete() {
    // getDatabasePath(...).parentFile came back null: we deleted nothing and can prove
    // nothing. Must NOT read as a clean wipe.
    assertFalse(sweepSiblings(null, DB, TAG))
  }

  /** An existing directory whose listing is unavailable (`listFiles()` == null). */
  private class UnlistableDir(path: File) : File(path.path) {
    override fun exists() = true
    override fun listFiles(filter: FileFilter?): Array<File>? = null
    override fun listFiles(): Array<File>? = null
  }

  @Test
  fun nullListingIsIncomplete_aMigbakMayStillBeThere() {
    // The pre-fix code did `?.listFiles(...)?.forEach {}` — a null listing silently did
    // nothing and the wipe still reported success.
    assertFalse(sweepSiblings(UnlistableDir(tmp.newFolder("databases")), DB, TAG))
  }

  /** A file the filesystem refuses to delete. */
  private class UndeletableFile(dir: File, name: String) : File(dir, name) {
    override fun exists() = true
    override fun delete() = false
  }

  /** A file that is already gone: delete() is false, but so is exists() — that's clean. */
  private class AlreadyGoneFile(dir: File, name: String) : File(dir, name) {
    override fun exists() = false
    override fun delete() = false
  }

  private class DirListing(path: File, val entries: Array<File>) : File(path.path) {
    override fun exists() = true
    override fun listFiles(filter: FileFilter?): Array<File> =
        entries.filter { filter == null || filter.accept(it) }.toTypedArray()
  }

  @Test
  fun aFailedDeleteIsIncomplete() {
    val dir = tmp.newFolder("databases")
    val stuck = UndeletableFile(dir, "$DB.migbak")
    assertFalse(sweepSiblings(DirListing(dir, arrayOf(stuck)), DB, TAG))
  }

  @Test
  fun oneFailedDeleteTaintsTheWholeSweep_butTheRestStillGo() {
    val dir = tmp.newFolder("databases")
    val stuck = UndeletableFile(dir, "$DB.migbak")
    val real = touch(dir, "$DB.enc")

    assertFalse(sweepSiblings(DirListing(dir, arrayOf(stuck, real)), DB, TAG))
    assertFalse("the sweep must keep deleting past a failure", real.exists())
  }

  @Test
  fun aRaceLostToSomeoneElsesDeleteIsStillComplete() {
    // delete() returns false for a file that is ALREADY gone. That is a clean outcome,
    // not a failure — otherwise every wipe would report incomplete.
    val dir = tmp.newFolder("databases")
    val gone = AlreadyGoneFile(dir, "$DB.migbak")
    assertTrue(sweepSiblings(DirListing(dir, arrayOf(gone)), DB, TAG))
  }

  @Test
  fun aThrowingWalkIsIncomplete() {
    val boom =
        object : File(tmp.root.path) {
          override fun exists() = true
          override fun listFiles(filter: FileFilter?): Array<File> =
              throw SecurityException("denied")
        }
    assertFalse(sweepSiblings(boom, DB, TAG))
  }

  @Test
  fun theFilterIsAPrefixMatch_notEquality() {
    val dir = tmp.newFolder("databases")
    touch(dir, "$DB.migbak")
    touch(dir, "not_$DB")
    assertTrue(sweepSiblings(dir, DB, TAG))
    assertEquals(listOf("not_$DB"), dir.list()!!.toList())
  }
}
