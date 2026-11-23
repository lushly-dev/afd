import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import { checkApp, type SurfaceCheck } from './check.js';
import { scaffold } from './templates.js';

const NATIVE = `manifest_version = 1
protocol = 1

[plugin]
id = "hello"
title = "Hello"
version = "0.1.0"
description = "One command, for the tests of app check."
kind = "native"
domains = ["hello"]

[native]
entry = "dist/native.js"

[[commands]]
name = "hello-greet"
description = "Greet someone and remember the name."
effects = ["inspect"]
input_schema = "schemas/in.json"
expose = { mcp = true, palette = false }
`;

const SCHEMA = '{"type":"object","properties":{},"additionalProperties":false}';

const files = (toml = NATIVE) => ({
	'loam-app.toml': toml,
	'schemas/in.json': SCHEMA,
	'dist/native.js': 'throw new Error("never run");',
});

describe('checkApp', () => {
	it("G2: refuses a project summary against ui.project_summary's rule, through readManifest", () => {
		const summarized = (levels: string) =>
			NATIVE.replace('manifest_version = 1', 'manifest_version = 2').concat(
				`\n[app]\nscope_levels = ${levels}\n\n[ui]\nproject_summary = { command = "hello-greet" }\n`
			);
		expect(checkApp(files(summarized('["project"]'))).refusals).toEqual([]);
		const refused = checkApp(files(summarized('["workspace"]')));
		expect(refused.ok).toBe(false);
		expect(refused.refusals).toEqual([
			expect.objectContaining({ code: 'MANIFEST_SUMMARY_INVALID', key: 'ui.project_summary' }),
		]);
	});

	it('P2-D3: inlines a content schema, and refuses a template off it as DOCUMENT_TEMPLATE_INVALID', () => {
		const typed = (content: string) =>
			NATIVE.replace('manifest_version = 1', 'manifest_version = 2')
				.replace('[native]', '[[grants]]\nname = "store"\nreason = "Keeps the text."\n\n[native]')
				.replace(
					'input_schema = "schemas/in.json"',
					'input_schema = { type = "object", properties = { document = { type = "string" } }, required = ["document"], additionalProperties = false }'
				)
				.concat(
					[
						'',
						'[[ui.documents]]',
						'id = "hello"',
						'title = "Greeting"',
						'icon = "system/document"',
						'content_schema = "schemas/content.json"',
						'content_version = 1',
						'instance_commands = ["hello-greet"]',
						'editor = { element = "hello-editor" }',
						'binding = { model = "command", selection = "none", locator = "none", conflict = "last-writer-wins" }',
						'',
						'[[ui.documents.templates]]',
						'id = "blank"',
						'title = "Blank"',
						`content = ${content}`,
						'',
					].join('\n')
				);
		const tree = (content: string) => ({
			...files(typed(content)),
			'schemas/content.json':
				'{"type":"object","properties":{"text":{"type":"string"}},"required":["text"],"additionalProperties":false}',
		});
		const valid = checkApp(tree('{ text = "" }'));
		expect(valid.refusals).toEqual([]);
		expect(valid.manifest?.ui?.documents?.[0]?.content_schema).toMatchObject({
			required: ['text'],
		});
		expect(checkApp(tree('{ text = 1 }')).refusals).toEqual([
			expect.objectContaining({
				code: 'DOCUMENT_TEMPLATE_INVALID',
				key: 'ui.documents[0].templates[0].content',
			}),
		]);
	});

	it('inlines, reports the effective exposure and says what a native app is', () => {
		const report = checkApp(files());
		expect(report.refusals).toEqual([]);
		expect(report.ok).toBe(true);
		expect(report.kind).toBe('native');
		expect(report.exposure).toEqual({
			'hello-greet': { palette: false, agent: true, mcp: true, cli: false },
		});
		expect(report.trust?.code).toBe('TRUSTED_NOT_SANDBOXED');
		expect(report.trust?.line).toMatch(/^Trusted, not sandboxed\./);
		expect(report.manifest?.commands?.[0]?.input_schema).toEqual(JSON.parse(SCHEMA));
	});

	it('says what a view and a mounted app are, and D55 of a mounted one', () => {
		const view = checkApp(scaffold('demo', 'view', 'workspace:*'));
		expect(view.trust?.line).toBe('Sandboxed: its grants are enforced.');
		const mounted = checkApp(scaffold('demo', 'mounted', 'workspace:*'));
		expect(mounted.trust?.line).toBe('External: its results are labeled untrusted.');
		expect(mounted.trust?.notices.map(({ code }) => code)).toEqual([
			'MOUNT_ANNOTATIONS_UNTRUSTED',
			'TEAM_INSTANCE_SINGLE_PRINCIPAL',
		]);
		expect(mounted.trust?.notices[1]?.message).toBe(
			'A team instance is mounted only where every member of its projects may read all of it.'
		);
	});

	it('still gives the trust line when the manifest is refused', () => {
		const report = checkApp(files(NATIVE.replace('[native]', '[native]\nnope = 1')));
		expect(report.ok).toBe(false);
		expect(report.trust?.code).toBe('TRUSTED_NOT_SANDBOXED');
		expect(report.manifest).toBeUndefined();
		expect(report.exposure).toEqual({});
	});

	it('refuses what is not there and what is not TOML', () => {
		expect(checkApp({}).refusals[0]?.code).toBe('APP_MANIFEST_MISSING');
		const broken = checkApp({ 'loam-app.toml': 'manifest_version = ' });
		expect(broken.refusals[0]?.code).toBe('MANIFEST_TOML_INVALID');
		expect(broken.trust).toBeUndefined();
	});

	it('reads another manifest path', () => {
		const report = checkApp(
			{ 'manifests/native.toml': NATIVE, 'schemas/in.json': SCHEMA },
			{ manifest: 'manifests/native.toml' }
		);
		expect(report.ok).toBe(true);
		const dotted = checkApp(
			{ 'manifests/native.toml': NATIVE, 'schemas/in.json': SCHEMA },
			{ manifest: './manifests/native.toml' }
		);
		expect(dotted.ok).toBe(true);
	});

	it('reports everything it finds, each key once', () => {
		const toml = NATIVE.replace('schemas/in.json', 'schemas/gone.json').replace(
			'domains = ["hello"]',
			'domains = ["other"]'
		);
		const report = checkApp(files(toml));
		expect(report.refusals.map(({ code }) => code).sort()).toEqual([
			'MANIFEST_DOMAIN_INVALID',
			'MANIFEST_FILE_MISSING',
			'MANIFEST_NAME_DOMAIN',
		]);
	});

	it('warns of an entry not built, and of a resource that declares a CSP', () => {
		const { 'dist/native.js': _built, ...source } = files();
		expect(checkApp(source).warnings.map(({ code }) => code)).toEqual(['ENTRY_NOT_BUILT']);
		const view = `${NATIVE.replace('kind = "native"', 'kind = "view"')
			.replace('[native]\nentry = "dist/native.js"', '[view]\nhandlers = "dist/h.html"')
			.replace(/\[\[commands\]\][\s\S]*/, '')}
[[ui.resources]]
uri = "ui://hello/main"
path = "dist/main.html"
csp = { connectDomains = ["https://example.com"] }
`;
		const report = checkApp({ 'loam-app.toml': view });
		expect(report.warnings.map(({ code }) => code).sort()).toEqual([
			'ENTRY_NOT_BUILT',
			'ENTRY_NOT_BUILT',
			'VIEW_CSP_IGNORED',
		]);
	});

	describe('with the surface validator', () => {
		const surface =
			(rule: string, severity: 'error' | 'warning' | 'info'): SurfaceCheck =>
			(commands) => {
				expect(commands[0]).toMatchObject({
					name: 'hello-greet',
					jsonSchema: JSON.parse(SCHEMA),
				});
				return [
					{ rule, severity, message: 'Found.', commands: ['hello-greet'], suggestion: 'Fix.' },
				];
			};

		it('warns of its findings', () => {
			const report = checkApp(files(), { surface: surface('missing-category', 'warning') });
			expect(report.ok).toBe(true);
			expect(report.warnings[0]).toMatchObject({
				code: 'SURFACE_MISSING_CATEGORY',
				key: 'commands[0]',
			});
		});

		it('fails on an injection finding', () => {
			const report = checkApp(files(), { surface: surface('description-injection', 'error') });
			expect(report.ok).toBe(false);
			expect(report.refusals[0]?.code).toBe('SURFACE_DESCRIPTION_INJECTION');
		});

		it('leaves out what only informs', () => {
			const report = checkApp(files(), { surface: surface('missing-output-schema', 'info') });
			expect(report.warnings).toEqual([]);
		});
	});
});

