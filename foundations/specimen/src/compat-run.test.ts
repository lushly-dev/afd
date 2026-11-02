import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSpecimenBench } from './bench.js';
import type { StoryRun } from './types.js';

// The two runners over the same retained stories: Storybook's Vitest addon, the incumbent, and
// Specimen's compatibility runtime. Every story must end the same way in both, for the same
// kind of reason, and each fixture must end the way it was written to.
const run = promisify(execFile);
const compat = resolve(import.meta.dirname, '../compat');
const vitest = resolve(import.meta.dirname, '../node_modules/.bin/vitest');
let scratch: string;

interface IncumbentTest {
	file: string;
	name: string;
	status: 'passed' | 'failed' | 'skipped';
	accessibility: boolean;
	message: string;
}

/** Storybook's Vitest run of one fixture project, test by test. */
async function incumbent(project: string): Promise<IncumbentTest[]> {
	const output = join(scratch, `${project.replaceAll('/', '-') || 'compat'}.json`);
	const cwd = join(compat, project);
	// Spawned tools must not inherit a hook's Git environment.
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
	);
	try {
		await run(
			vitest,
			['run', '--config', 'vitest.config.ts', '--reporter=json', `--outputFile=${output}`],
			{
				cwd,
				env: { ...env, STORYBOOK_DISABLE_TELEMETRY: '1' },
			}
		);
	} catch {
		// Failing fixtures fail the run; the report says which.
	}
	const report = JSON.parse(await readFile(output, 'utf8')) as {
		testResults: {
			name: string;
			assertionResults: { title: string; status: string; failureMessages: string[] }[];
		}[];
	};
	return report.testResults.flatMap((file) =>
		file.assertionResults.map((test) => ({
			file: `./${relative(cwd, file.name).replaceAll('\\', '/')}`,
			name: test.title,
			status: test.status as IncumbentTest['status'],
			accessibility: test.failureMessages.some((message) => message.includes('toHaveNoViolations')),
			message: test.failureMessages[0]?.split('\n')[0] ?? '',
		}))
	);
}

/** Specimen's run of every story the same project discovers. */
async function candidate(
	project: string
): Promise<{ file: string; name: string; run: StoryRun }[]> {
	const bench = await createSpecimenBench({ root: join(compat, project) });
	try {
		const runs = [];
		for (const entry of bench.list())
			runs.push({
				file: entry.module,
				name: entry.story?.name ?? '',
				run: await bench.run({ id: entry.id }),
			});
		return runs;
	} finally {
		await bench.close();
	}
}

/** Both runners agree on every story, and Specimen's outcomes are the expected ones. */
async function agree(project: string, expected: Record<string, string>) {
	// One runner at a time, to keep the shared host's load bounded.
	const tests = await incumbent(project);
	const stories = await candidate(project);
	const outcomes: Record<string, string> = {};
	for (const story of stories) {
		const { outcome } = story.run;
		const category = outcome.failures[0]?.category;
		outcomes[story.name] = category ? `${outcome.status}:${category}` : outcome.status;
		const test = tests.find((item) => item.file === story.file && item.name === story.name);
		if (outcome.status === 'excluded') {
			expect(test, `${story.name} has no incumbent test`).toBeUndefined();
			continue;
		}
		expect(test, `${story.name} has an incumbent test`).toBeDefined();
		expect(outcome.status, `${story.name}: ${test?.message}`).toBe(test?.status);
		if (outcome.status === 'failed')
			expect(category === 'a11y', `${story.name} fails for the same kind of reason`).toBe(
				test?.accessibility
			);
	}
	expect(tests).toHaveLength(
		stories.filter((story) => story.run.outcome.status !== 'excluded').length
	);
	expect(outcomes).toEqual(expected);
	return stories;
}

beforeAll(async () => {
	scratch = await mkdtemp(join(tmpdir(), 'specimen-compat-run-'));
});
afterAll(async () => {
	if (scratch) await rm(scratch, { recursive: true, force: true });
});

describe('retained stories end the same way in both runners', () => {
	it('passes, skips and excludes the representative slice as Storybook does', async () => {
		const stories = await agree('', {
			'Custom Renderer': 'passed',
			Precedence: 'passed',
			'Global Theme': 'passed',
			Responsive: 'passed',
			'Default Viewport': 'passed',
			'Form Associated': 'passed',
			'Smoke Only': 'passed',
			'Glob Import': 'passed',
			Skipped: 'skipped',
			'Not A Test': 'excluded',
			Made: 'passed',
			Extended: 'passed',
			Primary: 'passed',
			'With URL And H 1 Heading 2 X': 'passed',
			'Snake Case Name': 'passed',
			'Explicit display name': 'passed',
			Tagged: 'passed',
			'From a spread': 'passed',
			'Function Story': 'passed',
			Beta: 'passed',
			Alpha: 'passed',
		});
		const responsive = stories.find((story) => story.name === 'Responsive')?.run.observation;
		expect(responsive?.manifest.context).toMatchObject({
			viewport: { width: 320, height: 568 },
			themeMedia: 'browser-default',
		});
		const theme = stories.find((story) => story.name === 'Global Theme')?.run.observation;
		expect(theme?.manifest.context.theme).toBe('dark');
	}, 300_000);

	it('fails the deliberately failing cases for the same reasons', async () => {
		const stories = await agree('failing', {
			'Interaction Failure': 'failed:play',
			'Accessibility Failure': 'failed:a11y',
			'Accessibility Todo': 'passed',
			'Accessibility Off': 'passed',
			'Render Failure': 'failed:render',
			'Clean After Failure': 'passed',
			'Unknown Viewport': 'passed',
			'Unknown Theme': 'passed',
		});
		const outcome = (name: string) => stories.find((story) => story.name === name)?.run;
		expect(outcome('Accessibility Todo')?.outcome.a11y).toMatchObject({
			status: 'warning',
			policy: 'todo',
			violations: [{ id: 'image-alt' }],
			engine: '4.13.0',
		});
		expect(outcome('Accessibility Off')?.outcome.a11y.status).toBe('not-run');
		// Storybook renders an unknown viewport or theme silently; Specimen labels the mismatch.
		expect(outcome('Unknown Viewport')?.observation?.completeness.layout.reasons).toEqual([
			expect.stringContaining("viewport 'not-a-viewport'"),
		]);
		expect(outcome('Unknown Theme')?.observation?.completeness.layout.reasons).toEqual([
			expect.stringContaining('"sepia"'),
		]);
	}, 300_000);
});
