import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createSpecimenBench } from './bench.js';
import { checkPack, readPackFiles } from './pack.js';
import { packExportRunSchema } from './schema.js';

/** `specimen pack-export`: the exported form from the committed records, with no browser. */
const fixtures = fileURLToPath(new URL('../fixtures/', import.meta.url));
const roots: string[] = [];

async function copy(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'specimen-pack-export-'));
	roots.push(root);
	await cp(join(fixtures, 'pack-library'), join(root, 'pack-library'), {
		recursive: true,
		// A full build's index is a cache: a copy starts without one.
		filter: (source) => !source.includes('node_modules'),
	});
	await cp(join(fixtures, 'pack/committed'), join(root, 'pack/committed'), { recursive: true });
	return root;
}

async function exportFrom(root: string, directory: string, revision?: string) {
	const bench = await createSpecimenBench({ root: join(root, 'pack-library') });
	try {
		return await bench.packExport({ directory, ...(revision ? { revision } : {}) });
	} finally {
		await bench.close();
	}
}

const edit = async (path: string, from: string, to: string) => {
	const text = await readFile(path, 'utf8');
	expect(text).toContain(from);
	await writeFile(path, text.split(from).join(to));
};

afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('specimen pack-export', () => {
	it('writes the format’s exported fixture from the committed one', async () => {
		const root = await copy();
		const run = packExportRunSchema.parse(await exportFrom(root, '../out'));
		expect(run).toMatchObject({ library: 'example', keptPackToml: false });
		expect(await readPackFiles(join(root, 'out'))).toEqual(
			await readPackFiles(join(fixtures, 'pack/exported'))
		);
	});

	it('replaces only its own library, and keeps the deployment’s pack.toml', async () => {
		const root = await copy();
		const out = join(root, 'out');
		await mkdir(join(out, 'data/example/components'), { recursive: true });
		await writeFile(join(out, 'data/example/components/example-gone.json'), '{}\n');
		await writeFile(join(out, 'pack.toml'), 'id = "library"\n');
		// Another library, exported before, stays as it was.
		await cp(join(fixtures, 'pack/exported/data/example'), join(out, 'data/other'), {
			recursive: true,
		});
		const other = join(out, 'data/other/library.json');
		await edit(other, '"library": "example"', '"library": "other"');
		await cp(join(fixtures, 'pack/exported/rules/example.json'), join(out, 'rules/other.json'));
		await edit(join(out, 'rules/other.json'), '"library": "example"', '"library": "other"');
		const otherBefore = await readFile(other, 'utf8');
		const revision = 'a'.repeat(40);
		const run = await exportFrom(root, '../out', revision);
		expect(run.keptPackToml).toBe(true);
		expect(await readFile(join(out, 'pack.toml'), 'utf8')).toBe('id = "library"\n');
		expect(await readFile(other, 'utf8')).toBe(otherBefore);
		const files = await readPackFiles(out);
		expect(files.has('data/example/components/example-gone.json')).toBe(false);
		expect(
			JSON.parse(new TextDecoder().decode(files.get('data/example/library.json')))
		).toMatchObject({ revision });
		files.delete('pack.toml');
		expect(
			checkPack(files, { form: 'exported' }).problems.map((problem) => problem.code)
		).not.toContain('LAYOUT_INVALID');
	});

	it.each([
		[
			'a guide’s statement changed',
			'pack-library/guides/field.guide.json',
			'Set label; a placeholder is not a name.',
			'Set label; a placeholder is never a name.',
			'data/example/components/example-field.json: Its a11y.statements differs from its guide.',
		],
		[
			'the manifest declares a new attribute',
			'pack-library/custom-elements.json',
			'"required"',
			'"multiple"',
			'data/example/components/example-select.json: The manifest declares api.attributes.multiple, which it does not name.',
		],
		[
			'a shared rule changed',
			'pack-library/guides/rules.guide.json',
			'colour alone does not tell anyone',
			'colour alone tells no one',
			'rules/example.json: Its rules differ from the guide files.',
		],
		[
			'an attribute’s description changed in the manifest',
			'pack-library/custom-elements.json',
			"The field's visible label and accessible name.",
			"The field's label.",
			'data/example/components/example-field.json: Its api.attributes.label.description differs from the manifest.',
		],
		[
			'a slot the manifest declared is gone',
			'pack-library/custom-elements.json',
			'"name": "hint",',
			'"name": "help",',
			'data/example/components/example-field.json: The manifest declares api.slots.help, which it does not name.',
		],
		[
			'what a shared rule applies to changed',
			'pack-library/guides/rules.guide.json',
			'"attributes": ["invalid"]',
			'"attributes": ["disabled"]',
			'rules/example.json: Its rules differ from the guide files.',
		],
		[
			'a guide’s authored role changed',
			'pack-library/guides/select.guide.json',
			'"role": "listbox"',
			'"role": "menu"',
			'data/example/components/example-select.json: Its authored roles differ from its guide.',
		],
	])('refuses, naming the record, when %s', async (_, file, from, to, named) => {
		const root = await copy();
		await edit(join(root, file), from, to);
		await expect(exportFrom(root, '../out')).rejects.toThrow(named);
	});

	it('refuses a target that is not a pack, and puts back a pack an earlier export left aside', async () => {
		const root = await copy();
		await mkdir(join(root, 'out'), { recursive: true });
		await writeFile(join(root, 'out/notes.txt'), 'mine\n');
		await expect(exportFrom(root, '../out')).rejects.toThrow(
			/holds notes\.txt, which a pack does not/
		);
		expect(await readFile(join(root, 'out/notes.txt'), 'utf8')).toBe('mine\n');
		// An export stopped between its renames: the target is gone and the old pack is aside.
		await rm(join(root, 'out'), { recursive: true });
		await mkdir(join(root, '.out.specimen-retired'), { recursive: true });
		await writeFile(join(root, '.out.specimen-retired/pack.toml'), 'id = "library"\n');
		const run = await exportFrom(root, '../out');
		expect(run.keptPackToml).toBe(true);
		expect(await readFile(join(root, 'out/pack.toml'), 'utf8')).toBe('id = "library"\n');
	});
});
