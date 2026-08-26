package com.logoschat

/**
 * Transitional authorization policy for hosted media.
 *
 * New downloads use the per-blob capability carried inside the MLS message and do not need a
 * shared application bearer. The legacy bearer remains accepted during the gateway migration.
 * Uploads still require the legacy credential until the gateway issues one-use upload grants.
 */
object StorageAuthorization {
  fun canDownload(legacyToken: String, capability: String): Boolean =
      legacyToken.isNotEmpty() || capability.isNotEmpty()

  fun bearerHeader(legacyToken: String): String =
      if (legacyToken.isEmpty()) "" else "Bearer $legacyToken"
}
