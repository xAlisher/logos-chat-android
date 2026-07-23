// desktop-peer.c — headless desktop counterpart for M2 interop verification (#20).
//
// dlopens the DESKTOP x86_64 liblogoschat.so that Basecamp's chat_module wraps
// (~/.local/share/Logos/LogosBasecamp/modules/chat_module/liblogoschat.so) — wire-wise
// this IS the desktop Basecamp chat_module: same lib, same 12-fn FFI, same fleet.
//
// Reads line commands on stdin, prints every lib event on stdout (content hex-decoded
// alongside the raw JSON) with wall-clock timestamps — scriptable both-direction tests.
//
// Commands:
//   bundle                        -> chat_create_intro_bundle (prints the bundle)
//   id                            -> chat_get_identity
//   newconvo <bundle> <utf8 ...>  -> chat_new_private_conversation (text hex-encoded here)
//   send <convoId> <utf8 ...>     -> chat_send_message (text hex-encoded here)
//   quit                          -> chat_stop + chat_destroy + exit
//
// Build (see desktop-peer.sh):
//   cc -O2 -o desktop-peer desktop-peer.c -ldl
// Run:
//   LD_LIBRARY_PATH=<moduledir> ./desktop-peer <moduledir>/liblogoschat.so '<configJson>'
//
// Invariants honored (docs/architecture.md §1): event callback registered BEFORE
// chat_start; (msg,len) copied immediately; callbacks never re-enter the lib;
// statusCode==0 == accepted (empty response on newconvo success is SUCCESS).

#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>
#include <time.h>
#include <unistd.h>

typedef void (*FFICallBack)(int callerRet, const char *msg, size_t len, void *userData);
typedef void *(*chat_new_t)(const char *, FFICallBack, void *);
typedef int (*chat_call_t)(void *, FFICallBack, void *);
typedef int (*chat_call1_t)(void *, FFICallBack, void *, const char *);
typedef int (*chat_call2_t)(void *, FFICallBack, void *, const char *, const char *);
typedef void (*set_event_callback_t)(void *, FFICallBack, void *);

static volatile int g_done = 0;
static volatile int g_ret = -1;
static char g_resp[65536];

static void ts(char *buf, size_t n) {
  struct timeval tv;
  gettimeofday(&tv, NULL);
  struct tm tm;
  localtime_r(&tv.tv_sec, &tm);
  snprintf(buf, n, "%02d:%02d:%02d.%03ld", tm.tm_hour, tm.tm_min, tm.tm_sec,
           tv.tv_usec / 1000);
}

// Response callback: (msg,len) is NOT NUL-terminated — copy immediately.
static void cb(int ret, const char *msg, size_t len, void *ud) {
  const char *tag = (const char *)ud;
  size_t n = len < sizeof(g_resp) - 1 ? len : sizeof(g_resp) - 1;
  g_resp[0] = 0;
  if (msg && n) memcpy(g_resp, msg, n);
  g_resp[n] = 0;
  char t[32];
  ts(t, sizeof(t));
  printf("[RSP %s %s] statusCode=%d len=%zu msg=%s\n", t, tag, ret, (size_t)len, g_resp);
  fflush(stdout);
  g_ret = ret;
  g_done = 1;
}

// Best-effort hex→utf8 of the "content" field for readable event logs.
static void print_content_decoded(const char *json) {
  const char *k = strstr(json, "\"content\":\"");
  if (!k) return;
  k += 11;
  const char *e = strchr(k, '"');
  if (!e) return;
  size_t hexlen = (size_t)(e - k);
  if (hexlen == 0 || hexlen % 2 != 0 || hexlen > 8192) return;
  char out[4200];
  size_t o = 0;
  for (size_t i = 0; i + 1 < hexlen && o < sizeof(out) - 1; i += 2) {
    int hi = k[i], lo = k[i + 1];
    hi = (hi >= '0' && hi <= '9') ? hi - '0' : (hi | 32) - 'a' + 10;
    lo = (lo >= '0' && lo <= '9') ? lo - '0' : (lo | 32) - 'a' + 10;
    if (hi < 0 || hi > 15 || lo < 0 || lo > 15) return;
    out[o++] = (char)((hi << 4) | lo);
  }
  out[o] = 0;
  printf("      content(utf8)=%s\n", out);
}

// Persistent event callback — copy, print, never re-enter the lib.
static void event_cb(int ret, const char *msg, size_t len, void *ud) {
  (void)ud;
  static char buf[65536];
  size_t n = len < sizeof(buf) - 1 ? len : sizeof(buf) - 1;
  buf[0] = 0;
  if (msg && n) memcpy(buf, msg, n);
  buf[n] = 0;
  char t[32];
  ts(t, sizeof(t));
  printf("[EVT %s] ret=%d %s\n", t, ret, buf);
  print_content_decoded(buf);
  fflush(stdout);
}

