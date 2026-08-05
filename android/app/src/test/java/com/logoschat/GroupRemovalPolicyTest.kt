package com.logoschat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #349: the app-side remove-member gate. These pin the local affordance — a regression here
 * (dropping the creator check, or reordering it after the bridge call) means an unprivileged
 * user is offered a removal that the group will drop, stranding their own client on a dead
 * epoch.
 *
 * They do NOT — and cannot — pin the protocol property: this gate runs on the caller's own
 * device and an instrumented client skips it. "A non-creator's Remove commit is applied by
 * nobody" is enforced on the RECEIVE side in the native MLS layer and pinned there — libchat
 * `group_v1.rs::remove_auth_tests` and `remove_member_authorization.rs`. See the SECURITY
 * note on GroupRemovalPolicy.kt.
 */
class GroupRemovalPolicyTest {

  private val self = "aa11bb22cc33dd44ee55ff6600778899aabbccddeeff00112233445566778899"
  private val other = "1111111111111111111111111111111111111111111111111111111111111111"

  @Test
  fun creatorMayRemoveAnotherMember() {
    val d = decideRemove(createdByMe = true, libConvoId = "lib-1", selfAddress = self, peerAddress = other)
    assertTrue("the creator's removal of a peer is allowed", d is RemoveDecision.Allow)
    assertEquals("lib-1", (d as RemoveDecision.Allow).libConvoId)
    assertEquals(other, d.target)
  }

  @Test
  fun nonCreatorIsDeniedBeforeAnythingElse() {
    val d = decideRemove(createdByMe = false, libConvoId = "lib-1", selfAddress = self, peerAddress = other)
    assertEquals(
        RemoveDecision.Deny("only the group creator can remove members"), d)
  }

  @Test
  fun theCreatorCheckPrecedesTheBoundCheck() {
    // A non-creator must be refused for LACK OF AUTHORITY, never fall through to a
    // bind/normalization error that a caller could route around.
    val d = decideRemove(createdByMe = false, libConvoId = null, selfAddress = self, peerAddress = "")
    assertEquals(RemoveDecision.Deny("only the group creator can remove members"), d)
  }

  @Test
  fun selfRemovalIsRefusedEvenForTheCreator() {
    // Self-departure is leaveGroup (#108); remove_members on our own leaf is not a valid
    // self-removal in MLS.
    val d = decideRemove(createdByMe = true, libConvoId = "lib-1", selfAddress = self, peerAddress = self)
    assertEquals(RemoveDecision.Deny("use leave group to remove yourself"), d)
  }

  @Test
  fun selfRemovalIsRefusedRegardlessOfCaseOrPadding() {
    val d =
        decideRemove(
            createdByMe = true,
            libConvoId = "lib-1",
            selfAddress = self,
            peerAddress = "  " + self.uppercase() + "  ")
    assertEquals(RemoveDecision.Deny("use leave group to remove yourself"), d)
  }

  @Test
  fun anUnboundGroupIsRefused() {
    val d = decideRemove(createdByMe = true, libConvoId = null, selfAddress = self, peerAddress = other)
    assertEquals(RemoveDecision.Deny("group not bound"), d)
    val blank = decideRemove(createdByMe = true, libConvoId = "  ", selfAddress = self, peerAddress = other)
    assertEquals(RemoveDecision.Deny("group not bound"), blank)
  }

  @Test
  fun aBlankTargetIsRefused() {
    val d = decideRemove(createdByMe = true, libConvoId = "lib-1", selfAddress = self, peerAddress = "   ")
    assertEquals(RemoveDecision.Deny("no member address given"), d)
  }

  @Test
  fun theTargetIsNormalizedForTheBridgeAndTheRoster() {
    // The same value is handed to the native verb AND used to drop the local roster row,
    // so a padded/upper-case address must not leave a stale member behind.
    val d =
        decideRemove(
            createdByMe = true,
            libConvoId = "lib-1",
            selfAddress = self,
            peerAddress = " " + other.uppercase() + "\n")
    assertEquals(other, (d as RemoveDecision.Allow).target)
  }

  @Test
  fun anUnknownSelfAddressDoesNotBlockARealRemoval() {
    // Before the node reports its address, a creator's removal of a peer still proceeds.
    val d = decideRemove(createdByMe = true, libConvoId = "lib-1", selfAddress = null, peerAddress = other)
    assertTrue(d is RemoveDecision.Allow)
    val blankSelf =
        decideRemove(createdByMe = true, libConvoId = "lib-1", selfAddress = "", peerAddress = other)
    assertTrue(blankSelf is RemoveDecision.Allow)
  }
}
