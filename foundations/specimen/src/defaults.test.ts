import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	buildDefaultPatternsPackFiles,
	getDefaultPatternsDir,
	getDefaultPatternsPackDir,
	hasBundledDefaultsPack,
	isBuiltinDefaultPatternSource,
	loadDefaultPatterns,
	patternContentDigest,
	resolveDefaultsVersion,
} from './defaults.js';
import {
	CANONICAL_DEFAULT_PATTERNS,
	DEFAULT_PATTERNS_LIBRARY,
	DEFAULT_PATTERNS_SEMVER,
	DEFAULT_PATTERNS_VERSION,
} from './design-types.js';
import { checkPack, readPackFiles } from './pack.js';
import { loadPatterns, resolvePatternSource } from './patterns.js';

describe('afd-defaults@1.0.0 bundled default patterns', () => {
	it('defines the 10 canonical default patterns in alphabetical order', () => {
		expect(DEFAULT_PATTERNS_LIBRARY).toBe('afd-defaults');
		expect(DEFAULT_PATTERNS_SEMVER).toBe('1.0.0');
		expect(DEFAULT_PATTERNS_VERSION).toBe('afd-defaults@1.0.0');
		expect(CANONICAL_DEFAULT_PATTERNS).toHaveLength(10);
		expect([...CANONICAL_DEFAULT_PATTERNS]).toEqual([...CANONICAL_DEFAULT_PATTERNS].sort());
	});

	it('loads all 10 source pattern.json files with zero schema or lint problems', async () => {
		const defaultsDir = getDefaultPatternsDir();
		const loaded = await loadPatterns({
			root: defaultsDir,
			configFile: join(defaultsDir, 'specimen.config.json'),
			patterns: ['*/pattern.json'],
			localLibrary: DEFAULT_PATTERNS_LIBRARY,
			entries: [],
		});
		expect(loaded.problems).toEqual([]);
		expect(loaded.patterns.map((entry) => entry.pattern).sort()).toEqual([
			...CANONICAL_DEFAULT_PATTERNS,
		]);

		const byId = await loadDefaultPatterns();
		for (const id of CANONICAL_DEFAULT_PATTERNS) {
			const pattern = byId[id];
			expect(pattern.pattern).toBe(id);
			expect(pattern.summary?.length).toBeGreaterThan(10);
			expect(pattern.keep?.length).toBeGreaterThanOrEqual(1);
			expect(Object.keys(pattern.setups ?? {}).length).toBeGreaterThanOrEqual(1);
			expect(Object.keys(pattern.gates ?? {}).length).toBeGreaterThanOrEqual(1);
			// Every referenced gate and setup exists.
			for (const keep of pattern.keep ?? []) {
				if (keep.gate) {
					expect(pattern.gates?.[keep.gate]).toBeDefined();
					const setupName = pattern.gates?.[keep.gate]?.setup;
					expect(setupName && pattern.setups?.[setupName]).toBeDefined();
				}
			}
			expect(patternContentDigest(pattern)).toMatch(/^sha256:[0-9a-f]{64}$/);
		}
	});

	it('ships a bundled Pack Format 2 library in defaults/pack with zero drift', async () => {
		expect(hasBundledDefaultsPack()).toBe(true);
		const packDir = getDefaultPatternsPackDir();
		const onDisk = await readPackFiles(packDir);
		const check = checkPack(onDisk, { form: 'exported' });
		expect(check.problems).toEqual([]);
		expect(check.valid).toBe(true);

		const expected = await buildDefaultPatternsPackFiles();
		const decoder = new TextDecoder();
		expect([...onDisk.keys()].sort()).toEqual([...expected.keys()].sort());
		for (const [relPath, expectedText] of expected) {
			const bytes = onDisk.get(relPath);
			expect(bytes, `missing bundled pack file ${relPath}`).toBeDefined();
			expect(decoder.decode(bytes)).toBe(expectedText);
		}

		// Verify library.json metadata includes the package version and 10 patterns.
		const libraryJson = JSON.parse(
			await readFile(join(packDir, 'data', DEFAULT_PATTERNS_LIBRARY, 'library.json'), 'utf8')
		) as {
			library: string;
			package?: { name: string; version: string };
			patterns?: Array<{ pattern: string }>;
		};
		expect(libraryJson.library).toBe('afd-defaults');
		expect(libraryJson.package).toEqual({
			name: '@lushly-dev/specimen',
			version: '1.0.0',
		});
		expect((libraryJson.patterns ?? []).map((item) => item.pattern).sort()).toEqual([
			...CANONICAL_DEFAULT_PATTERNS,
		]);
	});

	it('resolves afd-defaults and afd-defaults@1.0.0 offline via resolvePatternSource', async () => {
		expect(isBuiltinDefaultPatternSource('afd-defaults')).toBe(true);
		expect(isBuiltinDefaultPatternSource('afd-defaults@1.0.0')).toBe(true);
		expect(isBuiltinDefaultPatternSource('afd-defaults@2.0.0')).toBe(false);
		expect(resolveDefaultsVersion()).toBe('afd-defaults@1.0.0');
		expect(resolveDefaultsVersion('afd-defaults')).toBe('afd-defaults@1.0.0');
		expect(resolveDefaultsVersion('afd-defaults@1.0.0')).toBe('afd-defaults@1.0.0');
		expect(() => resolveDefaultsVersion('afd-defaults@9.9.9')).toThrow(
			expect.objectContaining({ code: 'VALIDATION_ERROR' })
		);

		const expectedPackDir = await realpath(getDefaultPatternsPackDir());
		const resolvedBare = await resolvePatternSource(
			'/tmp/nonexistent-project/specimen.config.json',
			'afd-defaults'
		);
		expect(resolvedBare).toBe(expectedPackDir);
		const resolvedPinned = await resolvePatternSource(
			'/tmp/nonexistent-project/specimen.config.json',
			'afd-defaults@1.0.0'
		);
		expect(resolvedPinned).toBe(expectedPackDir);
	});
});
