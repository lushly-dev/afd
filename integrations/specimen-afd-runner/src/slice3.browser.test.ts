import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { CommandResult } from '@lushly-dev/afd-core/result';
import { InProcessExecutor, parseScenarioFile } from '@lushly-dev/afd-testing';
import { createSpecimenBench, type SpecimenBench } from '@lushly-dev/specimen';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageRoot, '../..');
const pluginUrl = pathToFileURL(resolve(packageRoot, 'dist/index.js')).href;
const jobSourceUrl = pathToFileURL(resolve(packageRoot, 'dist/job-source.js')).href;
const specimenAfdUrl = pathToFileURL(
	resolve(repoRoot, 'integrations/specimen-afd/dist/index.js')
).href;
const canonicalSlice3ScenarioPath = resolve(
	repoRoot,
	'docs/features/complete/screens-from-jobs/scenarios/11-find-what-no-job-reaches.scenario.yaml'
);

type ExecuteSpecimenCommand = (
	bench: SpecimenBench,
	name: string,
	input: unknown
) => Promise<CommandResult<unknown>>;

const APP_MODULE_SOURCE = `
if (!customElements.get('example-notice')) {
	class ExampleNotice extends HTMLElement {}
	customElements.define('example-notice', ExampleNotice);
}
if (!customElements.get('example-banner')) {
	class ExampleBanner extends HTMLElement {}
	customElements.define('example-banner', ExampleBanner);
}
if (!customElements.get('example-chip')) {
	class ExampleChip extends HTMLElement {}
	customElements.define('example-chip', ExampleChip);
}

export const NotesApp = {
	targets: {
		app: { selector: '#notes-app' },
		'second-editor': { selector: '#second-editor' },
	},
	render: () => {
		const root = document.createElement('div');
		root.id = 'notes-app';
		const input = document.createElement('input');
		input.id = 'second-editor';
		const slot = document.createElement('div');
		slot.id = 'status';
		let nextId = 1;
		const notes = new Map();
		root.call = async (name, payload = {}) => {
			if (name === 'document-create') {
				const id = 'doc-' + nextId++;
				notes.set(id, { title: payload.title || 'Untitled' });
				return { success: true, data: { id } };
			}
			if (name === 'document-open') {
				return { success: true, data: { id: payload.id, open: true } };
			}
			if (name === 'notes-content-set') {
				slot.replaceChildren();
				if (input.value.length > 0) {
					const notice = document.createElement('example-notice');
					notice.setAttribute('variant', 'warning');
					notice.textContent = 'This note changed elsewhere';
					const chip = document.createElement('example-chip');
					chip.setAttribute('size', 'medium');
					chip.textContent = 'Draft kept';
					slot.append(notice, chip);
				}
				return { success: true, data: { id: payload.id, saved: true } };
			}
			return {
				success: false,
				error: { code: 'UNKNOWN', message: 'Unknown ' + name, suggestion: 'Check command.' },
			};
		};
		root.append(input, slot);
		return root;
	},
};

export const BannerIsolated = {
	render: () => {
		const banner = document.createElement('example-banner');
		banner.setAttribute('tone', 'info');
		banner.textContent = 'Isolated banner only';
		return banner;
	},
};
`;

const KEEP_A_DRAFT_YAML = `name: Keep a draft
description: Keep an unsaved draft when another writer saves the note
job: keep-a-draft
steps:
  - description: A note is created
    command: document-create
    input:
      title: Meeting notes
    expect:
      success: true
  - description: The note opens
    command: document-open
    input:
      id: \${{ steps[0].data.id }}
    expect:
      success: true
  - description: The note opens beside itself
    command: document-open
    input:
      id: \${{ steps[0].data.id }}
      group: beside
    expect:
      success: true
  - description: Another writer saves the note
    command: notes-content-set
    input:
      id: \${{ steps[0].data.id }}
      content: External update
    expect:
      success: true
`;

