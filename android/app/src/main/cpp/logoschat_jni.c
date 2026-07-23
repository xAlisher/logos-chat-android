// JNI bridge for liblogoschat — ported from logos-libdelivery-android/jni/logos_messaging_ffi.c.
// The hardening transfers verbatim (docs/architecture.md §2.2); only the FFI verbs and the
// package (com.logoschat — one-way door) change.
//
// Invariants encoded here (docs/architecture.md §1):
//   - callbacks fire synchronously on the lib's FFI thread; (msg,len) is NON-NUL-terminated and
//     only valid during the call → copy immediately, never call back into the lib from a callback
//   - attach-once-per-thread via pthread_key; AttachCurrentThread OUTSIDE any assert()
//     (NDEBUG strips asserts — the libdelivery SIGSEGV lesson)
//   - JNI_OnLoad caches JavaVM*, GLOBAL refs to callback/result classes + method ids
//   - cb_result/on_response: the response callback fires on success too — only result->error
//     means failure
//   - stdout/stderr → logcat (tag "logos-chat-node") so the Nim node's own logs are visible
#include "liblogoschat.h"
#include <android/log.h>
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
// node logs through chronicles to stdout — pipe it to logcat.
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
// cb_result: response captured from a liblogoschat request callback.
// If `error` is true, `message` holds the error description; otherwise the result.
typedef struct {
  bool error;
  char *message;
} cb_result;

static void free_cb_result(cb_result *result) {
  if (result != NULL) {
    if (result->message != NULL) {
      free(result->message);
      result->message = NULL;
    }
    free(result);
  }
}

// Callback passed to liblogoschat request functions. user_data is a cb_result**.
// NOTE: fires on SUCCESS too (RET_OK) — only result->error means failure. (msg,len)
// is non-NUL-terminated: copy with the explicit length, never strlen/strdup.
static void on_response(int ret, const char *msg, size_t len, void *user_data) {
  if (user_data == NULL) return;
  cb_result **data_ref = (cb_result **)user_data;

  if (ret != RET_OK) {
    (*data_ref) = malloc(sizeof(cb_result));
    (*data_ref)->error = true;
    (*data_ref)->message = malloc(len + 1);
    (*data_ref)->message[0] = '\0';
    if (msg != NULL && len > 0) strncat((*data_ref)->message, msg, len);
    return;
  }

  if (len == 0 || msg == NULL) {
    msg = "on_response-ok";
    len = strlen(msg);
  }

  (*data_ref) = malloc(sizeof(cb_result));
  (*data_ref)->error = false;
  (*data_ref)->message = malloc(len + 1);
  (*data_ref)->message[0] = '\0';
  strncat((*data_ref)->message, msg, len);
}

// ---------------------------------------------------------------------------
// JNI plumbing. JVM pointer + GLOBAL class refs + method ids cached once in
// JNI_OnLoad — the event callback runs on non-JVM lib threads where local
// refs / FindClass on an unattached env are unsafe.
static JavaVM *jvm;
static jclass gChatResultClass;   // com.logoschat.ChatResult
static jmethodID gChatResultCtor; // (ZLjava/lang/String;)V
static jclass gChatPtrClass;      // com.logoschat.ChatPtr
static jmethodID gChatPtrCtor;    // (ZLjava/lang/String;J)V
static jclass gEventCbClass;      // com.logoschat.EventCallbackManager
static jmethodID gExecEventCb;    // static execEventCallback(JLjava/lang/String;)V
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

  jclass local;

  local = (*env)->FindClass(env, "com/logoschat/ChatResult");
  gChatResultClass = (jclass)(*env)->NewGlobalRef(env, local);
  gChatResultCtor =
      (*env)->GetMethodID(env, gChatResultClass, "<init>", "(ZLjava/lang/String;)V");
  (*env)->DeleteLocalRef(env, local);

  local = (*env)->FindClass(env, "com/logoschat/ChatPtr");
  gChatPtrClass = (jclass)(*env)->NewGlobalRef(env, local);
  gChatPtrCtor =
      (*env)->GetMethodID(env, gChatPtrClass, "<init>", "(ZLjava/lang/String;J)V");
  (*env)->DeleteLocalRef(env, local);

  local = (*env)->FindClass(env, "com/logoschat/EventCallbackManager");
  gEventCbClass = (jclass)(*env)->NewGlobalRef(env, local);
  gExecEventCb = (*env)->GetStaticMethodID(env, gEventCbClass, "execEventCallback",
                                           "(JLjava/lang/String;)V");
  (*env)->DeleteLocalRef(env, local);

  pthread_key_create(&gDetachKey, detach_current_thread);

  __android_log_write(ANDROID_LOG_INFO, BRIDGE_TAG, "JNI_OnLoad ok (classes+ids cached)");
  return JNI_VERSION_1_6;
}

