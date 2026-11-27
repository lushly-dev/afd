/**
 * Builds a zip byte by byte from the archive cases' entry description (`loam-plugin-cases.json`'s `archives`), so a
 * test can say what `loam plugin pack` would never write. Every field defaults to the canonical form's value
 * (`zip.ts`); a field set makes the archive deviate. `@lushly-dev/loam-manifest`'s `scripts/archive-cases.mjs` builds the
 * same bytes apart from this, and loam-desktop's Rust inspect (step 9c) from the same description.
 */

import { crc32, deflateRawSync } from 'node:zlib';

interface HeaderOverrides {
	versionNeeded?: number;
	flags?: number;
	method?: number;
	time?: number;
	date?: number;
	crc?: number;
	compressed?: number;
	declared?: number;
	extraHex?: string;
}

/** One entry, canonical unless a field says otherwise. */
export interface CraftedEntry extends HeaderOverrides {
	/** The name as UTF-8, or `nameHex` for bytes that are not. */
	path?: string;
	nameHex?: string;
	/** The data: text as UTF-8, `zeros` bytes of zero, or hex. Empty when none is given. */
	text?: string;
	zeros?: number;
	hex?: string;
	/**
	 * The body under method 8 (the default), as raw deflate bytes, so every builder writes the same ones; without it,
	 * Node's raw deflate of the data. Any other method's body is the data itself.
	 */
	bodyHex?: string;
	/** "Version made by": the host in the high byte (3, Unix, by default) and the spec version in the low (20). */
	madeBy?: number;
	madeByVersion?: number;
	/** The Unix mode, file type included, as an octal string: `100644` by default, or `100755` with `executable`. */
	mode?: string;
	executable?: boolean;
	/** MS-DOS attributes, OR'd into the external attributes' low half. */
	dosAttributes?: number;
	internal?: number;
	/** The central entry's comment, as hex. */
	commentHex?: string;
	disk?: number;
	/** The central entry's local header offset, instead of where its record is written. */
	localOffset?: number;
	/** Bytes written just before this entry's local record. */
	gapHex?: string;
	/**
	 * A data descriptor after the data (flag bit 3), its signature first, or without it when `unsigned`; the local
	 * header's CRC-32 and sizes are then 0.
	 */
	descriptor?: boolean | 'unsigned';
	descriptorCrc?: number;
	/** Overrides of the local header alone. */
	local?: HeaderOverrides & { path?: string };
}

/** The archive around the entries. */
export interface CraftedArchive {
	/** Entries in the order given, rather than sorted by their names' bytes. */
	unsorted?: boolean;
	/** Bytes before the first local record. */
	prefixHex?: string;
	commentHex?: string;
	/** Zero bytes after `commentHex`, still in the comment (its length counts them). */
	commentZeros?: number;
	/** Bytes between the last local record and the central directory. */
	beforeDirectoryHex?: string;
	trailingHex?: string;
	/** Both entry counts, or the count on this disk alone. */
	count?: number;
	countHere?: number;
	/** The end record's disk numbers. */
	disk?: number;
	directoryDisk?: number;
	/** Added to the central directory's size, or its offset replaced. */
	sizeDelta?: number;
	offset?: number;
}

const hex = (text: string | undefined) => Buffer.from(text ?? '', 'hex');
const DATE = (0 << 9) | (1 << 5) | 1;

export function entryData(entry: CraftedEntry): Buffer {
	if (entry.zeros !== undefined) return Buffer.alloc(entry.zeros);
	if (entry.hex !== undefined) return hex(entry.hex);
	return Buffer.from(entry.text ?? '', 'utf8');
}

const nameOf = (entry: CraftedEntry): Buffer =>
	entry.nameHex !== undefined ? hex(entry.nameHex) : Buffer.from(entry.path ?? '', 'utf8');

