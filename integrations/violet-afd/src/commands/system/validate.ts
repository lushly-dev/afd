import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { CommandResult } from '../../types/command-result.js';
import { type CommandContext, type CommandDefinition, registry } from '../registry.js';

const execAsync = promisify(exec);

/**
 * Coverage statistics
 */
const CoverageStatsSchema = z.object({
	lines: z.number(),
	statements: z.number(),
	functions: z.number(),
	branches: z.number(),
});

type CoverageStats = z.infer<typeof CoverageStatsSchema>;

/**
 * Validate command input schema
 */
const ValidateInputSchema = z.object({
	coverage: z.boolean().default(false).describe('Include coverage statistics'),
	filter: z.string().optional().describe('Filter pattern for test files'),
	bail: z.boolean().default(false).describe('Stop on first failure'),
});

type ValidateInput = z.input<typeof ValidateInputSchema>;

/**
 * Validate command output
 */
const ValidateOutputSchema = z.object({
	passed: z.boolean(),
	testResults: z.object({
		total: z.number(),
		passed: z.number(),
		failed: z.number(),
		skipped: z.number(),
		duration: z.number(),
	}),
	coverage: CoverageStatsSchema.optional(),
	failures: z
		.array(
			z.object({
				file: z.string(),
				test: z.string(),
				error: z.string(),
			}),
		)
		.optional(),
	rawOutput: z.string().optional(),
});

type ValidateOutput = z.infer<typeof ValidateOutputSchema>;

/**
 * Parse vitest JSON output to extract results
 */
function parseVitestOutput(stdout: string): {
	total: number;
	passed: number;
	failed: number;
	skipped: number;
	duration: number;
} {
	// Parse one or more vitest summary lines like "Tests  181 passed (181)"
	const testMatches = Array.from(
		stdout.matchAll(/Tests\s+(?:(\d+) failed \| )?(\d+) passed(?: \| (\d+) skipped)?\s+\((\d+)\)/g),
	);

	if (testMatches.length > 0) {
		const aggregate = testMatches.reduce(
			(acc, match) => {
				acc.failed += Number.parseInt(match[1] || '0', 10);
				acc.passed += Number.parseInt(match[2] || '0', 10);
				acc.skipped += Number.parseInt(match[3] || '0', 10);
				acc.total += Number.parseInt(match[4] || '0', 10);
				return acc;
			},
			{ total: 0, passed: 0, failed: 0, skipped: 0 },
		);

		const turboDurationMatch = stdout.match(/Time:\s+([\d.]+)s/);
		const durationMatch = stdout.match(/Duration\s+([\d.]+)s/g);

		let duration = 0;
		if (turboDurationMatch) {
			duration = Number.parseFloat(turboDurationMatch[1]) * 1000;
		} else if (durationMatch) {
			duration = Array.from(stdout.matchAll(/Duration\s+([\d.]+)s/g)).reduce(
				(sum, match) => sum + Number.parseFloat(match[1]) * 1000,
				0,
			);
		}

		return { ...aggregate, duration };
	}

	// Fallback: look for individual counts
	const failedMatch = stdout.match(/(\d+) failed/);
	const passedMatch = stdout.match(/(\d+) passed/);
	const skippedMatch = stdout.match(/(\d+) skipped/);
	const totalMatch = stdout.match(/\((\d+)\)/);

	const failed = failedMatch ? Number.parseInt(failedMatch[1], 10) : 0;
	const passed = passedMatch ? Number.parseInt(passedMatch[1], 10) : 0;
	const skipped = skippedMatch ? Number.parseInt(skippedMatch[1], 10) : 0;
	const total = totalMatch ? Number.parseInt(totalMatch[1], 10) : passed + failed + skipped;

	// Parse duration
	const durationMatch = stdout.match(/Duration\s+([\d.]+)s/);
	const duration = durationMatch ? Number.parseFloat(durationMatch[1]) * 1000 : 0;

	return { total, passed, failed, skipped, duration };
}

/**
 * Parse coverage from vitest output
 */
function parseCoverage(stdout: string): CoverageStats | undefined {
	// Look for coverage summary like "All files | 80.5 | 75.2 | 82.1 | 78.9"
	const coverageMatch = stdout.match(
		/All files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/,
	);

	if (coverageMatch) {
		return {
			statements: Number.parseFloat(coverageMatch[1]),
			branches: Number.parseFloat(coverageMatch[2]),
			functions: Number.parseFloat(coverageMatch[3]),
			lines: Number.parseFloat(coverageMatch[4]),
		};
	}

	return undefined;
}

