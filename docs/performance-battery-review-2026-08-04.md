# Background performance and battery review

**Review date:** 2026-08-04  
**Scope:** Static review of Android lifecycle/service, delivery node, BLE mesh, Tor, media, location, and React Native background paths. No new device power experiment was run for this review.

## Executive assessment

The app already avoids several common background costs: message persistence is native rather than JS-timer driven; the chat service owns the lifecycle; no persistent app-held wakelock was found; BLE scanning selects `SCAN_MODE_LOW_POWER`; media work runs off the React Native thread; and the existing idle test reported less than the device's 1% battery-display resolution over two hours.

The design nevertheless treats a long-lived messaging connection as a permanent `dataSync` foreground service, starts the node automatically at every app launch, restarts it after process death when enabled, refreshes a database-backed notification every 30 seconds, and can automatically restore continuous BLE discovery. That is likely acceptable for an explicit **always-on receive** mode, but it is not an economical default for all users and will become less reliable on current Android releases: Android 15 limits background `dataSync` foreground-service time to six hours per 24-hour window for apps targeting API 35+, and requires `onTimeout()` handling. The project currently targets API 34 but compiles API 36, so this needs near-term design work.

The biggest expected power consumer is not the Java/Kotlin polling shown here; it is the embedded delivery/libp2p node's network keepalive/reconnect behavior, especially under weak or changing network conditions. The second is continuous BLE scanning/advertising plus GATT links when the persisted BLE-engaged preference restores it on every launch. Neither has current per-feature battery, radio, CPU, wakeup, or network-byte telemetry, so the appropriate next step is measurement followed by adaptive policy—not arbitrary timer changes.

## Current behavior map

| Component | Current behavior | Battery/performance implication |
|---|---|---|
| Delivery node | App auto-starts node. A `dataSync` foreground service is started and can restart after process death while `nodeAutoRestart=1`. | Reliable receive but persistent process, network and radio activity; future Android time-limit risk. |
| Foreground notification | Service queries conversation/message counts and rebuilds/posts notification every 30 seconds. Status changes also trigger a push refresh. | Repeated executor wakeups and SQLite reads even when nothing changed; relatively small alone, avoidable. |
| Store catch-up | Native node performs periodic pull (~20 s per comment); JS also requests immediate catch-up whenever app becomes active. | Foreground recovery is good; ensure coalescing to avoid concurrent/redundant work. |
| BLE mesh | Once engaged, continuous filtered low-power scan + balanced, connectable advertisement; auto-restored if left enabled. Links capped at six; rotating-ID timer runs each minute. | Continuous radio activity; links and nearby traffic can dominate idle drain. Low-power mode is a positive control, not free. |
| BLE flooding | Fragmented media/contact-card traffic can rebroadcast with TTL 3. Card announcement is delayed 4 s and throttled to once/30 s. | Good initial storm guard; burst control and radio-aware scheduling are still needed. |
| Tor | If the opt-in preference is set, embedded Tor begins bootstrapping at launch. | Additional TCP connections/circuits and CPU; avoid booting before an operation needs it. |
| Media | Transcode, encryption, I/O, and upload are worker-thread based. Video encoding targets 720p-class H.264. | Correctly off UI thread, but can cause thermal/CPU/network spikes; no charging/battery/network policy or cancellation. |
| Voice/location | Voice records only during a user action; location requests one fix with a timeout. | Generally bounded and appropriate; keep lifecycle cleanup tested. |

## Findings and recommendations

### P-01 — Make always-on delivery an explicit service mode, not an implicit default

**Priority: P0; impact: high battery/reliability; effort: medium/high**

`App.tsx` calls `autoStart()` at each launch. The node starts a `START_STICKY`, `dataSync` foreground service, and `nodeAutoRestart` requests restart after process death. This delivers the intended background-receive experience but turns normal application launch into a durable networking commitment.

Split node operation into clearly named user choices:

1. **Receive while app is open** — no long-lived foreground service; close/pause delivery when backgrounded.
2. **Always-on receive** — explicit user opt-in, persistent notification, restart behavior, and a battery-cost explanation.
3. **Temporary receive window** — e.g. keep active for a configurable duration after user activity, then pause delivery.

Persist and display the current mode. Do not silently convert a previously foreground-only user into an always-on user after upgrade. This respects Android's foreground-service expectation that the work is user-noticeable and makes battery tradeoffs legible.

### P-02 — Prepare for Android 15+ `dataSync` foreground-service time limits