// Converts a cb_result into com.logoschat.ChatResult.
static jobject to_jni_result(JNIEnv *env, cb_result *result) {
  jboolean error;
  jstring message;
  if (result != NULL) {
    error = result->error ? JNI_TRUE : JNI_FALSE;
    message = (*env)->NewStringUTF(env, result->message);
  } else {
    error = JNI_FALSE;
    message = (*env)->NewStringUTF(env, "ok");
  }
  jobject response =
      (*env)->NewObject(env, gChatResultClass, gChatResultCtor, error, message);
  (*env)->DeleteLocalRef(env, message);
  return response;
}

// Converts a cb_result + ctx pointer into com.logoschat.ChatPtr. Only an ACTUAL
// error discards the ctx — on_response also fires on success.
static jobject to_jni_ptr(JNIEnv *env, cb_result *result, void *ptr) {
  jboolean error;
  jstring message;
  jlong chatPtr;
  if (result != NULL && result->error) {
    error = JNI_TRUE;
    message = (*env)->NewStringUTF(env, result->message);
    chatPtr = -1;
  } else {
    error = JNI_FALSE;
    message = (*env)->NewStringUTF(env, result != NULL ? result->message : "ok");
    chatPtr = (jlong)ptr;
  }
  jobject response =
      (*env)->NewObject(env, gChatPtrClass, gChatPtrCtor, error, message, chatPtr);
  (*env)->DeleteLocalRef(env, message);
  return response;
}

// ---------------------------------------------------------------------------
// Persistent event callback (set_event_callback). The node invokes this from
// its own worker threads. Attach unconditionally, OUTSIDE any assert (NDEBUG
// strips asserts — libdelivery's release-build SIGSEGV); the pthread-key
// destructor detaches on thread exit. NEVER call back into the lib from here.
typedef struct {
  jlong chatPtr;
} cb_env;

static void chat_event_callback(int callerRet, const char *msg, size_t len, void *userData) {
  (void)callerRet;
  cb_env *c = (cb_env *)userData;
  if (c == NULL) return;

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

  // (msg,len) is non-NUL-terminated and only valid during this call — copy NOW.
  jstring message = NULL;
  if (msg != NULL) {
    char *copy = malloc(len + 1);
    if (copy == NULL) return;
    memcpy(copy, msg, len);
    copy[len] = '\0';
    message = (*env)->NewStringUTF(env, copy);
    free(copy);
  }

  (*env)->CallStaticVoidMethod(env, gEventCbClass, gExecEventCb, c->chatPtr, message);
  if ((*env)->ExceptionCheck(env)) {
    (*env)->ExceptionClear(env);
  }
  if (message != NULL) {
    (*env)->DeleteLocalRef(env, message);
  }
  // No DetachCurrentThread — attach-once-per-thread; pthread key detaches on exit.
}

// ---------------------------------------------------------------------------
// com.logoschat.LogosChatModule externals

JNIEXPORT void JNICALL
Java_com_logoschat_NodeBridge_chatSetup(JNIEnv *env, jobject thiz) {
  (void)env; (void)thiz;
  logos_redirect_stdio_to_logcat();
  __android_log_write(ANDROID_LOG_INFO, BRIDGE_TAG,
                      "stdio redirected to logcat (tag: " NODE_TAG ")");
}

JNIEXPORT jobject JNICALL
Java_com_logoschat_NodeBridge_chatNew(JNIEnv *env, jobject thiz, jstring configJson) {
  (void)thiz;
  const char *config = (*env)->GetStringUTFChars(env, configJson, 0);
  __android_log_print(ANDROID_LOG_INFO, BRIDGE_TAG, "chat_new config: %s", config);
  cb_result *result = NULL;
  void *ctx = chat_new(config, on_response, (void *)&result);
  __android_log_print(ANDROID_LOG_INFO, BRIDGE_TAG, "chat_new returned ctx=%p err=%s", ctx,
                      result && result->error ? result->message : "(none)");
  jobject response = to_jni_ptr(env, result, ctx);
  (*env)->ReleaseStringUTFChars(env, configJson, config);
  free_cb_result(result);
  return response;
}

