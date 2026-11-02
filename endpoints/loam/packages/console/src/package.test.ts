import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('.', import.meta.url));

const sources = readdirSync(SRC)
	.filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
	.map((name) => ({ name, text: readFileSync(join(SRC, name), 'utf8') }));

describe('the console package', () => {
	it('binds to no kernel: only the SDK client (7.7)', () => {
		for (const { name, text } of sources) expect(text, name).not.toContain('loam-kernel');
	});

	it('imports violet-elements only through ./dist/* deep imports (section 1)', () => {
		for (const { name, text } of sources) {
			expect(text, name).not.toMatch(/['"]@lushly-dev\/violet-elements['"]/);
		}
	});

	it("sets innerHTML in one place, for the adapters' output, and writes no style attribute", () => {
		const assignments = sources.flatMap(({ name, text }) =>
			[...text.matchAll(/\.innerHTML\s*=\s*(.+);/g)].map((match) => [name, match[1]])
		);
		expect(assignments).toEqual([['console.ts', 'resultHtml(result)']]);
		for (const { name, text } of sources) {
			expect(text, name).not.toMatch(/style="/);
			expect(text, name).not.toMatch(/setAttribute\(\s*['"]style/);
			expect(text, name).not.toMatch(/insertAdjacentHTML|outerHTML|document\.write/);
		}
	});
});
