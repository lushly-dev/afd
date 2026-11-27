/**
 * @fileoverview The `.loam-plugin` archive (phase 5 no-terminal amendment, 4.4's archive rules; step 9a2): the one
 * form `loam plugin pack` writes, and nothing else. `writeZip` writes it; `readZip` reads the whole file and accepts
 * an archive only when every field is the value that form gives it, so no field is left for another reader to read
 * differently. Read with Node's own zlib, so packing needs no dependency.
 *
 * The canonical form: regular files only, each deflated, in strictly increasing order of the name's UTF-8 bytes. Each
 * local header is version needed 20, flags 0x0800 (the name is UTF-8), method 8, time 0, date 1980-01-01 (0x0021),
 * the CRC-32 and both sizes, and no extra field; its name, then its deflated data, follow at once. The central
 * directory follows the last record at once, one entry per record in the same order: version made by 0x0314 (Unix,
 * 2.0), the local header's fields, no extra field and no comment, disk 0, internal attributes 0, external attributes
 * `100644` or `100755` (octal) in the high half and 0 in the low, and the record's offset. The end record follows the
 * central directory at once and ends the file: disks 0, both counts the entries', the directory's size and offset,
 * and no comment.
 */

import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

/** An entry of a canonical archive: a regular file's name and data, and whether its mode is `100755`. */
export interface ZipEntry {
	path: string;
	data: Buffer;
	executable: boolean;
}

/**
 * Why an archive is refused, as a stable tag that loam-desktop's Rust inspect (9c) gives too (the shared cases name
 * one for each): one per rule of the canonical form, so two refusals of one code are told apart.
 */
export type ZipReason =
	| 'end-record'
	| 'comment'
	| 'signature-in-end-record'
	| 'zip64'
	| 'disk'
	| 'entry-counts'
	| 'directory-size'
	| 'name-encoding'
	| 'name-empty'
	| 'name-order'
	| 'made-by'
	| 'version-needed'
	| 'flags'
	| 'stored'
	| 'method'
	| 'time-date'
	| 'extra-field'
	| 'internal-attributes'
	| 'mode'
	| 'not-regular'
	| 'tiling'
	| 'local-header'
	| 'signature-in-directory'
	| 'too-many-entries'
	| 'declared-size'
	| 'stream-unfinished'
	| 'stream-corrupt'
	| 'stream-too-long'
	| 'stream-trailing'
	| 'size-crc';

export type ZipRead =
	| { ok: true; entries: ZipEntry[] }
	| { ok: false; problem: 'malformed' | 'too-large'; reason: ZipReason; detail: string }
	/** An entry whose attributes make it a link, a directory, a FIFO, a device or a socket. */
	| { ok: false; problem: 'not-regular'; reason: 'not-regular'; detail: string; path: string };

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const EOCD = 0x06054b50;

/** The canonical form's fixed values. */
export const CANONICAL = Object.freeze({
	versionNeeded: 20,
	/** Unix (3) in the high byte, spec version 2.0 in the low. */
	madeBy: (3 << 8) | 20,
	/** Bit 11 alone: the name is UTF-8. */
	flags: 0x0800,
	method: 8,
	time: 0,
	/** 1980-01-01, the earliest an MS-DOS date holds, so the bytes do not change with the clock. */
	date: (0 << 9) | (1 << 5) | 1,
	file: (0o100644 << 16) >>> 0,
	executable: (0o100755 << 16) >>> 0,
});

/**
 * The record signatures a reader looks for: local, central, end, ZIP64 end, ZIP64 locator and data descriptor. Each
 * holds a byte from 0x01 to 0x08, which no bundle path may (4.4, rule 3), so no name can spell one; the central
 * directory's scan below covers the names' bytes as well, so that holds by check, not only by the path rules.
 */
const SIGNATURES = [0x04034b50, 0x02014b50, 0x06054b50, 0x06064b50, 0x07064b50, 0x08074b50].map(
	(value) => {
		const bytes = Buffer.alloc(4);
		bytes.writeUInt32LE(value);
		return bytes;
	}
);

const S_IFMT = 0o170000;
const KINDS: ReadonlyArray<[number, string]> = [
	[0o120000, 'a symbolic link'],
	[0o040000, 'a directory'],
	[0o010000, 'a FIFO'],
	[0o020000, 'a character device'],
	[0o060000, 'a block device'],
	[0o140000, 'a socket'],
];

const malformed = (reason: ZipReason, detail: string): ZipRead => ({
	ok: false,
	problem: 'malformed',
	reason,
	detail,
});
const tooLarge = (reason: ZipReason, detail: string): ZipRead => ({
	ok: false,
	problem: 'too-large',
	reason,
	detail,
});

