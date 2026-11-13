import { describe, expect, it } from 'vitest';
import { FAILED, lineSplitter, READY, readChildLine } from './protocol.js';

describe("the development profile's child protocol", () => {
	it('reads ready, failed and every other line', () => {
		const ready = {
			origin: 'https://localhost:1',
			sandboxOrigin: null,
			spki: 'x',
			certificate: '/c',
			mail: '/m',
			data: '/d',
		};
		expect(readChildLine(`${READY} ${JSON.stringify(ready)}`)).toEqual({ kind: 'ready', ready });
		const failed = readChildLine(`${FAILED} {"code":"HOST_DATA_LOCKED","message":"held"}`);
		expect(failed.kind).toBe('failed');
		if (failed.kind === 'failed') {
			expect(failed.error.code).toBe('HOST_DATA_LOCKED');
			expect(failed.error.message).toBe('held');
		}
		const bare = readChildLine(`${FAILED} {}`);
		expect(bare.kind === 'failed' && bare.error.code).toBe('DEV_FAILED');
		expect(readChildLine('listening')).toEqual({ kind: 'log' });
		expect(readChildLine(READY)).toEqual({ kind: 'log' });
	});

	it('splits chunks into whole lines, keeping a partial one for the next chunk', () => {
		const lines: string[] = [];
		const split = lineSplitter((line) => lines.push(line));
		split('one\ntw');
		split('o\n');
		split('three');
		expect(lines).toEqual(['one', 'two']);
		split('\n\n');
		expect(lines).toEqual(['one', 'two', 'three', '']);
	});
});