static int wait_done(int timeout_s) {
  for (int i = 0; i < timeout_s * 20; i++) {
    if (g_done) { g_done = 0; return 0; }
    usleep(50000);
  }
  fprintf(stderr, "TIMEOUT waiting for callback\n");
  return 1;
}

static char *utf8_to_hex(const char *s) {
  size_t n = strlen(s);
  char *hex = malloc(n * 2 + 1);
  for (size_t i = 0; i < n; i++)
    sprintf(hex + i * 2, "%02x", (unsigned char)s[i]);
  hex[n * 2] = 0;
  return hex;
}

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: %s <path/liblogoschat.so> [configJson]\n", argv[0]);
    return 1;
  }
  const char *config = argc > 2 ? argv[2] : "{\"name\":\"desktop-peer\"}";

  void *h = dlopen(argv[1], RTLD_NOW);
  if (!h) { fprintf(stderr, "dlopen failed: %s\n", dlerror()); return 2; }
  printf("dlopen OK %s\n", argv[1]);

  chat_new_t f_new = (chat_new_t)dlsym(h, "chat_new");
  chat_call_t f_start = (chat_call_t)dlsym(h, "chat_start");
  chat_call_t f_stop = (chat_call_t)dlsym(h, "chat_stop");
  chat_call_t f_destroy = (chat_call_t)dlsym(h, "chat_destroy");
  chat_call_t f_bundle = (chat_call_t)dlsym(h, "chat_create_intro_bundle");
  chat_call_t f_identity = (chat_call_t)dlsym(h, "chat_get_identity");
  chat_call2_t f_newconvo = (chat_call2_t)dlsym(h, "chat_new_private_conversation");
  chat_call2_t f_send = (chat_call2_t)dlsym(h, "chat_send_message");
  set_event_callback_t f_setev = (set_event_callback_t)dlsym(h, "set_event_callback");
  if (!f_new || !f_start || !f_bundle || !f_newconvo || !f_send || !f_setev) {
    fprintf(stderr, "dlsym failed: %s\n", dlerror());
    return 3;
  }

  void *ctx = f_new(config, cb, (void *)"new");
  if (!ctx) { fprintf(stderr, "chat_new returned NULL\n"); return 4; }
  if (wait_done(60)) return 5;

  f_setev(ctx, event_cb, NULL);   // BEFORE chat_start — invariant #1
  printf("set_event_callback OK\n");

  f_start(ctx, cb, (void *)"start");
  if (wait_done(120)) return 6;
  if (g_ret != 0) { fprintf(stderr, "chat_start failed\n"); return 6; }
  printf("READY\n");
  fflush(stdout);

  char line[65536];
  while (fgets(line, sizeof(line), stdin)) {
    line[strcspn(line, "\r\n")] = 0;
    if (line[0] == 0) continue;
    if (strcmp(line, "quit") == 0) break;
    if (strcmp(line, "bundle") == 0) {
      f_bundle(ctx, cb, (void *)"bundle");
      wait_done(30);
    } else if (strcmp(line, "id") == 0) {
      f_identity(ctx, cb, (void *)"identity");
      wait_done(30);
    } else if (strncmp(line, "newconvo ", 9) == 0) {
      char *bundle = line + 9;
      char *sp = strchr(bundle, ' ');
      if (!sp) { printf("ERR usage: newconvo <bundle> <text>\n"); continue; }
      *sp = 0;
      char *hex = utf8_to_hex(sp + 1);
      f_newconvo(ctx, cb, (void *)"newconvo", bundle, hex);
      free(hex);
      wait_done(60);
    } else if (strncmp(line, "send ", 5) == 0) {
      char *convo = line + 5;
      char *sp = strchr(convo, ' ');
      if (!sp) { printf("ERR usage: send <convoId> <text>\n"); continue; }
      *sp = 0;
      char *hex = utf8_to_hex(sp + 1);
      f_send(ctx, cb, (void *)"send", convo, hex);
      free(hex);
      wait_done(60);
    } else {
      printf("ERR unknown command: %s\n", line);
    }
    fflush(stdout);
  }

  if (f_stop) { f_stop(ctx, cb, (void *)"stop"); wait_done(20); }
  if (f_destroy) { f_destroy(ctx, cb, (void *)"destroy"); wait_done(20); }
  printf("BYE\n");
  return 0;
}
