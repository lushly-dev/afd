/**
 * @fileoverview The `.loam-plugin` archive (phase 5's no-terminal amendment, 4.1 and 4.4): a plain zip of regular files,
 * stored or deflated, read and written with Node's own zlib so packing needs no dependency. The reader trusts nothing
 * it is told: each entry's size is checked against the bundle's budget while it inflates (a zip bomb stops there), and
 * its CRC-32 and length against what it held.
 */

import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

/** An entry as the archive names it, before its path is judged. */
export interface ZipEntry {
	path: string;
	/** A Unix symbolic link, by its external attributes' file type. */
	symlink: boolean;
	/** A directory entry, which holds nothing. */
	directory: boolean;
	data: Buffer;
}

export type ZipRead =
	| { ok: true; entries: ZipEntry[] }
	| { ok: false; problem: 'malformed' | 'too-large'; detail: string };

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const S_IFDIR = 0o040000;

const malformed = (detail: string): ZipRead => ({ ok: false, problem: 'malformed', detail });

/** The end of the central directory: the last signature within a comment's reach of the end. */
function endRecord(zip: Buffer): number {
	const earliest = Math.max(0, zip.length - 22 - 0xffff);
	for (let at = zip.length - 22; at >= earliest; at--) if (zip.readUInt32LE(at) === EOCD) return at;
	return -1;
}

/**
 * Every entry of `zip`, inflated within `budget` bytes in all and `maxEntries` entries. No ZIP64, no encryption and no
 * method but stored (0) and deflate (8): `loam plugin pack` writes none of them.
 */
export function readZip(zip: Buffer, budget: number, maxEntries: number): ZipRead {
	const end = endRecord(zip);
	if (end < 0) return malformed('it has no end of central directory');
	const disk = zip.readUInt16LE(end + 4);
	const count = zip.readUInt16LE(end + 10);
	const size = zip.readUInt32LE(end + 12);
	const offset = zip.readUInt32LE(end + 16);
	if (disk !== 0 || zip.readUInt16LE(end + 8) !== count) return malformed('it spans disks');
	if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff)
		return malformed('it is a ZIP64 archive');
	if (count > maxEntries)
		return { ok: false, problem: 'too-large', detail: `it holds ${count} entries` };
	if (offset + size > end) return malformed('its central directory overruns the archive');
	const entries: ZipEntry[] = [];
	let used = 0;
	let at = offset;
	for (let index = 0; index < count; index++) {
		if (at + 46 > end || zip.readUInt32LE(at) !== CENTRAL)
			return malformed('a central directory entry is cut short');
		const madeBy = zip.readUInt16LE(at + 4) >> 8;
		const flags = zip.readUInt16LE(at + 8);
		const method = zip.readUInt16LE(at + 10);
		const crc = zip.readUInt32LE(at + 16);
		const compressed = zip.readUInt32LE(at + 20);
		const declared = zip.readUInt32LE(at + 24);
		const nameLength = zip.readUInt16LE(at + 28);
		const extraLength = zip.readUInt16LE(at + 30);
		const commentLength = zip.readUInt16LE(at + 32);
		const external = zip.readUInt32LE(at + 38);
		const local = zip.readUInt32LE(at + 42);
		const nameBytes = zip.subarray(at + 46, at + 46 + nameLength);
		at += 46 + nameLength + extraLength + commentLength;
		if (at > offset + size) return malformed('a central directory entry overruns it');
		if (flags & 0x0001) return malformed('an entry is encrypted');
		if (method !== 0 && method !== 8)
			return malformed(`an entry uses compression method ${method}`);
		let path: string;
		try {
			path = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(nameBytes);
		} catch {
			return malformed('an entry is not named in UTF-8');
		}
		// Only an archive made on Unix (3) carries a file type in its external attributes' high half.
		const mode = madeBy === 3 ? external >>> 16 : 0;
		const symlink = (mode & S_IFMT) === S_IFLNK;
		const directory = path.endsWith('/') || (mode & S_IFMT) === S_IFDIR;
		if (local + 30 > zip.length || zip.readUInt32LE(local) !== LOCAL)
			return malformed('an entry has no local header');
		const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
		if (start + compressed > offset) return malformed("an entry's data overruns the archive");
		const raw = zip.subarray(start, start + compressed);
		let data: Buffer;
		if (method === 0) data = Buffer.from(raw);
		else {
			try {
				data = inflateRawSync(raw, { maxOutputLength: Math.max(1, budget - used + 1) });
			} catch (cause) {
				if (
					cause instanceof RangeError ||
					(cause as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE'
				)
					return {
						ok: false,
						problem: 'too-large',
						detail: `${path} inflates past the bundle's limit`,
					};
				return malformed(`${path} does not inflate`);
			}
		}
		used += data.length;
		if (used > budget)
			return { ok: false, problem: 'too-large', detail: `${path} takes the bundle past its limit` };
		if (data.length !== declared || crc32(data) !== crc)
			return malformed(`${path} does not match its recorded size and CRC-32`);
		entries.push({ path, symlink, directory, data });
	}
	return { ok: true, entries };
}

/** The MS-DOS date of 1980-01-01, the earliest a zip holds, so an archive's bytes do not change with the clock. */
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

/**
 * A zip of `files`, in the order given: each deflated, a regular file, mode 0644 (0755 when `executable`). `mode`
 * replaces the whole Unix mode, file type included, which only a test of the reader sets.
 */
export function writeZip(
	files: ReadonlyArray<{ path: string; data: Buffer; executable?: boolean; mode?: number }>
): Buffer {
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	for (const { path, data, executable, mode } of files) {
		const name = Buffer.from(path, 'utf8');
		const body = deflateRawSync(data);
		const crc = crc32(data);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(LOCAL, 0);
		local.writeUInt16LE(20, 4);
		// Bit 11: the name is UTF-8.
		local.writeUInt16LE(0x0800, 6);
		local.writeUInt16LE(8, 8);
		local.writeUInt16LE(0, 10);
		local.writeUInt16LE(DOS_DATE, 12);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(body.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(name.length, 26);
		local.writeUInt16LE(0, 28);
		const central = Buffer.alloc(46);
		central.writeUInt32LE(CENTRAL, 0);
		central.writeUInt16LE((3 << 8) | 20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(0x0800, 8);
		central.writeUInt16LE(8, 10);
		central.writeUInt16LE(0, 12);
		central.writeUInt16LE(DOS_DATE, 14);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(body.length, 20);
		central.writeUInt32LE(data.length, 24);
		central.writeUInt16LE(name.length, 28);
		central.writeUInt32LE(((mode ?? (executable ? 0o100755 : 0o100644)) << 16) >>> 0, 38);
		central.writeUInt32LE(offset, 42);
		locals.push(local, name, body);
		centrals.push(central, name);
		offset += local.length + name.length + body.length;
	}
	const directory = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(EOCD, 0);
	end.writeUInt16LE(files.length, 8);
	end.writeUInt16LE(files.length, 10);
	end.writeUInt32LE(directory.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, directory, end]);
}
