import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PACKAGE_VERSION } from './version.js';

describe('PACKAGE_VERSION', () => {
	it('is the version in package.json', () => {
		const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
		expect(PACKAGE_VERSION).toBe(manifest.version);
	});
});