**Priority: P0; impact: high reliability; effort: medium**

`ChatService` has no `Service.onTimeout(int, int)` implementation or timeout accounting. Android documents a six-hour-per-24-hour background limit for `dataSync` services on Android 15+ when targeting API 35+. An app that simply stays active can be stopped/ANR after the timeout.

Implement a compatibility plan before raising `targetSdkVersion`:

* Track session elapsed time and surface the remaining always-on window.
* Implement `onTimeout()` on supported APIs: checkpoint/flush node state, stop foreground work promptly, and post an actionable notification.
* Reset/restart only through a foreground user interaction where permitted; never spin on failed background starts.
* Move finite, deferrable maintenance (cache cleanup, backup cleanup, retries, diagnostics) to constrained WorkManager work; retain FGS only for genuinely live, user-enabled receive.
* Test on Android 15/16 emulators/devices with shortened service timeouts.

This is primarily a correctness change but also prevents futile restarts and battery-consuming error loops.

### P-03 — Replace periodic notification database polling with change-driven, coalesced updates

**Priority: P1; impact: low/moderate; effort: low**

`ChatService` runs every 30 seconds indefinitely. Each tick calls `ChatRepo.requireDb().counts()` (two SQL counts) and posts a notification, even if status and counts are unchanged. Notification updates also occur immediately on state changes.

Maintain an in-memory notification snapshot `{status, conversationCount, messageCount}` and update only from state/message mutation points. Debounce bursts (for example, 1–5 seconds) and use a much slower safety reconciliation interval only if measurement proves it is needed. Do not query the database merely to repaint a static notification.

**Acceptance metric:** zero periodic SQLite/count wakeups during a quiet session; notification update latency below five seconds after a relevant state change.

### P-04 — Add adaptive delivery backoff based on network quality and app state

**Priority: P1; impact: high under poor connectivity; effort: medium**

The embedded node's own keepalive/pull/reconnect policy is not visible in this repository. The app has only a pause/resume switch and foreground catch-up. Mobile radios pay a high tail-energy cost for frequent small network operations, especially while switching Wi-Fi/cellular or in poor coverage.

Expose a native policy interface to the delivery library, if available, or wrap operations with an app policy:

* Use `ConnectivityManager` callbacks to avoid retry loops while offline and resume with jitter when validated connectivity returns.
* Apply exponential backoff with jitter for failed delivery/reconnect, bounded by user-visible urgency.
* Coalesce catch-up, pending sends, and media retries into one connection window.
* Treat metered/roaming and Battery Saver as inputs to lower-frequency background sync, without delaying an explicit user send.
* Record reconnects, attempts, bytes, and active time by network type to guide tuning.

Avoid assuming a fixed 20-second interval is optimal without traces from the native node.

### P-05 — Make BLE a battery-aware session, not a permanently restored continuous scan

**Priority: P1; impact: high when BLE enabled; effort: medium**

BLE auto-restores whenever `bleEngagedPref` is true. The native module scans continuously in low-power mode and advertises continuously in balanced, connectable mode. Connecting to discovered peers can keep up to six GATT links. The one-minute identity timer is low cost, but repeated re-advertising and connection churn are not.

Recommended policy:

* Keep the current explicit opt-in, but default to **off after a bounded session** (for example 15–60 minutes) unless the user selects an always-on nearby mode.
* Offer profiles: **Discoverable**, **connected relay**, and **off**. Scan only while discovery is needed; once trusted links exist, stop or duty-cycle discovery.
* In background/screen-off state, progressively duty-cycle scans (for example a short scan window followed by a longer sleep) unless an active transfer or user-selected always-on mode requires continuity.
* Prefer passive scanning where API/device support and product requirements permit; retain service-data filtering.
* Disconnect idle GATT links, add exponential reconnect backoff, and cap concurrent transfer work separately from link count.
* Delay contact-card re-announcement until a genuine new peer/link event; do not announce merely because the app was restored unless discovery is intended.

Use Android Bluetooth power profiles as guidance, but tune exact scan/window values with real devices because controller behavior is OEM-specific.

### P-06 — Bound and schedule media/Tor work for thermal and battery safety

**Priority: P1; impact: moderate/high during large media; effort: medium**

Video transcoding is CPU/GPU-intensive and storage/media transfers can be large. They run on ad-hoc threads with no visible operation queue, cancellation API, battery/charging constraint, network policy, or thermal awareness. Tor starts on app launch whenever enabled, even if no media needs transfer.

