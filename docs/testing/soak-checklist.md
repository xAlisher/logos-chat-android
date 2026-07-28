# Soak / verification checklist — clear the debt

Consolidated + deduped from the v0.7.47 / v0.7.52 / v0.7.53 plans + the delivery,
WSS, and encryption work. **RedMe + Samsung are on 0.7.56 and have everything** — do
all of it there. (Pixel is 0.7.55 = Phase-1 only, held back on purpose.)

Grouped by the setup each needs, so you can batch.

---

## 1 · Single phone, nothing else needed
- [ ] **#256 voice bubble** — record a ~20s note *and* the longest note you can; neither overflows the bubble, short stays compact, long hits the width cap with ▶ + `mm:ss` visible. Check landscape.
- [ ] **#257 waveform tracks real mic** — while recording, speak loud / soft / silent; the 28 bars follow actual loudness (not a fixed loop). Watch for jank on both phones.
- [ ] **#253 context FAB** — switch sections in the side menu; the "+" recolors **orange** (Logos) / **green** (MeshCore) / **blue** (BLE). Logos → Contact opens Scan, Group opens New Group; MeshCore items land on the MeshCore page; BLE "Add BLE Groups" is dimmed.
- [ ] **#182 MeshInfoModal scroll** — open "About mesh mirroring" (mesh banner ⓘ / chat ⋮); it scrolls fully to the bottom above "Got it", persistent scrollbar.
- [ ] **#241 share QR as image** — My-address → **Share** → the OS sheet; share to Photos/Files and confirm you get the **QR + sigil image** (not just text).
- [ ] **#236 auto-lock** — needs a PIN set. Settings → Security → **"Lock when app goes to background"** ON. Background >15s → PIN gate on return; quick switch <15s → no relock; toggle OFF → no relock.
- [ ] **#158 swipe-back** — edge-swipe from the left on Chat / Group Info / Contacts / About goes back; doesn't fight swipe-to-delete on the conversation list.
- [ ] **#226 resume stability** — Developer Options → **"Don't keep activities" ON** → background + resume repeatedly → no black screen / no "Screen fragments" crash.
- [ ] **#259 BLE restore after restart** — engage BLE mesh → force-kill the app → relaunch → BLE **auto re-engages** with the same *Broadcast identity* state. Left OFF → stays off. OS Bluetooth OFF → boot doesn't try to engage (no error).

## 2 · Single phone, but needs a mesh-mapped contact / a BLE peer to see the effect
- [ ] **#174 mesh badge** — a mesh-mapped 1:1 shows the green mesh badge on its **conversation-list row**, in the **chat header**, and in the **contacts list**.
- [ ] **#246 BLE presence** — a Bluetooth DM shows a blue pulsing **"nearby"** dot on its **list row** and **chat header** when the peer is heard over BLE; clears when out of range.
- [ ] **#147 member-picker presence** — New group → Add members (BLE engaged + a peer nearby): **"via mesh · N of M nearby"** header; out-of-range members dimmed with "not nearby", in-range "nearby".

## 3 · Two phones (peer on the same build)
- [ ] **#211 delivery — the big one** — from a **fresh relaunch where the receiver never sends**, send a **photo / voice / location** A→B; B receives it **without replying**, within ~20s. (Proven with text probes; confirm with real media = your original bug.)
- [ ] **#240 QR include-label** — A sets a label; My-address → **"Include my label"** toggle (only shows with a label, default off) ON → B scans → B's new-conversation name is **prefilled** with A's label. Also: B scans an **old bare-address QR** → still starts a chat.
- [ ] **#210 map-to-mesh from a message** — long-press a **peer's** bubble in a **1:1** and a **group** → "Map to mesh" / "Change mesh identity" opens MeshMapModal targeting that sender; mapping persists.
- [ ] **#252 / #230 group join lines** — create a **new** group, invite a peer: on the invitee the creator's **"joined"** line sorts **before** the creator's first message; both show "joined" **without the invitee sending**; and repeated restart/re-invite does **not** stack "Group re-created"/"invited"/"hasn't joined" blocks.

## 4 · Special network (one phone on a restrictive network)
- [ ] **#221 WSS fallback** — put a phone on a network that blocks TCP **:30304** but allows **:8000** (a locked-down wifi / a filtering VPN) → confirm messages still deliver via WSS. If they don't, it's a small follow-up (point filternode/lightpushnode at the WSS multiaddr via env — no rebuild).

## 5 · Encryption soak (the current hold — RedMe + Samsung)
- [ ] **#258 Phase 2 at-rest encryption** — over normal use across many restarts: chats open, history intact, send/receive work, and **never** an unexpected empty-list / "start over" moment. If it's clean after a good soak → **your go/no-go to promote Phase 2 to the Pixel.**

---

### Notes
- Anything that fails → reopen the linked issue with what you saw; the migration path (#258) has a verified backup + rollback, so a failure there won't lose data (it falls back to plaintext).
- `#226` real fix is native (`super.onCreate(null)`, shipped); the JS `freezeOnBlur:false` is a belt-and-suspenders add.
