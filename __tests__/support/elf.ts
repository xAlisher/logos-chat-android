// Minimal ELF64 dynamic-symbol reader — enough to answer "does the .so we ship
// actually export the entry points the JNI bridge links against?".
//
// Deliberately dependency-free and `nm`-free: the provenance gate has to run on
// CI runners and dev laptops that have no binutils and no Android NDK. Every
// library under `jniLibs/arm64-v8a/` is little-endian ELF64 (aarch64), so that
// is the only shape handled; anything else throws loudly rather than silently
// reporting an empty symbol set (an empty set would make the gate vacuous).
import {readFileSync} from 'fs';

const ELF_MAGIC = 0x7f454c46;
const ELFCLASS64 = 2;
const ELFDATA2LSB = 1;
const SHT_DYNSYM = 11;
const SHN_UNDEF = 0;

// ELF64 section header (64 bytes) — the fields we need.
const SH_ENT = {name: 0, type: 4, offset: 24, size: 32, link: 40, entsize: 56};
// ELF64 symbol table entry (24 bytes).
const SYM_SIZE = 24;
const SYM = {name: 0, shndx: 6};

export type DynamicSymbols = {
  /** Symbols this object defines (exports). */
  defined: Set<string>;
  /** Symbols this object references but expects from another object (imports). */
  imported: Set<string>;
};

function cstr(buf: Buffer, at: number): string {
  const end = buf.indexOf(0, at);
  return buf.toString('utf8', at, end === -1 ? buf.length : end);
}

export function readDynamicSymbols(path: string): DynamicSymbols {
  const buf = readFileSync(path);
  if (buf.length < 64 || buf.readUInt32BE(0) !== ELF_MAGIC) {
    throw new Error(`${path}: not an ELF object`);
  }
  if (buf[4] !== ELFCLASS64 || buf[5] !== ELFDATA2LSB) {
    throw new Error(`${path}: not little-endian ELF64 (class=${buf[4]} data=${buf[5]})`);
  }

  const shoff = Number(buf.readBigUInt64LE(0x28));
  const shentsize = buf.readUInt16LE(0x3a);
  const shnum = buf.readUInt16LE(0x3c);
  if (shoff === 0 || shnum === 0) {
    throw new Error(`${path}: no section headers (fully stripped?) — cannot read .dynsym`);
  }

  const section = (i: number) => shoff + i * shentsize;
  const u32 = (base: number, field: number) => buf.readUInt32LE(base + field);
  const u64 = (base: number, field: number) => Number(buf.readBigUInt64LE(base + field));

  let dynsym = -1;
  for (let i = 0; i < shnum; i++) {
    if (u32(section(i), SH_ENT.type) === SHT_DYNSYM) {
      dynsym = i;
      break;
    }
  }
  if (dynsym === -1) {
    throw new Error(`${path}: no .dynsym section`);
  }

  const symBase = u64(section(dynsym), SH_ENT.offset);
  const symSize = u64(section(dynsym), SH_ENT.size);
  const entsize = u64(section(dynsym), SH_ENT.entsize) || SYM_SIZE;
  const strtab = u64(section(u32(section(dynsym), SH_ENT.link)), SH_ENT.offset);

  const defined = new Set<string>();
  const imported = new Set<string>();
  for (let off = symBase; off + entsize <= symBase + symSize; off += entsize) {
    const nameOff = buf.readUInt32LE(off + SYM.name);
    if (nameOff === 0) {
      continue; // the null entry / unnamed section symbols
    }
    const name = cstr(buf, strtab + nameOff);
    if (buf.readUInt16LE(off + SYM.shndx) === SHN_UNDEF) {
      imported.add(name);
    } else {
      defined.add(name);
    }
  }
  return {defined, imported};
}
