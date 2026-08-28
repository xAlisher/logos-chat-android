// Senti P2 on #543 — a stricter caller must not destroy a cache entry a looser one still uses.
//
// THE REGRESSION THIS PINS. The media cache file is keyed by SHA-256(cid) ALONE, so every
// reference to a CID shares one pair of files (plaintext + ciphertext-size sidecar). But the
// ciphertext bound is per-CALLER and comes off the sender's `mime` field: visual media gets
// 100 MiB, `audio/*` gets 2 MiB. #543's first cut deleted the pair whenever it did not satisfy
// THIS caller's bound, so:
//
//   1. an image (5 MiB ciphertext) is downloaded and cached under the 100 MiB bound
//   2. any peer sends a marker for the SAME cid typed `audio/mp4` -> 2 MiB bound
//   3. native sees sidecar 5 MiB > 2 MiB, deletes BOTH files, re-downloads, and the
//      re-download predictably aborts past 2 MiB -> the request fails having destroyed the entry
//   4. mediaCache.ts memoises pathByCid per `${cid}:${maxBytes}`, so the IMAGE entry
//      (`cid:104857600`) still points at the unlinked path -> broken media until process restart
//
// So a peer-controlled mime field could evict another message's cached media. The fix is that a
// cache pair is only ever REPLACED, never unlinked ahead of a verified download: an entry whose
// recorded size is known-but-too-large is REJECTED with the pair left intact, an entry with
// missing/corrupt metadata is REVALIDATED into a temp file and published atomically.
//
// These are source-shape assertions on the ordering guarantee inside downloadDecrypt; the
// behavioural half (the classifier verdicts and atomic publication over real files) is
// StorageRefTest.
import {readFileSync} from 'fs';
import path from 'path';

const native = (f: string) =>
  readFileSync(
    path.join(__dirname, '..', 'android/app/src/main/java/com/logoschat', f),
    'utf8',
  );

const downloadDecrypt = () => {
  const src = native('StorageModule.kt');
  const start = src.indexOf('fun downloadDecrypt');
  expect(start).toBeGreaterThan(-1);
  return src.slice(start);
};

describe('shared media cache entries survive a stricter caller (#543 / Senti P2)', () => {
  it('THE ORACLE: downloadDecrypt never unlinks the cached pair', () => {
    const fn = downloadDecrypt();
    // The two files of the shared pair. Neither may be deleted on the request path: the
    // ONLY legitimate way either changes is publishCacheEntry replacing both together.
    expect(fn).not.toMatch(/\bdest\.delete\(\)/);
    expect(fn).not.toMatch(/\bciphertextSizeFile\.delete\(\)/);
  });

  it('a known-oversized entry is rejected, not discarded', () => {
    const fn = downloadDecrypt();
    // TOO_LARGE => throw. It must NOT fall through to the download, because re-downloading
    // under the stricter bound can only fail, and the entry was valid for its own caller.
    expect(fn).toMatch(
      /CacheVerdict\.TOO_LARGE\s*->[\s\S]{0,120}?throw\s+RuntimeException/,
    );
  });

  it('a revalidated entry is written to a temp file and published atomically', () => {
    const fn = downloadDecrypt();
    // The verified plaintext lands somewhere else first...
    expect(fn).toMatch(/createTempFile/);
    // ...and only a complete download replaces the live pair.
    expect(fn).toMatch(/StorageRef\.publishCacheEntry\(/);
    // The old direct write to the live cache path is gone.
    expect(fn).not.toMatch(/dest\.writeBytes\(/);
  });

  it('classify and publish share one critical section so no reader sees a half-swap', () => {
    const fn = downloadDecrypt();
    // Exactly two critical sections: classify, then publish.
    const locks = [...fn.matchAll(/synchronized\(CACHE_LOCK\)/g)].map(m => m.index!);
    expect(locks).toHaveLength(2);
    // The download sits BETWEEN them, so the lock is never held across 60 s of network I/O
    // (which would serialise every media request in the app behind one slow blob).
    const network = fn.indexOf('conn.inputStream.use');
    expect(network).toBeGreaterThan(locks[0]);
    expect(network).toBeLessThan(locks[1]);
    // The first section does nothing but read the verdict.
    expect(fn).toMatch(
      /synchronized\(CACHE_LOCK\)\s*\{\s*StorageRef\.classifyCacheEntry\([^)]*\)\s*\}/,
    );
  });

  it('the sidecar is dropped before the plaintext moves, so a torn pair fails closed', () => {
    const src = native('StorageRef.kt');
    const fn = src.slice(src.indexOf('fun publishCacheEntry'));
    const dropSidecar = fn.indexOf('ciphertextSizeFile.delete()');
    const movePlaintext = fn.indexOf('renameTo(cachedPlaintext)');
    const writeSidecar = fn.indexOf('ciphertextSizeFile.writeText');
    expect(dropSidecar).toBeGreaterThan(-1);
    // sidecar gone -> plaintext swapped -> sidecar rewritten. A reader interrupting anywhere
    // in that order sees a pair with no/old sidecar (=> revalidate), never new-size/old-bytes.
    expect(dropSidecar).toBeLessThan(movePlaintext);
    expect(movePlaintext).toBeLessThan(writeSidecar);
  });

  // Senti P2 on #544. The first cut of publishCacheEntry fell back to
  // `cachedPlaintext.writeBytes(verifiedPlaintext.readBytes())` when renameTo returned false.
  // That truncates and rewrites the LIVE cache path in place. Consumers read that path off
  // downloadDecrypt's resolve WITHOUT taking CACHE_LOCK, so they can observe a partial file,
  // and a copy that throws part-way destroys the previously valid entry -- reintroducing the
  // broken media this PR exists to prevent, on the exact error path it handles. The move is
  // now rename-only: one atomic replace, or an abort with the old bytes untouched.
  // Behavioural half: StorageRefTest.publishCacheEntry_refusedRenameLeavesTheOldPlaintextIntact.
  it('THE ORACLE: publication never writes over the live cache path', () => {
    const src = native('StorageRef.kt');
    const fn = src.slice(src.indexOf('fun publishCacheEntry'));
    const body = fn.slice(0, fn.indexOf('\n  }') + 1);
    // The destination is only ever the TARGET of a rename, never opened for writing.
    expect(body).not.toMatch(/cachedPlaintext\.(writeBytes|writeText|outputStream|printWriter)/);
    // ...and it is never unlinked either: a failed publication must leave it readable.
    expect(body).not.toMatch(/cachedPlaintext\.delete\(\)/);
    // A refused rename aborts the publication instead of falling back to a copy.
    expect(body).toMatch(
      /if\s*\(!verifiedPlaintext\.renameTo\(cachedPlaintext\)\)\s*\{\s*throw\s+IOException/,
    );
  });
});