describe('Screens from Jobs Slice 3 end-to-end verification (Job 11: find-what-no-job-reaches)', () => {
	let root: string;
	let bench: SpecimenBench;

	beforeAll(async () => {
		root = await mkdtemp(join(tmpdir(), 'specimen-slice3-'));
		await mkdir(join(root, 'example/scenarios'), { recursive: true });
		await writeFile(
			join(root, 'afd.plugin.mjs'),
			`import { afdRunner } from ${JSON.stringify(pluginUrl)};\nexport default afdRunner();\n`,
			'utf8'
		);
		await writeFile(
			join(root, 'afd.job-source.mjs'),
			`export { default } from ${JSON.stringify(jobSourceUrl)};\n`,
			'utf8'
		);
		await writeFile(join(root, 'app.specimens.mjs'), APP_MODULE_SOURCE, 'utf8');
		await writeFile(join(root, 'example/scenarios/keep-a-draft.scenario.yaml'), KEEP_A_DRAFT_YAML);
		await writeFile(
			join(root, 'custom-elements.json'),
			JSON.stringify(
				{
					schemaVersion: '1.0.0',
					modules: [
						{
							path: 'src/components.ts',
							declarations: [
								{
									tagName: 'example-notice',
									members: [
										{
											kind: 'field',
											name: 'variant',
											attribute: 'variant',
											type: { text: "'warning' | 'error'" },
										},
									],
								},
								{
									tagName: 'example-banner',
									members: [
										{
											kind: 'field',
											name: 'tone',
											attribute: 'tone',
											type: { text: "'info' | 'alert'" },
										},
									],
								},
								{
									tagName: 'example-chip',
									members: [
										{
											kind: 'field',
											name: 'size',
											attribute: 'size',
											type: { text: "'small' | 'medium'" },
										},
									],
								},
							],
						},
					],
				},
				null,
				2
			),
			'utf8'
		);
		await writeFile(
			join(root, 'specimen.config.json'),
			JSON.stringify(
				{
					manifest: './custom-elements.json',
					plugins: ['./afd.plugin.mjs'],
					jobSources: ['./afd.job-source.mjs'],
					coverage: {
						waivers: {
							version: '2026-11-23',
							entries: [
								{
									component: 'example-chip',
									obligation: 'unreached:size=small',
									reason: 'Small chips appear only in a settings dialog no job opens.',
								},
							],
						},
					},
					specimens: [
						{
							id: 'example-banner-isolated',
							title: 'Example/Banner',
							module: './app.specimens.mjs',
							exportName: 'BannerIsolated',
							component: 'example-banner',
						},
						{
							id: 'example-keep-a-draft',
							title: 'Example/Notes/Keep a draft',
							module: './app.specimens.mjs',
							exportName: 'NotesApp',
							job: {
								scenario: 'example/scenarios/keep-a-draft.scenario.yaml',
								target: 'app',
								pin: { clock: '2026-03-02T09:00:00Z' },
								captures: [
									{ after: 'The note opens beside itself', name: 'two-editors' },
									{
										after: 'Another writer saves the note',
										name: 'conflict-notice',
										before: [{ action: { fill: 'second-editor', value: ' draft' } }],
									},
								],
							},
						},
					],
				},
				null,
				2
			),
			'utf8'
		);
		bench = await createSpecimenBench({ root });
	}, 60_000);

	afterAll(async () => {
		await bench?.close();
		if (root) await rm(root, { recursive: true, force: true });
	});

	it('Job 11 (find-what-no-job-reaches): captures mixed main set in Chromium and passes all 3 Slice 3 steps with zero browser launch', async () => {
		// Capture isolated banner + keep-a-draft job into label `main`.
		const captured = await bench.captureSet({ label: 'main', axe: false });
		expect(captured.counts.captured).toBe(3); // 1 isolated banner + 2 job captures
		expect(captured.skipped.jobs).toBe(0);

		// Open a browserless bench to prove jobs@1 coverage reads the set with zero browser launch,
		// executing the canonical repository scenario YAML through the real specimen-afd command surface.
		const browserless = await createSpecimenBench({
			root,
			executablePath: join(root, 'no-browser-here'),
		});
		try {
			const { executeSpecimenCommand } = (await import(specimenAfdUrl)) as {
				executeSpecimenCommand: ExecuteSpecimenCommand;
			};
			const parsed = await parseScenarioFile(canonicalSlice3ScenarioPath);
			expect(parsed.success).toBe(true);
			if (!parsed.success) return;

			const executor = new InProcessExecutor({
				handler: (command, input) => executeSpecimenCommand(browserless, command, input ?? {}),
			});

			const result = await executor.execute(parsed.scenario);
			expect(result.outcome).toBe('pass');
			expect(result.passedSteps).toBe(3);
			expect(result.failedSteps).toBe(0);
		} finally {
			await browserless.close();
		}
	}, 120_000);
});
