// JNI bridge for the NEW pure-Rust liblogoschat (MLS/address generation).
//
// M1' rewrite: the new C ABI (include/liblogoschat.h) returns values DIRECTLY
// (char* / int) — no request/response callbacks, so the whole old on_response /
// cb_result machinery is gone. Only the persistent EVENT callback survives, and
// its signature changed to (int event_type, const char* json, void* user_data).
//
// Hardening carried over verbatim (the hard-won lessons):
//   - stdout/stderr → logcat (the Nim delivery node logs through stdout)
//   - JNI_OnLoad caches JavaVM* + a GLOBAL ref to EventCallbackManager + the
//     static method id (the event callback runs on a non-JVM lib thread)
//   - the event callback attaches the thread ONCE per thread via a pthread_key,
//     with AttachCurrentThread OUTSIDE any assert() (NDEBUG strips asserts —
//     the libdelivery release-build SIGSEGV lesson); the key destructor detaches
//   - never call back into the lib from the callback; the json is already
//     NUL-terminated by the wrapper (CString) but only valid during the call
#include "liblogoschat.h"
#include <android/log.h>
#include <dlfcn.h>
#include <jni.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <pthread.h>

#define BRIDGE_TAG "logos-chat-bridge"
#define NODE_TAG "logos-chat-node"

// ---------------------------------------------------------------------------
// stdout/stderr → logcat pump. Android drops app stdout by default; the Nim
// delivery node logs through chronicles to stdout — pipe it to logcat.
static int _logos_logpipe[2];
static void *_logos_log_pump(void *arg) {
  (void)arg;
  char buf[2048];
  ssize_t n;
  while ((n = read(_logos_logpipe[0], buf, sizeof(buf) - 1)) > 0) {
    if (n > 0 && buf[n - 1] == '\n') n--;
    buf[n] = '\0';
    __android_log_write(ANDROID_LOG_INFO, NODE_TAG, buf);
  }
  return NULL;
}
static void logos_redirect_stdio_to_logcat(void) {
  setvbuf(stdout, 0, _IONBF, 0);
  setvbuf(stderr, 0, _IONBF, 0);
  if (pipe(_logos_logpipe) != 0) return;
  dup2(_logos_logpipe[1], STDOUT_FILENO);
  dup2(_logos_logpipe[1], STDERR_FILENO);
  pthread_t t;
  pthread_create(&t, NULL, _logos_log_pump, NULL);
  pthread_detach(t);
}

// ---------------------------------------------------------------------------
// JNI plumbing. JVM pointer + a GLOBAL ref to EventCallbackManager + the static
// method id, cached once in JNI_OnLoad. The event callback runs on the lib's
// own pump thread where FindClass on an unattached env is unsafe.
static JavaVM *jvm;
static jclass gEventCbClass;      // com.logoschat.EventCallbackManager
static jmethodID gExecEventCb;    // static execLibEvent(ILjava/lang/String;)V
static pthread_key_t gDetachKey;

static void detach_current_thread(void *unused) {
  (void)unused;
  (*jvm)->DetachCurrentThread(jvm);
}

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM *pjvm, void *reserved) {
  (void)reserved;
  jvm = pjvm;
  JNIEnv *env = NULL;
  if ((*jvm)->GetEnv(jvm, (void **)&env, JNI_VERSION_1_6) != JNI_OK || env == NULL) {
    return JNI_ERR;
  }
  jclass local = (*env)->FindClass(env, "com/logoschat/EventCallbackManager");
  gEventCbClass = (jclass)(*env)->NewGlobalRef(env, local);
  gExecEventCb = (*env)->GetStaticMethodID(env, gEventCbClass, "execLibEvent",
                                           "(ILjava/lang/String;)V");
  (*env)->DeleteLocalRef(env, local);
  pthread_key_create(&gDetachKey, detach_current_thread);
  __android_log_write(ANDROID_LOG_INFO, BRIDGE_TAG, "JNI_OnLoad ok (event class+id cached)");
  return JNI_VERSION_1_6;
}

