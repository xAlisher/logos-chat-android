// #262 — pure link detection for message text. RN-free + unit-tested so the bubble
// renderer can split a message into plain runs and tappable URL runs without any
// dependency. Detects:
//   • http(s):// URLs
//   • bare www.* (promoted to https://)
//   • scheme-less domains — github.com/x, peers.tech — promoted to https://
// We do NOT auto-detect mailto/geo — only web links, opened explicitly on tap.
//
// Scheme-less matching is deliberately conservative to avoid linkifying prose that
// merely looks domain-ish (file names like `index.ts`, `notes.md`; version strings;
// email domains). A bare host is a link ONLY when it has a /path OR its TLD is a
// well-known web TLD, and never when it directly follows an '@' (an email address).

export interface TextRun {
  text: string;
  /** present iff this run is a link — the URL to open (may add https://). */
  url?: string;
}

// One of: http(s):// URL · bare www.* · bare host(.host)+.tld(/path)?
const URL_RE =
  /(https?:\/\/[^\s]+|www\.[^\s]+|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s]*)?)/gi;
const TRAILING_PUNCT = /[.,;:!?'"]+$/;

// TLDs we accept on a *bare, path-less* host (github.com/x is accepted via its path;
// peers.tech is accepted via this list). Keeps `foo.md` / `index.ts` out.
const COMMON_TLDS = new Set([
  'com', 'org', 'net', 'io', 'dev', 'app', 'tech', 'xyz', 'co', 'me', 'info',
  'ai', 'gg', 'so', 'sh', 'live', 'news', 'link', 'chat', 'social', 'im',
]);

function splitTrailing(raw: string): {url: string; trailer: string} {
  let url = raw;
  let trailer = '';
  // Strip trailing sentence punctuation.
  const m = url.match(TRAILING_PUNCT);
  if (m) {
    trailer = m[0] + trailer;
    url = url.slice(0, url.length - m[0].length);
  }
  // Unbalanced trailing ')' → treat as not part of the link.
  while (url.endsWith(')') && countChar(url, '(') < countChar(url, ')')) {
    trailer = ')' + trailer;
    url = url.slice(0, -1);
  }
  return {url, trailer};
}

function countChar(s: string, c: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s[i] === c) n++;
  return n;
}

/** Normalize a matched token to an openable href (any scheme-less token → https://). */
export function hrefFor(token: string): string {
  return /^https?:\/\//i.test(token) ? token : `https://${token}`;
}

/**
 * A scheme-less host is a real link only if it has a /path, or its TLD is well-known.
 * (Called only for tokens that are neither http(s):// nor www.*)
 */
function bareHostIsLink(url: string): boolean {
  if (url.includes('/')) return true; // has a path → treat as a link
  const tld = url.split('.').pop()?.toLowerCase() ?? '';
  return COMMON_TLDS.has(tld);
}

/**
 * Split `input` into ordered runs. Plain text runs have no `url`; link runs carry
 * the openable `url`. Concatenating every run's `text` reproduces `input` exactly.
 */
export function linkify(input: string): TextRun[] {
  const runs: TextRun[] = [];
  let last = 0;
  URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(input)) !== null) {
    const start = m.index;
    const token = m[0];
    const hasScheme = /^https?:\/\//i.test(token);
    const isWww = /^www\./i.test(token);
    const {url, trailer} = splitTrailing(token);
    // Skip: pure-punctuation match; an email domain (preceded by '@'); or a bare
    // host that isn't link-worthy (no path and an unknown TLD → likely a filename).
    if (
      url.length === 0 ||
      (start > 0 && input[start - 1] === '@') ||
      (!hasScheme && !isWww && !bareHostIsLink(url))
    ) {
      continue; // leave the span as text; `last` is unchanged so it's captured later
    }
    if (start > last) runs.push({text: input.slice(last, start)});
    runs.push({text: url, url: hrefFor(url)});
    if (trailer) runs.push({text: trailer});
    last = start + token.length;
  }
  if (last < input.length) runs.push({text: input.slice(last)});
  if (runs.length === 0) runs.push({text: input});
  return runs;
}

/** True if `input` contains at least one detectable link. */
export function hasLink(input: string): boolean {
  return linkify(input).some(r => r.url != null);
}
