import { chmod, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createSpecimenBench } from './bench.js';
import { loadConfig } from './config.js';
import { guideJsonSchemas } from './guide-schema.js';
import { guidePatternRegExp } from './guides.js';

const fixture = fileURLToPath(new URL('../fixtures/guides/', import.meta.url));
const schemaRoot = fileURLToPath(new URL('../schema/guide/', import.meta.url));
const projects: string[] = [];

async function project(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'specimen-guides-'));
	projects.push(root);
	await cp(fixture, root, { recursive: true });
	return root;
}
afterEach(async () => {
	await Promise.all(projects.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function validate(root: string, target?: { id?: string; file?: string }) {
	const bench = await createSpecimenBench({ root });
	try {
		return bench.validate(target);
	} finally {
		await bench.close();
	}
}
const writeGuide = (root: string, name: string, value: unknown) =>
	writeFile(
		join(root, 'src', name),
		typeof value === 'string' ? value : JSON.stringify(value, null, '\t')
	);
const editConfig = async (root: string, edit: (config: Record<string, unknown>) => void) => {
	const path = join(root, 'specimen.config.json');
	const config = JSON.parse(await readFile(path, 'utf8'));
	edit(config);
	await writeFile(path, JSON.stringify(config));
};
const button = { tag: 'example-button' };
const line = (id: string, text = 'A statement.', members?: string[]) => ({
	id,
	text,
	...(members ? { members } : {}),
});

describe('guide files', () => {
	it('loads the fixture guide and its shared rules', async () => {
		const { guides } = await loadConfig({ root: fixture });
		expect(guides?.problems).toEqual([]);
		expect(guides?.files).toEqual(['./src/example-button.guide.json', './src/shared.guide.json']);
		expect(guides?.components.map((guide) => guide.tag)).toEqual(['example-button']);
		expect(guides?.components[0]?.usage?.map((statement) => statement.id)).toEqual([
			'button.when',
			'button.disabled',
		]);
		expect(guides?.rules.map((rule) => rule.id)).toEqual([
			'actions.disabled-state',
			'actions.one-primary',
		]);
	});

	it('validates clean, counting the guide files', async () => {
		expect(await validate(fixture)).toEqual({
			valid: true,
			scope: 'static',
			checked: 2,
			issues: [],
		});
	});

	it('leaves a project with no guides key as it was', async () => {
		const root = await project();
		await editConfig(root, (config) => {
			delete config.guides;
		});
		expect((await loadConfig({ root })).guides).toBeUndefined();
		expect(await validate(root)).toEqual({ valid: true, scope: 'static', checked: 0, issues: [] });
	});

	it('needs a manifest', async () => {
		const root = await project();
		await editConfig(root, (config) => {
			delete config.manifest;
		});
		await expect(loadConfig({ root })).rejects.toThrow('configuration.guides');
	});

	const failures: [string, string, unknown, string, string?][] = [
		['not JSON', 'x.guide.json', '{ nope', 'GUIDE_JSON_INVALID'],
		['an unknown key', 'x.guide.json', { ...button, extra: 1 }, 'GUIDE_SCHEMA_INVALID'],
		['no tag', 'x.guide.json', { summary: 'A summary.' }, 'GUIDE_SCHEMA_INVALID', 'tag'],
		[
			'a bad statement id',
			'x.guide.json',
			{ ...button, usage: [line('NotAnId')] },
			'GUIDE_SCHEMA_INVALID',
			'usage[0].id',
		],
		[
			'a replacement on a component not deprecated',
			'x.guide.json',
			{ ...button, status: 'stable', replacedBy: 'example-link' },
			'GUIDE_SCHEMA_INVALID',
		],
		[
			'a rule that applies to nothing',
			'x.guide.json',
			{ rules: [{ id: 'a.b', text: 'A rule.', appliesTo: {} }] },
			'GUIDE_SCHEMA_INVALID',
			'rules[0].appliesTo',
		],
		[
			'a summary over 160 characters',
			'x.guide.json',
			{ ...button, summary: 'x'.repeat(161) },
			'GUIDE_TEXT_TOO_LONG',
			'summary',
		],
		[
			'a statement over 240 characters',
			'x.guide.json',
			{ ...button, a11y: [line('a.b', 'x'.repeat(241))] },
			'GUIDE_TEXT_TOO_LONG',
			'a11y[0].text',
		],
		[
			'a control character',
			'x.guide.json',
			{ ...button, usage: [line('a.b', 'two\nlines')] },
			'GUIDE_TEXT_INVALID',
			'usage[0].text',
		],
		[
			'a tag the manifest lacks',
			'x.guide.json',
			{ tag: 'example-nope' },
			'GUIDE_UNKNOWN_TAG',
			'tag',
		],
		[
			'a replacement the manifest lacks',
			'x.guide.json',
			{ tag: 'example-link', status: 'deprecated', replacedBy: 'example-nope' },
			'GUIDE_UNKNOWN_TAG',
			'replacedBy',
		],
		[
			'a rule for a tag the manifest lacks',
			'x.guide.json',
			{ rules: [{ id: 'a.b', text: 'A rule.', appliesTo: { tags: ['example-nope'] } }] },
			'GUIDE_UNKNOWN_TAG',
			'rules[0].appliesTo.tags[0]',
		],
		[
			'a member that does not exist',
			'x.guide.json',
			{ tag: 'example-link', usage: [line('a.b', 'A statement.', ['disabled'])] },
			'GUIDE_UNKNOWN_MEMBER',
			'usage[0].members[0]',
		],
		[
			'a rule for an attribute no component has',
			'x.guide.json',
			{ rules: [{ id: 'a.b', text: 'A rule.', appliesTo: { attributes: ['nope'] } }] },
			'GUIDE_UNKNOWN_MEMBER',
			'rules[0].appliesTo.attributes[0]',
		],
		[
			'a second guide for one tag',
			'z.guide.json',
			{ tag: 'example-button' },
			'GUIDE_DUPLICATE_TAG',
			'tag',
		],
		[
			'an id another guide uses',
			'z.guide.json',
			{ tag: 'example-link', usage: [line('button.when')] },
			'GUIDE_DUPLICATE_ID',
			'usage[0].id',
		],
		[
			'a rule id a statement uses',
			'z.guide.json',
			{ rules: [{ id: 'button.when', text: 'A rule.', appliesTo: { tags: ['example-link'] } }] },
			'GUIDE_DUPLICATE_ID',
			'rules[0].id',
		],
	];
	it.each(failures)('reports %s', async (_name, file, value, code, field) => {
		const root = await project();
		await writeGuide(root, file, value);
		const report = await validate(root);
		expect(report.valid).toBe(false);
		const issue = report.issues.find((item) => item.code === code);
		expect(issue, JSON.stringify(report.issues)).toMatchObject({
			severity: 'error',
			importPath: `./src/${file}`,
			...(field === undefined ? {} : { field }),
		});
		expect(issue?.suggestion).toBeTruthy();
	});

	it('defers an unknown member when a plugin could add it', async () => {
		const root = await project();
		await writeFile(join(root, 'plugin.js'), 'export default {};');
		await editConfig(root, (config) => {
			config.plugins = ['./plugin.js'];
		});
		await writeGuide(root, 'x.guide.json', {
			tag: 'example-link',
			usage: [line('a.b', 'A statement.', ['from-plugin'])],
		});
		const report = await validate(root);
		expect(report.valid).toBe(true);
		expect(report.issues).toMatchObject([{ severity: 'deferred', code: 'GUIDE_UNKNOWN_MEMBER' }]);
	});

	it('warns of a pattern that matches nothing, and reports an invalid one', async () => {
		const root = await project();
		await editConfig(root, (config) => {
			config.guides = [
				'src/**/*.nothing.json',
				'src/@(a|b).json',
				'../outside/*.json',
				'src/{a/b}.json',
				'src/foo**/a.json',
			];
		});
		const report = await validate(root);
		expect(report.issues.map((issue) => [issue.severity, issue.code])).toEqual([
			['warning', 'GUIDE_NO_FILES'],
			['error', 'GUIDE_PATTERN_INVALID'],
			['error', 'GUIDE_PATTERN_INVALID'],
			['error', 'GUIDE_PATTERN_INVALID'],
			['error', 'GUIDE_PATTERN_INVALID'],
		]);
	});

	it('follows no link and reads no node_modules or hidden directory', async () => {
		const root = await project();
		const outside = await project();
		await symlink(join(outside, 'src'), join(root, 'src', 'linked'));
		for (const directory of ['node_modules/dep', '.hidden']) {
			await mkdir(join(root, 'src', directory), { recursive: true });
			await writeFile(join(root, 'src', directory, 'a.guide.json'), '{ nope');
		}
		const { guides } = await loadConfig({ root });
		expect(guides?.files).toEqual(['./src/example-button.guide.json', './src/shared.guide.json']);
	});

	it('refuses a link in the fixed part of a pattern that leads outside the root', async () => {
		const root = await project();
		const outside = await project();
		await symlink(join(outside, 'src'), join(root, 'src', 'linked'));
		await editConfig(root, (config) => {
			config.guides = ['src/linked/*.guide.json'];
		});
		const { guides } = await loadConfig({ root });
		expect(guides?.files).toEqual([]);
		expect(guides?.problems.map((problem) => problem.code)).toEqual(['GUIDE_PATTERN_INVALID']);
	});

	it('reports a file or directory it cannot read, and still opens', async () => {
		const root = await project();
		await writeGuide(root, 'locked.guide.json', { tag: 'example-link' });
		await mkdir(join(root, 'src', 'locked'));
		await chmod(join(root, 'src', 'locked.guide.json'), 0o000);
		await chmod(join(root, 'src', 'locked'), 0o000);
		try {
			const report = await validate(root);
			expect(report.valid).toBe(false);
			expect(
				report.issues.map((issue) => [issue.code, issue.importPath, issue.message.split(':')[0]])
			).toEqual([
				['GUIDE_UNREADABLE', undefined, './src/locked'],
				['GUIDE_UNREADABLE', './src/locked.guide.json', './src/locked.guide.json'],
			]);
		} finally {
			await chmod(join(root, 'src', 'locked'), 0o755);
			await chmod(join(root, 'src', 'locked.guide.json'), 0o644);
		}
	});

	it('reports a file used as a directory, and still opens', async () => {
		const root = await project();
		await editConfig(root, (config) => {
			config.guides = ['src/shared.guide.json/*.json'];
		});
		expect((await validate(root)).issues.map((issue) => issue.code)).toEqual([
			'GUIDE_UNREADABLE',
			'GUIDE_NO_FILES',
		]);
	});

	it('narrows to a file, and has nothing to say of one story', async () => {
		const root = await project();
		await writeGuide(root, 'x.guide.json', { tag: 'example-nope' });
		const all = await validate(root);
		expect(all.checked).toBe(3);
		expect((await validate(root, { file: 'src/shared.guide.json' })).issues).toEqual([]);
		const one = await validate(root, { file: 'src/x.guide.json' });
		expect(one.checked).toBe(1);
		expect(one.issues.map((issue) => issue.code)).toEqual(['GUIDE_UNKNOWN_TAG']);
		expect(await validate(root, { id: 'example-button' })).toMatchObject({
			valid: true,
			issues: [],
		});
	});
});

describe('guide patterns', () => {
	it.each([
		['*.guide.json', 'a.guide.json', true],
		['*.guide.json', 'x/a.guide.json', false],
		['**/*.guide.json', 'a.guide.json', true],
		['**/*.guide.json', 'x/y/a.guide.json', true],
		['a?.json', 'ab.json', true],
		['a?.json', 'a/.json', false],
		['{a,b}.json', 'b.json', true],
		['{a,b}.json', 'c.json', false],
		['a.json', 'axjson', false],
	])('%s against %s is %s', (pattern, path, matches) => {
		expect(guidePatternRegExp(pattern).test(path)).toBe(matches);
	});
});

describe('guide JSON Schema', () => {
	const schemas = guideJsonSchemas();

	it('is committed as the package exports it', async () => {
		for (const [kind, schema] of Object.entries(schemas))
			expect(
				JSON.parse(await readFile(join(schemaRoot, `${kind}.schema.json`), 'utf8')),
				kind
			).toEqual(schema);
	});

	it('accepts the fixture and refuses a bad shape', async () => {
		const ajv = new Ajv2020({ allErrors: true, strict: false });
		const component = ajv.compile(schemas.component as object);
		const rules = ajv.compile(schemas.rules as object);
		const read = async (name: string) =>
			JSON.parse(await readFile(join(fixture, 'src', name), 'utf8'));
		expect(component(await read('example-button.guide.json')), ajv.errorsText()).toBe(true);
		expect(rules(await read('shared.guide.json')), ajv.errorsText()).toBe(true);
		expect(component({ tag: 'example-button', extra: 1 })).toBe(false);
		expect(component({ tag: 'example-button', replacedBy: 'example-link' })).toBe(false);
		expect(rules({ rules: [{ id: 'a.b', text: 'A rule.', appliesTo: {} }] })).toBe(false);
	});
});
