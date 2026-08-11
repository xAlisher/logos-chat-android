---
id: rehome-feature-on-upstream-rewrite
title: When upstream deletes the file a fork feature lives in, re-home the feature onto the replacement and check what upstream now enforces itself
phase: native-fork
type: pattern
severity: high
severity_reason: a fork feature built on a deleted file won't compile; blindly porting it can also duplicate a guarantee upstream now provides, or drop one it doesn't.
libchat_commit: "462a4884"
so_hash: "e879a3e0"
app_version: "0.9.9"
verified_date: "2026-08-08"
last_used: "2026-08-08"
created: "2026-08-08"
status: active
---

## Problem
Upstream #184 deleted `contact_registry/http.rs` (HTTP registry) and replaced it with
`store.rs` (delivery-based `ContactRegistry`). Our fork's #239 offline-contact-card cache
and the GHSA-xxgx-7757-3qq6 key-package binding (patch 491) lived entirely in `http.rs`.

## Recipe
Re-home, don't blind-port. Three moves:

1. **Port the feature onto the replacement, reusing its primitives.** #239's offline cache
   (`local_keypackages`/`local_accounts` + `export_contact`/`import_contact`) moved onto
   `store.rs::ContactRegistry`, reusing store's own `encode_payload`/`decode_payload` +
   the recover-key-from-device_id verify — instead of the fork's bespoke format.
2. **Check what upstream now enforces itself — a fork guard may be subsumed.** Patch 490's
   group-layer "leaf signature_key == requested signer" check was needed only because the
   OLD http registry `retrieve` was *unverified*. The NEW `store::retrieve` verifies the
   package was Ed25519-signed by the requested device — so 490 is subsumed for the online
   path (and it mis-fired anyway: a de-mls member id is the leaf CREDENTIAL, not the
   signer-key hex). Dropped it; kept 491 for the offline-card path store doesn't cover.
3. **Follow every consumer of the deleted symbol.** `grep -rn HttpRegistry` surfaced the
   glue (`logos.rs open_persistent`) that still constructed the old type → switch to
   `ContactRegistry::new(transport.clone(), url, publish_mode)`. Update the mod file +
   the build script's fail-closed security-marker assertions (they grepped `http.rs`).

Verify: `cargo test` — the fork's own integration test (`saro_and_raya`,
`offline_bootstrap_via_imported_contact`) exercises the re-homed path end-to-end.

## Why
A registry rewrite changes the ground a fork feature stands on. Porting mechanically can
duplicate a now-upstream guarantee (490) or drop the offline edge upstream never had (491).
Read the new code's verify path before deciding port vs subsume.

## See also
- xwing-provider-single-suite
- repin-via-3way-rebase
