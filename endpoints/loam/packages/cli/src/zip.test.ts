/**
 * The `.loam-plugin` archive's reader (phase 5 no-terminal amendment, 4.4's archive rules; step 9a2): it reads only the
 * canonical form `writeZip` writes. Each archive below is built byte by byte by `zip-test-support.ts`, canonical but
 * for the field a case sets; the shared cases in `loam-plugin-cases.json` hold one for every rule, and these pin the
 * reader's details and order.
 */

import { describe, expect, it } from 'vitest';
import { CANONICAL, findSignatureCollision, readZip, writeZip } from './zip.js';
import { type CraftedArchive, type CraftedEntry, craft } from './zip-test-support.js';

const BUDGET = 1024 * 1024;
const TEXT = 'export default {};\n';
const DATA = Buffer.from(TEXT);
const read = (zip: Buffer, budget = BUDGET) => readZip(zip, budget, 2000);
const refusal = (entries: CraftedEntry[], archive?: CraftedArchive, budget = BUDGET) => {
	const result = read(craft(entries, archive), budget);
	return result.ok ? 'read' : `${result.problem}: ${result.detail}`;
};
const file = (path: string, extra: Partial<CraftedEntry> = {}): CraftedEntry => ({
	path,
	text: TEXT,
	...extra,
});

