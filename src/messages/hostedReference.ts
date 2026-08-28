import {isMediaContent} from './media';
import {parseReply, REPLY_PREFIX} from './reply';
import {parseRelay, RELAY_PREFIX} from '../native/relay';

/** Release-blocker #539: shared fail-closed hosted-reference classifier. */
export function containsSensitiveHostedReference(raw: string): boolean {
  let body = raw;
  for (let depth = 0; depth < 8; depth++) {
    if (isMediaContent(body)) return true;
    if (body.startsWith('pfp1:')) {
      body = body.slice('pfp1:'.length);
      continue;
    }
    const relay = parseRelay(body);
    if (relay != null) {
      body = relay.text;
      continue;
    }
    if (body.startsWith(RELAY_PREFIX)) return true;
    const reply = parseReply(body);
    if (reply != null) {
      body = reply.body;
      continue;
    }
    if (body.startsWith(REPLY_PREFIX)) return true;
    return false;
  }
  // Any still-wrapped remainder is ambiguous and therefore sensitive.
  return true;
}

export {isMediaContent};
