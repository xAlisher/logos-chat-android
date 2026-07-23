// Generated manually
#ifndef __liblogoschat__
#define __liblogoschat__

#include <stddef.h>
#include <stdint.h>

// The possible returned values for the functions that return int
#define RET_OK 0
#define RET_ERR 1
#define RET_MISSING_CALLBACK 2

#ifdef __cplusplus
extern "C" {
#endif

typedef void (*FFICallBack)(int callerRet, const char *msg, size_t len,
                            void *userData);

//////////////////////////////////////////////////////////////////////////////
// Client Lifecycle
//////////////////////////////////////////////////////////////////////////////

// Creates a new instance of the chat client.
// Sets up the chat client from the given configuration.
// Returns a pointer to the Context needed by the rest of the API functions.
// configJson: JSON object with fields:
//   - "name": string - identity name (default: "anonymous")
//   - "port": int - Waku port (optional)
//   - "clusterId": int - Waku cluster ID (optional)
//   - "shardId": int - Waku shard ID (optional)
//   - "staticPeers": array of strings - static peer multiaddrs (optional)
void *chat_new(const char *configJson, FFICallBack callback, void *userData);

// Start the chat client and begin listening for messages
int chat_start(void *ctx, FFICallBack callback, void *userData);

// Stop the chat client
int chat_stop(void *ctx, FFICallBack callback, void *userData);

// Destroys an instance of a chat client created with chat_new
int chat_destroy(void *ctx, FFICallBack callback, void *userData);

// Sets a callback that will be invoked whenever an event occurs.
// Events are JSON objects with "eventType" field:
//   - "new_message":
//   {"eventType":"new_message","conversationId":"...","messageId":"...","content":"hex...","timestamp":...}
//   - "new_conversation":
//   {"eventType":"new_conversation","conversationId":"...","conversationType":"private"}
//   - "delivery_ack":
//   {"eventType":"delivery_ack","conversationId":"...","messageId":"..."}
void set_event_callback(void *ctx, FFICallBack callback, void *userData);

//////////////////////////////////////////////////////////////////////////////
// Client Info
//////////////////////////////////////////////////////////////////////////////

// Get the client's identifier
int chat_get_id(void *ctx, FFICallBack callback, void *userData);

//////////////////////////////////////////////////////////////////////////////
// Conversation Operations
//////////////////////////////////////////////////////////////////////////////

// List all conversations as JSON array
// Returns: JSON array of objects with "id" field
int chat_list_conversations(void *ctx, FFICallBack callback, void *userData);

// Get a specific conversation by ID
// Returns: JSON object with "id" field
int chat_get_conversation(void *ctx, FFICallBack callback, void *userData,
                          const char *convoId);

// Create a new private conversation with the given IntroBundle
// introBundleStr: Intro bundle ASCII string as returned by chat_create_intro_bundle
// contentHex: Initial message content as hex-encoded string
int chat_new_private_conversation(void *ctx, FFICallBack callback,
                                  void *userData, const char *introBundleStr,
                                  const char *contentHex);

// Send a message to a conversation
// convoId: Conversation ID string
// contentHex: Message content as hex-encoded string
// Returns: Message ID on success
int chat_send_message(void *ctx, FFICallBack callback, void *userData,
                      const char *convoId, const char *contentHex);

//////////////////////////////////////////////////////////////////////////////
// Identity Operations
//////////////////////////////////////////////////////////////////////////////

// Get the client identity
// Returns JSON: {"name": "..."}
int chat_get_identity(void *ctx, FFICallBack callback, void *userData);

// Create an IntroBundle for initiating private conversations
// Returns the intro bundle as an ASCII string (format: logos_chatintro_<version>_<base64url payload>)
int chat_create_intro_bundle(void *ctx, FFICallBack callback, void *userData);

#ifdef __cplusplus
}
#endif

#endif /* __liblogoschat__ */
