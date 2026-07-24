// liblogoschat.h — C ABI for the Android arm64 wrapper over the pure-Rust
// `libchat` (MLS/address generation) facade `logos_chat::open`.
//
// Built from github.com/logos-messaging/libchat @ d2124fd (main, 2026-07-24)
// plus patches/libchat-android-arm64.patch and the wrapper crate in wrapper/.
//
// Threading: outbound verbs run on the caller's thread. The event callback set
// via logoschat_set_event_callback fires on a dedicated pump thread — keep it
// fast and thread-safe. The underlying workspace is compiled panic="abort", so
// every entry point returns null / -1 on error (never unwinds) and records a
// message retrievable via logoschat_last_error (thread-local).
//
// Ownership: every char* returned by a logoschat_* function is owned by the
// caller and must be freed with logoschat_free_string.
#pragma once
#ifndef __liblogoschat__
#define __liblogoschat__

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

// Event type tags handed to the event callback.
#define LOGOSCHAT_EVENT_CONVERSATION_STARTED 1
#define LOGOSCHAT_EVENT_MESSAGE_RECEIVED     2
#define LOGOSCHAT_EVENT_MEMBERS_CHANGED      3
#define LOGOSCHAT_EVENT_INBOUND_ERROR        4

typedef void (*logoschat_event_cb)(int event_type, const char *json, void *user_data);

// --- Identity / lifecycle ---------------------------------------------------

// Mint a fresh account and return its hex address (64 hex chars). NO network,
// no node — proves the account/crypto path. Caller frees.
char *logoschat_gen_address(void);

// Open a client: starts the embedded delivery node, publishes the device bundle
// to the registry, opens encrypted storage at db_path. registry_url may be NULL
// (baked-in default). Ephemeral identity — a FRESH address every call. Returns
// an opaque handle or NULL (see logoschat_last_error). Blocks on network.
void *logoschat_open(const char *db_path, const char *db_key,
                     const char *registry_url);

// Open with a PERSISTENT identity loaded (or created) from identity_path
// (a 64-byte seed file: account seed || delegate seed). First call generates +
// writes the seeds; later calls reload them, so the address is STABLE across
// restarts. In production, back identity_path with an Android Keystore-encrypted
// blob. Returns a handle or NULL.
void *logoschat_open_persistent(const char *db_path, const char *db_key,
                                const char *registry_url,
                                const char *identity_path);

// Shut down and free a handle from logoschat_open[_persistent]. Invalid after.
void logoschat_shutdown(void *handle);

// --- Verbs (mirror the desktop chat_module contract) ------------------------

// This client's account address (the hex peers paste to reach it). Caller frees.
char *logoschat_get_address(void *handle);

// This client's installation (device) name. Caller frees.
char *logoschat_installation_name(void *handle);

// Create a 1:1 conversation with peer_address (hex). Returns the conversation
// id, or NULL on failure. Caller frees.
char *logoschat_create_conversation(void *handle, const char *peer_address);

// Create a GroupV2 (MLS) conversation. Returns the conversation id. Caller frees.
char *logoschat_create_group(void *handle, const char *name, const char *desc);

// Add peer_address (hex) to group convo_id. 0 on success, -1 on failure.
int logoschat_add_group_member(void *handle, const char *convo_id,
                               const char *peer_address);

// List conversation ids as a JSON array string, e.g. ["id1","id2"]. Caller frees.
char *logoschat_list_conversations(void *handle);

// Encrypt and send content (len bytes) to convo_id. 0 on success, -1 on failure.
int logoschat_send_message(void *handle, const char *convo_id,
                           const unsigned char *content, size_t len);

// Register the event callback: spawns a pump that drains the event stream and
// invokes cb(event_type, json, user_data) per event. Call once per handle.
// 0 on success, -1 if already registered / bad handle.
int logoschat_set_event_callback(void *handle, logoschat_event_cb cb,
                                 void *user_data);

// --- Errors / memory --------------------------------------------------------

// The last error string set on THIS thread ("" if none). Valid until the next
// fallible call on the same thread. Do NOT free.
const char *logoschat_last_error(void);

// Free a char* returned by any logoschat_* function (NULL-safe).
void logoschat_free_string(char *ptr);

#ifdef __cplusplus
}
#endif

#endif /* __liblogoschat__ */
