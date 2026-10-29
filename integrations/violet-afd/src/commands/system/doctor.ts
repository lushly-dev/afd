import { z } from 'zod';
import type { CommandResult } from '../../types/command-result.js';
import { type CommandContext, type CommandDefinition, registry } from '../registry.js';

/**
 * Health check result for a single check
 */
const HealthCheckSchema = z.object({
	name: z.string(),
	status: z.enum(['pass', 'warn', 'fail']),
	message: z.string(),
	detail: z.string().optional(),
});

type HealthCheck = z.infer<typeof HealthCheckSchema>;

/**
 * Environment info for verbose output
 */
const EnvironmentInfoSchema = z.object({
	nodeVersion: z.string(),
	platform: z.string(),
	arch: z.string(),
	cwd: z.string(),
	packageVersion: z.string(),
});

type EnvironmentInfo = z.infer<typeof EnvironmentInfoSchema>;

/**
 * Doctor command input schema
 */
const DoctorInputSchema = z.object({
	verbose: z.boolean().default(false).describe('Include environment details'),
});

type DoctorInput = z.input<typeof DoctorInputSchema>;

/**
 * Doctor command output
 */
const DoctorOutputSchema = z.object({
	healthy: z.boolean(),
	checks: z.array(HealthCheckSchema),
	summary: z.object({
		passed: z.number(),
		warnings: z.number(),
		failed: z.number(),
		total: z.number(),
	}),
	environment: EnvironmentInfoSchema.optional(),
});

type DoctorOutput = z.infer<typeof DoctorOutputSchema>;

/**
 * Check Node.js version
 */
function checkNodeVersion(): HealthCheck {
	const nodeVersion = process.version;
	const major = Number.parseInt(nodeVersion.slice(1).split('.')[0], 10);

	if (major >= 24) {
		return {
			name: 'Node.js version',
			status: 'pass',
			message: `Node.js ${nodeVersion} (required: v24+)`,
		};
	}
	return {
		name: 'Node.js version',
		status: 'fail',
		message: `Node.js ${nodeVersion} (v24+ required)`,
		detail: 'Violet requires Node.js 24 or higher (see "engines" in package.json)',
	};
}

/**
 * Check database connectivity
 */
async function checkDatabase(context: CommandContext): Promise<HealthCheck> {
	try {
		// Try to list nodes - this tests basic DB connectivity
		const nodes = await context.db.listNodes();
		return {
			name: 'Database connectivity',
			status: 'pass',
			message: `Connected (${nodes.length} nodes)`,
		};
	} catch (error) {
		return {
			name: 'Database connectivity',
			status: 'fail',
			message: 'Failed to connect to database',
			detail: error instanceof Error ? error.message : 'Unknown error',
		};
	}
}

/**
 * Check command registry health
 */
function checkRegistry(): HealthCheck {
	const commands = registry.list();

	if (commands.length === 0) {
		return {
			name: 'Command registry',
			status: 'fail',
			message: 'No commands registered',
			detail: 'Call initializeCore() before using Violet',
		};
	}

	// Check for expected minimum commands
	const expectedMinimum = 15; // We have 21+ commands
	if (commands.length < expectedMinimum) {
		return {
			name: 'Command registry',
			status: 'warn',
			message: `${commands.length} commands registered (expected ${expectedMinimum}+)`,
			detail: 'Some command modules may not be loaded',
		};
	}

	return {
		name: 'Command registry',
		status: 'pass',
		message: `${commands.length} commands registered`,
	};
}

/**
 * Check write permissions (try to create a temp node if DB is memory-based)
 * For non-destructive check, we just verify DB methods exist
 */
function checkWriteCapability(context: CommandContext): HealthCheck {
	try {
		// Check that essential methods exist
		const requiredMethods = ['createNode', 'updateNode', 'deleteNode', 'addOperation'] as const;

		for (const method of requiredMethods) {
			if (typeof context.db[method] !== 'function') {
				return {
					name: 'Write capability',
					status: 'fail',
					message: `Database missing ${method} method`,
				};
			}
		}

		return {
			name: 'Write capability',
			status: 'pass',
			message: 'Database supports write operations',
		};
	} catch (error) {
		return {
			name: 'Write capability',
			status: 'fail',
			message: 'Failed to verify write capability',
			detail: error instanceof Error ? error.message : 'Unknown error',
		};
	}
}

/**
 * Get environment info for verbose output
 */
function getEnvironmentInfo(): EnvironmentInfo {
	return {
		nodeVersion: process.version,
		platform: process.platform,
		arch: process.arch,
		cwd: process.cwd(),
		packageVersion: '0.1.0', // Would read from package.json in production
	};
}

/**
 * Doctor command handler
 */
async function doctorHandler(
	rawInput: DoctorInput,
	context: CommandContext,
): Promise<CommandResult<DoctorOutput>> {
	const input = DoctorInputSchema.parse(rawInput);
	const checks: HealthCheck[] = [];

	// Run all health checks
	checks.push(checkNodeVersion());
	checks.push(await checkDatabase(context));
	checks.push(checkRegistry());
	checks.push(checkWriteCapability(context));

	// Calculate summary
	const passed = checks.filter((c) => c.status === 'pass').length;
	const warnings = checks.filter((c) => c.status === 'warn').length;
	const failed = checks.filter((c) => c.status === 'fail').length;

	const healthy = failed === 0;

	const output: DoctorOutput = {
		healthy,
		checks,
		summary: {
			passed,
			warnings,
			failed,
			total: checks.length,
		},
	};

	// Add environment info if verbose
	if (input.verbose) {
		output.environment = getEnvironmentInfo();
	}

	return {
		success: true,
		data: output,
		reasoning: healthy
			? `All ${checks.length} health checks passed`
			: `${failed} check(s) failed, ${warnings} warning(s)`,
		confidence: 1.0,
	};
}

/**
 * Doctor command definition
 */
export const doctorCommand: CommandDefinition<typeof DoctorInputSchema, DoctorOutput> = {
	name: 'doctor',
	description: 'Check system health and configuration',
	category: 'system',
	inputSchema: DoctorInputSchema,
	outputSchema: DoctorOutputSchema,
	handler: doctorHandler,
	examples: [
		{
			description: 'Basic health check',
			input: {},
		},
		{
			description: 'Verbose health check with environment info',
			input: { verbose: true },
		},
	],
};

/**
 * Register system commands
 */
export function registerSystemCommands(): void {
	registry.register(doctorCommand);
}