describe('the canonical .loam-plugin form (4.4)', () => {
	it('reads what writeZip writes, sorted, with the engine executable', () => {
		const zip = writeZip([
			{ path: 'b.js', data: DATA },
			{ path: 'a.js', data: DATA, executable: true },
		]);
		expect(read(zip)).toEqual({
			ok: true,
			entries: [
				{ path: 'a.js', data: DATA, executable: true },
				{ path: 'b.js', data: DATA, executable: false },
			],
		});
		// The crafted default is the same form, byte for byte.
		expect(craft([file('a.js', { executable: true }), file('b.js')]).equals(zip)).toBe(true);
	});

	it('names the first field that is not its canonical value', () => {
		const cases: Array<[Partial<CraftedEntry>, RegExp]> = [
			[{ madeBy: 0 }, new RegExp(`version made by is 20, not ${CANONICAL.madeBy}`)],
			[{ madeByVersion: 30 }, /version made by is 798/],
			[{ versionNeeded: 45 }, /version needed is 45, not 20/],
			[{ flags: 0 }, /flags are 0, not 2048/],
			[{ flags: 0x0801 }, /flags are 2049/],
			[{ descriptor: true }, /flags are 2056/],
			[{ method: 0 }, /method is 0, not 8/],
			[{ time: 1 }, /time is 1, not 0/],
			[{ date: 0 }, /date is 0, not 33/],
			[{ extraHex: 'feca0000' }, /extra field length is 4, not 0/],
			[{ commentHex: '6869' }, /comment length is 2, not 0/],
			[{ disk: 1 }, /disk is 1, not 0/],
			[{ internal: 1 }, /internal attributes are 1, not 0/],
			[{ mode: '100600' }, /external attributes are 0x8180/],
			[{ dosAttributes: 0x20 }, /external attributes are 0x81a40020/],
			[{ mode: '600' }, /external attributes are 0x1800000/],
			[{ mode: '170644' }, /external attributes are/],
			[{ local: { extraHex: '6c780000' } }, /local extra field length is 4, not 0/],
			[{ local: { versionNeeded: 10 } }, /local version needed is 10, not 20/],
			[{ local: { crc: 7 } }, /local CRC-32 is 7/],
			[{ local: { path: 'b.js' } }, /local header names another file/],
		];
		for (const [fields, expected] of cases)
			expect(refusal([file('a.js', fields)]), JSON.stringify(fields)).toMatch(expected);
	});

	it('reports a link, a directory and the other kinds by name, as not regular', () => {
		for (const [mode, kind] of [
			['120777', 'a symbolic link'],
			['040755', 'a directory'],
			['010644', 'a FIFO'],
			['020644', 'a character device'],
			['060644', 'a block device'],
			['140755', 'a socket'],
		] as const) {
			expect(read(craft([file('apps/x', { mode })]))).toEqual({
				ok: false,
				problem: 'not-regular',
				reason: 'not-regular',
				detail: `it is ${kind}, and an archive holds regular files only`,
				path: 'apps/x',
			});
		}
		expect(read(craft([file('apps/x/', { text: '' })]))).toMatchObject({
			problem: 'not-regular',
			path: 'apps/x',
		});
	});

	it('refuses names out of order, repeated, empty or not UTF-8', () => {
		expect(refusal([file('b.js'), file('a.js')], { unsorted: true })).toMatch(
			/does not follow the entry before it/
		);
		expect(refusal([file('a.js'), file('a.js')])).toMatch(/or repeats it/);
		expect(refusal([file('')])).toMatch(/has no name/);
		expect(refusal([{ nameHex: '61ff', text: TEXT }])).toMatch(/not named in UTF-8/);
	});

	it('refuses an end record that is not the last 22 bytes, has a comment or spells a signature in its fields', () => {
		expect(refusal([file('a')], { trailingHex: '78' })).toMatch(
			/last 22 bytes are not an end record/
		);
		expect(refusal([file('a')], { commentHex: '6d61696c' })).toMatch(
			/end record carries a comment/
		);
		expect(refusal([file('a')], { commentHex: `504b0506${'00'.repeat(18)}` })).toMatch(
			/central directory does not end at its end record/
		);
		// A central directory offset that spells a central header's signature, 0x02014b50.
		expect(read(craft([file('a')], { offset: 0x02014b50 }))).toEqual({
			ok: false,
			problem: 'malformed',
			reason: 'signature-in-end-record',
			detail: 'its end record holds a record signature in its fields',
		});
		// And a size that does.
		expect(refusal([file('a')], { sizeDelta: 0x02014b50 - (46 + 1) })).toBe(
			'malformed: its end record holds a record signature in its fields'
		);
		expect(refusal([file('a')], { countHere: 0 })).toMatch(/entry count on this disk is 0, not 1/);
		expect(refusal([file('a')], { disk: 1 })).toMatch(/its disk number is 1/);
		expect(refusal([file('a')], { count: 0xffff })).toMatch(/ZIP64/);
		expect(refusal([file('a')], { sizeDelta: -1 })).toMatch(/does not end at its end record/);
	});

	it('refuses local records that do not tile the archive exactly', () => {
		expect(refusal([file('a')], { prefixHex: '00' })).toMatch(/bytes come before its first entry/);
		expect(refusal([file('a'), file('b', { gapHex: '00' })])).toMatch(
			/does not start where the one before it ends/
		);
		expect(refusal([file('a'), file('b', { localOffset: 0 })])).toMatch(
			/does not start where the one before it ends/
		);
		expect(refusal([file('a', { compressed: 4096 })])).toMatch(/data overruns the archive/);
		expect(refusal([file('a')], { beforeDirectoryHex: '00' })).toMatch(
			/bytes lie between its last entry and its central directory/
		);
	});

	it('refuses a central directory whose fields spell a record signature, as a ZIP64 locator before the end record', () => {
		expect(refusal([file('z', { crc: 0x07064b50 })])).toBe(
			'malformed: its central directory holds a record signature inside an entry'
		);
	});

	it('holds the order: the structure, then the bounds, then the data', () => {
		// A bounds fault and a structural one: the structure.
		expect(refusal([file('a', { declared: 4 * BUDGET })], { trailingHex: '78' })).toMatch(
			/^malformed/
		);
		// A bounds fault and a data fault: the bounds.
		expect(refusal([file('a', { crc: 1 }), file('b', { declared: 4 * BUDGET })])).toMatch(
			/^too-large: its entries declare/
		);
		expect(readZip(craft([file('a'), file('b')]), BUDGET, 1)).toMatchObject({
			problem: 'too-large',
			detail: 'it holds 2 entries',
		});
	});

	it('refuses data that does not inflate to its size and CRC-32, or ends before its compressed size', () => {
		expect(refusal([file('a', { declared: DATA.length + 5 })])).toMatch(
			/does not (inflate to|match) its recorded size/
		);
		expect(refusal([file('a', { declared: DATA.length - 5 })])).toMatch(
			/inflates past its recorded size/
		);
		expect(read(craft([file('a', { declared: DATA.length - 1 })]))).toMatchObject({
			ok: false,
			reason: 'stream-too-long',
		});
		expect(read(craft([file('a', { text: 'x', declared: 0 })]))).toMatchObject({
			ok: false,
			reason: 'stream-too-long',
		});
		expect(refusal([file('a', { crc: 1 })])).toMatch(/CRC-32/);
		expect(refusal([file('a', { bodyHex: 'ffffffff' })])).toMatch(/deflate stream is corrupt/);
		expect(read(craft([file('a', { text: 'x\n', bodyHex: 'aae002000000ffff' })]))).toMatchObject({
			reason: 'stream-unfinished',
			detail: "a's deflate stream does not end: it has no final block",
		});
		const body = craft([file('a')])
			.subarray(31, 31 + 21)
			.toString('hex');
		expect(refusal([file('a', { bodyHex: `${body}00` })])).toMatch(
			/deflate stream ends before its data does: bytes follow the final block/
		);
	});

	it('identifies the colliding asset when an in-bounds asset length spells a ZIP signature', () => {
		const zip = writeZip([{ path: 'apps/sketch/zero.bin', data: Buffer.alloc(0x02014b50) }]);
		expect(readZip(zip, 256 * 1024 * 1024, 2000)).toMatchObject({
			ok: false,
			problem: 'malformed',
			reason: 'signature-in-directory',
		});
		expect(findSignatureCollision(zip)).toEqual({
			where: 'directory',
			path: 'apps/sketch/zero.bin',
		});
	});
});
