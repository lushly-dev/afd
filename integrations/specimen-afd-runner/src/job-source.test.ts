import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { InProcessExecutor, parseScenarioFile } from '@lushly-dev/afd-testing';
import {
	type JobSourceContext,
	type SpecimenEntry,
	validateJobEntries,
} from '@lushly-dev/specimen';
import { describe, expect, it } from 'vitest';
import { createNotesCommandHandler } from '../fixtures/notes-app.js';
import {
	AFD_JOB_SOURCE_ID,
	afdJobSource,
	buildJobCaptures,
	JobScenarioError,
	parseAfdJobScenario,
	slugifyStepDescription,
	validateAfdJobEntry,
} from './job-source.js';

const fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures');

function makeEntry(overrides: Partial<SpecimenEntry> = {}): SpecimenEntry {
	return {
		id: 'notes-keep-a-draft',
		title: 'Notes/Keep a draft',
		module: './app.specimens.ts',
		exportName: 'NotesApp',
		job: {
			scenario: './scenarios/keep-a-draft.scenario.yaml',
			target: 'app',
			captures: [
				{ after: 'The note opens beside itself', name: 'two-editors' },
				{ after: 'Another writer saves the note', name: 'conflict-notice' },
			],
		},
		...overrides,
	};
}

function makeMemoryContext(
	files: Record<string, string>,
	entry: SpecimenEntry = makeEntry(),
	scenarioPath = entry.job?.scenario ?? './scenarios/keep-a-draft.scenario.yaml'
): JobSourceContext {
	const normalized = new Map<string, string>();
	for (const [key, value] of Object.entries(files)) {
		normalized.set(key.replace(/^\.\//, ''), value);
	}
	return {
		root: '/virtual-root',
		base: '/virtual-root',
		entry,
		scenarioPath,
		async read(relativePath: string): Promise<string> {
			const key = relativePath.replace(/^\.\//, '');
			const content = normalized.get(key);
			if (content === undefined) {
				throw new Error(`Missing virtual file '${relativePath}'`);
			}
			return content;
		},
	};
}

describe('afdJobSource', () => {
	it('declares its default id, version, and YAML extension filter', () => {
		const source = afdJobSource();
		expect(source.id).toBe(AFD_JOB_SOURCE_ID);
		expect(source.version).toMatch(/^\d+\.\d+\.\d+/);
		const entry = makeEntry();
		expect(source.supports?.('scenarios/keep-a-draft.scenario.yaml', entry)).toBe(true);
		expect(source.supports?.('scenarios/keep-a-draft.yml', entry)).toBe(true);
		expect(source.supports?.('scenarios/keep-a-draft.json', entry)).toBe(false);
	});

	it('parses AFD .scenario.yaml and merges base, file, and overrides fixtures through context.read', async () => {
		const source = afdJobSource();
		const scenarioPath = './scenarios/keep-a-draft.scenario.yaml';
		const context: JobSourceContext = {
			root: fixturesDir,
			base: fixturesDir,
			entry: makeEntry(),
			scenarioPath,
			read: (relativePath) => readFile(join(fixturesDir, relativePath), 'utf8'),
		};

		const jobScenario = await source.parseScenario(context);
		expect(jobScenario.job).toBe('keep-a-draft');
		expect(jobScenario.steps).toHaveLength(5);
		expect(jobScenario.steps[0]).toMatchObject({
			step: 1,
			description: 'A note is created',
			command: 'note-create',
		});
		expect(jobScenario.fixture).toEqual({
			app: 'notes-demo',
			description: 'Notes workspace fixture overriding the base',
			setup: [{ command: 'note-seed', input: { workspace: 'team-vault' } }],
		});
	});

	it('rejects prototype-polluting fixture keys, invalid JSON, and absolute fixture paths with JOB_SCENARIO_INVALID', async () => {
		const source = afdJobSource();
		const yamlWithFixture = `name: Bad fixture
description: Checks fixture safety
job: bad-fixture
fixture:
  file: ../fixtures/bad.json
steps:
  - description: Step one
    command: note-noop
    expect:
      success: true
`;

		await expect(
			source.parseScenario(
				makeMemoryContext(
					{
						'scenarios/bad.scenario.yaml': yamlWithFixture,
						'fixtures/bad.json': '{ invalid json',
					},
					makeEntry({
						job: { scenario: './scenarios/bad.scenario.yaml', target: 'app', captures: [] },
					})
				)
			)
		).rejects.toMatchObject({ code: 'JOB_SCENARIO_INVALID' });

		const protoYaml = `name: Proto fixture
description: Checks prototype pollution guard
job: proto-fixture
fixture:
  file: ../fixtures/base.json
  overrides:
    __proto__:
      polluted: true
steps:
  - description: Step one
    command: note-noop
    expect:
      success: true
`;
		await expect(
			source.parseScenario(
				makeMemoryContext(
					{
						'scenarios/proto.scenario.yaml': protoYaml,
						'fixtures/base.json': '{"app": "custom"}',
					},
					makeEntry({
						job: { scenario: './scenarios/proto.scenario.yaml', target: 'app', captures: [] },
					})
				)
			)
		).rejects.toMatchObject({ code: 'JOB_SCENARIO_INVALID' });

		const absYaml = `name: Absolute fixture
description: Rejects absolute fixture path
job: abs-fixture
fixture:
  file: /etc/passwd
steps:
  - description: Step one
    command: note-noop
    expect:
      success: true
`;
		await expect(
			source.parseScenario(
				makeMemoryContext(
					{ 'scenarios/abs.scenario.yaml': absYaml },
					makeEntry({
						job: { scenario: './scenarios/abs.scenario.yaml', target: 'app', captures: [] },
					})
				)
			)
		).rejects.toMatchObject({ code: 'JOB_SCENARIO_INVALID' });

		// Backslash-prefixed path must also be rejected consistently on all platforms.
		const backslashYaml = `name: Backslash fixture
description: Rejects leading backslash fixture path
job: backslash-fixture
fixture:
  file: '\\\\etc\\\\passwd'
steps:
  - description: Step one
    command: note-noop
    expect:
      success: true
`;
		await expect(
			source.parseScenario(
				makeMemoryContext(
					{ 'scenarios/backslash.scenario.yaml': backslashYaml },
					makeEntry({
						job: { scenario: './scenarios/backslash.scenario.yaml', target: 'app', captures: [] },
					})
				)
			)
		).rejects.toMatchObject({ code: 'JOB_SCENARIO_INVALID' });

		// Forbidden keys in standalone, base, nested object, and array-embedded fixture objects.
		const standaloneYaml = `name: Standalone proto
description: Rejects forbidden key in standalone fixture
job: standalone-proto
fixture:
  file: ../fixtures/bad-standalone.json
steps:
  - description: Step one
    command: note-noop
    expect:
      success: true
`;
		await expect(
			source.parseScenario(
				makeMemoryContext(
					{
						'scenarios/standalone.scenario.yaml': standaloneYaml,
						'fixtures/bad-standalone.json': '{"app": "custom", "__proto__": {"polluted": true}}',
					},
					makeEntry({
						job: { scenario: './scenarios/standalone.scenario.yaml', target: 'app', captures: [] },
					})
				)
			)
		).rejects.toMatchObject({ code: 'JOB_SCENARIO_INVALID' });

		const baseProtoYaml = `name: Base proto
description: Rejects forbidden key in base fixture
job: base-proto
fixture:
  file: ../fixtures/child.json
  base: ./bad-base.json
steps:
  - description: Step one
    command: note-noop
    expect:
      success: true
`;
		await expect(
			source.parseScenario(
				makeMemoryContext(
					{
						'scenarios/base-proto.scenario.yaml': baseProtoYaml,
						'fixtures/child.json': '{"app": "custom"}',
						'fixtures/bad-base.json': '{"setup": [{"input": {"constructor": {"x": 1}}}]}',
					},
					makeEntry({
						job: { scenario: './scenarios/base-proto.scenario.yaml', target: 'app', captures: [] },
					})
				)
			)
		).rejects.toMatchObject({ code: 'JOB_SCENARIO_INVALID' });

		const nestedOverrideYaml = `name: Nested override proto
description: Rejects forbidden key inside newly introduced nested override object
job: nested-override-proto
fixture:
  file: ../fixtures/base.json
  overrides:
    nested:
      __proto__:
        polluted: true
steps:
  - description: Step one
    command: note-noop
    expect:
      success: true
`;
		await expect(
			source.parseScenario(
				makeMemoryContext(
					{
						'scenarios/nested-proto.scenario.yaml': nestedOverrideYaml,
						'fixtures/base.json': '{"app": "custom"}',
					},
					makeEntry({
						job: {
							scenario: './scenarios/nested-proto.scenario.yaml',
							target: 'app',
							captures: [],
						},
					})
				)
			)
		).rejects.toMatchObject({ code: 'JOB_SCENARIO_INVALID' });
	});

	it('rejects scenario-level timeout and unsupported fields with JOB_SCENARIO_INVALID', () => {
		const timeoutYaml = `name: Timed
description: Has a scenario timeout
job: timed-job
timeout: 50
steps:
  - description: Step one
    command: note-noop
    expect:
      success: true
`;
		expect(() => parseAfdJobScenario(timeoutYaml, { scenarioPath: 'timed.scenario.yaml' })).toThrow(
			JobScenarioError
		);
		try {
			parseAfdJobScenario(timeoutYaml, { scenarioPath: 'timed.scenario.yaml' });
		} catch (error) {
			expect((error as JobScenarioError).code).toBe('JOB_SCENARIO_INVALID');
			expect((error as JobScenarioError).message).toContain('timeout');
		}

		const isolationYaml = `name: Isolated
description: Has unsupported isolation
job: iso-job
isolation: chained
steps:
  - description: Step one
    command: note-noop
    expect:
      success: true
`;
		expect(() => parseAfdJobScenario(isolationYaml)).toThrowError(/'isolation' is not supported/i);
	});

	it('throws JOB_SCENARIO_INVALID for invalid YAML or missing required AFD scenario fields', () => {
		expect(() => parseAfdJobScenario('name: Broken\nsteps: []\n')).toThrow(JobScenarioError);
		try {
			parseAfdJobScenario('name: Broken\nsteps: []\n', { scenarioPath: 'broken.scenario.yaml' });
		} catch (error) {
			expect(error).toBeInstanceOf(JobScenarioError);
			expect((error as JobScenarioError).code).toBe('JOB_SCENARIO_INVALID');
			expect((error as JobScenarioError).suggestion).toContain('broken.scenario.yaml');
		}
	});

	it('surfaces CAPTURE_STEP_UNKNOWN, CAPTURE_STEP_AMBIGUOUS, JOB_SCENARIO_INVALID, and STEP_HAS_NO_DESCRIPTION via Specimen validateJobEntries', async () => {
		const source = afdJobSource();
		const validYaml = `name: Demo
description: Demo scenario
job: demo-job
steps:
  - description: First step
    command: note-create
    expect:
      success: true
  - description: Repeated step
    command: note-noop
    expect:
      success: true
  - description: Repeated step
    command: note-noop
    expect:
      success: true
`;
		const undescribedYaml = `name: Undescribed
description: No step descriptions
job: undescribed-job
steps:
  - command: note-create
    expect:
      success: true
`;
		const mixedBlankYaml = `name: Mixed blank
description: One blank step description and one named step
job: mixed-blank-job
steps:
  - description: "   "
    command: note-create
    expect:
      success: true
  - description: Named step
    command: note-noop
    expect:
      success: true
`;

		const entries: SpecimenEntry[] = [
			makeEntry({
				id: 'unknown-capture',
				job: {
					scenario: './scenarios/valid.scenario.yaml',
					target: 'app',
					captures: [{ after: 'No such step', name: 'missing' }],
				},
			}),
			makeEntry({
				id: 'ambiguous-capture',
				job: {
					scenario: './scenarios/valid.scenario.yaml',
					target: 'app',
					captures: [{ after: 'Repeated step', name: 'ambiguous' }],
				},
			}),
			makeEntry({
				id: 'invalid-yaml',
				job: {
					scenario: './scenarios/broken.scenario.yaml',
					target: 'app',
					captures: [{ after: 'Anything', name: 'broken' }],
				},
			}),
			makeEntry({
				id: 'no-description',
				job: {
					scenario: './scenarios/undescribed.scenario.yaml',
					target: 'app',
					captures: [{ after: 'First step', name: 'first' }],
				},
			}),
			makeEntry({
				id: 'blank-description',
				job: {
					scenario: './scenarios/mixed-blank.scenario.yaml',
					target: 'app',
					captures: [{ after: '   ', name: 'blank' }],
				},
			}),
		];

		// Use a real temp folder via validateJobEntries to exercise Specimen's full root containment + JobSource integration.
		const { mkdtemp, mkdir, rm, writeFile } = await import('node:fs/promises');
		const { tmpdir } = await import('node:os');
		const scratch = await mkdtemp(join(tmpdir(), 'specimen-afd-runner-validate-'));
		try {
			await mkdir(join(scratch, 'scenarios'), { recursive: true });
			await writeFile(join(scratch, 'scenarios/valid.scenario.yaml'), validYaml, 'utf8');
			await writeFile(join(scratch, 'scenarios/broken.scenario.yaml'), 'not: [valid\n', 'utf8');
			await writeFile(
				join(scratch, 'scenarios/undescribed.scenario.yaml'),
				undescribedYaml,
				'utf8'
			);
			await writeFile(join(scratch, 'scenarios/mixed-blank.scenario.yaml'), mixedBlankYaml, 'utf8');

			const validation = await validateJobEntries(entries, [source], scratch, scratch);
			const byId = new Map(validation.issues.map((issue) => [issue.id, issue]));

			expect(byId.get('unknown-capture')?.code).toBe('CAPTURE_STEP_UNKNOWN');
			expect(byId.get('unknown-capture')?.suggestion).toBeTruthy();

			expect(byId.get('ambiguous-capture')?.code).toBe('CAPTURE_STEP_AMBIGUOUS');
			expect(byId.get('ambiguous-capture')?.suggestion).toBeTruthy();

			expect(byId.get('invalid-yaml')?.code).toBe('JOB_SCENARIO_INVALID');
			expect(byId.get('invalid-yaml')?.suggestion).toBeTruthy();

			expect(byId.get('no-description')?.code).toBe('STEP_HAS_NO_DESCRIPTION');
			expect(byId.get('no-description')?.suggestion).toBeTruthy();

			expect(byId.get('blank-description')?.code).toBe('STEP_HAS_NO_DESCRIPTION');
			expect(byId.get('blank-description')?.suggestion).toBeTruthy();
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	});

	it('builds capture points and validates step selection errors', () => {
		const scenario = parseAfdJobScenario(`name: Build captures
description: Tests buildJobCaptures
job: build-captures
steps:
  - description: A note is created
    command: note-create
    expect:
      success: true
  - command: note-noop
    expect:
      success: true
  - description: Duplicate step
    command: note-noop
    expect:
      success: true
  - description: Duplicate step
    command: note-noop
    expect:
      success: true
`);

		expect(buildJobCaptures(scenario, [1])).toEqual([
			{ after: 'A note is created', name: 'a-note-is-created' },
		]);
		expect(
			buildJobCaptures(scenario, [
				{
					step: 1,
					name: 'created',
					before: [{ action: { fill: 'draft', value: 'hi' } }],
				},
			])
		).toEqual([
			{
				after: 'A note is created',
				name: 'created',
				before: [{ action: { fill: 'draft', value: 'hi' } }],
			},
		]);

		expect(() => buildJobCaptures(scenario, [])).toThrowError(/At least one capture step/);
		expect(() => buildJobCaptures(scenario, [99])).toThrowError(/does not exist/);
		expect(() => buildJobCaptures(scenario, [2])).toThrowError(/has no description/);
		expect(() => buildJobCaptures(scenario, [3])).toThrowError(/matches 2 steps/);
		expect(() => buildJobCaptures(scenario, [1, 1])).toThrowError(/selected more than once/);
		expect(() => buildJobCaptures(scenario, [{ step: 1, name: '' }])).toThrowError(
			/Capture name '' for step 1 is invalid/
		);
		expect(() => buildJobCaptures(scenario, [{ step: 1, name: 'my capture' }])).toThrowError(
			/Capture name 'my capture' for step 1 is invalid/
		);
		expect(slugifyStepDescription('  Café — Open #1!  ')).toBe('cafe-open-1');
		expect(slugifyStepDescription('!!!', 4)).toBe('step-4');

		expect(() => validateAfdJobEntry(makeEntry({ job: undefined }), scenario)).toThrowError(
			/not a job specimen/
		);
	});

	it('runs the consuming keep-a-draft scenario headless without a browser via afd-testing', async () => {
		const scenarioPath = join(fixturesDir, 'scenarios/keep-a-draft.scenario.yaml');
		const parsed = await parseScenarioFile(scenarioPath);
		expect(parsed.success).toBe(true);
		if (!parsed.success) return;

		const app = createNotesCommandHandler();
		const executor = new InProcessExecutor({
			handler: (command, input) => app.call(command, input),
			basePath: fixturesDir,
		});
		const result = await executor.execute(parsed.scenario);

		expect(result.outcome).toBe('pass');
		expect(result.passedSteps).toBe(5);
		expect(result.failedSteps).toBe(0);
		expect(app.state.workspace).toBe('team-vault');
	});
});
