/**
 * @fileoverview The `loam` bin: `loam <domain> <action>`. Output is a `CommandResult` as JSON, and the
 * exit code is 0 on success, 1 on failure, whatever went wrong.
 */

import { parseArgs } from 'node:util';
import { type CommandResult, failure } from '@lushly-dev/afd-server/define';
import {
	appCheckCommand,
	appNewCommand,
	appPackCommand,
	deploymentCheckCommand,
	deploymentWriteCommand,
} from './commands.js';

export interface CliIO {
	stdout?: (text: string) => void;
}

interface Subcommand {
	command: { inputSchema: { safeParse(input: unknown): unknown }; handler: unknown };
	usage: string;
	/** The options it takes, spelled on the command line, with the input key each fills. */
	options: Record<string, string>;
	/** The input keys its positional arguments fill, in order. */
	positionals: string[];
}

const SUBCOMMANDS: Record<string, Subcommand> = {
	'app new': {
		command: appNewCommand,
		usage: 'loam app new <id> --kind native|view|mounted [--dir <dir>] [--dep-spec <spec>]',
		options: { kind: 'kind', dir: 'dir', 'dep-spec': 'depSpec' },
		positionals: ['id'],
	},
	'app check': {
		command: appCheckCommand,
		usage: 'loam app check [<dir>] [--manifest <path>]',
		options: { manifest: 'manifest' },
		positionals: ['dir'],
	},
	'app pack': {
		command: appPackCommand,
		usage: 'loam app pack [<dir>] [--manifest <path>] --out <dir>',
		options: { manifest: 'manifest', out: 'out' },
		positionals: ['dir'],
	},
	'deployment check': {
		command: deploymentCheckCommand,
		usage: 'loam deployment check <file>',
		options: {},
		positionals: ['file'],
	},
	'deployment write': {
		command: deploymentWriteCommand,
		usage: 'loam deployment write --config <file> --dist <dir> --out <dir> [--mounts-out <path>]',
		options: { config: 'config', dist: 'dist', out: 'out', 'mounts-out': 'mountsOut' },
		positionals: [],
	},
};

const USAGE = Object.values(SUBCOMMANDS)
	.map((subcommand) => subcommand.usage)
	.join('; ');

function usageFailure(message: string, usage: string = USAGE): CommandResult<never> {
	return failure({ code: 'CLI_USAGE', message, suggestion: `Usage: ${usage}` });
}

/** The input of a subcommand from its arguments. A string is a mistake to report. */
function inputOf(subcommand: Subcommand, args: string[]): Record<string, string> | string {
	let parsed: ReturnType<typeof parseArgs>;
	try {
		parsed = parseArgs({
			args,
			allowPositionals: true,
			strict: true,
			options: Object.fromEntries(
				Object.keys(subcommand.options).map((name) => [name, { type: 'string' as const }])
			),
		});
	} catch (cause) {
		return cause instanceof Error ? cause.message : String(cause);
	}
	if (parsed.positionals.length > subcommand.positionals.length) {
		return `Unexpected argument: ${parsed.positionals[subcommand.positionals.length]}`;
	}
	const input: Record<string, string> = {};
	parsed.positionals.forEach((value, index) => {
		input[subcommand.positionals[index] as string] = value;
	});
	for (const [name, key] of Object.entries(subcommand.options)) {
		const value = parsed.values[name];
		if (typeof value === 'string') input[key] = value;
	}
	return input;
}

async function run(args: string[]): Promise<CommandResult<unknown>> {
	const [domain, action, ...rest] = args;
	const subcommand = SUBCOMMANDS[`${domain} ${action}`];
	if (!subcommand)
		return usageFailure(`Unknown command: ${[domain, action].filter(Boolean).join(' ')}`);
	const input = inputOf(subcommand, rest);
	if (typeof input === 'string') return usageFailure(input, subcommand.usage);
	const parsed = subcommand.command.inputSchema.safeParse(input) as
		| { success: true; data: unknown }
		| { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } };
	if (!parsed.success) {
		const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
		return usageFailure(issues.join('; '), subcommand.usage);
	}
	const handler = subcommand.command.handler as (
		input: unknown,
		context: object
	) => Promise<CommandResult<unknown>>;
	return handler(parsed.data, {});
}

export async function runCli(args: string[], io: CliIO = {}): Promise<number> {
	const stdout = io.stdout ?? ((text: string) => process.stdout.write(text));
	let result: CommandResult<unknown>;
	try {
		result = await run(args);
	} catch (cause) {
		result = failure({
			code: 'CLI_FAILED',
			message: cause instanceof Error ? cause.message : String(cause),
			suggestion: 'Read the message; a path or a permission is the usual cause.',
		});
	}
	stdout(`${JSON.stringify(result, null, '\t')}\n`);
	return result.success ? 0 : 1;
}