// ---------------------------------------------------------------------------
// Persistent event callback (logoschat_set_event_callback). The wrapper's pump
// thread invokes this per event. Attach unconditionally, OUTSIDE any assert; the
// pthread-key destructor detaches on thread exit. NEVER call back into the lib.
static void chat_event_callback(int event_type, const char *json, void *user_data) {
  (void)user_data;
  JNIEnv *env = NULL;
  jint st = (*jvm)->GetEnv(jvm, (void **)&env, JNI_VERSION_1_6);
  if (st == JNI_EDETACHED) {
    if ((*jvm)->AttachCurrentThread(jvm, &env, NULL) != JNI_OK || env == NULL) {
      return;
    }
    pthread_setspecific(gDetachKey, (void *)1); // arm detach-on-thread-exit
  } else if (st != JNI_OK || env == NULL) {
    return;
  }
  // json is NUL-terminated (wrapper CString) but only valid during this call.
  jstring jj = (json != NULL) ? (*env)->NewStringUTF(env, json) : NULL;
  (*env)->CallStaticVoidMethod(env, gEventCbClass, gExecEventCb, (jint)event_type, jj);
  if ((*env)->ExceptionCheck(env)) {
    (*env)->ExceptionClear(env);
  }
  if (jj != NULL) (*env)->DeleteLocalRef(env, jj);
  // No DetachCurrentThread — attach-once-per-thread; the key detaches on exit.
}

// ---------------------------------------------------------------------------
// Helpers

// Read the thread-local last error into a fresh Java string ("" if none).
static jstring last_error_jstr(JNIEnv *env) {
  const char *e = logoschat_last_error();
  return (*env)->NewStringUTF(env, e ? e : "");
}

// Wrap an owned char* from the lib into a Java string and free it (null-safe).
static jstring take_cstr(JNIEnv *env, char *owned) {
  if (owned == NULL) return NULL;
  jstring s = (*env)->NewStringUTF(env, owned);
  logoschat_free_string(owned);
  return s;
}

// ---------------------------------------------------------------------------
// com.logoschat.NodeBridge externals

JNIEXPORT void JNICALL
Java_com_logoschat_NodeBridge_chatSetup(JNIEnv *env, jobject thiz) {
  (void)env; (void)thiz;
  logos_redirect_stdio_to_logcat();
  __android_log_write(ANDROID_LOG_INFO, BRIDGE_TAG,
                      "stdio redirected to logcat (tag: " NODE_TAG ")");
}

// open_persistent(db_path, db_key, registry_url|null, identity_path) -> handle | 0.
JNIEXPORT jlong JNICALL
Java_com_logoschat_NodeBridge_chatOpenPersistent(JNIEnv *env, jobject thiz,
                                                 jstring dbPath, jstring dbKey,
                                                 jstring registryUrl,
                                                 jstring identityPath) {
  (void)thiz;
  const char *db_path = (*env)->GetStringUTFChars(env, dbPath, 0);
  const char *db_key = (*env)->GetStringUTFChars(env, dbKey, 0);
  const char *reg = registryUrl ? (*env)->GetStringUTFChars(env, registryUrl, 0) : NULL;
  const char *id_path = (*env)->GetStringUTFChars(env, identityPath, 0);
  __android_log_print(ANDROID_LOG_INFO, BRIDGE_TAG,
                      "open_persistent db=%s registry=%s", db_path, reg ? reg : "(default)");
  void *handle = logoschat_open_persistent(db_path, db_key, reg, id_path);
  if (handle == NULL) {
    __android_log_print(ANDROID_LOG_ERROR, BRIDGE_TAG, "open_persistent failed: %s",
                        logoschat_last_error());
  } else {
    __android_log_print(ANDROID_LOG_INFO, BRIDGE_TAG, "open_persistent ok handle=%p", handle);
  }
  (*env)->ReleaseStringUTFChars(env, dbPath, db_path);
  (*env)->ReleaseStringUTFChars(env, dbKey, db_key);
  if (reg) (*env)->ReleaseStringUTFChars(env, registryUrl, reg);
  (*env)->ReleaseStringUTFChars(env, identityPath, id_path);
  return (jlong)handle;
}

JNIEXPORT void JNICALL
Java_com_logoschat_NodeBridge_chatShutdown(JNIEnv *env, jobject thiz, jlong handle) {
  (void)env; (void)thiz;
  if (handle != 0) logoschat_shutdown((void *)handle);
}

