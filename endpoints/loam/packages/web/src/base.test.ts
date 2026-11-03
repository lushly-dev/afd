/**
 * P2-E8 (phase 2 specification, section 15), its scan: nothing in the web host or the chrome reads
 * `document.baseURI`, which a deep link moves and `base-uri 'none'` forbids setting. The base comes from
 * the entry's URL (6.2).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGES = fileURLToPath(new URL('../..', import.meta.url));

function sources(directory: string): string[] {
	return readdirSync(directory).flatMap((name) => {
		const path = join(directory, name);
		if (statSync(path).isDirectory()) return sources(path);
		return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
	});
}

describe('P2-E8: the base', () => {
	it('P2-E8: a scan of web/src and chrome/src finds no baseURI', () => {
		const files = [join(PACKAGES, 'web', 'src'), join(PACKAGES, 'chrome', 'src')].flatMap(sources);
		expect(files.length).toBeGreaterThan(20);
		expect(files.filter((file) => readFileSync(file, 'utf8').includes('baseURI'))).toEqual([]);
	});

	it('P2-E8: the entry computes the base from its own URL, one level up from assets/', () => {
		const main = readFileSync(join(PACKAGES, 'web', 'src', 'main.ts'), 'utf8');
		expect(main).toContain("new URL('../', /* @vite-ignore */ import.meta.url)");
		expect(main).toContain("fetch(new URL('deployment.json', base))");
	});
});
