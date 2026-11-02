import { describe, expect, it } from 'vitest';
import {
	executeSuite,
	flakeId,
	pool,
	type StoryAttempt,
	type StoryEntry,
	selectStories,
} from './suite.js';
import type { SpecimenEntry, StoryOutcome } from './types.js';

const entry = (name: string, tags = ['test'], module = './src/a.stories.ts'): StoryEntry => ({
	id: `a--${name.toLowerCase()}`,
	title: 'Components/A',
	module,
	exportName: name,
	story: { name, tags, play: 'absent', unresolved: [], annotations: { meta: [], story: [] } },
});
const outcome = (status: StoryOutcome['status']): StoryAttempt => ({
	outcome: {
		status,
		play: 'none',
		failures: status === 'failed' ? [{ category: 'play', message: 'no' }] : [],
		a11y: { status: 'not-run', policy: 'error', violations: [], incomplete: 0 },
	},
	observation: null,
});
const options = { workers: 2, retry: true, flakeCap: 2 };

/** Runs with a scripted status per attempt, by story name. */
function scripted(script: Record<string, StoryOutcome['status'][]>) {
	const calls: string[] = [];
	return {
		calls,
		run: async (story: StoryEntry) => {
			calls.push(story.story.name);
			return outcome(script[story.story.name]?.shift() ?? 'passed');
		},
	};
}

describe('selecting a suite', () => {
	const entries: SpecimenEntry[] = [
		entry('Alpha', ['test', 'smoke']),
		entry('Beta', ['test'], './src/b.stories.ts'),
		{ id: 'native', title: 'Native', module: './native.ts', exportName: 'Native' },
	];
	const names = (filter?: Parameters<typeof selectStories>[1]) =>
		selectStories(entries, filter, '/root').map((story) => story.story.name);

	it('takes every retained story and never a native specimen', () => {
		expect(names()).toEqual(['Alpha', 'Beta']);
	});
	it('applies every condition it is given', () => {
		expect(names({ ids: ['a--beta'] })).toEqual(['Beta']);
		expect(names({ file: 'src/b.stories.ts' })).toEqual(['Beta']);
		expect(names({ file: './src/a.stories.ts' })).toEqual(['Alpha']);
		expect(names({ tags: ['smoke'] })).toEqual(['Alpha']);
		expect(names({ match: 'components/a beta' })).toEqual(['Beta']);
		expect(names({ tags: ['smoke'], file: 'src/b.stories.ts' })).toEqual([]);
	});
});

describe('the worker pool', () => {
	it('never runs more than its limit at once and keeps results in order', async () => {
		let running = 0;
		let peak = 0;
		const results = await pool([5, 1, 4, 2, 3], 2, async (delay) => {
			running += 1;
			peak = Math.max(peak, running);
			await new Promise((resolve) => setTimeout(resolve, delay));
			running -= 1;
			return delay * 10;
		});
		expect(peak).toBe(2);
		expect(results).toEqual([50, 10, 40, 20, 30]);
	});
});

describe('the once-only retry', () => {
	const stories = [entry('Alpha'), entry('Beta'), entry('Gamma')];

	it('passes without a retry when nothing fails', async () => {
		const { run, calls } = scripted({});
		const suite = await executeSuite('/root', stories, run, options);
		expect(suite.outcome).toBe('passed');
		expect(suite.retry).toEqual({ ran: false, reason: 'no story failed' });
		expect(calls).toHaveLength(3);
		expect(suite.counts).toMatchObject({ total: 3, passed: 3, failed: 0, flaky: 0 });
	});
	it('calls a failure that passes on its retry flaky, and records both attempts', async () => {
		const { run, calls } = scripted({ Beta: ['failed', 'passed'] });
		const suite = await executeSuite('/root', stories, run, options);
		expect(suite.outcome).toBe('passed-with-flake');
		expect(suite.retry).toEqual({ ran: true });
		expect(calls.filter((name) => name === 'Beta')).toHaveLength(2);
		const beta = suite.stories[1];
		expect(beta).toMatchObject({
			status: 'flaky',
			file: 'src/a.stories.ts',
			flakeId: 'storybook:src/a.stories.ts::Beta',
		});
		expect(beta?.attempts.map((attempt) => attempt.status)).toEqual(['failed', 'passed']);
		expect(suite.counts).toMatchObject({ passed: 2, failed: 0, flaky: 1 });
	});
	it('fails when any retried story fails again, even if another passes', async () => {
		const { run } = scripted({ Alpha: ['failed', 'passed'], Beta: ['failed', 'failed'] });
		const suite = await executeSuite('/root', stories, run, options);
		expect(suite.outcome).toBe('failed-after-retry');
		expect(suite.counts).toMatchObject({ passed: 1, failed: 1, flaky: 1 });
	});
	it('does not retry more failures than the cap, since they cannot pass as flakes', async () => {
		const { run, calls } = scripted({
			Alpha: ['failed', 'passed'],
			Beta: ['failed', 'passed'],
			Gamma: ['failed', 'passed'],
		});
		const suite = await executeSuite('/root', stories, run, options);
		expect(suite.outcome).toBe('failed');
		expect(suite.retry.ran).toBe(false);
		expect(suite.retry.reason).toContain('3 stories failed');
		expect(calls).toHaveLength(3);
	});
	it('does not retry unless asked', async () => {
		const { run, calls } = scripted({ Beta: ['failed', 'passed'] });
		const suite = await executeSuite('/root', stories, run, { ...options, retry: false });
		expect(suite.outcome).toBe('failed');
		expect(suite.retry).toEqual({ ran: false, reason: 'retry was not requested' });
		expect(calls).toHaveLength(3);
	});
	it('retries one at a time, so a retry has no neighbours', async () => {
		let running = 0;
		let peak = 0;
		let phase: 'first' | 'retry' = 'first';
		await executeSuite(
			'/root',
			stories,
			async (story) => {
				if (phase === 'retry') {
					running += 1;
					peak = Math.max(peak, running);
				}
				await new Promise((resolve) => setTimeout(resolve, 2));
				if (phase === 'retry') running -= 1;
				if (story.story.name === 'Gamma') phase = 'retry';
				return outcome(phase === 'first' || story.story.name === 'Gamma' ? 'failed' : 'passed');
			},
			{ workers: 3, retry: true, flakeCap: 3 }
		);
		expect(peak).toBeLessThanOrEqual(1);
	});
	it('leaves skipped and excluded stories out of the failures', async () => {
		const { run, calls } = scripted({ Alpha: ['skipped'], Beta: ['excluded'] });
		const suite = await executeSuite('/root', stories, run, options);
		expect(suite.outcome).toBe('passed');
		expect(suite.counts).toMatchObject({ passed: 1, skipped: 1, excluded: 1 });
		expect(calls).toHaveLength(3);
	});
});

describe('a flake id', () => {
	it('is the form consumers already key their flake records by', () => {
		expect(flakeId('src/a.stories.ts', ['Primary'])).toBe('storybook:src/a.stories.ts::Primary');
		expect(flakeId('src/a.stories.ts', ['Suite', 'Primary'])).toBe(
			'storybook:src/a.stories.ts::Suite › Primary'
		);
	});
});