* Use a single bounded media-operation queue; never transcode multiple videos concurrently.
* Add cancellation on conversation deletion, app shutdown, and user cancel; clean partial files.
* Check `PowerManager` thermal status and Battery Saver before starting expensive transcodes; offer lower-resolution/deferred options.
* For non-urgent upload/download, use WorkManager constraints (network available, unmetered/charging as user-selected) and resumable chunking/checkpoints.
* Start Tor lazily when a Tor-routed operation is requested; retain it for a short idle grace period, then stop it. Keep startup asynchronous and visible.
* Measure codec fallback rate; uploading originals after failed transcode may consume far more energy/data than a retry or explicit user choice.

### P-07 — Coalesce foreground-resume work and protect the node executor

**Priority: P2; impact: moderate; effort: low**

Every transition to `active` calls `catchupNow()`, which creates a new thread that invokes the serialized node executor. Repeated focus transitions can enqueue redundant catch-ups behind node work. The native periodic pull still runs.

Replace fire-and-forget calls with a `catchupInFlight`/minimum-interval guard in `NodeRuntime`: permit one catch-up at a time, merge callers, and skip it if a periodic pull completed recently. Collect latency and result metrics. This improves resume responsiveness under event storms without changing delivery semantics.

### P-08 — Establish a battery-performance measurement gate

**Priority: P0; impact: enables safe tuning; effort: medium**

The existing two-hour idle observation is useful baseline evidence, but it is one model, a coarse percentage indicator, no traffic, and insufficient to assess radio, BLE, Tor, media, thermal, or poor-network cost.

Build a repeatable test matrix and collect:

| Scenario | Required metrics |
|---|---|
| Delivery idle, Wi-Fi and cellular | battery drain/hour, UID CPU time, wakeups, radio active time, network bytes, reconnects |
| Background receive under message bursts | delivery latency, wakeups, DB write time, notification updates, bytes/message |
| No/poor/changing network | reconnect attempts, backoff behavior, radio tail time, recovery latency |
| BLE discovery and relay | drain/hour, scan/advertise duty cycle, GATT links, packets/bytes, CPU, screen-off behavior |
| Tor media fetch/upload | bootstrap time, CPU, bytes, transfer energy, idle retention cost |
| Video/audio/location | peak thermal state, CPU/GPU time, completion/cancel behavior, bytes and battery cost |
| Android 15/16 timeout | service timeout handling, data preservation, user-visible recovery |

Use `adb shell dumpsys batterystats`, Battery Historian/Perfetto, Android Studio Energy Profiler, `dumpsys activity services`, `dumpsys bluetooth_manager`, network stats, and app-internal counters. Normalize runs by device, OS, signal quality, screen state, and duration. Define budgets before optimization, such as idle drain, median receive latency, reconnect rate, and BLE session drain.

## Recommended implementation sequence

1. **P0:** add measurement/counters and Android 15+ `dataSync` timeout handling; decide and implement explicit delivery modes.
2. **P1:** eliminate 30-second notification polling; add coalesced catch-up; introduce adaptive connectivity/retry policy.
3. **P1:** add BLE sessions/duty cycling/idle link handling and a bounded media queue with cancellation and thermal/network constraints.
4. **P2:** lazy-start/idle-stop Tor, tune scan and reconnect values from traces, and publish user-facing battery expectations for each transport mode.

## Existing strengths to preserve

* Native persistence before JS forwarding avoids background JS timer dependency.
* The service uses a single scheduled executor rather than multiple JS intervals.
* The implementation found no persistent explicit wake lock.
* BLE uses a service-data filter and low-power scan mode; it is better than unfiltered, low-latency scanning.
* Audio capture, one-shot location, video compression, and storage cryptography do not block the UI thread.
* The BLE card announcement has a delay and 30-second flood guard; preserve these when introducing duty cycling.

## Sources and limitations

The review is source-based. Existing project evidence reports idle FGS drain below ~0.5%/hour resolution over two hours on one Samsung device with no traffic; it is not a representative battery benchmark. Android platform guidance used for current lifecycle recommendations: [foreground-service overview](https://developer.android.com/develop/background-work/services/fgs), [foreground-service timeouts](https://developer.android.com/develop/background-work/services/fgs/timeout), [foreground-service changes](https://developer.android.com/develop/background-work/services/fgs/changes), and [BLE scan settings](https://developer.android.com/reference/android/bluetooth/le/ScanSettings).