JNIEXPORT jstring JNICALL
Java_com_logoschat_NodeBridge_chatGetAddress(JNIEnv *env, jobject thiz, jlong handle) {
  (void)thiz;
  return take_cstr(env, logoschat_get_address((void *)handle));
}

JNIEXPORT jstring JNICALL
Java_com_logoschat_NodeBridge_chatInstallationName(JNIEnv *env, jobject thiz, jlong handle) {
  (void)thiz;
  return take_cstr(env, logoschat_installation_name((void *)handle));
}

// create_conversation(peer_address) -> convoId | null (see chatLastError).
JNIEXPORT jstring JNICALL
Java_com_logoschat_NodeBridge_chatCreateConversation(JNIEnv *env, jobject thiz,
                                                     jlong handle, jstring peerAddress) {
  (void)thiz;
  const char *peer = (*env)->GetStringUTFChars(env, peerAddress, 0);
  char *id = logoschat_create_conversation((void *)handle, peer);
  (*env)->ReleaseStringUTFChars(env, peerAddress, peer);
  return take_cstr(env, id);
}

// send_message(convoId, bytes) -> 0 | -1. Content is RAW BYTES (no hex).
JNIEXPORT jint JNICALL
Java_com_logoschat_NodeBridge_chatSendMessage(JNIEnv *env, jobject thiz, jlong handle,
                                              jstring convoId, jbyteArray content) {
  (void)thiz;
  const char *convo = (*env)->GetStringUTFChars(env, convoId, 0);
  jsize len = (*env)->GetArrayLength(env, content);
  jbyte *bytes = (*env)->GetByteArrayElements(env, content, NULL);
  int rc = logoschat_send_message((void *)handle, convo,
                                  (const unsigned char *)bytes, (size_t)len);
  (*env)->ReleaseByteArrayElements(env, content, bytes, JNI_ABORT);
  (*env)->ReleaseStringUTFChars(env, convoId, convo);
  return rc;
}

JNIEXPORT jstring JNICALL
Java_com_logoschat_NodeBridge_chatListConversations(JNIEnv *env, jobject thiz, jlong handle) {
  (void)thiz;
  return take_cstr(env, logoschat_list_conversations((void *)handle));
}

// Group verbs (M2', bound now for forward-compat; not wired to UI yet).
JNIEXPORT jstring JNICALL
Java_com_logoschat_NodeBridge_chatCreateGroup(JNIEnv *env, jobject thiz, jlong handle,
                                              jstring name, jstring desc) {
  (void)thiz;
  const char *n = (*env)->GetStringUTFChars(env, name, 0);
  const char *d = (*env)->GetStringUTFChars(env, desc, 0);
  char *id = logoschat_create_group((void *)handle, n, d);
  (*env)->ReleaseStringUTFChars(env, name, n);
  (*env)->ReleaseStringUTFChars(env, desc, d);
  return take_cstr(env, id);
}

JNIEXPORT jint JNICALL
Java_com_logoschat_NodeBridge_chatAddGroupMember(JNIEnv *env, jobject thiz, jlong handle,
                                                 jstring convoId, jstring peerAddress) {
  (void)thiz;
  const char *c = (*env)->GetStringUTFChars(env, convoId, 0);
  const char *p = (*env)->GetStringUTFChars(env, peerAddress, 0);
  int rc = logoschat_add_group_member((void *)handle, c, p);
  (*env)->ReleaseStringUTFChars(env, convoId, c);
  (*env)->ReleaseStringUTFChars(env, peerAddress, p);
  return rc;
}

// Register the persistent event callback for this handle. The wrapper spawns a
// pump; events arriving before this are buffered on the crossbeam channel, so
// there is no early-event-loss window (unlike the old lib).
JNIEXPORT jint JNICALL
Java_com_logoschat_NodeBridge_chatSetEventCallback(JNIEnv *env, jobject thiz, jlong handle) {
  (void)env; (void)thiz;
  int rc = logoschat_set_event_callback((void *)handle, chat_event_callback, NULL);
  __android_log_print(ANDROID_LOG_INFO, BRIDGE_TAG, "set_event_callback rc=%d", rc);
  return rc;
}

JNIEXPORT jstring JNICALL
Java_com_logoschat_NodeBridge_chatLastError(JNIEnv *env, jobject thiz) {
  (void)thiz;
  return last_error_jstr(env);
}
