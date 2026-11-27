#!/usr/bin/env node
/**
 * Builds each `.loam-plugin` archive case in `test/fixtures/loam-plugin-cases.json` (`archives`) from its description
 * and checks its SHA-256, apart from `@lushly-dev/loam-cli`'s own builder (`zip-test-support.ts`), so the two, and
 * loam-desktop's Rust inspect (step 9c), are held to the bytes the description states. Node.js alone: no package.
 *
 *   node scripts/archive-cases.mjs           checks every case's `sha256`, exiting 1 on a mismatch
 *   node scripts/archive-cases.mjs --write   sets every case's `sha256` to the bytes built
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CASES = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../test/fixtures/loam-plugin-cases.json'
);

/** CRC-32 (IEEE 802.3, reflected, as zip uses), table-driven. */
const TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});
function crc32(bytes) {
	let c = 0xffffffff;
	for (const byte of bytes) c = (TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)) >>> 0;
	return (c ^ 0xffffffff) >>> 0;
}

const hex = (text) => Buffer.from(text ?? '', 'hex');
const u16 = (value) => {
	const out = Buffer.alloc(2);
	out.writeUInt16LE(value & 0xffff);
	return out;
};
const u32 = (value) => {
	const out = Buffer.alloc(4);
	out.writeUInt32LE(value >>> 0);
	return out;
};

function dataOf(entry) {
	if (entry.zeros !== undefined) return Buffer.alloc(entry.zeros);
	if (entry.hex !== undefined) return hex(entry.hex);
	return Buffer.from(entry.text ?? '', 'utf8');
}

/**
 * The case's entries, as the description says: its base's (`engineBase` for `"base": "engine"`, else `base`) less
 * `remove`, `set`'s fields on the base entries it names, then the case's, then `repeat`'s; `all` on each.
 */
export function entriesOf(entry, archives) {
	const base = Array.isArray(archives)
		? archives
		: entry.base === 'engine'
			? archives.engineBase
			: archives.base;
	const repeated = [];
	for (let n = 0; n < (entry.repeat?.count ?? 0); n++) {
		const { path, count: _count, ...fields } = entry.repeat;
		repeated.push({ path: path.replace('{n}', String(n)), ...fields });
	}
	return [
		...base
			.filter(({ path }) => !(entry.remove ?? []).includes(path))
			.map((each) => ({ ...each, ...(entry.set?.[each.path] ?? {}) })),
		...(entry.entries ?? []),
		...repeated,
	].map((each) => ({ ...each, ...(entry.all ?? {}) }));
}

const nameOf = (entry) =>
	entry.nameHex !== undefined ? hex(entry.nameHex) : Buffer.from(entry.path ?? '', 'utf8');

