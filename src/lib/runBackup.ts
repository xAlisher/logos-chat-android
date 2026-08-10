import LogosChat from '../native/LogosChat';
import {KV_LAST_BACKUP_AT} from './backupStatus';

// #493/#494: run the encrypted export AND record the last-backup timestamp, so
// every entry point (About screen, the reset-modal "Back up now") stays consistent.
// Returns the recorded ms timestamp on success; throws on failure (caller toasts).
export async function exportEncryptedBackup(passphrase: string): Promise<number> {
  await LogosChat.exportChatData(passphrase);
  const at = Date.now();
  await LogosChat.setSetting(KV_LAST_BACKUP_AT, String(at));
  return at;
}
