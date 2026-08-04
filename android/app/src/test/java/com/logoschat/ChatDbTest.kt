package com.logoschat

import android.database.sqlite.SQLiteConstraintException
import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** M1' schema unit tests — the address-keyed logoschat_mls.db. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class ChatDbTest {

  private lateinit var db: ChatDb
  private val ADDR = "a".repeat(64)
  private val ADDR2 = "b".repeat(64)

  @Before
  fun setUp() {
    // name=null → in-memory database, fresh per test. SQLCipher can't run under
    // Robolectric, so back the store with the framework (plaintext) factory.
    db = ChatDb(RuntimeEnvironment.getApplication(), null, FrameworkSQLiteOpenHelperFactory())
  }

  @Test
  fun schemaHasExpectedTables() {
    val tables = mutableSetOf<String>()
    db.readableDatabase
        .query("SELECT name FROM sqlite_master WHERE type='table'")
        .use { c -> while (c.moveToNext()) tables.add(c.getString(0)) }
    for (t in listOf("kv", "conversations", "messages")) {
      assertTrue("missing table $t", t in tables)
    }
    // the ephemeral-model tables are GONE
    for (t in listOf("epochs", "contacts", "convo_sessions")) {
      assertFalse("stale table $t present", t in tables)
    }
    assertEquals(ChatDb.DB_VERSION, db.readableDatabase.version)
  }

  @Test
  fun kvRoundTrip() {
    assertNull(db.kvGet("displayName"))
    db.kvSet("displayName", "phone")
    db.kvSet("displayName", "phone-m1") // upsert
    assertEquals("phone-m1", db.kvGet("displayName"))
  }

  @Test
  fun conversationByAddressAndLibId() {
    val pk = db.insertConversation(ADDR, null, "peer", 1000)
    assertEquals(pk, db.convoPkByAddress(ADDR))
    assertNull(db.convoPkByLibId("nope"))
    db.setLibConvoId(pk, "lib-123")
    assertEquals(pk, db.convoPkByLibId("lib-123"))
    assertEquals("lib-123", db.libConvoIdOf(pk))
    assertEquals(ADDR, db.peerAddressOf(pk))
  }

  /**
   * #194: recreating a group must FOLD into the member's existing thread, not
   * clone. The fold mechanic is a rebind old→new lib id on the SAME convo_pk:
   * the new id resolves to that convo, the old id no longer resolves, and no
   * second conversation row appears.
   */
  @Test
  fun continuationRebindFoldsIntoSameConvoNoClone() {
    val pk = db.insertConversation(null, "old-lib", null, 1000)
    db.markGroup(pk, "Trio")
    assertEquals(1, db.counts().first)

    // The member receives the re-created group and rebinds old→new (the fold).
    db.setLibConvoId(pk, "new-lib")

    assertEquals("new id resolves to the same convo", pk, db.convoPkByLibId("new-lib"))
    assertNull("old id no longer a separate row", db.convoPkByLibId("old-lib"))
    assertEquals("no clone — still one conversation", 1, db.counts().first)
    assertEquals("new-lib", db.libConvoIdOf(pk))
  }

  @Test
  fun learnAddressAndNickname() {
    val pk = db.insertConversation(null, "lib-x", null, 1000)
    assertNull(db.peerAddressOf(pk))
    db.setPeerAddress(pk, ADDR)
    assertEquals(ADDR, db.peerAddressOf(pk))
    db.setNickname(pk, "desktop")
    val row = JSONArray(db.listConversationsJson()).getJSONObject(0)
    assertEquals("desktop", row.getString("nickname"))
    assertEquals(ADDR, row.getString("peerAddress"))
    assertTrue(row.getBoolean("bound"))
  }

  @Test
  fun messagePaginationNewestFirst() {
    val pk = db.insertConversation(ADDR, "lib", null, 1000)
    for (i in 1..10) db.insertMessage(pk, "in", "msg$i", 1000L + i, "received")
    val page1 = JSONArray(db.listMessagesJson(pk, 0, 4))
    assertEquals(4, page1.length())
    assertEquals("msg10", page1.getJSONObject(0).getString("text"))
    val oldest = page1.getJSONObject(3).getLong("msgPk")
    val page2 = JSONArray(db.listMessagesJson(pk, oldest, 4))
    assertEquals("msg6", page2.getJSONObject(0).getString("text"))
  }

  @Test
  fun checkConstraintsRejectBadEnums() {
    val pk = db.insertConversation(ADDR, "lib", null, 1000)
    try {
      db.insertMessage(pk, "sideways", "hi", 1000, "sent")
      fail("direction CHECK not enforced")
    } catch (_: SQLiteConstraintException) {}
    try {
      db.insertMessage(pk, "in", "hi", 1000, "delivered") // not a valid status
      fail("status CHECK not enforced")
    } catch (_: SQLiteConstraintException) {}
  }

  @Test
  fun unreadCountsPersistAndClear() {
    val pk = db.insertConversation(ADDR, "lib", null, 1000)
    db.insertMessage(pk, "in", "one", 1001, "received")
    db.bumpUnread(pk)
    db.insertMessage(pk, "in", "two", 1002, "received")
    db.bumpUnread(pk)
    var row = JSONArray(db.listConversationsJson()).getJSONObject(0)
    assertEquals(2, row.getInt("unread"))
    db.markRead(pk)
    row = JSONArray(db.listConversationsJson()).getJSONObject(0)
    assertEquals(0, row.getInt("unread"))
  }

  @Test
  fun listOrdersByRecencyWithLastMessagePreview() {
    val a = db.insertConversation(ADDR, "la", "A", 1000)
    val b = db.insertConversation(ADDR2, "lb", "B", 1000)
    db.insertMessage(a, "out", "old", 1001, "sent"); db.touchConversation(a, 1001)
    db.insertMessage(b, "in", "new", 2001, "received"); db.touchConversation(b, 2001)
    val rows = JSONArray(db.listConversationsJson())
    assertEquals(b, rows.getJSONObject(0).getLong("convoPk")) // newest first
    assertEquals("new", rows.getJSONObject(0).getString("lastText"))
    assertEquals("in", rows.getJSONObject(0).getString("lastDirection"))
  }

  @Test
  fun deleteConversationRemovesMessages() {
    val pk = db.insertConversation(ADDR, "lib", null, 1000)
    db.insertMessage(pk, "out", "x", 1001, "sent")
    db.deleteConversation(pk)
    assertEquals(0, JSONArray(db.listConversationsJson()).length())
    assertEquals(0, JSONArray(db.listMessagesJson(pk, 0, 10)).length())
  }

  @Test
  fun displayNamePrefersNicknameThenShortAddress() {
    val named = db.insertConversation(ADDR, "l1", "desktop", 1000)
    assertEquals("desktop", db.displayNameFor(named))
    val unnamed = db.insertConversation(ADDR2, "l2", null, 1000)
    assertEquals(ADDR2.substring(0, 8), db.displayNameFor(unnamed))
  }

  // -- groups (M2') ----------------------------------------------------------

  @Test
  fun schemaHasGroupTablesAndColumns() {
    val tables = mutableSetOf<String>()
    db.readableDatabase
        .query("SELECT name FROM sqlite_master WHERE type='table'")
        .use { c -> while (c.moveToNext()) tables.add(c.getString(0)) }
    assertTrue("missing group_members table", "group_members" in tables)
    assertEquals(ChatDb.DB_VERSION, db.readableDatabase.version)
  }

  // -- #112 dead-group bridge -------------------------------------------------

  @Test
  fun createdByMeDefaultsFalseAndIsSetOnlyForOurOwnGroups() {
    // A JOINER's group row (created from an inbound welcome) must NOT be ours,
    // or two devices would both try to re-create it and fork the group.
    val joined = db.insertConversation(null, "jlib", null, 1000, isGroup = true)
    assertTrue("a joined group must not be marked ours", !db.createdByMe(joined))

    val mine =
        db.insertConversation(
            null, "mlib", null, 1000, isGroup = true, groupName = "mine", createdByMe = true)
    assertTrue("our own group must be marked ours", db.createdByMe(mine))
  }

  @Test
  fun groupNameAndRosterSurviveForRecreate() {
    val g =
        db.insertConversation(
            null, "glib2", null, 1000, isGroup = true, groupName = "crew", createdByMe = true)
    db.addGroupMember(g, ADDR, isSelf = true, addedAt = 1000)
    db.addGroupMember(g, ADDR2, isSelf = false, addedAt = 1001)
    // Re-creating a dead group reuses the name and re-invites the persisted roster.
    assertEquals("crew", db.groupNameOf(g))
    assertEquals(listOf(ADDR, ADDR2), db.groupMemberAddresses(g))
  }

  @Test
  fun wipeClearsContentButKeepsTheConversation() {
    // Wipe must NOT delete the row: there is no way to leave a group yet, so the
    // conversation has to survive in order to keep receiving new messages.
    val g = db.insertConversation(null, "glib3", null, 1000, isGroup = true, groupName = "keep")
    db.insertMessage(g, "in", "hello", 1000, "received")
    db.insertMessage(g, "out", "bye", 1001, "sent")
    db.wipeConversationContent(g)
    assertEquals("[]", db.listMessagesJson(g, 0, 10))
    assertTrue("the conversation row must survive a wipe", db.isGroup(g))
    assertEquals("keep", db.groupNameOf(g))
  }

  @Test
  fun groupConversationSurfacesIsGroupAndName() {
    val g = db.insertConversation(null, "glib", null, 1000, isGroup = true, groupName = "dev team")
    assertTrue(db.isGroup(g))
    assertEquals("dev team", db.displayNameFor(g)) // group name wins
    val row = JSONArray(db.listConversationsJson()).getJSONObject(0)
    assertTrue(row.getBoolean("isGroup"))
    assertEquals("dev team", row.getString("groupName"))
  }

  @Test
  fun groupMemberRosterDedupesAndCounts() {
    val g = db.insertConversation(null, "glib", null, 1000, isGroup = true, groupName = "g")
    db.addGroupMember(g, ADDR, isSelf = true, addedAt = 1000)
    db.addGroupMember(g, ADDR2, isSelf = false, addedAt = 1001)
    db.addGroupMember(g, ADDR2, isSelf = false, addedAt = 1002) // dup → ignored
    assertEquals(2, db.groupMemberCount(g))
    val roster = JSONArray(db.listGroupMembersJson(g))
    assertEquals(2, roster.length())
    assertTrue(roster.getJSONObject(0).getBoolean("isSelf")) // self first
    val row = JSONArray(db.listConversationsJson()).getJSONObject(0)
    assertEquals(2, row.getInt("memberCount"))
  }

  @Test
  fun markGroupPromotesInboundConversation() {
    val pk = db.insertConversation(null, "inbound-glib", null, 1000)
    assertFalse(db.isGroup(pk))
    db.markGroup(pk, "welcomed")
    assertTrue(db.isGroup(pk))
    assertEquals("welcomed", db.displayNameFor(pk))
  }

  @Test
  fun messageStoresSenderAccountForGroupAttribution() {
    val g = db.insertConversation(null, "glib", null, 1000, isGroup = true, groupName = "g")
    db.insertMessage(g, "in", "hi all", 1001, "received", ADDR2)
    val msg = JSONArray(db.listMessagesJson(g, 0, 10)).getJSONObject(0)
    assertEquals(ADDR2, msg.getString("senderAccount"))
  }

  @Test
  fun dedupInboundMergesDualTransportCopies() {
    // #168 dual-send: a mirrored group's message arrives via BOTH transports; the
    // second copy must merge into the first (marked 'both'), not add a bubble.
    val g = db.insertConversation(null, "glib", null, 1000, isGroup = true, groupName = "g")
    db.setMeshMirror(g, 1, "k".repeat(32))
    assertTrue(db.isMeshMode(g))
    val m1 = db.insertMessage(g, "in", "hello team", 5000, "received", null, "mesh")
    // the Logos copy within the window → dedup returns m1 and upgrades it to 'both'.
    assertEquals(m1, db.dedupInbound(g, "hello team", 5200, "logos"))
    val msg = JSONArray(db.listMessagesJson(g, 0, 10)).getJSONObject(0)
    assertEquals("both", msg.getString("sentVia"))
    // different content is not a dup; same content outside the window is not a dup.
    assertEquals(-1L, db.dedupInbound(g, "different", 5300, "logos"))
    assertEquals(-1L, db.dedupInbound(g, "hello team", 5000L + 11L * 60 * 1000, "logos"))
  }

  @Test
  fun mergeDirectConversationReconcilesReinstalledPeerByAccount() {
    // #175/#176: durable contact (labeled, old dead binding) + a transient convo the
    // reinstalled peer forked (new live convoId). Merge must keep the contact's
    // identity/label + its history, adopt the new binding, drop the transient row.
    val canonical = db.insertConversation(ADDR, "lib-old", "Pixel", 1000)
    db.setVerified(canonical, true)
    db.insertMessage(canonical, "in", "old-history", 1001, "received", ADDR)
    val transient = db.insertConversation(null, "lib-new", null, 2000)
    db.insertMessage(transient, "in", "fresh-after-reinstall", 2001, "received", ADDR)

    db.mergeDirectConversation(fromPk = transient, intoPk = canonical, newLibConvoId = "lib-new")

    // transient row is gone; the account resolves to exactly one conversation.
    assertNull(db.libConvoIdOf(transient))
    assertEquals(canonical, db.convoPkByAddress(ADDR))
    // survivor kept its label/verified/mesh identity and adopted the LIVE binding.
    val row = JSONArray(db.listConversationsJson()).getJSONObject(0)
    assertEquals("Pixel", row.getString("nickname"))
    assertTrue(row.getBoolean("verified"))
    assertEquals(canonical, db.convoPkByLibId("lib-new"))
    assertNull(db.convoPkByLibId("lib-old"))
    // both messages now live under the one contact.
    val msgs = JSONArray(db.listMessagesJson(canonical, 0, 10))
    assertEquals(2, msgs.length())
  }

  // -- mesh contact roster (#172) --------------------------------------------

  @Test
  fun meshContactUpsertListAndPrefixLookup() {
    val pk1 = "a".repeat(64)
    val pk2 = "b".repeat(64)
    db.upsertMeshContact(pk1, "Tariqa", 1000)
    db.upsertMeshContact(pk2, "T1", 2000)

    // list: JSON [{pubkeyHex,name}], newest-seen first (pk2 has later last_seen).
    val arr = JSONArray(db.listMeshContactsJson())
    assertEquals(2, arr.length())
    assertEquals(pk2, arr.getJSONObject(0).getString("pubkeyHex"))
    assertEquals("T1", arr.getJSONObject(0).getString("name"))
    assertEquals(pk1, arr.getJSONObject(1).getString("pubkeyHex"))
    assertEquals("Tariqa", arr.getJSONObject(1).getString("name"))

    // prefix lookup: the 6-byte (12-hex) pubkey prefix resolves the display name.
    assertEquals("Tariqa", db.meshContactName(pk1.substring(0, 12)))
    assertEquals("T1", db.meshContactName(pk2.substring(0, 12)))
    assertNull(db.meshContactName("c".repeat(12)))
  }

  @Test
  fun meshContactUpsertIsIdempotentAndRefreshes() {
    val pk = "a".repeat(64)
    db.upsertMeshContact(pk, "Old", 1000)
    // Re-upsert same key: updates name + last_seen in place, no duplicate row.
    db.upsertMeshContact(pk, "New", 3000)
    val arr = JSONArray(db.listMeshContactsJson())
    assertEquals(1, arr.length())
    assertEquals("New", arr.getJSONObject(0).getString("name"))
    assertEquals(3000L, arr.getJSONObject(0).getLong("lastSeen"))

    // An empty incoming name must NOT clobber a previously-learned one.
    db.upsertMeshContact(pk, "", 4000)
    val arr2 = JSONArray(db.listMeshContactsJson())
    assertEquals(1, arr2.length())
    assertEquals("New", arr2.getJSONObject(0).getString("name"))
    assertEquals(4000L, arr2.getJSONObject(0).getLong("lastSeen"))
  }

  @Test
  fun meshContactsEmptyRosterListsAsEmptyArray() {
    assertEquals(0, JSONArray(db.listMeshContactsJson()).length())
    assertNull(db.meshContactName("a".repeat(12)))
  }

  /** #361/#365: an export must never carry the PIN/duress verifiers (offline-guessing risk),
   *  while ordinary kv settings still round-trip. */
  @Test
  fun exportExcludesPinAndDuressVerifiers() {
    db.kvSet("pinVerifier", "SECRET_PIN_VERIFIER_VALUE")
    db.kvSet("duressVerifier", "SECRET_DURESS_VERIFIER_VALUE")
    db.kvSet("displayName", "phone-export")

    val json = db.exportJson()

    // sensitive verifiers — neither the key nor the value may appear
    assertFalse(json.contains("SECRET_PIN_VERIFIER_VALUE"))
    assertFalse(json.contains("SECRET_DURESS_VERIFIER_VALUE"))
    assertFalse(json.contains("pinVerifier"))
    assertFalse(json.contains("duressVerifier"))
    // ordinary settings still exported
    assertTrue(json.contains("displayName"))
    assertTrue(json.contains("phone-export"))
  }
}