export function craft(given: readonly CraftedEntry[], archive: CraftedArchive = {}): Buffer {
	const entries = archive.unsorted
		? given
		: [...given].sort((a, b) => Buffer.compare(nameOf(a), nameOf(b)));
	const parts: Buffer[] = [hex(archive.prefixHex)];
	const centrals: Buffer[] = [];
	let offset = parts[0]?.length ?? 0;
	for (const entry of entries) {
		const gap = hex(entry.gapHex);
		parts.push(gap);
		offset += gap.length;
		const data = entryData(entry);
		const method = entry.method ?? 8;
		const body =
			method === 8
				? entry.bodyHex === undefined
					? deflateRawSync(data)
					: hex(entry.bodyHex)
				: data;
		const name = nameOf(entry);
		const flags = (entry.flags ?? 0x0800) | (entry.descriptor ? 0x0008 : 0);
		const crc = entry.crc ?? crc32(data);
		const compressed = entry.compressed ?? body.length;
		const declared = entry.declared ?? data.length;
		const extra = hex(entry.extraHex);
		const comment = hex(entry.commentHex);
		const local = entry.local ?? {};
		const localName = local.path === undefined ? name : Buffer.from(local.path, 'utf8');
		const localExtra = hex(local.extraHex);
		const header = Buffer.alloc(30);
		header.writeUInt32LE(0x04034b50, 0);
		header.writeUInt16LE(local.versionNeeded ?? entry.versionNeeded ?? 20, 4);
		header.writeUInt16LE(local.flags ?? flags, 6);
		header.writeUInt16LE(local.method ?? method, 8);
		header.writeUInt16LE(local.time ?? entry.time ?? 0, 10);
		header.writeUInt16LE(local.date ?? entry.date ?? DATE, 12);
		header.writeUInt32LE(local.crc ?? (entry.descriptor ? 0 : crc), 14);
		header.writeUInt32LE(local.compressed ?? (entry.descriptor ? 0 : compressed), 18);
		header.writeUInt32LE(local.declared ?? (entry.descriptor ? 0 : declared), 22);
		header.writeUInt16LE(localName.length, 26);
		header.writeUInt16LE(localExtra.length, 28);
		const signed = entry.descriptor === true;
		const descriptor = Buffer.alloc(entry.descriptor ? (signed ? 16 : 12) : 0);
		if (entry.descriptor) {
			const at = signed ? 4 : 0;
			if (signed) descriptor.writeUInt32LE(0x08074b50, 0);
			descriptor.writeUInt32LE(entry.descriptorCrc ?? crc, at);
			descriptor.writeUInt32LE(compressed, at + 4);
			descriptor.writeUInt32LE(declared, at + 8);
		}
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(((entry.madeBy ?? 3) << 8) | (entry.madeByVersion ?? 20), 4);
		central.writeUInt16LE(entry.versionNeeded ?? 20, 6);
		central.writeUInt16LE(flags, 8);
		central.writeUInt16LE(method, 10);
		central.writeUInt16LE(entry.time ?? 0, 12);
		central.writeUInt16LE(entry.date ?? DATE, 14);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(compressed, 20);
		central.writeUInt32LE(declared, 24);
		central.writeUInt16LE(name.length, 28);
		central.writeUInt16LE(extra.length, 30);
		central.writeUInt16LE(comment.length, 32);
		central.writeUInt16LE(entry.disk ?? 0, 34);
		central.writeUInt16LE(entry.internal ?? 0, 36);
		const mode = Number.parseInt(entry.mode ?? (entry.executable ? '100755' : '100644'), 8);
		central.writeUInt32LE((mode * 0x10000 + (entry.dosAttributes ?? 0)) >>> 0, 38);
		central.writeUInt32LE(entry.localOffset ?? offset, 42);
		parts.push(header, localName, localExtra, body, descriptor);
		centrals.push(central, name, extra, comment);
		offset +=
			header.length + localName.length + localExtra.length + body.length + descriptor.length;
	}
	const before = hex(archive.beforeDirectoryHex);
	parts.push(before);
	offset += before.length;
	const directory = Buffer.concat(centrals);
	const comment = Buffer.concat([hex(archive.commentHex), Buffer.alloc(archive.commentZeros ?? 0)]);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(archive.disk ?? 0, 4);
	end.writeUInt16LE(archive.directoryDisk ?? 0, 6);
	end.writeUInt16LE(archive.countHere ?? archive.count ?? entries.length, 8);
	end.writeUInt16LE(archive.count ?? entries.length, 10);
	end.writeUInt32LE((directory.length + (archive.sizeDelta ?? 0)) >>> 0, 12);
	end.writeUInt32LE((archive.offset ?? offset) >>> 0, 16);
	end.writeUInt16LE(comment.length, 20);
	return Buffer.concat([...parts, directory, end, comment, hex(archive.trailingHex)]);
}