describe('the /check entry', () => {
	it('bundles for a browser with no Node.js builtin, through its dependencies too', async () => {
		const builtins: string[] = [];
		await build({
			configFile: false,
			logLevel: 'silent',
			plugins: [
				{
					name: 'loam-find-builtins',
					enforce: 'pre',
					resolveId(id) {
						if (id.startsWith('node:') || builtinModules.includes(id)) builtins.push(id);
						return undefined;
					},
				},
			],
			build: {
				write: false,
				lib: {
					entry: fileURLToPath(new URL('./check.ts', import.meta.url)),
					formats: ['es'],
					fileName: 'check',
				},
			},
		});
		expect(builtins).toEqual([]);
	});

	it('imports no Node.js builtin, directly or through this package', () => {
		const seen = new Set<string>();
		const visit = (file: string): void => {
			if (seen.has(file)) return;
			seen.add(file);
			const source = readFileSync(new URL(file, import.meta.url), 'utf8');
			expect(source, file).not.toMatch(/from 'node:/);
			expect(source, file).not.toMatch(/from '@lushly-dev\/afd-testing'/);
			for (const [, relative] of source.matchAll(/from '(\.\/[^']+)\.js'/g))
				visit(`${relative}.ts`);
		};
		visit('./check.ts');
		expect(seen.has('./file-rules.ts')).toBe(true);
	});

	it('warns EXPERIMENT_OVERDUE past ends when now is given, skipping graduated and removed (#2110)', () => {
		const withExperiments = (blocks: string[]) =>
			NATIVE.replace('manifest_version = 1', 'manifest_version = 2').concat(
				'\n[app]\nscope_levels = ["workspace"]\n',
				...blocks.map((block) => `\n[[ui.experiments]]\n${block}\n`)
			);
		const toml = withExperiments([
			'id = "due-visible"\ntitle = "Visible"\nchanges = "Shows a panel."\nends = "2026-11-22"\nstage = "visible"',
			'id = "due-hidden"\ntitle = "Hidden"\nchanges = "Hidden work."\nends = "2026-11-22"\nstage = "hidden"',
			'id = "done-graduated"\ntitle = "Graduated"\nchanges = "Always on."\nends = "2026-11-22"\nstage = "graduated"',
			'id = "done-removed"\ntitle = "Removed"\nchanges = "Gone."\nends = "2026-11-22"\nstage = "removed"',
			'id = "future"\ntitle = "Future"\nchanges = "Later."\nends = "2027-03-01"\nstage = "visible"',
		]);

		// Pure when `now` is omitted (or non-finite): no clock read, no overdue warning.
		expect(checkApp(files(toml)).warnings).toEqual([]);
		expect(checkApp(files(toml), { now: Number.NaN }).warnings).toEqual([]);
		expect(checkApp(files(toml), { now: Number.POSITIVE_INFINITY }).warnings).toEqual([]);
		expect(checkApp(files(toml), { now: Number.NEGATIVE_INFINITY }).warnings).toEqual([]);

		// On `ends` itself (even the last ms of that UTC day): not yet overdue.
		const endStart = Date.parse('2026-11-22T00:00:00Z');
		expect(checkApp(files(toml), { now: endStart }).warnings).toEqual([]);
		expect(checkApp(files(toml), { now: endStart + 86_399_999 }).warnings).toEqual([]);

		// Starting the UTC day after `ends`: warns for visible and hidden, never graduated/removed/future; still ok.
		const overdue = checkApp(files(toml), { now: endStart + 86_400_000 });
		expect(overdue.ok).toBe(true);
		expect(overdue.refusals).toEqual([]);
		expect(overdue.warnings).toEqual([
			expect.objectContaining({
				code: 'EXPERIMENT_OVERDUE',
				key: 'ui.experiments[0].ends',
				message: expect.stringContaining("'hello.due-visible'"),
			}),
			expect.objectContaining({
				code: 'EXPERIMENT_OVERDUE',
				key: 'ui.experiments[1].ends',
				message: expect.stringContaining("'hello.due-hidden'"),
			}),
		]);
	});
});
