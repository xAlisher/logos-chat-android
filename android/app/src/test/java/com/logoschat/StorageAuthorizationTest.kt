package com.logoschat

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StorageAuthorizationTest {
  @Test
  fun capabilityAllowsDownloadWithoutSharedBearer() {
    assertTrue(StorageAuthorization.canDownload("", "deadbeef"))
  }

  @Test
  fun legacyBearerAllowsCaplessDownload() {
    assertTrue(StorageAuthorization.canDownload("legacy-token", ""))
  }

  @Test
  fun downloadWithoutBearerOrCapabilityFailsClosed() {
    assertFalse(StorageAuthorization.canDownload("", ""))
  }

  @Test
  fun bearerHeaderIsOnlyPresentForLegacyCredential() {
    assertTrue(StorageAuthorization.bearerHeader("").isEmpty())
    assertTrue(StorageAuthorization.bearerHeader("legacy-token") == "Bearer legacy-token")
  }
}
