/**
 * @fileoverview The `loam-host` bin (phase 6 specification, 3.8): `loam-host <command> [options]`. Output is
 * a `CommandResult` as JSON, and the exit code is 0 on success, 1 on failure, as `loam`'s is. `dev` prints
 * its result once it serves, then serves until `SIGINT` or `SIGTERM`, and closes, releasing the lock, as
 * `start` does. Step 1 has `check` and `doctor`, step 2 `dev`, and step 3 `start` and `bootstrap`; `health`
 * comes with step 8.
 */

import { parseArgs } from 'node:util';
import { type CommandResult, failure } from '@lushly-dev/afd-server/define';
import {
	hostBootstrapCommand,
	hostCheckCommand,
	hostDevCommand,
	hostDoctorCommand,
	hostStartCommand,
	takeStartedDev,
} from './commands.js';

export interface HostCliIO {
	stdout?: (text: string) => void;
	/** For `dev`: resolves when the profile should stop; `SIGINT` or `SIGTERM` by default. */
	untilStopped?: () => Promise<void>;
}

function untilSignal(): Promise<void> {
	return new Promise((done) => {
		const stop = () => {
			process.off('SIGINT', stop);
			process.off('SIGTERM', stop);
			done();
		};
		process.once('SIGINT', stop);
		process.once('SIGTERM', stop);
	});
}

interface Subcommand {
	command: { inputSchema: { safeParse(input: unknown): unknown }; handler: unknown };
	usage: string;
	options: readonly string[];
	/** Flags that take no value. */
	flags?: readonly string[];
	/** Options spelled with a dash on the command line, and their input's key. */
	renamed?: Readonly<Record<string, string>>;
}

const SUBCOMMANDS: Readonly<Record<string, Subcommand>> = {
	check: {
		command: hostCheckCommand,
		usage: 'loam-host check --server <file> --deployment <file> --dist <dir>',
		options: ['server', 'deployment', 'dist'],
	},
	doctor: {
		command: hostDoctorCommand,
		usage: 'loam-host doctor --server <file> --deployment <file>',
		options: ['server', 'deployment'],
	},
	dev: {
		command: hostDevCommand,
		usage: 'loam-host dev --deployment <file> [--data <dir>] [--port <n>] [--dist <dir>]',
		options: ['deployment', 'data', 'port', 'dist'],
	},
	start: {
		command: hostStartCommand,
		usage: 'loam-host start --server <file> --deployment <file> --dist <dir>',
		options: ['server', 'deployment', 'dist'],
	},
	bootstrap: {
		command: hostBootstrapCommand,
		usage:
			'loam-host bootstrap (--server <file> | --dev [--data <dir>]) --deployment <file> --slug <slug> --name <name> --owner-email <email>',
		options: ['server', 'data', 'deployment', 'slug', 'name', 'owner-email'],
		flags: ['dev'],
		renamed: { 'owner-email': 'ownerEmail' },
	},
};

const USAGE = Object.values(SUBCOMMANDS)
	.map(({ usage }) => usage)
	.join('; ');

function usageFailure(message: string, usage = USAGE): CommandResult<never> {
	return failure({ code: 'CLI_USAGE', message, suggestion: `Usage: ${usage}` });
}

async function run(args: string[]): Promise<CommandResult<unknown>> {
	const [name, ...rest] = args;
	const subcommand = name === undefined ? undefined : SUBCOMMANDS[name];
	if (!subcommand) return usageFailure(`Unknown command: ${name ?? '(none)'}`);
	let values: Record<string, unknown>;
	try {
		({ values } = parseArgs({
			args: rest,
			strict: true,
			allowPositionals: false,
			options: Object.fromEntries([
				...subcommand.options.map((option) => [option, { type: 'string' as const }]),
				...(subcommand.flags ?? []).map((flag) => [flag, { type: 'boolean' as const }]),
			]),
		}));
	} catch (cause) {
		return usageFailure(cause instanceof Error ? cause.message : String(cause), subcommand.usage);
	}
	for (const [flag, key] of Object.entries(subcommand.renamed ?? {})) {
		if (flag in values) {
			values[key] = values[flag];
			delete values[flag];
		}
	}
	const parsed = subcommand.command.inputSchema.safeParse(values) as
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

export async function runHostCli(args: string[], io: HostCliIO = {}): Promise<number> {
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
	const profile = takeStartedDev();
	if (profile) {
		await (io.untilStopped ?? untilSignal)();
		await profile.host.close();
	}
	return result.success ? 0 : 1;
}