/** The archive's bytes, field by field as the description states them; canonical where it states nothing. */
export function buildArchive(given, archive = {}) {
	const entries = archive.unsorted
		? given
		: [...given].sort((a, b) => Buffer.compare(nameOf(a), nameOf(b)));
	const parts = [hex(archive.prefixHex)];
	const centrals = [];
	let offset = parts[0].length;
	for (const entry of entries) {
		const gap = hex(entry.gapHex);
		parts.push(gap);
		offset += gap.length;
		const data = dataOf(entry);
		const method = entry.method ?? 8;
		if (method === 8 && entry.bodyHex === undefined)
			throw new Error(`A deflated case entry carries its body: ${entry.path ?? entry.nameHex}`);
		const body = method === 8 ? hex(entry.bodyHex) : data;
		const name = nameOf(entry);
		const descriptor = entry.descriptor;
		const flags = ((entry.flags ?? 0x0800) | (descriptor ? 0x0008 : 0)) & 0xffff;
		const crc = entry.crc ?? crc32(data);
		const compressed = entry.compressed ?? body.length;
		const declared = entry.declared ?? data.length;
		const extra = hex(entry.extraHex);
		const comment = hex(entry.commentHex);
		const local = entry.local ?? {};
		const localName = local.path === undefined ? name : Buffer.from(local.path, 'utf8');
		const localExtra = hex(local.extraHex);
		const date = (0 << 9) | (1 << 5) | 1;
		const localHeader = Buffer.concat([
			u32(0x04034b50),
			u16(local.versionNeeded ?? entry.versionNeeded ?? 20),
			u16(local.flags ?? flags),
			u16(local.method ?? method),
			u16(local.time ?? entry.time ?? 0),
			u16(local.date ?? entry.date ?? date),
			u32(local.crc ?? (descriptor ? 0 : crc)),
			u32(local.compressed ?? (descriptor ? 0 : compressed)),
			u32(local.declared ?? (descriptor ? 0 : declared)),
			u16(localName.length),
			u16(localExtra.length),
		]);
		const trailer = descriptor
			? Buffer.concat([
					descriptor === 'unsigned' ? Buffer.alloc(0) : u32(0x08074b50),
					u32(entry.descriptorCrc ?? crc),
					u32(compressed),
					u32(declared),
				])
			: Buffer.alloc(0);
		const mode = Number.parseInt(entry.mode ?? (entry.executable ? '100755' : '100644'), 8);
		const central = Buffer.concat([
			u32(0x02014b50),
			u16(((entry.madeBy ?? 3) << 8) | (entry.madeByVersion ?? 20)),
			u16(entry.versionNeeded ?? 20),
			u16(flags),
			u16(method),
			u16(entry.time ?? 0),
			u16(entry.date ?? date),
			u32(crc),
			u32(compressed),
			u32(declared),
			u16(name.length),
			u16(extra.length),
			u16(comment.length),
			u16(entry.disk ?? 0),
			u16(entry.internal ?? 0),
			u32((mode * 0x10000 + (entry.dosAttributes ?? 0)) >>> 0),
			u32(entry.localOffset ?? offset),
		]);
		parts.push(localHeader, localName, localExtra, body, trailer);
		centrals.push(central, name, extra, comment);
		offset +=
			localHeader.length + localName.length + localExtra.length + body.length + trailer.length;
	}
	const before = hex(archive.beforeDirectoryHex);
	parts.push(before);
	offset += before.length;
	const directory = Buffer.concat(centrals);
	const comment = Buffer.concat([hex(archive.commentHex), Buffer.alloc(archive.commentZeros ?? 0)]);
	const count = archive.count ?? entries.length;
	const end = Buffer.concat([
		u32(0x06054b50),
		u16(archive.disk ?? 0),
		u16(archive.directoryDisk ?? 0),
		u16(archive.countHere ?? count),
		u16(count),
		u32(directory.length + (archive.sizeDelta ?? 0)),
		u32(archive.offset ?? offset),
		u16(comment.length),
	]);
	return Buffer.concat([...parts, directory, end, comment, hex(archive.trailingHex)]);
}

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Each case's name, the SHA-256 it records, and the one its bytes have. */
export function caseDigests(document = JSON.parse(readFileSync(CASES, 'utf8'))) {
	const { valid, refused } = document.archives;
	return [...valid, ...refused].map((entry) => ({
		name: entry.name,
		recorded: entry.sha256,
		built: sha256(buildArchive(entriesOf(entry, document.archives), entry.archive)),
	}));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const text = readFileSync(CASES, 'utf8');
	const document = JSON.parse(text);
	const digests = caseDigests(document);
	if (process.argv.includes('--write')) {
		let written = text;
		for (const { recorded, built } of digests)
			if (recorded !== built)
				written = written.replace(`"sha256": "${recorded}"`, `"sha256": "${built}"`);
		writeFileSync(CASES, written);
		console.log(`${digests.length} archive cases, their SHA-256s written.`);
	} else {
		const wrong = digests.filter(({ recorded, built }) => recorded !== built);
		for (const { name, recorded, built } of wrong)
			console.error(`${name}: records ${recorded}, builds ${built}`);
		console.log(
			`${digests.length - wrong.length} of ${digests.length} archive cases build to their SHA-256.`
		);
		process.exitCode = wrong.length > 0 ? 1 : 0;
	}
}
