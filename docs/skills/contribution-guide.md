# Peers skills — contribution guide

Atomic, retrievable lessons for the Peers app (`xAlisher/peers`). Mirrors the
`~/basecamp/basecamp-skills` protocol, adapted to Peers' stack. One file, one
technique, **≤80 body lines**. The monolith `docs/PROJECT_KNOWLEDGE.md` stays for
narrative/ADR context; discrete techniques come here so an agent can retrieve them
cold from the indexes instead of reading a 43KB blob.

## When to add
After a task/bug/retro surfaces a technique that would apply to a *second* task.
Route: native stack/build/crypto/delivery/UI/release/on-device → here. Process that
applies to any project → `~/fieldcraft/protocols/`. Cross-project reference → agent memory.

## Frontmatter schema (Peers-specific)
```yaml
---
id: kebab-case-unique-id
title: One-line imperative summary
phase: <from _taxonomy.yml phases>
type:  <from _taxonomy.yml types>
severity: low | medium | high | critical
severity_reason: one sentence — what breaks if ignored
# ⚠️ MANDATORY version anchor — how a future agent detects staleness. Peers pins the
# NATIVE stack, not basecamp/DS. Fill what the recipe actually depends on; "n/a" only
# for pure-JS/process recipes that no native change can invalidate.
libchat_commit: ""   # the LIBCHAT_COMMIT the recipe was verified against, e.g. "462a4884". "n/a" if JS/process-only.
so_hash: ""          # short liblogoschat.so hash if the recipe is .so-dependent, e.g. "e879a3e0". else "n/a".
app_version: ""      # Peers versionName verified on, e.g. "0.9.9"
verified_date: ""    # YYYY-MM-DD — REQUIRED
last_used: "YYYY-MM-DD"
created: "YYYY-MM-DD"
status: active       # active | suspect | deprecated
---
```

## Body structure
```markdown
## Problem
≤3 sentences. What goes wrong, or the question this answers.

## Recipe
Concrete code / commands / steps.

## Why          ← optional, ≤3 sentences
## See also     ← optional, list of recipe ids
```

## After writing
1. Add a row to `_index/by-phase.md` (under the phase, severity-sorted, `last_used` desc).
2. Add a row to `_index/by-type.md` (under the type).
3. Commit with the app repo: `skills: add <id> — <reason>`.

## Staleness
A recipe goes `status: suspect` when its `libchat_commit`/`so_hash` no longer matches
what ships (a repin or `.so` bump can flip native behaviour), or a `/log fail` cites it.
Re-verify on the current build, bump the anchor + `last_used`, set `active`.
