import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generateSecret } from './signer.js';

describe('generateSecret', () => {
	it('returns a hex string of the requested byte length', () => {
		expect(generateSecret()).toMatch(/^[0-9a-f]{64}$/);
		expect(generateSecret(8)).toMatch(/^[0-9a-f]{16}$/);
	});

	it('returns a different value each call', () => {
		expect(generateSecret()).not.toBe(generateSecret());
	});

	it('does not use CommonJS require() (undefined in the built ES module output)', () => {
		// vitest shims `require`, which hides this bug in tests. Guard at source level.
		const source = readFileSync(fileURLToPath(new URL('./signer.ts', import.meta.url)), 'utf8');
		expect(source).not.toMatch(/\brequire\s*\(/);
	});
});
