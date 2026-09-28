import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AFD_CONTRACT_VERSION } from './index.js';

const specVersion = readFileSync(new URL('../../../spec/VERSION', import.meta.url), 'utf8').trim();

describe('AFD_CONTRACT_VERSION', () => {
	it('matches spec/VERSION', () => {
		expect(AFD_CONTRACT_VERSION).toBe(specVersion);
	});

	it('is MAJOR.MINOR with an optional pre-release label', () => {
		expect(AFD_CONTRACT_VERSION).toMatch(/^\d+\.\d+(?:-[0-9A-Za-z.]+)?$/);
	});
});