/** The first field of a header that is not its canonical value, refused with its reason, or `undefined`. */
function deviation(
	fields: ReadonlyArray<[string, number, number, ZipReason]>
): ZipRead | undefined {
	for (const [name, value, canonical, reason] of fields) {
		if (value !== canonical) return malformed(reason, `${name} ${value}, not ${canonical}`);
	}
	return undefined;
}

interface Central {
	name: string;
	nameBytes: Buffer;
	crc: number;
	compressed: number;
	declared: number;
	local: number;
	start: number;
	executable: boolean;
}

/**
 * Every file of `zip`, read only if it is in the canonical form, within `maxEntries` entries and `budget` bytes in all
 * (4.4's archive rules). With more than one fault, the first in this order is reported: the structure (the end record,
 * then each central entry with its local record, then the central directory's own bytes), then the bounds, then the
 * data. An entry whose attributes make it something other than a regular file is reported as `not-regular`, with
 * its name, in the structure's place.
 */
export function readZip(zip: Buffer, budget: number, maxEntries: number): ZipRead {
	// The end record: the file's last 22 bytes, with no comment. Whatever else the file holds there (bytes after a
	// record, a comment, or no record at all) is `end-record`; nothing is searched for. `comment` is only a non-zero
	// comment length read where the form puts it, in those 22 bytes.
	const end = zip.length - 22;
	if (end < 0 || zip.readUInt32LE(end) !== EOCD)
		return malformed(
			'end-record',
			'its last 22 bytes are not an end record: bytes or a comment follow it, or it has none'
		);
	// Nothing after the record's first byte spells a signature, so no reader finds another record in its fields.
	const after = zip.subarray(end + 1);
	if (SIGNATURES.some((signature) => after.includes(signature)))
		return malformed(
			'signature-in-end-record',
			'its end record holds a record signature in its fields'
		);
	const count = zip.readUInt16LE(end + 10);
	const size = zip.readUInt32LE(end + 12);
	const offset = zip.readUInt32LE(end + 16);
	const recordDeviation = deviation([
		['its disk number is', zip.readUInt16LE(end + 4), 0, 'disk'],
		["its central directory's disk is", zip.readUInt16LE(end + 6), 0, 'disk'],
		['its entry count on this disk is', zip.readUInt16LE(end + 8), count, 'entry-counts'],
		['its comment length is', zip.readUInt16LE(end + 20), 0, 'comment'],
	]);
	if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff)
		return malformed('zip64', 'it is a ZIP64 archive');
	if (recordDeviation) return recordDeviation;
	if (offset + size !== end)
		return malformed('directory-size', 'its central directory does not end at its end record');

	// Each central entry, in order, with its local record, which must start where the one before it ended.
	const centrals: Central[] = [];
	let at = offset;
	let expected = 0;
	let previous: Buffer | undefined;
	for (let index = 0; index < count; index++) {
		if (at + 46 > end || zip.readUInt32LE(at) !== CENTRAL)
			return malformed('directory-size', 'a central directory entry is cut short');
		const nameLength = zip.readUInt16LE(at + 28);
		const extraLength = zip.readUInt16LE(at + 30);
		const commentLength = zip.readUInt16LE(at + 32);
		const compressed = zip.readUInt32LE(at + 20);
		const declared = zip.readUInt32LE(at + 24);
		const external = zip.readUInt32LE(at + 38);
		const local = zip.readUInt32LE(at + 42);
		if (compressed === 0xffffffff || declared === 0xffffffff || local === 0xffffffff)
			return malformed('zip64', 'it is a ZIP64 archive');
		const nameBytes = zip.subarray(at + 46, at + 46 + nameLength);
		if (at + 46 + nameLength > end)
			return malformed('directory-size', 'a central directory entry overruns it');
		let name: string;
		try {
			name = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(nameBytes);
		} catch {
			return malformed('name-encoding', 'an entry is not named in UTF-8');
		}
		const centralDeviation = deviation([
			[`${name}'s version made by is`, zip.readUInt16LE(at + 4), CANONICAL.madeBy, 'made-by'],
			[
				`${name}'s version needed is`,
				zip.readUInt16LE(at + 6),
				CANONICAL.versionNeeded,
				'version-needed',
			],
			[`${name}'s flags are`, zip.readUInt16LE(at + 8), CANONICAL.flags, 'flags'],
			[
				`${name}'s method is`,
				zip.readUInt16LE(at + 10),
				CANONICAL.method,
				zip.readUInt16LE(at + 10) === 0 ? 'stored' : 'method',
			],
			[`${name}'s time is`, zip.readUInt16LE(at + 12), CANONICAL.time, 'time-date'],
			[`${name}'s date is`, zip.readUInt16LE(at + 14), CANONICAL.date, 'time-date'],
			[`${name}'s extra field length is`, extraLength, 0, 'extra-field'],
			[`${name}'s comment length is`, commentLength, 0, 'comment'],
			[`${name}'s disk is`, zip.readUInt16LE(at + 34), 0, 'disk'],
			[`${name}'s internal attributes are`, zip.readUInt16LE(at + 36), 0, 'internal-attributes'],
		]);
		if (centralDeviation) return centralDeviation;
		if (nameLength === 0) return malformed('name-empty', 'an entry has no name');
		if (external !== CANONICAL.file && external !== CANONICAL.executable) {
			const kind = KINDS.find(([type]) => ((external >>> 16) & S_IFMT) === type);
			if (kind || name.endsWith('/'))
				return {
					ok: false,
					problem: 'not-regular',
					reason: 'not-regular',
					detail: `it is ${kind?.[1] ?? 'a directory'}, and an archive holds regular files only`,
					path: name.replace(/\/$/, ''),
				};
			return malformed(
				'mode',
				`${name}'s external attributes are 0x${external.toString(16)}, not a regular file's 100644 or 100755`
			);
		}
		if (name.endsWith('/'))
			return {
				ok: false,
				problem: 'not-regular',
				reason: 'not-regular',
				detail: 'it is a directory',
				path: name.replace(/\/$/, ''),
			};
		if (previous && Buffer.compare(previous, nameBytes) >= 0)
			return malformed(
				'name-order',
				`${name} does not follow the entry before it in the order of the names' UTF-8 bytes, or repeats it`
			);
		previous = nameBytes;
		// Its local record.
		if (local !== expected)
			return malformed(
				'tiling',
				expected === 0
					? 'bytes come before its first entry'
					: `${name}'s local record does not start where the one before it ends`
			);
		if (local + 30 > offset || zip.readUInt32LE(local) !== LOCAL)
			return malformed('tiling', `${name} has no local header`);
		const crc = zip.readUInt32LE(at + 16);
		const localDeviation = deviation([
			[
				`${name}'s local version needed is`,
				zip.readUInt16LE(local + 4),
				CANONICAL.versionNeeded,
				'local-header',
			],
			[`${name}'s local flags are`, zip.readUInt16LE(local + 6), CANONICAL.flags, 'local-header'],
			[`${name}'s local method is`, zip.readUInt16LE(local + 8), CANONICAL.method, 'local-header'],
			[`${name}'s local time is`, zip.readUInt16LE(local + 10), CANONICAL.time, 'local-header'],
			[`${name}'s local date is`, zip.readUInt16LE(local + 12), CANONICAL.date, 'local-header'],
			[`${name}'s local CRC-32 is`, zip.readUInt32LE(local + 14), crc, 'local-header'],
			[
				`${name}'s local compressed size is`,
				zip.readUInt32LE(local + 18),
				compressed,
				'local-header',
			],
			[`${name}'s local size is`, zip.readUInt32LE(local + 22), declared, 'local-header'],
			[`${name}'s local name length is`, zip.readUInt16LE(local + 26), nameLength, 'local-header'],
			[`${name}'s local extra field length is`, zip.readUInt16LE(local + 28), 0, 'extra-field'],
		]);
		if (localDeviation) return localDeviation;
		const start = local + 30 + nameLength;
		if (!zip.subarray(local + 30, start).equals(nameBytes))
			return malformed('local-header', `${name}'s local header names another file`);
		if (start + compressed > offset)
			return malformed('tiling', `${name}'s data overruns the archive`);
		centrals.push({
			name,
			nameBytes,
			crc,
			compressed,
			declared,
			local,
			start,
			executable: external === CANONICAL.executable,
		});
		expected = start + compressed;
		at += 46 + nameLength;
	}
	if (at !== end)
		return malformed('directory-size', 'its central directory holds more than its entries');
	if (expected !== offset)
		return malformed('tiling', 'bytes lie between its last entry and its central directory');
	// The central directory's own bytes: names cannot spell a signature, but a CRC-32, a size or an offset can, and a
	// reader that looks just before the end record for a ZIP64 locator, or scans the directory, would read it.
	let entryStart = offset;
	const starts = new Set<number>();
	for (const entry of centrals) {
		starts.add(entryStart);
		entryStart += 46 + entry.nameBytes.length;
	}
	const directory = zip.subarray(offset, end);
	for (const signature of SIGNATURES) {
		for (
			let found = directory.indexOf(signature);
			found >= 0;
			found = directory.indexOf(signature, found + 1)
		) {
			if (!(signature === SIGNATURES[1] && starts.has(offset + found)))
				return malformed(
					'signature-in-directory',
					'its central directory holds a record signature inside an entry'
				);
		}
	}

	// The bounds, once the structure is sound and before any data is read.
	if (count > maxEntries) return tooLarge('too-many-entries', `it holds ${count} entries`);
	const total = centrals.reduce((sum, { declared }) => sum + declared, 0);
	if (total > budget)
		return tooLarge('declared-size', `its entries declare ${total} bytes, more than ${budget}`);

	// The data, in the central directory's order.
	const entries: ZipEntry[] = [];
	for (const entry of centrals) {
		let inflated: { buffer: Buffer; engine: { bytesWritten: number } };
		try {
			inflated = inflateRawSync(zip.subarray(entry.start, entry.start + entry.compressed), {
				info: true,
				maxOutputLength: entry.declared + 1,
			}) as unknown as typeof inflated;
		} catch (cause) {
			const code = (cause as { code?: unknown }).code;
			if (code === 'Z_BUF_ERROR')
				return malformed(
					'stream-unfinished',
					`${entry.name}'s deflate stream does not end: it has no final block`
				);
			if (code === 'ERR_BUFFER_TOO_LARGE')
				return malformed('stream-too-long', `${entry.name} inflates past its recorded size`);
			return malformed('stream-corrupt', `${entry.name}'s deflate stream is corrupt`);
		}
		if (inflated.engine.bytesWritten !== entry.compressed)
			return malformed(
				'stream-trailing',
				`${entry.name}'s deflate stream ends before its data does: bytes follow the final block`
			);
		const data = inflated.buffer;
		if (data.length !== entry.declared || crc32(data) !== entry.crc)
			return malformed('size-crc', `${entry.name} does not match its recorded size and CRC-32`);
		entries.push({ path: entry.name, data, executable: entry.executable });
	}
	return { ok: true, entries };
}

