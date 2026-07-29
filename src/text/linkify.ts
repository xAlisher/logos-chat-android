// #262 — pure link detection for message text. RN-free + unit-tested so the bubble
// renderer can split a message into plain runs and tappable URL runs without any
// dependency. Detects http(s):// URLs and bare www.* (promoted to https://). We do
// NOT auto-detect mailto/geo here — only web links, opened explicitly on tap.

export interface TextRun {
  text: string;
  /** present iff this run is a link — the URL to open (may add https:// to www.*). */
  url?: string;
}

// A URL run ends at whitespace. We then trim trailing punctuation that is almost
// always sentence punctuation rather than part of the link, and balance a trailing
// ")" only when the URL has no matching "(" (so "(https://a.com/x)" keeps its path
// but "https://en.wikipedia.org/wiki/A_(b)" keeps the paren).
const URL_RE = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
const TRAILING_PUNCT = /[.,;:!?'"]+$/;

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

/** Normalize a matched token to an openable href (bare www.* → https://). */
export function hrefFor(token: string): string {
  return /^www\./i.test(token) ? `https://${token}` : token;
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
    const {url, trailer} = splitTrailing(m[0]);
    if (url.length === 0) {
      // The whole match was punctuation-ish; leave it as text and continue.
      continue;
    }
    if (start > last) runs.push({text: input.slice(last, start)});
    runs.push({text: url, url: hrefFor(url)});
    if (trailer) runs.push({text: trailer});
    last = start + m[0].length;
  }
  if (last < input.length) runs.push({text: input.slice(last)});
  if (runs.length === 0) runs.push({text: input});
  return runs;
}

/** True if `input` contains at least one detectable link. */
export function hasLink(input: string): boolean {
  URL_RE.lastIndex = 0;
  return URL_RE.test(input);
}