JNIEXPORT jobject JNICALL
Java_com_logoschat_NodeBridge_chatStart(JNIEnv *env, jobject thiz, jlong ctx) {
  (void)thiz;
  cb_result *result = NULL;
  chat_start((void *)ctx, on_response, (void *)&result);
  jobject response = to_jni_result(env, result);
  free_cb_result(result);
  return response;
}

JNIEXPORT jobject JNICALL
Java_com_logoschat_NodeBridge_chatStop(JNIEnv *env, jobject thiz, jlong ctx) {
  (void)thiz;
  cb_result *result = NULL;
  chat_stop((void *)ctx, on_response, (void *)&result);
  jobject response = to_jni_result(env, result);
  free_cb_result(result);
  return response;
}

JNIEXPORT jobject JNICALL
Java_com_logoschat_NodeBridge_chatDestroy(JNIEnv *env, jobject thiz, jlong ctx) {
  (void)thiz;
  cb_result *result = NULL;
  chat_destroy((void *)ctx, on_response, (void *)&result);
  jobject response = to_jni_result(env, result);
  free_cb_result(result);
  return response;
}

JNIEXPORT jobject JNICALL
Java_com_logoschat_NodeBridge_chatGetIdentity(JNIEnv *env, jobject thiz, jlong ctx) {
  (void)thiz;
  cb_result *result = NULL;
  chat_get_identity((void *)ctx, on_response, (void *)&result);
  jobject response = to_jni_result(env, result);
  free_cb_result(result);
  return response;
}

JNIEXPORT jobject JNICALL
Java_com_logoschat_NodeBridge_chatCreateIntroBundle(JNIEnv *env, jobject thiz, jlong ctx) {
  (void)thiz;
  cb_result *result = NULL;
  chat_create_intro_bundle((void *)ctx, on_response, (void *)&result);
  jobject response = to_jni_result(env, result);
  free_cb_result(result);
  return response;
}

// Creates a new private conversation from a peer's intro bundle + a mandatory
// opening message (hex). Returns EMPTY on success (invariant #3) — only
// result->error means failure; the conversationId arrives via the
// new_conversation push, and each side's id is different for the same
// logical conversation.
JNIEXPORT jobject JNICALL
Java_com_logoschat_NodeBridge_chatNewPrivateConversation(
    JNIEnv *env, jobject thiz, jlong ctx, jstring bundle, jstring contentHex) {
  (void)thiz;
  const char *bundleStr = (*env)->GetStringUTFChars(env, bundle, 0);
  const char *hexStr = (*env)->GetStringUTFChars(env, contentHex, 0);
  cb_result *result = NULL;
  chat_new_private_conversation((void *)ctx, on_response, (void *)&result,
                                bundleStr, hexStr);
  jobject response = to_jni_result(env, result);
  (*env)->ReleaseStringUTFChars(env, bundle, bundleStr);
  (*env)->ReleaseStringUTFChars(env, contentHex, hexStr);
  free_cb_result(result);
  return response;
}

// Sends a message (hex content) into an existing conversation (this side's
// local convoId). Response message is the messageId on success.
JNIEXPORT jobject JNICALL
Java_com_logoschat_NodeBridge_chatSendMessage(
    JNIEnv *env, jobject thiz, jlong ctx, jstring convoId, jstring contentHex) {
  (void)thiz;
  const char *convoStr = (*env)->GetStringUTFChars(env, convoId, 0);
  const char *hexStr = (*env)->GetStringUTFChars(env, contentHex, 0);
  cb_result *result = NULL;
  chat_send_message((void *)ctx, on_response, (void *)&result, convoStr, hexStr);
  jobject response = to_jni_result(env, result);
  (*env)->ReleaseStringUTFChars(env, convoId, convoStr);
  (*env)->ReleaseStringUTFChars(env, contentHex, hexStr);
  free_cb_result(result);
  return response;
}

// Registers the persistent event callback for this ctx. MUST be called BEFORE
// chatStart (invariant #1 — early pushes are lost otherwise); enforced on the
// Kotlin side in startNode.
JNIEXPORT void JNICALL
Java_com_logoschat_NodeBridge_chatSetEventCallback(JNIEnv *env, jobject thiz, jlong ctx) {
  (void)env; (void)thiz;
  cb_env *c = (cb_env *)malloc(sizeof(cb_env)); // intentionally leaked: outlives the ctx
  c->chatPtr = ctx;
  set_event_callback((void *)ctx, chat_event_callback, (void *)c);
  __android_log_write(ANDROID_LOG_INFO, BRIDGE_TAG, "event callback registered");
}