/**
 * Parse failure details from output
 */
function parseFailures(stdout: string): Array<{ file: string; test: string; error: string }> {
	const failures: Array<{ file: string; test: string; error: string }> = [];

	// Look for FAIL markers
	const failPattern = /FAIL\s+(.+?)\s+>\s+(.+?)(?:\n|$)/g;
	let match = failPattern.exec(stdout);

	while (match !== null) {
		failures.push({
			file: match[1].trim(),
			test: match[2].trim(),
			error: 'Test failed (see raw output for details)',
		});
		match = failPattern.exec(stdout);
	}

	return failures;
}

/**
 * Validate command handler
 */
async function validateHandler(
	rawInput: ValidateInput,
	_context: CommandContext,
): Promise<CommandResult<ValidateOutput>> {
	const input = ValidateInputSchema.parse(rawInput);

	const ignoredOptions: string[] = [];

	if (input.filter) {
		ignoredOptions.push('filter');
	}

	if (input.bail) {
		ignoredOptions.push('bail');
	}

	const command = input.coverage ? 'pnpm test:coverage' : 'pnpm test';

	try {
		const { stdout, stderr } = await execAsync(command, {
			cwd: process.cwd(),
			timeout: 120000, // 2 minute timeout
			maxBuffer: 10 * 1024 * 1024, // 10MB buffer
		});

		const combined = stdout + stderr;
		const testResults = parseVitestOutput(combined);
		const coverage = input.coverage ? parseCoverage(combined) : undefined;
		const failures = testResults.failed > 0 ? parseFailures(combined) : undefined;

		return {
			success: true,
			data: {
				passed: testResults.failed === 0,
				testResults,
				coverage,
				failures,
			},
			reasoning:
				testResults.failed === 0
					? `All ${testResults.passed} tests passed`
					: `${testResults.failed} test(s) failed out of ${testResults.total}`,
			confidence: 1.0,
			warnings:
				ignoredOptions.length > 0
					? [
							{
								code: 'UNSUPPORTED_OPTIONS_IGNORED',
								message: `Ignored validate option(s): ${ignoredOptions.join(', ')}`,
								severity: 'warning',
							},
						]
					: undefined,
		};
	} catch (error) {
		// Test failures cause non-zero exit code
		if (error instanceof Error && 'stdout' in error) {
			const execError = error as Error & { stdout: string; stderr: string };
			const combined = (execError.stdout || '') + (execError.stderr || '');
			const testResults = parseVitestOutput(combined);
			const failures = parseFailures(combined);

			return {
				success: true, // Command succeeded even if tests failed
				data: {
					passed: false,
					testResults,
					failures: failures.length > 0 ? failures : undefined,
					rawOutput: combined.slice(0, 2000), // Truncate for readability
				},
				reasoning: `${testResults.failed} test(s) failed out of ${testResults.total}`,
				confidence: 1.0,
				warnings: [
					{
						code: 'TEST_FAILURES',
						message: `${testResults.failed} test(s) failed`,
						severity: 'warning',
					},
					...(ignoredOptions.length > 0
						? [
								{
									code: 'UNSUPPORTED_OPTIONS_IGNORED',
									message: `Ignored validate option(s): ${ignoredOptions.join(', ')}`,
									severity: 'warning' as const,
								},
							]
						: []),
				],
			};
		}

		return {
			success: false,
			error: {
				code: 'VALIDATION_ERROR',
				message: error instanceof Error ? error.message : 'Validation failed',
				suggestion: 'Check that vitest is installed and configured correctly',
			},
		};
	}
}

/**
 * Validate command definition (system.validate - runs test suite)
 * Named systemValidateCommand to avoid conflict with constraints.validateCommand
 */
export const systemValidateCommand: CommandDefinition<typeof ValidateInputSchema, ValidateOutput> =
	{
		name: 'validate',
		description: 'Run test suite and optionally collect coverage',
		category: 'system',
		inputSchema: ValidateInputSchema,
		outputSchema: ValidateOutputSchema,
		handler: validateHandler,
		examples: [
			{
				description: 'Run all tests',
				input: {},
			},
			{
				description: 'Run tests with coverage',
				input: { coverage: true },
			},
			{
				description: 'Run filtered tests',
				input: { filter: 'node.*' },
			},
			{
				description: 'Stop on first failure',
				input: { bail: true },
			},
		],
	};

/**
 * Register validate command
 */
export function registerValidateCommand(): void {
	registry.register(systemValidateCommand);
}
