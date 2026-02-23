import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { ScenarioResult, TestReport } from '../types/report.js';
import {
	createJsonReporter,
	createReporter,
	createVerboseReporter,
	TerminalReporter,
} from './reporter.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Test Helpers
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Capture output from a reporter into a string array.
 */
function createCaptureStream(): { stream: NodeJS.WritableStream; lines: string[] } {
	const lines: string[] = [];
	const stream = new Writable({
		write(chunk, _encoding, callback) {
			lines.push(chunk.toString());
			callback();
		},
	});
	return { stream, lines };
}

function makeScenarioResult(overrides?: Partial<ScenarioResult>): ScenarioResult {
	return {
		scenarioPath: 'test.yaml',
		jobName: 'test-job',
		jobDescription: 'Test scenario description',
		outcome: 'pass',
		durationMs: 150,
		stepResults: [
			{
				stepId: 'step-1',
				command: 'test-cmd',
				outcome: 'pass',
				durationMs: 100,
				assertions: [
					{
						path: 'success',
						matcher: 'equals',
						passed: true,
						expected: true,
						actual: true,
						description: 'success is true',
					},
				],
			},
		],
		passedSteps: 1,
		failedSteps: 0,
		skippedSteps: 0,
		startedAt: new Date('2024-01-01'),
		completedAt: new Date('2024-01-01'),
		...overrides,
	};
}

function makeFailedResult(): ScenarioResult {
	return makeScenarioResult({
		outcome: 'fail',
		passedSteps: 0,
		failedSteps: 1,
		stepResults: [
			{
				stepId: 'step-1',
				command: 'fail-cmd',
				outcome: 'fail',
				durationMs: 50,
				assertions: [
					{
						path: 'success',
						matcher: 'equals',
						passed: false,
						expected: true,
						actual: false,
						description: 'success should be true',
					},
				],
				error: {
					type: 'expectation_mismatch',
					message: 'Expected success to be true',
				},
			},
		],
	});
}

// ═══════════════════════════════════════════════════════════════════════════════
// TerminalReporter - JSON format
// ═══════════════════════════════════════════════════════════════════════════════

