/**
 * Regression test for #1448: the desktop test harness's stderr filter keeps Tauri's invoke key
 * (and untrusted received values) out of captured lines and forwarded CI logs, even across split
 * chunks, multiple refusals on one line, or a trailing line without a newline.
 */
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { pipeRedactedStderr, redactInvokeKey } from './stderr-filter';

describe('#1448: desktop test stderr redaction', () => {
	it('redacts expected and received values on every occurrence in a line', () => {
		const secret = 'real-secret-invoke-key-9f8e7d6c';
		expect(redactInvokeKey(`__TAURI_INVOKE_KEY__ expected ${secret} but received forged`)).toBe(
			'__TAURI_INVOKE_KEY__ expected <key> but received <other>'
		);
		expect(redactInvokeKey(`__TAURI_INVOKE_KEY__ expected ${secret} but received `)).toBe(
			'__TAURI_INVOKE_KEY__ expected <key> but received <empty>'
		);
		expect(
			redactInvokeKey(
				`__TAURI_INVOKE_KEY__ expected ${secret} but received forged multi word payload`
			)
		).toBe('__TAURI_INVOKE_KEY__ expected <key> but received <other>');
		// Whitespace-only, trailing whitespace, bare CR, and forged partial refusal prefixes are all redacted.
		expect(redactInvokeKey(`__TAURI_INVOKE_KEY__ expected ${secret} but received   `)).toBe(
			'__TAURI_INVOKE_KEY__ expected <key> but received <other>'
		);
		expect(redactInvokeKey(`__TAURI_INVOKE_KEY__ expected ${secret} but received foo   `)).toBe(
			'__TAURI_INVOKE_KEY__ expected <key> but received <other>'
		);
		expect(redactInvokeKey(`__TAURI_INVOKE_KEY__ expected ${secret} but received a\rb`)).toBe(
			'__TAURI_INVOKE_KEY__ expected <key> but received <other>'
		);
		const forgedPrefix = `__TAURI_INVOKE_KEY__ expected ${secret} but received foo __TAURI_INVOKE_KEY__ expected LEAKED`;
		const redactedPrefix = redactInvokeKey(forgedPrefix);
		expect(redactedPrefix).toBe('__TAURI_INVOKE_KEY__ expected <key> but received <other>');
		expect(redactedPrefix).not.toMatch(/__TAURI_INVOKE_KEY__ expected (?!<key>)/);
		// Back-to-back refusals when the first received value is empty.
		const backToBack = `__TAURI_INVOKE_KEY__ expected ${secret} but received __TAURI_INVOKE_KEY__ expected ${secret} but received b`;
		expect(redactInvokeKey(backToBack)).toBe(
			'__TAURI_INVOKE_KEY__ expected <key> but received <empty>__TAURI_INVOKE_KEY__ expected <key> but received <other>'
		);
		// Linear time on heavily whitespace-padded received values (no quadratic backtracking).
		const padded = `__TAURI_INVOKE_KEY__ expected ${secret} but received ${' '.repeat(50_000)}x`;
		expect(redactInvokeKey(padded)).toBe(
			'__TAURI_INVOKE_KEY__ expected <key> but received <other>'
		);
		expect(redactInvokeKey('__TAURI_INVOKE_KEY__ expected <key> but received <redacted>')).toBe(
			'__TAURI_INVOKE_KEY__ expected <key> but received <other>'
		);
		// Multiple occurrences on a single line are all redacted.
		const doubled = `__TAURI_INVOKE_KEY__ expected ${secret} but received a __TAURI_INVOKE_KEY__ expected ${secret} but received b`;
		const redacted = redactInvokeKey(doubled);
		expect(redacted).not.toContain(secret);
		expect(redacted).toBe(
			'__TAURI_INVOKE_KEY__ expected <key> but received <other> __TAURI_INVOKE_KEY__ expected <key> but received <other>'
		);
		expect(redactInvokeKey('loam-desktop: unrelated log line')).toBe(
			'loam-desktop: unrelated log line'
		);
	});

	it('never leaks the invoke key across split chunks or a trailing unterminated line', async () => {
		const secret = 'secret-key-split-across-chunks-12345';
		const stream = new PassThrough();
		const target = { lines: [] as string[], keyRefusals: 0 };
		const forwarded: string[] = [];
		pipeRedactedStderr(stream, target, (text) => forwarded.push(text));

		// Chunk boundary right in the middle of the secret key, bare CR in payload, plus CRLF and a trailing line.
		stream.write('loam-desktop: startup\r\n__TAURI_INVOKE_KEY__ expected secret-key-split-');
		stream.write('across-chunks-12345 but received forged\rvalue\r\n');
		stream.write(
			`__TAURI_INVOKE_KEY__ expected ${secret} but received __TAURI_INVOKE_KEY__ expected ${secret} but received trailing`
		);
		stream.end();

		await new Promise<void>((resolve) => stream.once('close', () => resolve()));

		expect(target.keyRefusals).toBe(3);
		expect(target.lines).toEqual([
			'loam-desktop: startup',
			'__TAURI_INVOKE_KEY__ expected <key> but received <other>',
			'__TAURI_INVOKE_KEY__ expected <key> but received <empty>__TAURI_INVOKE_KEY__ expected <key> but received <other>',
		]);
		const allOutput = [...target.lines, ...forwarded].join('\n');
		expect(allOutput).not.toContain(secret);
		expect(allOutput).not.toContain('forged');
		expect(allOutput).not.toContain('value');
		expect(allOutput).not.toContain('trailing');
		expect(allOutput).not.toMatch(/__TAURI_INVOKE_KEY__ expected (?!<key>)/);
	});
});
