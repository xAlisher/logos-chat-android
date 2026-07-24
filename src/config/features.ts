// Feature flags.
//
// MIX_UI_ENABLED (#81): the Private-routing (mix) toggle is HIDDEN for now.
// Mix can't message normal-mode peers (needs both ends on mix), resets identity
// on every switch, and can't E2E-deliver from the phone yet (no RLN membership),
// so it's a footgun for test users. All the dual-binary/mix infrastructure stays
// in place — only the UI entry point is hidden, and the node is forced to run in
// standard mode. Re-enable when mix is per-conversation (#34) / matured.
export const MIX_UI_ENABLED = false;

// CONTACT_ATTACH_ENABLED (#82): the manual "unknown → attach/merge to a contact"
// flow is HIDDEN for now — it's a confusing workaround for the ephemeral-identity
// limitation. So we don't amber-flag unknown conversations and don't show the
// attach bar. The Contacts + stable-identity epic (#69) replaces this properly
// (auto-attribution by pinned key). Persistence/merge code stays intact.
export const CONTACT_ATTACH_ENABLED = false;
