/** JSON-only CLI adapter over the shared AFD command definitions. */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { CommandResult } from '@lushly-dev/afd-core';
import { failure } from '@lushly-dev/afd-server/define';
import { createSpecimenBench } from '@lushly-dev/specimen';
import type { BenchOptions, SpecimenContext } from '@lushly-dev/specimen/types';
import {
	executeSpecimenCommand,
	executeSpecimenDiff,
	observationSchema,
	type SpecimenCommandBench,
} from '@lushly-dev/specimen-afd';
import { z } from 'zod';

interface CliBench extends SpecimenCommandBench {
	close(): Promise<void>;
}
export interface CliIO {
	stdout?: (text: string) => void;
	stderr?: (text: string) => void;
	createBench?: (options: BenchOptions) => Promise<CliBench>;
}
interface ParsedArguments {
	action: string;
	positionals: string[];
	options: Map<string, string>;
	flags: Set<string>;
}
const valueOptions = new Set([
	'root',
	'config',
	'checkpoint',
	'viewport',
	'container',
	'theme',
	'locale',
	'reduced-motion',
	'motion',
	'screenshot',
	'output',
	'allow-context',
]);
const flagOptions = new Set(['require-visual']);
function parseArguments(args: string[]): ParsedArguments {
	const positionals: string[] = [];
	const options = new Map<string, string>();
	const flags = new Set<string>();
	for (let i = 0; i < args.length; i++) {
		const item = args[i];
		if (!item) continue;
		if (!item.startsWith('--')) {
			positionals.push(item);
			continue;
		}
		const key = item.slice(2);
		if (options.has(key) || flags.has(key)) throw new Error(`Duplicate option: ${item}`);
		if (flagOptions.has(key)) {
			flags.add(key);
			continue;
		}
		if (!valueOptions.has(key)) throw new Error(`Unknown option: ${item}`);
		const value = args[++i];
		if (!value || value.startsWith('--')) throw new Error(`Option ${item} needs a value`);
		options.set(key, value);
	}
	const action = positionals.shift();
	if (!action) throw new Error('Choose a command: list, render, diff, or build');
	return { action, positionals, options, flags };
}
function dimensions(value: string): { width: number; height: number } {
	const match = /^(\d+)x(\d+)$/.exec(value);
	if (!match) throw new Error(`Invalid dimensions: ${value}; use WIDTHxHEIGHT`);
	return { width: Number(match[1]), height: Number(match[2]) };
}
function validateOptions(parsed: ParsedArguments): void {
	const allowed: Record<string, Set<string>> = {
		list: new Set(['root', 'config', 'output']),
		render: new Set([
			'root',
			'config',
			'output',
			'checkpoint',
			'viewport',
			'container',
			'theme',
			'locale',
			'reduced-motion',
			'motion',
			'screenshot',
		]),
		diff: new Set(['root', 'output', 'allow-context', 'require-visual']),
		build: new Set(['root', 'config', 'output']),
	};
	const known = allowed[parsed.action];
	if (!known) throw new Error(`Unknown command: ${parsed.action}`);
	for (const option of [...parsed.options.keys(), ...parsed.flags]) {
		if (!known.has(option))
			throw new Error(`Option --${option} does not apply to ${parsed.action}`);
	}
	const expected = parsed.action === 'list' ? 0 : parsed.action === 'diff' ? 2 : 1;
	if (parsed.positionals.length !== expected)
		throw new Error(
			`${parsed.action} expects ${expected} positional argument${expected === 1 ? '' : 's'}`
		);
}
const resultCapture = z.object({ success: z.literal(true), data: observationSchema }).passthrough();
async function readCapture(file: string): Promise<unknown> {
	const value: unknown = JSON.parse(await readFile(file, 'utf8'));
	const wrapped = resultCapture.safeParse(value);
	return wrapped.success ? wrapped.data.data : value;
}
async function saveResult(file: string, result: CommandResult<unknown>): Promise<void> {
	await mkdir(dirname(file), { recursive: true });
	const temporary = `${file}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
		await rename(temporary, file);
	} finally {
		await rm(temporary, { force: true });
	}
}
/** Return an exit code; stdout always contains exactly one CommandResult JSON value. */
export async function runCli(args: string[], io: CliIO = {}): Promise<number> {
	const stdout = io.stdout ?? ((text: string) => process.stdout.write(text));
	const stderr = io.stderr ?? ((text: string) => process.stderr.write(text));
	let bench: CliBench | undefined;
	let result: CommandResult<unknown>;
	let output: string | undefined;
	try {
		const parsed = parseArguments(args);
		validateOptions(parsed);
		const root = resolve(parsed.options.get('root') ?? process.cwd());
		output = parsed.options.get('output');
		if (output) output = resolve(root, output);
		if (parsed.action === 'diff') {
			const [left, right] = parsed.positionals;
			if (!left || !right) throw new Error('diff requires two capture files');
			result = await executeSpecimenDiff({
				left: await readCapture(resolve(root, left)),
				right: await readCapture(resolve(root, right)),
				...(parsed.options.has('allow-context')
					? { allowContextDifferences: parsed.options.get('allow-context')?.split(',') }
					: {}),
				...(parsed.flags.has('require-visual') ? { requireVisual: true } : {}),
			});
		} else {
			bench = await (io.createBench ?? createSpecimenBench)({
				root,
				configFile: parsed.options.get('config'),
			});
			if (parsed.action === 'list')
				result = await executeSpecimenCommand(bench, 'specimen-list', {});
			else if (parsed.action === 'build')
				result = await executeSpecimenCommand(bench, 'specimen-build', {
					outDir: resolve(root, parsed.positionals[0] ?? ''),
				});
			else {
				const context: Partial<SpecimenContext> = {};
				const viewport = parsed.options.get('viewport');
				const container = parsed.options.get('container');
				if (viewport) context.viewport = dimensions(viewport);
				if (container) context.container = dimensions(container);
				// Validate raw values through the AFD schema rather than coercing a typo to a context.
				const raw: Record<string, string> = {};
				for (const [option, field] of [
					['theme', 'theme'],
					['locale', 'locale'],
					['reduced-motion', 'reducedMotion'],
					['motion', 'motion'],
				] as const) {
					const value = parsed.options.get(option);
					if (value) raw[field] = value;
				}
				const input = {
					id: parsed.positionals[0],
					context: { ...context, ...raw },
					...(parsed.options.has('checkpoint')
						? { checkpoint: parsed.options.get('checkpoint') }
						: {}),
					...(parsed.options.has('screenshot')
						? { screenshot: resolve(root, parsed.options.get('screenshot') ?? '') }
						: {}),
				};
				result = await executeSpecimenCommand(bench, 'specimen-render', input);
			}
		}
		await bench?.close();
		bench = undefined;
		if (output) await saveResult(output, result);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		stderr(`${message}\n`);
		result = failure({
			code: 'SPECIMEN_CLI_ERROR',
			message,
			suggestion:
				'Use specimen list, render ID, diff LEFT.json RIGHT.json, or build OUTDIR; check option values and file paths.',
		});
	} finally {
		if (bench) {
			try {
				await bench.close();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				stderr(`${message}\n`);
				result = failure({
					code: 'SPECIMEN_DISPOSAL_FAILED',
					message,
					suggestion: 'Inspect the browser/server cleanup failure before reusing this environment.',
				});
			}
		}
	}
	stdout(`${JSON.stringify(result)}\n`);
	return result.success ? 0 : 1;
}
