import {
  backupStatus,
  parseLastBackupAt,
  KV_LAST_BACKUP_AT,
} from '../src/lib/backupStatus';

describe('parseLastBackupAt', () => {
  it('treats absent / blank / malformed / non-positive as no backup', () => {
    for (const v of [null, undefined, '', '   ', 'abc', '0', '-5', 'NaN']) {
      expect(parseLastBackupAt(v as string | null)).toBeNull();
    }
  });
  it('parses a positive ms epoch', () => {
    expect(parseLastBackupAt('1700000000000')).toBe(1_700_000_000_000);
    expect(parseLastBackupAt('  1700000000000  ')).toBe(1_700_000_000_000);
  });
});

describe('backupStatus', () => {
  const NOW = Date.UTC(2026, 7, 10, 12, 0, 0); // 2026-08-10

  it('never backed up → red danger label', () => {
    expect(backupStatus(null, NOW)).toEqual({text: 'Never backed up', danger: true});
  });

  it('a future timestamp (clock skew) is not trusted → never', () => {
    expect(backupStatus(NOW + 86_400_000, NOW).danger).toBe(true);
  });

  it('a past backup → dated, non-danger label', () => {
    const s = backupStatus(Date.UTC(2026, 7, 8), NOW, 'en-US');
    expect(s.danger).toBe(false);
    expect(s.text).toMatch(/^Last backup: /);
    expect(s.text).toContain('2026');
    expect(s.text).toContain('Aug');
  });

  it('the KV key is the stable string the store writes', () => {
    expect(KV_LAST_BACKUP_AT).toBe('lastBackupAt');
  });
});
