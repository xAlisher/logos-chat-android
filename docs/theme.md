# logos-chat-android — visual system spec

Material Design (react-native-paper MD3) with a fully custom **dark-only, terminal-emerald**
theme — the `chat_ui_mix` visual language, adapted to phone. JetBrains Mono everywhere.
Branding mark: `> λ chat`.

## 1. Color tokens (`src/theme/colors.ts`)

| Token | Hex | Use |
|---|---|---|
| `canvas` | `#0A0A0A` | App background, message area |
| `pane` | `#111111` | Lists, input rows |
| `panel` | `#161616` | Headers, cards, dialogs, status bar |
| `border` | `#2a2a2a` | All borders/separators |
| `text` | `#FAFAFA` | Primary text |
| `textDim` | `#6B7280` | Labels, secondary |
| `textFaint` | `#4B5563` | Timestamps, muted |
| `accent` | `#10B981` | Own bubble fill, buttons, online dot, branding, MIX pill |
| `accentHover` | `#34D399` | Pressed/hover states (Paper ripple tint) |
| `accentPressed` | `#059669` | Active press |
| `onAccent` | `#000000` | Text on accent (own-bubble text; ~7:1 on `#10B981`) |
| `bubblePeer` | `#1F1F1F` | Received bubble fill (text `#FAFAFA`) |
| `unread` | `#EF4444` | Unread badge (display capped "99+"); mix pool-below-min warning |
| `pulse` | `#F59E0B` | Amber startup pulse (node Initializing/Starting) |
| `errorFill` | `#5c1a1a` | Error toast fill |
| `errorBorder` | `#C62828` | Error toast border (text `#EF4444`) |
| `qrBg` / `qrFg` | `#FFFFFF` / `#000000` | QR modules — **always** white-bg/black-fg for scannability, regardless of theme |

Paper MD3 mapping (adapter in `src/theme/index.ts`): `background=canvas`, `surface=pane`,
`surfaceVariant=panel`, `primary=accent`, `onPrimary=onAccent`, `outline=border`,
`error=#EF4444`, `onSurface=text`, `onSurfaceVariant=textDim`. No default Material colors may
leak (AC of the theme issue).

## 2. Typography (`src/theme/typography.ts`)

**JetBrains Mono only** (Regular 400 / Medium 500 / Bold 700, bundled in `assets/fonts/`).

| Style | Size/weight | Use |
|---|---|---|
| `brand` | 16 / Bold | `> λ chat` header mark (accent color) |
| `title` | 16 / Medium | Screen titles, conversation names |
| `body` | 14 / Regular | Messages, inputs |
| `label` | 12 / Regular | Labels, previews, status text |
| `caption` | 10 / Regular | Timestamps, badges |
| `code` | 13 / Regular | Bundle strings, IDs (selectable) |

## 3. Spacing / shape

Scale 4 / 8 / 12 / 16 / 24. Radii: bubbles 8, cards 8, pills 999. Bubbles max-width 78% of
screen. List row heights: conversation 64dp, header 56dp. Touch targets ≥ 44dp.

## 4. Screens

### Conversations
Header: `> λ chat` brand left, node `StatusPill` right (see States). Rows: name (title),
last-message preview (label, `textDim`, 1 line), timestamp (caption, `textFaint`), unread pill
(`unread` fill, white text, "99+" cap), online/pending dot. FAB or header action **`+ new`** →
Scanner (with paste fallback). Empty state: centered `label` text "no conversations — scan a
peer's QR to start".

### Chat thread
Inverted list; peer bubbles left (`bubblePeer`/`text`), own right (`accent`/`onAccent`);
timestamps (caption) under bubbles; day separators (label, centered). Expired-session state
(M3): banner in `panel` with `border`, text + two actions *Show my QR* / *Scan theirs*; composer
disabled while expired. Composer: `pane` row, mono input, send button (`accent`, `>>` glyph);
optimistic `pending` state on sent messages (spinner/dimmed) — **no "delivered" ticks** (the lib
never emits delivery acks).

### Intro bundle (Show my QR)
`panel` card, `border` outline: QR ~260dp (white card area, black modules, quiet zone), the full
`logos_chatintro_1_…` string below in `code` style (selectable, wrapped), **Copy** button
(`accent`); confirmation flash "copied" in `accent`.

### Scanner
Full-bleed camera preview, emerald corner brackets ~240dp, caption "scan a logos_chat intro
bundle". Valid scan (prefix `logos_chatintro_1_`) → haptic + proceed to opening-message composer.
Invalid QR → inline `unread`-colored caption "not an intro bundle". Permission-denied and
no-camera paths land on **Paste bundle** (mono input + validate). Paste is always reachable via a
text button under the preview.

### Settings / Status
Identity name (editable pre-start), node status line, epoch info, app version. M4 adds: **Private
routing** toggle (confirm dialog warns sessions re-introduce; spinner during client recreate) and
"Mix network: N/min nodes" diagnostics (red when N < min).

## 5. States & signature moves

- **Node states**: `stopped` (`textFaint`) → `initializing`/`starting` (**amber `pulse` opacity
  0.35↔1.0, 550ms loop** — the signature startup animation, from chat_ui_mix) → `running`
  (`accent` steady dot) → `error` (`#EF4444`).
- **Mix chrome (M4)**: emerald **outlined** MIX pill in the header on *every* screen while
  Private routing is on (the forgotten-global-mode guard); pool indicator `MIX n/min` — `accent`
  healthy, `unread` when short; composer placeholder becomes "Waiting for mix peers…" and send
  disabled when gated. **Never silent fallback.**
- **Errors**: toast bottom, `errorFill`/`errorBorder`/`#EF4444` text, 4s auto-dismiss, mono.
- **In-flight mix send (M4)**: distinct hop/shuffle sending indicator so mix latency reads as
  privacy work, not breakage.

## 6. Accessibility

Contrast: all text pairs above meet WCAG AA (`#FAFAFA` on `#0A0A0A` ≈ 18:1; `#000000` on
`#10B981` ≈ 7:1; check `textFaint` `#4B5563` on `canvas` ≈ 4.6:1 — use ≥ 12px). Unread and
status never color-only (count text + dot + label). QR screen keeps the code text as the
non-visual alternative; scanner always offers paste.
