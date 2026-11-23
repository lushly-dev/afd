/**
 * @fileoverview Engine-port isolation boundary test (spec §5.1):
 * No file in `src/` outside `src/port/` and `src/interface.ts` may import
 * `@lushly-dev/violet-afd` or `@lushly-dev/violet-core`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_DIR = fileURLToPath(new URL('../src', import.meta.url));
const FORBIDDEN_IMPORT_RE =
	/(?:from\s+['"]|import\(\s*['"])@lushly-dev\/violet-(?:afd|core)(?:\/[^'"]*)?['"]/g;

function walkTs(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			files.push(...walkTs(full));
		} else if (entry.endsWith('.ts')) {
			files.push(full);
		}
	}
	return files;
}

describe('engine port boundary (spec §5.1)', () => {
	it('confines @lushly-dev/violet-afd and @lushly-dev/violet-core imports to src/port/ and src/interface.ts', () => {
		const violations: string[] = [];
		for (const file of walkTs(SRC_DIR)) {
			const rel = relative(SRC_DIR, file).replaceAll('\\', '/');
			if (rel.startsWith('port/') || rel === 'interface.ts') continue;
			const source = readFileSync(file, 'utf8');
			for (const match of source.matchAll(FORBIDDEN_IMPORT_RE)) {
				violations.push(`${rel}: ${match[0]}`);
			}
		}
		expect(violations).toEqual([]);
	});
});