describe('TerminalReporter - JSON format', () => {
	it('outputs valid JSON for single scenario', () => {
		const { stream, lines } = createCaptureStream();
		const reporter = new TerminalReporter({ format: 'json', output: stream });

		reporter.reportScenario(makeScenarioResult());

		const output = lines.join('');
		const parsed = JSON.parse(output);
		expect(parsed.jobName).toBe('test-job');
		expect(parsed.outcome).toBe('pass');
	});

	it('outputs valid JSON array for multiple scenarios', () => {
		const { stream, lines } = createCaptureStream();
		const reporter = new TerminalReporter({ format: 'json', output: stream });

		reporter.reportAll([makeScenarioResult(), makeFailedResult()]);

		const output = lines.join('');
		const parsed = JSON.parse(output);
		expect(Array.isArray(parsed)).toBe(true);
		expect(parsed).toHaveLength(2);
	});

	it('outputs valid JSON for test report', () => {
		const { stream, lines } = createCaptureStream();
		const reporter = new TerminalReporter({ format: 'json', output: stream });

		const report: TestReport = {
			title: 'Test Suite',
			durationMs: 300,
			scenarios: [makeScenarioResult()],
			summary: {
				totalScenarios: 1,
				passedScenarios: 1,
				failedScenarios: 0,
				errorScenarios: 0,
				totalSteps: 1,
				passedSteps: 1,
				failedSteps: 0,
				skippedSteps: 0,
				passRate: 1.0,
			},
			generatedAt: new Date('2024-01-01'),
		};

		reporter.reportTestReport(report);

		const output = lines.join('');
		const parsed = JSON.parse(output);
		expect(parsed.title).toBe('Test Suite');
	});

	it('does not output step progress in JSON mode', () => {
		const { stream, lines } = createCaptureStream();
		const reporter = new TerminalReporter({ format: 'json', output: stream });

		const stepResult = makeScenarioResult().stepResults[0];
		if (!stepResult) throw new Error('Test setup error');
		reporter.reportStepProgress(
			{ command: 'test-cmd', expect: { success: true } },
			stepResult,
			0,
			1
		);

		expect(lines).toHaveLength(0);
	});

	it('does not output scenario start in JSON mode', () => {
		const { stream, lines } = createCaptureStream();
		const reporter = new TerminalReporter({ format: 'json', output: stream });

		reporter.reportScenarioStart('test-job', 'description');

		expect(lines).toHaveLength(0);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// TerminalReporter - Human format
// ═══════════════════════════════════════════════════════════════════════════════

describe('TerminalReporter - Human format', () => {
	it('shows pass icon for passing scenario', () => {
		const { stream, lines } = createCaptureStream();
		const reporter = new TerminalReporter({ format: 'human', colors: false, output: stream });

		reporter.reportScenario(makeScenarioResult());

		const output = lines.join('');
		expect(output).toContain('✓');
		expect(output).toContain('test-job');
		expect(output).toContain('1 passed');
	});

	it('shows fail icon and details for failing scenario', () => {
		const { stream, lines } = createCaptureStream();
		const reporter = new TerminalReporter({ format: 'human', colors: false, output: stream });

		reporter.reportScenario(makeFailedResult());

		const output = lines.join('');
		expect(output).toContain('✗');
		expect(output).toContain('1 failed');
		expect(output).toContain('Failed steps:');
		expect(output).toContain('fail-cmd');
	});

	it('shows description when present', () => {
		const { stream, lines } = createCaptureStream();
		const reporter = new TerminalReporter({ format: 'human', colors: false, output: stream });

		reporter.reportScenario(makeScenarioResult({ jobDescription: 'My test description' }));

		const output = lines.join('');
		expect(output).toContain('My test description');
	});

	it('verbose mode shows all step details', () => {
		const { stream, lines } = createCaptureStream();
		const reporter = new TerminalReporter({
			format: 'human',
			colors: false,
			verbose: true,
			output: stream,
		});

		reporter.reportScenario(makeScenarioResult());

		const output = lines.join('');
		expect(output).toContain('test-cmd');
		expect(output).toContain('success is true');
	});

	it('verbose step progress shows assertions', () => {
		const { stream, lines } = createCaptureStream();
		const reporter = new TerminalReporter({
			format: 'human',
			colors: false,
			verbose: true,
			output: stream,
		});

		const step = makeScenarioResult().stepResults[0];
		if (!step) throw new Error('Test setup error');
		reporter.reportStepProgress({ command: 'test-cmd', expect: { success: true } }, step, 0, 1);

		const output = lines.join('');
		expect(output).toContain('[1/1]');
		expect(output).toContain('test-cmd');
		expect(output).toContain('success is true');
	});

	it('non-verbose step progress shows failed assertions', () => {
		const { stream, lines } = createCaptureStream();
		const reporter = new TerminalReporter({
			format: 'human',
			colors: false,
			verbose: false,
			output: stream,
		});

		const failStep = makeFailedResult().stepResults[0];
		if (!failStep) throw new Error('Test setup error');
		reporter.reportStepProgress({ command: 'fail-cmd', expect: { success: true } }, failStep, 0, 1);

		const output = lines.join('');
		expect(output).toContain('✗');
		expect(output).toContain('Error:');
	});

	it('summary shows total pass/fail counts', () => {
		const { stream, lines } = createCaptureStream();
		const reporter = new TerminalReporter({ format: 'human', colors: false, output: stream });

		reporter.reportAll([makeScenarioResult(), makeScenarioResult()]);

		const output = lines.join('');
		expect(output).toContain('2 passed');
		expect(output).toContain('0 failed');
		expect(output).toContain('All scenarios passed!');
	});

	it('summary shows failure message when some fail', () => {
		const { stream, lines } = createCaptureStream();
		const reporter = new TerminalReporter({ format: 'human', colors: false, output: stream });

		reporter.reportAll([makeScenarioResult(), makeFailedResult()]);

		const output = lines.join('');
		expect(output).toContain('1 failed');
		expect(output).toContain('scenario(s) failed');
	});

	it('scenario start outputs job name', () => {
		const { stream, lines } = createCaptureStream();
		const reporter = new TerminalReporter({ format: 'human', colors: false, output: stream });

		reporter.reportScenarioStart('my-job', 'My job description');

		const output = lines.join('');
		expect(output).toContain('my-job');
		expect(output).toContain('My job description');
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// Duration formatting
// ═══════════════════════════════════════════════════════════════════════════════

describe('TerminalReporter - duration formatting', () => {
	it('formats milliseconds', () => {
		const { stream, lines } = createCaptureStream();
		const reporter = new TerminalReporter({ format: 'human', colors: false, output: stream });

		reporter.reportScenario(makeScenarioResult({ durationMs: 500 }));

		const output = lines.join('');
		expect(output).toContain('500ms');
	});

	it('formats seconds', () => {
		const { stream, lines } = createCaptureStream();
		const reporter = new TerminalReporter({ format: 'human', colors: false, output: stream });

		reporter.reportScenario(makeScenarioResult({ durationMs: 2500 }));

		const output = lines.join('');
		expect(output).toContain('2.5s');
	});

	it('formats minutes', () => {
		const { stream, lines } = createCaptureStream();
		const reporter = new TerminalReporter({ format: 'human', colors: false, output: stream });

		reporter.reportScenario(makeScenarioResult({ durationMs: 90000 }));

		const output = lines.join('');
		expect(output).toContain('1.5m');
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// Outcome icons
// ═══════════════════════════════════════════════════════════════════════════════

describe('TerminalReporter - outcome icons', () => {
	it.each([
		['pass', '✓'],
		['fail', '✗'],
		['error', '⚠'],
		['skip', '○'],
		['partial', '◐'],
	])('shows correct icon for %s outcome', (outcome, icon) => {
		const { stream, lines } = createCaptureStream();
		const reporter = new TerminalReporter({ format: 'human', colors: false, output: stream });

		reporter.reportScenario(makeScenarioResult({ outcome: outcome as ScenarioResult['outcome'] }));

		const output = lines.join('');
		expect(output).toContain(icon);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// Factory functions
// ═══════════════════════════════════════════════════════════════════════════════

describe('Factory functions', () => {
	it('createReporter creates default reporter', () => {
		const reporter = createReporter();
		expect(reporter).toBeInstanceOf(TerminalReporter);
	});

	it('createJsonReporter creates JSON reporter', () => {
		const { stream, lines } = createCaptureStream();
		const reporter = createJsonReporter(stream);

		reporter.reportScenario(makeScenarioResult());

		const output = lines.join('');
		const parsed = JSON.parse(output);
		expect(parsed.outcome).toBe('pass');
	});

	it('createVerboseReporter creates verbose human reporter', () => {
		const { stream, lines } = createCaptureStream();
		const reporter = createVerboseReporter(stream);

		reporter.reportScenario(makeScenarioResult());

		const output = lines.join('');
		// Verbose shows step details
		expect(output).toContain('test-cmd');
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test report with summary
// ═══════════════════════════════════════════════════════════════════════════════

describe('TerminalReporter - reportTestReport (human)', () => {
	it('shows title and summary', () => {
		const { stream, lines } = createCaptureStream();
		const reporter = new TerminalReporter({ format: 'human', colors: false, output: stream });

		const report: TestReport = {
			title: 'Integration Tests',
			durationMs: 5000,
			scenarios: [makeScenarioResult(), makeFailedResult()],
			summary: {
				totalScenarios: 2,
				passedScenarios: 1,
				failedScenarios: 1,
				errorScenarios: 0,
				totalSteps: 2,
				passedSteps: 1,
				failedSteps: 1,
				skippedSteps: 0,
				passRate: 0.5,
			},
			generatedAt: new Date('2024-01-01'),
		};

		reporter.reportTestReport(report);

		const output = lines.join('');
		expect(output).toContain('Integration Tests');
		expect(output).toContain('Summary');
		expect(output).toContain('1 passed');
		expect(output).toContain('1 failed');
		expect(output).toContain('50.0%');
		expect(output).toContain('scenario(s) failed');
	});

	it('shows all passed message when no failures', () => {
		const { stream, lines } = createCaptureStream();
		const reporter = new TerminalReporter({ format: 'human', colors: false, output: stream });

		const report: TestReport = {
			title: 'All Green',
			durationMs: 1000,
			scenarios: [makeScenarioResult()],
			summary: {
				totalScenarios: 1,
				passedScenarios: 1,
				failedScenarios: 0,
				errorScenarios: 0,
				totalSteps: 1,
				passedSteps: 1,
				failedSteps: 0,
				skippedSteps: 0,
				passRate: 1.0,
			},
			generatedAt: new Date('2024-01-01'),
		};

		reporter.reportTestReport(report);

		const output = lines.join('');
		expect(output).toContain('All scenarios passed!');
	});
});
