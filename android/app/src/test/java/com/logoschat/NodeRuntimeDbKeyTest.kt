package com.logoschat

import android.content.Context
import org.junit.Assert.assertNull
import org.junit.Assert.fail
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * #358 P0 regression for [NodeRuntime.dbKey]: a fresh install whose Keystore is unusable
 * must FAIL CLOSED — throw and persist NO plaintext store key. The pre-#358 code wrote the
 * fresh key to SharedPreferences in plaintext and returned it.
 *
 * Robolectric ships no `AndroidKeyStore` provider, so [KeystoreCrypto.wrap] throws here —
 * which is exactly the "Keystore unusable" condition this fix targets. The test asserts the
 * precondition (via assumeTrue) so it can't silently pass if a future Robolectric adds one.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class NodeRuntimeDbKeyTest {

  @Test
  fun freshInstall_keystoreUnavailable_failsClosed_noPlaintextKey() {
    val keystoreUnusable =
        try {
          KeystoreCrypto.wrap("probe")
          false
        } catch (t: Throwable) {
          true
        }
    assumeTrue("needs an environment without a usable AndroidKeyStore", keystoreUnusable)

    val ctx = RuntimeEnvironment.getApplication()
    val prefs = ctx.getSharedPreferences(NodeRuntime.SECURE_PREFS, Context.MODE_PRIVATE)
    prefs.edit().clear().commit() // truly fresh install

    try {
      NodeRuntime.dbKey(ctx)
      fail("expected IllegalStateException — must not persist a plaintext fallback key")
    } catch (e: IllegalStateException) {
      // expected: fail closed
    }

    assertNull(
        "plaintext store key must NOT be written to SharedPreferences",
        prefs.getString(NodeRuntime.KEY_DB_KEY, null))
    assertNull(
        "no wrapped key should have been written either (wrap failed)",
        prefs.getString(NodeRuntime.KEY_DB_KEY_ENC, null))
  }
}
