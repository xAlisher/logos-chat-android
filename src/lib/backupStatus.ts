// #493: the last-backup status shown under the "Back up" control on the About
// screen. Pure so the date/never logic is unit-tested independently of the view.

/** KV key: ms-epoch of the last successful encrypted export (#493). */
export const KV_LAST_BACKUP_AT = 'lastBackupAt';

export type BackupStatus = {
  /** Text to render. */
  text: string;
  /** True → render in the danger colour (never backed up). */
  danger: boolean;
};

/**
 * Parse a KV value (the raw string from `getSetting`) into a last-backup ms
 * timestamp, or `null` when absent/blank/malformed. Exported so the caller and
 * the tests agree on what counts as "no backup".
 */
export function parseLastBackupAt(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const t = raw.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The status label under the backup control. `lastBackupAt` is the parsed ms
 * timestamp (or null). `now` + `locale` are injectable for deterministic tests.
 */
export function backupStatus(
  lastBackupAt: number | null,
  now: number = Date.now(),
  locale?: string,
): BackupStatus {
  if (lastBackupAt == null || lastBackupAt > now) {
    // Absent, or a clock-skew future value we don't trust → treat as "never".
    return {text: 'Never backed up', danger: true};
  }
  const when = new Date(lastBackupAt).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  return {text: `Last backup: ${when}`, danger: false};
}
