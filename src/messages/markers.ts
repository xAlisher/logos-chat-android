// Folded control markers — messages that travel on the wire like any other
// message (persisted, synced, reloaded) but must NEVER be rendered as a chat
// bubble. Each is folded into some other affordance instead: a reaction chip, a
// pin bar, a system line, an avatar, a config toggle, a recovery action.
//
// WHY THIS FILE EXISTS: the marker set used to be duplicated as an inline
// `isX(t) || isY(t) || …` chain at every render site. Adding a marker meant
// remembering every chain — and #350's `readd1:` was added to the native guards
// (unread / preview / notification) but missed BOTH JS chains, so the "never a
// bubble" control message rendered as a raw `readd1:<hex>` bubble on the sender
// AND every recipient. One list, one predicate, so the next marker can't be
// half-registered.
import {isReactionContent} from './reactions';
import {isPinContent} from './pins';
import {isLeaveContent} from './leave';
import {isPfpContent} from './pfp';
import {isGroupCfgContent} from './groupcfg';
import {isReaddContent} from './readd';

/** Every folded-marker predicate. Add new control markers HERE, not at a call site. */
export const FOLDED_MARKERS: ReadonlyArray<(s: string) => boolean> = [
  isReactionContent, // react1: → folded into the reaction chips
  isPinContent, // pin1:   → folded into the pinned bar
  isLeaveContent, // leave1: → folded into a "left" system line
  isPfpContent, // pfp1:   → folded into the avatar
  isGroupCfgContent, // gcfg1:  → folded into the storage toggle (#344)
  isReaddContent, // readd1: → folded into the creator's auto re-add (#350)
];

/** True when `text` is a control marker that must not be rendered as a bubble. */
export function isFoldedMarker(text: string): boolean {
  return FOLDED_MARKERS.some(is => is(text));
}
