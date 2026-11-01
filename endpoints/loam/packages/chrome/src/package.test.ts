import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { clampSize, nextPreset } from './resize.js';
import { STATE_PROPERTIES } from './state-properties.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function sources(directory: string): string[] {
	return readdirSync(directory).flatMap((name) => {
		const path = join(directory, name);
		if (statSync(path).isDirectory()) return sources(path);
		return /\.ts$/.test(name) ? [path] : [];
	});
}

describe('the chrome package', () => {
	it("lists the same state properties as the token lint's allowlist (step 2)", () => {
		const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
			loamLintTokens: { stateProperties: string[] };
		};
		expect([...STATE_PROPERTIES]).toEqual(manifest.loamLintTokens.stateProperties);
	});

	it('imports violet-elements only through ./dist/* deep imports (section 7)', () => {
		const files = [...sources(join(ROOT, 'src')), ...sources(join(ROOT, 'specimens'))];
		const offenders = files.filter((file) =>
			/from\s+['"]@lushly-dev\/violet-elements['"]|import\s+['"]@lushly-dev\/violet-elements['"]|import\(\s*['"]@lushly-dev\/violet-elements['"]/.test(
				readFileSync(file, 'utf8')
			)
		);
		expect(offenders).toEqual([]);
		const deep = files.filter((file) =>
			readFileSync(file, 'utf8').includes("'@lushly-dev/violet-elements/dist/")
		);
		expect(deep.length).toBeGreaterThan(0);
	});

	it('sets no inline style through markup, so style-src stays self', () => {
		for (const file of sources(join(ROOT, 'src'))) {
			const text = readFileSync(file, 'utf8');
			expect(text, file).not.toMatch(/\sstyle=["$]/);
			expect(text, file).not.toMatch(/createElement\(['"]style['"]\)/);
			expect(text, file).not.toMatch(/setAttribute\(['"]style['"]/);
		}
	});
});

describe('resize steps', () => {
	it('clamps to whole pixels within the bounds', () => {
		expect(clampSize(199.4, 200, 480)).toBe(200);
		expect(clampSize(300.6, 200, 480)).toBe(301);
		expect(clampSize(900, 200, 480)).toBe(480);
	});

	it('cycles through the minimum, default and maximum on a click', () => {
		expect(nextPreset(200, 200, 260, 480)).toBe(260);
		expect(nextPreset(260, 200, 260, 480)).toBe(480);
		expect(nextPreset(480, 200, 260, 480)).toBe(200);
		expect(nextPreset(300, 200, 260, 480)).toBe(480);
	});
});
