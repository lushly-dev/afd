import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSpecimenBench } from './bench.js';
import { loadConfig } from './config.js';
import { runDesignStates } from './design-states.js';
import { designStatesResultSchema } from './schema.js';

describe('design-states', () => {
	let root: string;

	beforeAll(async () => {
		root = await realpath(await mkdtemp(join(tmpdir(), 'specimen-design-states-')));
	});

	afterAll(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it('satisfies Scenario 01, Scenario 09 step 1, and Scenario 10 step 1 on commands-only configs', async () => {
		const dir = join(root, 'bookshop');
		await mkdir(dir, { recursive: true });
		await writeFile(
			join(dir, 'bookshop.commands.json'),
			JSON.stringify({
				app: 'bookshop',
				defaultsVersion: 'afd-defaults@1.0.0',
				consumer: 'bookshop-ui',
				commands: [
					{
						name: 'order-create',
						mutation: true,
						undoable: true,
						errors: [{ code: 'OUT_OF_STOCK', retryable: false }],
					},
					{
						name: 'stock-list',
						returnsCollection: true,
					},
					{
						name: 'catalog-import',
						mutation: true,
						returnsPlan: true,
						executionTime: 'long-running',
					},
					{
						name: 'member-delete',
						mutation: true,
						destructive: true,
						confirmPrompt: 'Delete this member permanently?',
					},
				],
			})
		);
		await writeFile(
			join(dir, 'specimen.config.json'),
			JSON.stringify({
				defaults: 'afd-defaults@1.0.0',
				commandManifest: './bookshop.commands.json',
			})
		);

		const bench = await createSpecimenBench({ root: dir });
		try {
			// Scenario 01 step 1: every error, undo, empty, pending and destructive state named.
			const s1 = await bench.designStates({
				commands: ['order-create', 'stock-list', 'catalog-import', 'member-delete'],
			});
			expect(designStatesResultSchema.safeParse(s1).success).toBe(true);
			expect(s1.defaultsVersion).toBe('afd-defaults@1.0.0');
			expect(s1.states.map((s) => [s.command, s.pattern, s.source, s.approvalStatus])).toEqual([
				['order-create', 'afd-defaults/error-recovery', 'default', 'approved'],
				['order-create', 'afd-defaults/undo-offer', 'default', 'approved'],
				['stock-list', 'afd-defaults/collection-states', 'default', 'approved'],
				['catalog-import', 'afd-defaults/progress-and-plan', 'default', 'approved'],
				['member-delete', 'afd-defaults/destructive-confirm', 'default', 'approved'],
			]);
			expect(s1.states[0]?.setup).toBeTruthy();
			expect(s1.nextSteps[0]).toContain('components-brief');
			expect(s1.nextSteps[0]).toContain('bookshop-ui');

			// Scenario 01 step 2: empty input refused with NO_COMMANDS.
			await expect(bench.designStates({})).rejects.toMatchObject({
				code: 'NO_COMMANDS',
				suggestion: expect.stringContaining('commands'),
			});

			// Scenario 01 step 3: unknown command refused with TARGET_COMMAND_NOT_FOUND.
			await expect(bench.designStates({ commands: ['book-teleport'] })).rejects.toMatchObject({
				code: 'TARGET_COMMAND_NOT_FOUND',
				message: expect.stringContaining('book-teleport'),
				suggestion: expect.stringContaining('manifest'),
			});

			// Scenario 10 step 1: commands-only config succeeds and reports unmeasured screen-gates.
			const s10 = await bench.designStates({ commands: ['order-create'] });
			expect(s10.states[0]?.command).toBe('order-create');
			expect(s10.unmeasured[0]).toMatchObject({
				area: 'screen-gates',
				reason: expect.stringContaining('specimen'),
				addToMeasure: expect.stringContaining('specimen-capture'),
			});
			expect(s10.unmeasured.some((item) => item.area === 'job-scenarios')).toBe(true);
			expect(s10.unmeasured.some((item) => item.area === 'panel-walks')).toBe(true);
		} finally {
			await bench.close();
		}

		// Scenario 09 step 1 with unchanged bookshop.json string-only fixture and unchanged input ['catalog-import'].
		const s9Dir = join(root, 'bookshop-s9');
		await mkdir(s9Dir, { recursive: true });
		await writeFile(
			join(s9Dir, 'bookshop.json'),
			JSON.stringify({
				app: 'bookshop',
				defaultsVersion: 'afd-defaults@1.0.0',
				commands: ['order-create', 'order-cancel', 'stock-list', 'catalog-import', 'member-delete'],
				localLibrary: 'bookshop-ui',
				consumer: 'bookshop-ui',
			})
		);
		await writeFile(
			join(s9Dir, 'specimen.config.json'),
			JSON.stringify({
				defaults: 'afd-defaults@1.0.0',
				commandManifest: './bookshop.json',
			})
		);
		const s9Bench = await createSpecimenBench({ root: s9Dir });
		try {
			const s9 = await s9Bench.designStates({ commands: ['catalog-import'] });
			expect(s9.states[0]).toMatchObject({
				command: 'catalog-import',
				pattern: 'afd-defaults/batch-partial-failure',
				approvalStatus: 'approved',
			});
			expect(s9.nextSteps[0]).toContain('components-brief');
			expect(s9.nextSteps[0]).toContain('bookshop-ui');
		} finally {
			await s9Bench.close();
		}
	});

	it('derives states from string-only manifests, all metadata flags, and explicit states[]', async () => {
		const dir = join(root, 'metadata');
		await mkdir(dir, { recursive: true });
		await writeFile(
			join(dir, 'commands.json'),
			JSON.stringify({
				localLibrary: 'bookshop-ui',
				commands: [
					'order-create',
					'catalog-import',
					'item-list',
					'member-delete',
					'refund-approve',
					'title-suggest',
					'ping-check',
					{
						name: 'price-estimate',
						approval: true,
						returnsAlternatives: true,
						returnsSources: true,
						returnsWarnings: true,
					},
					{
						name: 'custom-flow',
						states: [
							{
								id: 'custom-warn',
								trigger: 'result.warnings.length > 0',
								pattern: 'warnings-banner',
								setup: 'fixtures/custom-warning.json',
							},
							{
								trigger: 'custom.error',
								pattern: 'bookshop-ui/custom-banner',
							},
						],
					},
				],
			})
		);
		await writeFile(
			join(dir, 'specimen.config.json'),
			JSON.stringify({
				commandManifest: './commands.json',
			})
		);

		const loaded = await loadConfig({ root: dir });

		const inferred = await runDesignStates(loaded, {
			commands: [
				'order-create',
				'catalog-import',
				'item-list',
				'member-delete',
				'refund-approve',
				'title-suggest',
				'ping-check',
			],
		});
		expect(inferred.states.map((s) => `${s.command}:${s.pattern}`)).toEqual([
			'order-create:afd-defaults/error-recovery',
			'order-create:afd-defaults/undo-offer',
			'catalog-import:afd-defaults/batch-partial-failure',
			'catalog-import:afd-defaults/progress-and-plan',
			'item-list:afd-defaults/collection-states',
			'member-delete:afd-defaults/destructive-confirm',
			'refund-approve:afd-defaults/approval-request',
			'refund-approve:afd-defaults/error-recovery',
			'title-suggest:afd-defaults/alternatives-and-confidence',
			'title-suggest:afd-defaults/evidence-and-sources',
			'ping-check:afd-defaults/error-recovery',
		]);

		const flagged = await runDesignStates(loaded, { commands: ['price-estimate'] });
		expect(flagged.states.map((s) => s.pattern)).toEqual([
			'afd-defaults/approval-request',
			'afd-defaults/alternatives-and-confidence',
			'afd-defaults/evidence-and-sources',
			'afd-defaults/warnings-banner',
		]);

		const explicit = await runDesignStates(loaded, { commands: ['custom-flow'] });
		expect(explicit.states).toEqual([
			{
				id: 'custom-warn',
				command: 'custom-flow',
				trigger: 'result.warnings.length > 0',
				pattern: 'afd-defaults/warnings-banner',
				source: 'default',
				approvalStatus: 'approved',
				setup: 'fixtures/custom-warning.json',
			},
			{
				id: 'custom-banner',
				command: 'custom-flow',
				trigger: 'custom.error',
				pattern: 'bookshop-ui/custom-banner',
				source: 'product',
				approvalStatus: 'approved',
				setup: 'command:custom-flow (custom-banner)',
			},
		]);
	});

	it('parses indented, indentless, and nested-input YAML scenarios, handles collision-free pagination, checks real evidence, and respects manifest.localLibrary', async () => {
		const dir = join(root, 'scenario-paging');
		await mkdir(join(dir, 'scenarios'), { recursive: true });
		// Empty directories must NOT suppress screen-gates or panel-walks in unmeasured!
		await mkdir(join(dir, '.specimen', 'sets'), { recursive: true });
		await mkdir(join(dir, '.specimen', 'walks'), { recursive: true });
		await writeFile(
			join(dir, 'commands.json'),
			JSON.stringify({
				localLibrary: 'bookshop-ui',
				consumer: 'bookshop-ui',
				commands: [
					'order-create',
					'stock-list',
					'catalog-import',
					'member-delete',
					{
						name: 'collision-cmd',
						states: [
							{ id: 'x', trigger: 't1', pattern: 'error-recovery' },
							{ id: 'x', trigger: 't2', pattern: 'undo-offer' },
							{ id: 'x:2', trigger: 't3', pattern: 'warnings-banner' },
							{ id: 'z', trigger: 't4', pattern: 'progress-and-plan' },
						],
					},
				],
			})
		);
		await writeFile(
			join(dir, 'scenarios', 'checkout.scenario.yaml'),
			`name: Checkout flow
steps: # trailing comment
  - description: Create an order
    command: order-create
    input:
      description: Nested description must not overwrite step description
      command: member-delete
      items:
        - command: member-delete
          sku: book-1
  - command: stock-list
    description: Refresh inventory
  - command: order-create
`
		);
		await writeFile(
			join(dir, 'scenarios', 'indentless.scenario.yaml'),
			`name: Indentless sequence
steps:
- command: order-create
  description: First indentless step
- command: stock-list
`
		);
		await writeFile(join(dir, 'scenarios', 'empty.scenario.yaml'), `name: Empty\nsteps:\n`);
		await writeFile(
			join(dir, 'scenarios', 'import.json'),
			JSON.stringify({ commands: ['catalog-import', 'member-delete'] })
		);
		await writeFile(join(dir, 'placeholder.js'), 'export const Placeholder = {};');
		await writeFile(
			join(dir, 'specimen.config.json'),
			JSON.stringify({
				defaults: 'afd-defaults@1.0.0',
				commandManifest: './commands.json',
				specimens: [
					{
						id: 'placeholder',
						title: 'Placeholder',
						module: './placeholder.js',
						exportName: 'Placeholder',
					},
				],
			})
		);

		const loaded = await loadConfig({ root: dir });
		// Simulate a local proposed copied pattern bound via patternBindings using manifest.localLibrary.
		(loaded.config as { patternBindings?: Record<string, string> }).patternBindings = {
			'afd-defaults/error-recovery': 'bookshop-ui/error-recovery',
		};
		loaded.patterns = {
			patterns: [
				{
					pattern: 'error-recovery',
					scope: 'composition',
					approvalStatus: 'proposed',
					derivedFrom: { library: 'afd-defaults', pattern: 'error-recovery', version: '1.0.0' },
				} as unknown as NonNullable<typeof loaded.patterns>['patterns'][number],
			],
			external: {},
			sources: [],
			storySetups: {},
			problems: [],
			files: [],
		};

		// Nested input.items / input.description / input.command do NOT corrupt step parsing.
		const page1 = await runDesignStates(loaded, {
			scenario: './scenarios/checkout.scenario.yaml',
			limit: 2,
		});
		expect(page1.states).toHaveLength(2);
		expect(page1.states[0]).toMatchObject({
			command: 'order-create',
			pattern: 'afd-defaults/error-recovery',
			source: 'default',
			approvalStatus: 'approved',
			setup: './scenarios/checkout.scenario.yaml#step-1: Create an order',
		});
		expect(page1.next).toBe('s:2');
		expect(page1.nextSteps.some((step) => step.includes(`after: '${page1.next}'`))).toBe(true);
		expect(page1.unmeasured.some((u) => u.area === 'job-scenarios')).toBe(false);
		// Empty sets and walks dirs still leave screen-gates and panel-walks unmeasured.
		expect(page1.unmeasured.some((u) => u.area === 'screen-gates')).toBe(true);
		expect(page1.unmeasured.some((u) => u.area === 'panel-walks')).toBe(true);

		const page2 = await runDesignStates(loaded, {
			scenario: './scenarios/checkout.scenario.yaml',
			limit: 2,
			after: page1.next,
		});
		expect(page2.states).toHaveLength(1);
		expect(page2.states[0]?.command).toBe('stock-list');
		expect(page2.next).toBeUndefined();

		// Indentless YAML sequence parses cleanly.
		const indentless = await runDesignStates(loaded, {
			scenario: './scenarios/indentless.scenario.yaml',
		});
		expect(indentless.states.map((s) => s.command)).toEqual([
			'order-create',
			'order-create',
			'stock-list',
		]);

		// Collision-free pagination over state ids ['x', 'x', 'x:2', 'z'] with limit: 1 terminates cleanly.
		const collectedIds: string[] = [];
		let cursor: string | undefined;
		for (let guard = 0; guard < 10; guard++) {
			const res = await runDesignStates(loaded, {
				commands: ['collision-cmd'],
				limit: 1,
				...(cursor ? { after: cursor } : {}),
			});
			collectedIds.push(...res.states.map((s) => `${s.id}:${s.trigger}`));
			cursor = res.next;
			if (!cursor) break;
		}
		expect(collectedIds).toEqual(['x:t1', 'x:t2', 'x:2:t3', 'z:t4']);

		// Once a real walk record exists, panel-walks drops from unmeasured.
		await writeFile(join(dir, '.specimen', 'walks', 'walk-000000000001.json'), '{}');
		const withWalk = await runDesignStates(loaded, { commands: ['order-create'] });
		expect(withWalk.unmeasured.some((u) => u.area === 'panel-walks')).toBe(false);

		// includeProposed: true surfaces the proposed localLibrary copy.
		const withProposed = await runDesignStates(loaded, {
			commands: ['order-create'],
			includeProposed: true,
		});
		expect(withProposed.states[0]).toMatchObject({
			pattern: 'bookshop-ui/error-recovery',
			source: 'copied',
			approvalStatus: 'proposed',
		});

		// JSON scenario works too.
		const jsonRes = await runDesignStates(loaded, {
			scenario: './scenarios/import.json',
		});
		expect(jsonRes.states.map((s) => s.command)).toEqual([
			'catalog-import',
			'catalog-import',
			'member-delete',
		]);

		// Error paths: empty scenario, unknown cursor, missing scenario, escaping scenario.
		await expect(
			runDesignStates(loaded, { scenario: './scenarios/empty.scenario.yaml' })
		).rejects.toMatchObject({ code: 'NO_COMMANDS' });
		await expect(
			runDesignStates(loaded, { commands: ['order-create'], after: 'missing:cursor' })
		).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
		await expect(
			runDesignStates(loaded, { scenario: './scenarios/missing.scenario.yaml' })
		).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
		await expect(
			runDesignStates(loaded, { scenario: '../../outside.scenario.yaml' })
		).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
	});

	it('turns malformed JSON, null JSON, directories, invalid manifest entries, and unsupported defaults into typed VALIDATION_ERROR without leaking absolute paths', async () => {
		const dir = join(root, 'errors');
		await mkdir(join(dir, 'subdir'), { recursive: true });
		await writeFile(join(dir, 'bad.json'), '{ not json');
		await writeFile(join(dir, 'null.json'), 'null');
		await writeFile(join(dir, 'bad-entry.json'), JSON.stringify({ commands: [null] }));
		await writeFile(join(dir, 'empty-obj.json'), JSON.stringify({ commands: [{}] }));
		await writeFile(join(dir, 'ok.json'), JSON.stringify({ commands: ['order-create'] }));
		await writeFile(
			join(dir, 'specimen.config.json'),
			JSON.stringify({ commandManifest: './ok.json' })
		);

		const loaded = await loadConfig({ root: dir });

		for (const scenario of ['./bad.json', './null.json', './subdir']) {
			await expect(runDesignStates(loaded, { scenario })).rejects.toMatchObject({
				code: 'VALIDATION_ERROR',
				message: expect.not.stringContaining(dir),
			});
		}

		for (const manifest of [
			'./bad.json',
			'./null.json',
			'./subdir',
			'./bad-entry.json',
			'./empty-obj.json',
		]) {
			loaded.config.commandManifest = manifest;
			await expect(runDesignStates(loaded, { commands: ['order-create'] })).rejects.toMatchObject({
				code: 'VALIDATION_ERROR',
				message: expect.not.stringContaining(dir),
			});
		}

		loaded.config.commandManifest = './ok.json';
		loaded.config.defaults = 'afd-defaults@9.9.9';
		await expect(runDesignStates(loaded, { commands: ['order-create'] })).rejects.toMatchObject({
			code: 'VALIDATION_ERROR',
			suggestion: expect.stringContaining('afd-defaults@1.0.0'),
		});
	});
});
