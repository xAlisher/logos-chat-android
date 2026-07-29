// #262 — link detection (pure logic).
import {linkify, hrefFor, hasLink} from '../src/text/linkify';

// The core invariant: runs concatenate back to the input, exactly.
function assertRoundTrip(input: string) {
  expect(linkify(input).map(r => r.text).join('')).toBe(input);
}

describe('linkify', () => {
  it('returns a single plain run for link-free text', () => {
    const runs = linkify('just some text');
    expect(runs).toEqual([{text: 'just some text'}]);
  });

  it('detects a bare https URL', () => {
    const runs = linkify('see https://peers.tech now');
    expect(runs).toEqual([
      {text: 'see '},
      {text: 'https://peers.tech', url: 'https://peers.tech'},
      {text: ' now'},
    ]);
  });

  it('detects http and multiple URLs', () => {
    const runs = linkify('a http://x.io b https://y.io');
    const links = runs.filter(r => r.url);
    expect(links.map(l => l.url)).toEqual(['http://x.io', 'https://y.io']);
    assertRoundTrip('a http://x.io b https://y.io');
  });

  it('promotes bare www. to https://', () => {
    const runs = linkify('go to www.peers.tech');
    const link = runs.find(r => r.url);
    expect(link?.text).toBe('www.peers.tech');
    expect(link?.url).toBe('https://www.peers.tech');
  });

  it('strips trailing sentence punctuation from the link but keeps it as text', () => {
    const runs = linkify('open https://peers.tech.');
    expect(runs).toEqual([
      {text: 'open '},
      {text: 'https://peers.tech', url: 'https://peers.tech'},
      {text: '.'},
    ]);
    assertRoundTrip('open https://peers.tech.');
  });

  it('drops an unbalanced trailing paren but keeps balanced ones', () => {
    const wrapped = linkify('(https://peers.tech)');
    expect(wrapped.find(r => r.url)?.url).toBe('https://peers.tech');
    expect(wrapped.map(r => r.text).join('')).toBe('(https://peers.tech)');

    const wiki = linkify('https://en.wikipedia.org/wiki/A_(b)');
    expect(wiki.find(r => r.url)?.url).toBe('https://en.wikipedia.org/wiki/A_(b)');
  });

  it('preserves query strings and fragments', () => {
    const url = 'https://a.io/p?q=1&r=2#frag';
    expect(linkify(`x ${url}`).find(r => r.url)?.url).toBe(url);
  });

  it('always round-trips (text runs rebuild the input)', () => {
    for (const s of [
      '',
      'no links here',
      'https://only.link',
      'trailing https://a.io, and https://b.io!',
      'парео https://кириллица.example ok',
      'multi\nline https://a.io\nend',
    ]) {
      assertRoundTrip(s);
    }
  });

  it('empty string yields one empty run', () => {
    expect(linkify('')).toEqual([{text: ''}]);
  });
});

describe('hrefFor', () => {
  it('leaves http(s) untouched, prefixes www.', () => {
    expect(hrefFor('https://a.io')).toBe('https://a.io');
    expect(hrefFor('http://a.io')).toBe('http://a.io');
    expect(hrefFor('www.a.io')).toBe('https://www.a.io');
  });
});

describe('hasLink', () => {
  it('is true only when a link is present', () => {
    expect(hasLink('nope')).toBe(false);
    expect(hasLink('yep https://a.io')).toBe(true);
    expect(hasLink('yep www.a.io')).toBe(true);
  });
});
