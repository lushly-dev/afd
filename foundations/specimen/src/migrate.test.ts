import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSpecimenBench } from './bench.js';

// The preview-first codemod through the bench: a project with a manifest and three stories.
let root: string;
const story = (imports: string, meta: string) =>
	`${imports}\nconst meta = {\n\t${meta}\n\ttags: ['autodocs'],\n\tparameters: { docs: { description: { component: 'Kept.' } } },\n};\nexport default meta;\nexport const Primary = {};\n`;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'specimen-migrate-'));
	await mkdir(join(root, 'src'));
	await writeFile(
		join(root, 'custom-elements.json'),
		JSON.stringify({
			modules: [
				{ path: 'src/x-card.ts', declarations: [{ tagName: 'x-card' }] },
				{ path: 'src/x-badge.ts', declarations: [{ tagName: 'x-badge' }] },
			],
		})
	);
	await writeFile(join(root, 'src/x-card.ts'), '');
	await writeFile(join(root, 'src/x-badge.ts'), '');
	await writeFile(
		join(root, 'src/x-card.stories.ts'),
		story("import './x-badge.js';\nimport './x-card.js';", "title: 'Card',")
	);
	await writeFile(
		join(root, 'src/gallery.stories.ts'),
		story("import './x-badge.js';\nimport './x-card.js';", "title: 'Gallery',")
	);
	await writeFile(
		join(root, 'src/x-badge.stories.ts'),
		story("import './x-badge.js';", "title: 'Badge',\n\tcomponent: 'x-badge',")
	);
	await writeFile(
		join(root, 'specimen.config.json'),
		JSON.stringify({ stories: ['src/*.stories.ts'], manifest: 'custom-elements.json' })
	);
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe('the codemod', () => {
	it('previews by default, writes nothing, and reports every file', async () => {
		const bench = await createSpecimenBench({ root });
		try {
			const before = await readFile(join(root, 'src/x-card.stories.ts'), 'utf8');
			const report = await bench.migrate();
			expect(report.mode).toBe('preview');
			expect(report.summary).toEqual({ files: 3, present: 1, proposed: 1, manual: 1, applied: 0 });
			const card = report.files.find((file) => file.importPath === './src/x-card.stories.ts');
			expect(card).toMatchObject({
				component: { status: 'proposed', tag: 'x-card', candidates: ['x-badge', 'x-card'] },
				retained: ['title', 'tags', 'parameters'],
				applied: false,
			});
			expect(card?.diff).toContain("+\tcomponent: 'x-card',");
			const gallery = report.files.find((file) => file.importPath === './src/gallery.stories.ts');
			expect(gallery?.component.status).toBe('manual');
			expect(gallery?.manual).toEqual([expect.stringContaining('ambiguous')]);
			expect(await readFile(join(root, 'src/x-card.stories.ts'), 'utf8')).toBe(before);
		} finally {
			await bench.close();
		}
	}, 60_000);

	it('applies only the proposals, to the files asked for, and keeps every other field', async () => {
		const bench = await createSpecimenBench({ root });
		try {
			const report = await bench.migrate({ files: ['./src/x-card.stories.ts'], apply: true });
			expect(report.summary).toMatchObject({ files: 1, applied: 1 });
			const written = await readFile(join(root, 'src/x-card.stories.ts'), 'utf8');
			expect(written).toContain(
				"const meta = {\n\tcomponent: 'x-card',\n\ttitle: 'Card',\n\ttags: ['autodocs'],"
			);
			expect(written).toContain("description: { component: 'Kept.' }");
			// The discovered identity is the one Storybook gave before.
			expect(bench.list().map((entry) => entry.id)).toContain('card--primary');
			const again = await bench.migrate({ apply: true });
			expect(again.summary).toMatchObject({ present: 2, proposed: 0, manual: 1, applied: 0 });
			const missing = await bench.migrate({ files: ['./src/absent.stories.ts'] });
			expect(missing.problems).toEqual([expect.stringContaining('absent.stories.ts')]);
		} finally {
			await bench.close();
		}
	}, 60_000);
});