/**
 * The canonical archive of `files`, in strictly increasing order of the name's UTF-8 bytes (sorted here), each
 * deflated, mode `100755` when `executable` and `100644` otherwise.
 */
export function writeZip(
	files: ReadonlyArray<{ path: string; data: Buffer; executable?: boolean }>
): Buffer {
	const sorted = [...files].sort((a, b) =>
		Buffer.compare(Buffer.from(a.path), Buffer.from(b.path))
	);
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	for (const { path, data, executable } of sorted) {
		const name = Buffer.from(path, 'utf8');
		// Node's defaults (level 6, memLevel 8, windowBits 15): `archiveAllowance` reckons zlib's expansion bound for
		// those defaults, and holds only while these stay them.
		const body = deflateRawSync(data);
		const crc = crc32(data);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(LOCAL, 0);
		local.writeUInt16LE(CANONICAL.versionNeeded, 4);
		local.writeUInt16LE(CANONICAL.flags, 6);
		local.writeUInt16LE(CANONICAL.method, 8);
		local.writeUInt16LE(CANONICAL.time, 10);
		local.writeUInt16LE(CANONICAL.date, 12);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(body.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(name.length, 26);
		local.writeUInt16LE(0, 28);
		const central = Buffer.alloc(46);
		central.writeUInt32LE(CENTRAL, 0);
		central.writeUInt16LE(CANONICAL.madeBy, 4);
		central.writeUInt16LE(CANONICAL.versionNeeded, 6);
		central.writeUInt16LE(CANONICAL.flags, 8);
		central.writeUInt16LE(CANONICAL.method, 10);
		central.writeUInt16LE(CANONICAL.time, 12);
		central.writeUInt16LE(CANONICAL.date, 14);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(body.length, 20);
		central.writeUInt32LE(data.length, 24);
		central.writeUInt16LE(name.length, 28);
		central.writeUInt32LE(executable ? CANONICAL.executable : CANONICAL.file, 38);
		central.writeUInt32LE(offset, 42);
		locals.push(local, name, body);
		centrals.push(central, name);
		offset += local.length + name.length + body.length;
	}
	const directory = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(EOCD, 0);
	end.writeUInt16LE(sorted.length, 8);
	end.writeUInt16LE(sorted.length, 10);
	end.writeUInt32LE(directory.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, directory, end]);
}
