/** JSON-only CLI adapter over the shared AFD command definitions. */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
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
import { DESIGN_ALLOWED_OPTIONS, isDesignCliAction, runDesignCliAction } from './design-actions.js';

interface CliBench extends SpecimenCommandBench {
	close(): Promise<void>;
}
export interface CliIO {
	stdout?: (text: string) => void;
	stderr?: (text: string) => void;
	createBench?: (options: BenchOptions) => Promise<CliBench>;
	/**
	 * Interactive person confirmation callback for host-verified CLI commands (`decision-record`
	 * card mode and `design-release`). Defaults to prompting on an interactive TTY (`stdin.isTTY && stderr.isTTY`)
	 * and refusing non-interactive runs (`PERSON_REQUIRED`).
	 */
	confirmPrompt?: (
		prompt: string
	) => Promise<boolean | { confirmed: boolean; confirmedBy?: string }>;
}

async function promptCliHumanConfirmation(
	prompt: string,
	customPrompt?: CliIO['confirmPrompt']
): Promise<{ humanConfirmed: true; channel: 'cli'; confirmedBy?: string } | undefined> {
	if (customPrompt) {
		const answer = await customPrompt(prompt);
		if (typeof answer === 'boolean') {
			return answer ? { humanConfirmed: true, channel: 'cli' } : undefined;
		}
		return answer.confirmed
			? {
					humanConfirmed: true,
					channel: 'cli',
					...(answer.confirmedBy ? { confirmedBy: answer.confirmedBy } : {}),
				}
			: undefined;
	}
	if (!process.stdin.isTTY || !process.stderr.isTTY) {
		return undefined;
	}
	const rl = createInterface({ input: process.stdin, output: process.stderr });
	try {
		const reply = (await rl.question(`${prompt} [y/N]: `)).trim().toLowerCase();
		if (reply === 'y' || reply === 'yes') {
			const user = process.env.USER ?? process.env.USERNAME;
			return {
				humanConfirmed: true,
				channel: 'cli',
				...(user ? { confirmedBy: user } : {}),
			};
		}
		return undefined;
	} finally {
		rl.close();
	}
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
	'id',
	'ids',
	'label',
	'kind',
	'component',
	'pattern',
	'limit',
	'before',
	'after',
	'left-set',
	'left-id',
	'right-set',
	'right-id',
	'file',
	'files',
	'tag',
	'match',
	'workers',
	'flake-cap',
	'capture',
	'runs',
	'note',
	'gaps',
	'out',
	'allow-failed',
	'revision',
	'threshold',
	'role',
	'name',
	'selector',
	'index',
	'set',
	'scenario',
	'module',
	'export-name',
	'target',
	'title',
	'runner',
	'pin-clock',
	'captures',
	'obligations',
	'timeout',
	'point',
	'pointer',
	'text',
	'assignee',
	'specimen',
	'state',
	'reason',
	'outcome',
	'slug',
	'question',
	'supersedes',
	'items',
	'chosen',
	'specimens',
	'tokens',
	'commands',
	'consumer',
	'job',
	'persona',
	'modality',
	'app-date',
	'max-actions',
	'baseline-walk',
	'requested-tools',
	'card',
	'cards',
	'refusal-scope',
	'remediation',
	'status',
	'severity',
	'scope',
	'release',
	'decisions',
	'released-at',
	'meant-to-fix',
	'source',
	'upstream-version',
	'accept',
	'decline',
	'waivers',
	'resolutions',
]);
const flagOptions = new Set([
	'require-visual',
	'apply',
	'helpers',
	'retry',
	'no-axe',
	'orphaned',
	'no-orphaned',
	'include-proposed',
	'regression-accepted',
	'include-provisional',
	'include-decided',
	'released',
	'unreleased',
	'bind',
	'all-statements',
]);
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
		const allowEmpty = key === 'text' || key === 'reason';
		if (value === undefined || value.startsWith('--') || (!value && !allowEmpty))
			throw new Error(`Option ${item} needs a value`);
		options.set(key, value);
	}
	const action = positionals.shift();
	if (!action)
		throw new Error(
			'Choose a command: list, validate, inspect, render, capture, compare, review, run, themes, diff, build, point, point-move, point-check, note-add, note-list, note-check, note-move, note-resolve, note-reopen, job-create, job-run, decision-record, decision-get, decision-list, decision-check, design-states, panel-walk, design-card-list, design-release, pattern-fork, pattern-compare, or pattern-merge'
		);
	return { action, positionals, options, flags };
}
function dimensions(value: string): { width: number; height: number } {
	const match = /^(\d+)x(\d+)$/.exec(value);
	if (!match) throw new Error(`Invalid dimensions: ${value}; use WIDTHxHEIGHT`);
	return { width: Number(match[1]), height: Number(match[2]) };
}
function validateOptions(parsed: ParsedArguments): void {
	const allowed: Record<string, Set<string>> = {
		list: new Set([
			'root',
			'config',
			'output',
			'kind',
			'component',
			'pattern',
			'match',
			'limit',
			'after',
		]),
		validate: new Set(['root', 'config', 'output', 'id', 'file']),
		migrate: new Set(['root', 'config', 'output', 'files', 'apply', 'helpers']),
		render: new Set([
			'root',
			'config',
			'output',
			'set',
			'checkpoint',
			'viewport',
			'container',
			'theme',
			'locale',
			'reduced-motion',
			'motion',
			'screenshot',
		]),
		inspect: new Set([
			'root',
			'config',
			'output',
			'viewport',
			'container',
			'theme',
			'locale',
			'reduced-motion',
			'motion',
		]),
		run: new Set([
			'root',
			'config',
			'output',
			'viewport',
			'container',
			'theme',
			'locale',
			'reduced-motion',
			'motion',
			'screenshot',
			'file',
			'tag',
			'match',
			'kind',
			'pattern',
			'workers',
			'retry',
			'flake-cap',
			'capture',
		]),
		coverage: new Set([
			'root',
			'config',
			'output',
			'file',
			'tag',
			'match',
			'pattern',
			'workers',
			'obligations',
			'captures',
		]),
		contract: new Set(['root', 'config', 'output', 'file', 'tag', 'match', 'workers']),
		suggest: new Set(['root', 'config', 'output', 'pattern', 'gaps', 'out', 'workers']),
		a11y: new Set([
			'root',
			'config',
			'output',
			'set',
			'checkpoint',
			'viewport',
			'container',
			'theme',
			'locale',
			'reduced-motion',
			'motion',
			'file',
			'tag',
			'match',
			'workers',
		]),
		themes: new Set([
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
			'threshold',
			'file',
			'tag',
			'match',
			'workers',
		]),
		matrix: new Set([
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
			'workers',
		]),
		profile: new Set([
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
			'file',
			'tag',
			'match',
			'runs',
		]),
		baseline: new Set([
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
			'file',
			'tag',
			'match',
			'runs',
			'note',
		]),
		diff: new Set([
			'root',
			'output',
			'allow-context',
			'require-visual',
			'left-set',
			'left-id',
			'right-set',
			'right-id',
		]),
		capture: new Set([
			'root',
			'config',
			'output',
			'ids',
			'label',
			'checkpoint',
			'no-axe',
			'viewport',
			'container',
			'theme',
			'locale',
			'reduced-motion',
			'motion',
			'file',
			'tag',
			'match',
			'kind',
			'workers',
		]),
		compare: new Set([
			'root',
			'config',
			'output',
			'ids',
			'checkpoint',
			'viewport',
			'container',
			'theme',
			'locale',
			'reduced-motion',
			'motion',
			'workers',
		]),
		review: new Set(['root', 'config', 'output', 'before', 'after', 'ids']),
		build: new Set(['root', 'config', 'output']),
		pack: new Set(['root', 'config', 'output', 'workers', 'allow-failed']),
		'pack-check': new Set(['root', 'config', 'output', 'workers', 'allow-failed']),
		'pack-export': new Set(['root', 'config', 'output', 'revision']),
		point: new Set([
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
			'role',
			'name',
			'selector',
		]),
		'point-move': new Set(['root', 'config', 'output', 'index']),
		'point-check': new Set(['root', 'config', 'output']),
		'note-add': new Set([
			'root',
			'config',
			'output',
			'point',
			'pointer',
			'text',
			'assignee',
			'timeout',
		]),
		'note-list': new Set([
			'root',
			'config',
			'output',
			'specimen',
			'state',
			'assignee',
			'orphaned',
			'no-orphaned',
			'limit',
			'after',
		]),
		'note-check': new Set(['root', 'config', 'output', 'specimen', 'timeout']),
		'note-move': new Set(['root', 'config', 'output', 'point', 'pointer', 'reason', 'timeout']),
		'note-resolve': new Set([
			'root',
			'config',
			'output',
			'ids',
			'outcome',
			'reason',
			'revision',
			'capture',
		]),
		'note-reopen': new Set(['root', 'config', 'output', 'reason']),
		'job-create': new Set([
			'root',
			'config',
			'output',
			'scenario',
			'module',
			'export-name',
			'target',
			'title',
			'runner',
			'pin-clock',
			'captures',
		]),
		'job-run': new Set([
			'root',
			'config',
			'output',
			'label',
			'no-axe',
			'timeout',
			'pin-clock',
			'viewport',
			'container',
			'theme',
			'locale',
			'reduced-motion',
			'motion',
		]),
		'decision-record': new Set([
			'root',
			'config',
			'output',
			'slug',
			'question',
			'set',
			'supersedes',
			'items',
			'card',
			'cards',
			'chosen',
			'reason',
			'refusal-scope',
			'regression-accepted',
			'remediation',
			'meant-to-fix',
			'specimens',
			'files',
			'tokens',
		]),
		'decision-get': new Set(['root', 'config', 'output']),
		'decision-list': new Set([
			'root',
			'config',
			'output',
			'kind',
			'released',
			'unreleased',
			'limit',
			'after',
		]),
		'decision-check': new Set(['root', 'config', 'output', 'files', 'specimens', 'tokens']),
		...DESIGN_ALLOWED_OPTIONS,
	};
	const known = allowed[parsed.action];
	if (!known) throw new Error(`Unknown command: ${parsed.action}`);
	for (const option of [...parsed.options.keys(), ...parsed.flags]) {
		if (!known.has(option))
			throw new Error(`Option --${option} does not apply to ${parsed.action}`);
	}
	if (parsed.action === 'diff') {
		const hasLeftSet = parsed.options.has('left-set');
		const hasLeftId = parsed.options.has('left-id');
		const hasRightSet = parsed.options.has('right-set');
		const hasRightId = parsed.options.has('right-id');
		if (hasLeftSet !== hasLeftId) throw new Error('Pass both --left-set and --left-id together.');
		if (hasRightSet !== hasRightId)
			throw new Error('Pass both --right-set and --right-id together.');
		const expectedFiles = 2 - (hasLeftSet ? 1 : 0) - (hasRightSet ? 1 : 0);
		if (parsed.positionals.length !== expectedFiles)
			throw new Error(
				`diff expects ${expectedFiles} positional argument${expectedFiles === 1 ? '' : 's'}`
			);
		return;
	}
	if (parsed.action === 'capture') {
		if (parsed.options.has('ids') && parsed.positionals.length > 0)
			throw new Error('Give specimen ids positionally or with --ids, not both.');
		const hasIds = parsed.options.has('ids') || parsed.positionals.length > 0;
		if (hasIds) {
			for (const option of ['file', 'tag', 'match', 'kind'])
				if (parsed.options.has(option))
					throw new Error(`Option --${option} cannot be combined with explicit specimen ids`);
		}
		return;
	}
	if (parsed.action === 'review') {
		const hasBeforeOpt = parsed.options.has('before');
		const hasAfterOpt = parsed.options.has('after');
		if (hasBeforeOpt !== hasAfterOpt) {
			throw new Error('Pass both --before and --after together, or pass both positionally.');
		}
		if (hasBeforeOpt && parsed.positionals.length > 0) {
			throw new Error('Pass before and after positionally or with --before/--after, not both.');
		}
		if (!hasBeforeOpt && parsed.positionals.length !== 2) {
			throw new Error('review expects <before> <after> or --before <set> --after <set>.');
		}
		return;
	}
	if (parsed.action === 'compare') {
		if (parsed.options.has('ids') && parsed.positionals.length > 0)
			throw new Error('Give variant ids positionally or with --ids, not both.');
		return;
	}
	if (parsed.action === 'note-add') {
		const hasPoint = parsed.options.has('point');
		const hasPointer = parsed.options.has('pointer');
		if (hasPoint && hasPointer) throw new Error('Give either --point or --pointer, not both.');
		if ((hasPoint || hasPointer) && parsed.positionals.length > 0)
			throw new Error('Give a point/pointer positionally or via --point/--pointer, not both.');
		if (!hasPoint && !hasPointer && parsed.positionals.length !== 1)
			throw new Error('note-add expects a --point, --pointer, or 1 positional target');
		return;
	}
	if (parsed.action === 'note-list') {
		if (parsed.flags.has('orphaned') && parsed.flags.has('no-orphaned'))
			throw new Error('Give either --orphaned or --no-orphaned, not both.');
		if (parsed.positionals.length !== 0)
			throw new Error('note-list expects 0 positional arguments');
		return;
	}
	if (parsed.action === 'note-check') {
		if (parsed.options.has('specimen') && parsed.positionals.length > 0)
			throw new Error('Give a specimen id positionally or with --specimen, not both.');
		if (parsed.positionals.length > 1)
			throw new Error('note-check expects at most 1 positional argument');
		return;
	}
	if (parsed.action === 'note-move') {
		const hasPoint = parsed.options.has('point');
		const hasPointer = parsed.options.has('pointer');
		if (hasPoint && hasPointer) throw new Error('Give either --point or --pointer, not both.');
		if (hasPoint || hasPointer) {
			if (parsed.positionals.length !== 1)
				throw new Error(
					'note-move expects 1 positional argument (note id) when using --point/--pointer'
				);
		} else if (parsed.positionals.length !== 2) {
			throw new Error(
				'note-move expects 2 positional arguments (note id and point/pointer) or --point/--pointer'
			);
		}
		return;
	}
	if (parsed.action === 'note-resolve') {
		if (parsed.options.has('ids') && parsed.positionals.length > 0)
			throw new Error('Give note ids positionally or with --ids, not both.');
		if (!parsed.options.has('ids') && parsed.positionals.length === 0)
			throw new Error('note-resolve expects at least 1 note id positionally or via --ids');
		return;
	}
	if (parsed.action === 'design-states') {
		if (parsed.options.has('commands') && parsed.positionals.length > 0)
			throw new Error('Give commands positionally or with --commands, not both.');
		return;
	}
	if (parsed.action === 'panel-walk') {
		if (parsed.options.has('job') && parsed.positionals.length > 0)
			throw new Error('Give a job id positionally or with --job, not both.');
		if (parsed.positionals.length > 1)
			throw new Error('panel-walk expects at most 1 positional argument');
		return;
	}
	if (parsed.action === 'pattern-fork') {
		if (parsed.options.has('source') && parsed.positionals.length > 0)
			throw new Error('Give source positionally or with --source, not both.');
		if (parsed.positionals.length > 2)
			throw new Error('pattern-fork expects at most 2 positional arguments');
		return;
	}
	if (parsed.action === 'pattern-compare' || parsed.action === 'pattern-merge') {
		if (parsed.options.has('pattern') && parsed.positionals.length > 0)
			throw new Error('Give pattern positionally or with --pattern, not both.');
		if (parsed.positionals.length > 1)
			throw new Error(`${parsed.action} expects at most 1 positional argument`);
		return;
	}
	const expected =
		parsed.action === 'list' ||
		parsed.action === 'validate' ||
		parsed.action === 'migrate' ||
		parsed.action === 'decision-record' ||
		parsed.action === 'decision-list' ||
		parsed.action === 'decision-check' ||
		parsed.action === 'design-card-list' ||
		parsed.action === 'design-release'
			? 0
			: parsed.action === 'point-move'
				? 2
				: 1;
	const selects = ['run', 'a11y', 'profile', 'baseline', 'themes'].includes(parsed.action);
	const suite =
		(selects && parsed.positionals.length === 0) ||
		(['coverage', 'contract', 'pack', 'pack-check'].includes(parsed.action) &&
			parsed.positionals.length <= 1) ||
		(parsed.action === 'suggest' &&
			parsed.positionals.length === 0 &&
			parsed.options.has('pattern') &&
			parsed.options.has('gaps'));
	const suiteOptions = ['file', 'tag', 'match', 'kind', 'pattern', 'workers', 'retry', 'flake-cap'];
	// How many runs apply to one entry as to many.
	if (selects && !suite)
		for (const option of suiteOptions)
			if (parsed.options.has(option) || parsed.flags.has(option))
				throw new Error(`Option --${option} selects many; omit the id to use it`);
	if (!suite && parsed.positionals.length !== expected)
		throw new Error(
			`${parsed.action} expects ${expected} positional argument${expected === 1 ? '' : 's'}`
		);
}
/** What selects and shapes a suite, from `specimen run` without a story id. */
function suiteInput(parsed: ParsedArguments): Record<string, unknown> {
	const filter = {
		...(parsed.options.has('file') ? { file: parsed.options.get('file') } : {}),
		...(parsed.options.has('tag')
			? { tags: (parsed.options.get('tag') ?? '').split(',').filter(Boolean) }
			: {}),
		...(parsed.options.has('match') ? { match: parsed.options.get('match') } : {}),
		...(parsed.action === 'run' && parsed.options.has('kind')
			? { kind: (parsed.options.get('kind') ?? '').split(',').filter(Boolean) }
			: {}),
		...(parsed.action === 'run' && parsed.options.has('pattern')
			? { pattern: parsed.options.get('pattern') }
			: {}),
	};
	const whole = (option: string) => {
		const value = Number(parsed.options.get(option));
		if (!Number.isInteger(value)) throw new Error(`--${option} expects a whole number`);
		return value;
	};
	return {
		...(Object.keys(filter).length ? { filter } : {}),
		...(parsed.options.has('workers') ? { workers: whole('workers') } : {}),
		...(parsed.flags.has('retry') ? { retry: true } : {}),
		...(parsed.options.has('flake-cap') ? { flakeCap: whole('flake-cap') } : {}),
		...(parsed.options.has('capture') ? { capture: parsed.options.get('capture') } : {}),
	};
}
/** A run the stories or job failed: the command succeeded, but a script calling it must see the failure. */
function storiesFailed(result: CommandResult<unknown>): boolean {
	const data = result.data as
		| {
				valid?: boolean;
				status?: string;
				cases?: { failed?: unknown[] };
				outcome?: string | { status?: string };
				counts?: { failed?: number; errored?: number };
		  }
		| undefined;
	if (data?.counts?.failed || data?.counts?.errored || data?.cases?.failed?.length) return true;
	if (data?.valid === false || data?.status === 'failed') return true;
	const outcome = data?.outcome;
	if (typeof outcome === 'string') return outcome === 'failed' || outcome === 'failed-after-retry';
	return outcome?.status === 'failed';
}
function parseCapturesOption(raw: string): unknown {
	const trimmed = raw.trim();
	if (!trimmed) return [];
	if (trimmed.startsWith('[')) {
		try {
			return JSON.parse(trimmed);
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			throw new Error(`Invalid JSON for --captures: ${detail}`);
		}
	}
	return trimmed
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean)
		.map((part) => {
			const step = Number(part);
			if (!Number.isInteger(step) || step <= 0) {
				throw new Error(
					`Invalid step number in --captures: ${part}; pass positive step numbers or a JSON array`
				);
			}
			return step;
		});
}
function splitTopLevelList(raw: string): string[] {
	const items: string[] = [];
	let current = '';
	let braceDepth = 0;
	let bracketDepth = 0;
	for (let i = 0; i < raw.length; i++) {
		const ch = raw[i] as string;
		if (ch === '{') braceDepth++;
		else if (ch === '}' && braceDepth > 0) braceDepth--;
		else if (ch === '[') bracketDepth++;
		else if (ch === ']' && bracketDepth > 0) bracketDepth--;
		if (ch === ',' && braceDepth === 0 && bracketDepth === 0) {
			if (current.length > 0) items.push(current);
			current = '';
		} else {
			current += ch;
		}
	}
	if (current.length > 0) items.push(current);
	return items;
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
			const files = [...parsed.positionals];
			const left =
				parsed.options.has('left-set') && parsed.options.has('left-id')
					? {
							set: parsed.options.get('left-set') as string,
							id: parsed.options.get('left-id') as string,
						}
					: await readCapture(resolve(root, files.shift() ?? ''));
			const right =
				parsed.options.has('right-set') && parsed.options.has('right-id')
					? {
							set: parsed.options.get('right-set') as string,
							id: parsed.options.get('right-id') as string,
						}
					: await readCapture(resolve(root, files.shift() ?? ''));
			result = await executeSpecimenDiff(
				{
					left,
					right,
					...(parsed.options.has('allow-context')
						? { allowContextDifferences: parsed.options.get('allow-context')?.split(',') }
						: {}),
					...(parsed.flags.has('require-visual') ? { requireVisual: true } : {}),
				},
				{ root }
			);
		} else {
			bench = await (io.createBench ?? createSpecimenBench)({
				root,
				configFile: parsed.options.get('config'),
			});
			if (parsed.action === 'list') {
				const rawLimit = parsed.options.get('limit');
				let limit: number | undefined;
				if (rawLimit !== undefined) {
					const parsedLimit = Number(rawLimit);
					if (!rawLimit.trim() || !Number.isInteger(parsedLimit))
						throw new Error('--limit expects a whole number');
					limit = parsedLimit;
				}
				result = await executeSpecimenCommand(bench, 'specimen-list', {
					...(parsed.options.has('kind') ? { kind: parsed.options.get('kind') } : {}),
					...(parsed.options.has('component')
						? { component: parsed.options.get('component') }
						: {}),
					...(parsed.options.has('pattern') ? { pattern: parsed.options.get('pattern') } : {}),
					...(parsed.options.has('match') ? { match: parsed.options.get('match') } : {}),
					...(limit !== undefined ? { limit } : {}),
					...(parsed.options.has('after') ? { after: parsed.options.get('after') } : {}),
				});
			} else if (parsed.action === 'migrate')
				result = await executeSpecimenCommand(bench, 'specimen-migrate', {
					...(parsed.options.has('files')
						? { files: (parsed.options.get('files') ?? '').split(',').filter(Boolean) }
						: {}),
					...(parsed.flags.has('apply') ? { apply: true } : {}),
					...(parsed.flags.has('helpers') ? { helpers: true } : {}),
				});
			else if (parsed.action === 'validate')
				result = await executeSpecimenCommand(bench, 'specimen-validate', {
					...(parsed.options.has('id') ? { id: parsed.options.get('id') } : {}),
					...(parsed.options.has('file') ? { file: parsed.options.get('file') } : {}),
				});
			else if (parsed.action === 'build')
				result = await executeSpecimenCommand(bench, 'specimen-build', {
					outDir: resolve(root, parsed.positionals[0] ?? ''),
				});
			else if (parsed.action === 'decision-record') {
				const splitList = (option: string) =>
					(parsed.options.get(option) ?? '').split(',').filter(Boolean);
				const splitGlobs = (option: string) => splitTopLevelList(parsed.options.get(option) ?? '');
				const rawSupersedes = parsed.options.has('supersedes')
					? splitList('supersedes')
					: undefined;
				const supersedes =
					rawSupersedes === undefined
						? undefined
						: rawSupersedes.length === 1
							? rawSupersedes[0]
							: rawSupersedes;
				const hasSubjects =
					parsed.options.has('specimens') ||
					parsed.options.has('files') ||
					parsed.options.has('tokens');
				const subjects = hasSubjects
					? {
							...(parsed.options.has('specimens') ? { specimens: splitList('specimens') } : {}),
							...(parsed.options.has('files') ? { files: splitGlobs('files') } : {}),
							...(parsed.options.has('tokens') ? { tokens: splitList('tokens') } : {}),
						}
					: undefined;
				const rawMeantToFix = parsed.options.get('meant-to-fix');
				let meantToFix: unknown;
				if (rawMeantToFix !== undefined) {
					try {
						meantToFix = JSON.parse(rawMeantToFix) as unknown;
					} catch {
						throw new Error(
							'--meant-to-fix expects a valid JSON object: {"job":"...","target":"..."}'
						);
					}
				}
				const isCardMode = parsed.options.has('card') || parsed.options.has('cards');
				const cardConfirmation = isCardMode
					? await promptCliHumanConfirmation(
							`Confirm decision-record (${parsed.options.get('chosen') ?? ''}) for ${parsed.options.get('card') ?? parsed.options.get('cards') ?? 'card(s)'}?`,
							io.confirmPrompt
						)
					: undefined;
				result = await executeSpecimenCommand(
					bench,
					'decision-record',
					{
						...(parsed.options.has('slug') ? { slug: parsed.options.get('slug') } : {}),
						...(parsed.options.has('question') ? { question: parsed.options.get('question') } : {}),
						...(parsed.options.has('set') ? { set: parsed.options.get('set') } : {}),
						...(supersedes !== undefined ? { supersedes } : {}),
						...(parsed.options.has('items') ? { items: splitList('items') } : {}),
						...(parsed.options.has('card') ? { card: parsed.options.get('card') } : {}),
						...(parsed.options.has('cards') ? { cards: splitList('cards') } : {}),
						...(parsed.options.has('chosen') ? { chosen: parsed.options.get('chosen') } : {}),
						...(parsed.options.has('reason') ? { reason: parsed.options.get('reason') } : {}),
						...(parsed.options.has('refusal-scope')
							? { refusalScope: parsed.options.get('refusal-scope') }
							: {}),
						...(parsed.flags.has('regression-accepted') ? { regressionAccepted: true } : {}),
						...(parsed.options.has('remediation')
							? { remediation: parsed.options.get('remediation') }
							: {}),
						...(meantToFix !== undefined ? { meantToFix } : {}),
						...(subjects !== undefined ? { subjects } : {}),
					},
					cardConfirmation
				);
			} else if (parsed.action === 'decision-get')
				result = await executeSpecimenCommand(bench, 'decision-get', {
					decision: parsed.positionals[0],
				});
			else if (parsed.action === 'decision-list') {
				if (parsed.flags.has('released') && parsed.flags.has('unreleased'))
					throw new Error('Give either --released or --unreleased, not both.');
				const rawLimit = parsed.options.get('limit');
				let limit: number | undefined;
				if (rawLimit !== undefined) {
					const parsedLimit = Number(rawLimit);
					if (!rawLimit.trim() || !Number.isInteger(parsedLimit))
						throw new Error('--limit expects a whole number');
					limit = parsedLimit;
				}
				result = await executeSpecimenCommand(bench, 'decision-list', {
					...(parsed.options.has('kind') ? { kind: parsed.options.get('kind') } : {}),
					...(parsed.flags.has('released') ? { released: true } : {}),
					...(parsed.flags.has('unreleased') ? { released: false } : {}),
					...(limit !== undefined ? { limit } : {}),
					...(parsed.options.has('after') ? { after: parsed.options.get('after') } : {}),
				});
			} else if (parsed.action === 'decision-check') {
				const splitList = (option: string) =>
					(parsed.options.get(option) ?? '').split(',').filter(Boolean);
				const splitGlobs = (option: string) => splitTopLevelList(parsed.options.get(option) ?? '');
				result = await executeSpecimenCommand(bench, 'decision-check', {
					...(parsed.options.has('files') ? { files: splitGlobs('files') } : {}),
					...(parsed.options.has('specimens') ? { specimens: splitList('specimens') } : {}),
					...(parsed.options.has('tokens') ? { tokens: splitList('tokens') } : {}),
				});
			} else if (isDesignCliAction(parsed.action)) {
				const designResult = await runDesignCliAction(bench, parsed, (prompt) =>
					promptCliHumanConfirmation(prompt, io.confirmPrompt)
				);
				if (!designResult) throw new Error(`Unknown command: ${parsed.action}`);
				result = designResult;
			} else {
				const context: Partial<SpecimenContext> = {};
				const viewport = parsed.options.get('viewport');
				const container = parsed.options.get('container');
				// A matrix reads these as lists of axis values, below; `themes` reads --theme as a list.
				if (viewport && parsed.action !== 'matrix') context.viewport = dimensions(viewport);
				if (container && parsed.action !== 'matrix') context.container = dimensions(container);
				// Validate raw values through the AFD schema rather than coercing a typo to a context.
				const raw: Record<string, string> = {};
				for (const [option, field] of [
					['theme', 'theme'],
					['locale', 'locale'],
					['reduced-motion', 'reducedMotion'],
					['motion', 'motion'],
				] as const) {
					const value = parsed.options.get(option);
					if (value && !(parsed.action === 'themes' && option === 'theme')) raw[field] = value;
				}
				if (parsed.action === 'capture') {
					const ids = parsed.options.has('ids')
						? (parsed.options.get('ids') ?? '').split(',').filter(Boolean)
						: parsed.positionals.length > 0
							? parsed.positionals
							: undefined;
					const suite = suiteInput(parsed);
					const baseFilter = (suite.filter as Record<string, unknown> | undefined) ?? {};
					const kind = parsed.options.has('kind')
						? (parsed.options.get('kind') ?? '').split(',').filter(Boolean)
						: undefined;
					const filter =
						Object.keys(baseFilter).length > 0 || kind !== undefined
							? { ...baseFilter, ...(kind !== undefined ? { kind } : {}) }
							: undefined;
					const mergedContext = { ...context, ...raw };
					result = await executeSpecimenCommand(bench, 'specimen-capture', {
						...(ids !== undefined ? { ids } : {}),
						...(filter !== undefined ? { filter } : {}),
						...(Object.keys(mergedContext).length > 0 ? { context: mergedContext } : {}),
						...(parsed.options.has('checkpoint')
							? { checkpoint: parsed.options.get('checkpoint') }
							: {}),
						...(parsed.options.has('label') ? { label: parsed.options.get('label') } : {}),
						...(parsed.flags.has('no-axe') ? { axe: false } : {}),
						...(suite.workers !== undefined ? { workers: suite.workers } : {}),
					});
				} else if (parsed.action === 'compare') {
					const ids = parsed.options.has('ids')
						? (parsed.options.get('ids') ?? '').split(',').filter(Boolean)
						: parsed.positionals;
					const suite = suiteInput(parsed);
					const mergedContext = { ...context, ...raw };
					result = await executeSpecimenCommand(bench, 'specimen-compare', {
						ids,
						...(Object.keys(mergedContext).length > 0 ? { context: mergedContext } : {}),
						...(parsed.options.has('checkpoint')
							? { checkpoint: parsed.options.get('checkpoint') }
							: {}),
						...(suite.workers !== undefined ? { workers: suite.workers } : {}),
					});
				} else if (parsed.action === 'review') {
					const before = parsed.options.get('before') ?? parsed.positionals[0] ?? '';
					const after = parsed.options.get('after') ?? parsed.positionals[1] ?? '';
					const hasIds = parsed.options.has('ids');
					const ids = hasIds
						? (parsed.options.get('ids') ?? '')
								.split(',')
								.map((id) => id.trim())
								.filter(Boolean)
						: undefined;
					result = await executeSpecimenCommand(bench, 'specimen-review', {
						before,
						after,
						...(hasIds ? { ids: ids ?? [] } : {}),
					});
				} else if (parsed.action === 'themes') {
					// The command's schema refuses a share outside 0 to 1, and a word, which is NaN.
					const threshold = parsed.options.get('threshold');
					result = await executeSpecimenCommand(bench, 'specimen-themes', {
						...(parsed.positionals[0] ? { id: parsed.positionals[0] } : {}),
						context: { ...context, ...raw },
						...(parsed.options.has('theme')
							? { themes: (parsed.options.get('theme') ?? '').split(',').filter(Boolean) }
							: {}),
						...(threshold === undefined
							? {}
							: { threshold: threshold.trim() ? Number(threshold) : Number.NaN }),
						...(parsed.options.has('checkpoint')
							? { checkpoint: parsed.options.get('checkpoint') }
							: {}),
						...suiteInput(parsed),
					});
				} else if (parsed.action === 'matrix') {
					const list = (option: string) =>
						(parsed.options.get(option) ?? '').split(',').filter(Boolean);
					const axes = {
						...(parsed.options.has('theme') ? { theme: list('theme') } : {}),
						...(parsed.options.has('viewport')
							? { viewport: list('viewport').map(dimensions) }
							: {}),
						...(parsed.options.has('container')
							? { container: list('container').map(dimensions) }
							: {}),
						...(parsed.options.has('locale') ? { locale: list('locale') } : {}),
						...(parsed.options.has('reduced-motion')
							? { reducedMotion: list('reduced-motion') }
							: {}),
						...(parsed.options.has('motion') ? { motion: list('motion') } : {}),
					};
					result = await executeSpecimenCommand(bench, 'specimen-matrix', {
						id: parsed.positionals[0],
						axes,
						...(parsed.options.has('checkpoint')
							? { checkpoint: parsed.options.get('checkpoint') }
							: {}),
						...suiteInput(parsed),
					});
				} else if (parsed.action === 'profile' || parsed.action === 'baseline') {
					const runs = parsed.options.get('runs');
					if (runs !== undefined && !Number.isInteger(Number(runs)))
						throw new Error('--runs expects a whole number');
					const note = parsed.options.get('note');
					result = await executeSpecimenCommand(
						bench,
						parsed.action === 'profile' ? 'specimen-profile' : 'specimen-baseline',
						{
							...(parsed.positionals[0] ? { id: parsed.positionals[0] } : {}),
							context: { ...context, ...raw },
							...(parsed.options.has('checkpoint')
								? { checkpoint: parsed.options.get('checkpoint') }
								: {}),
							...(runs === undefined ? {} : { runs: Number(runs) }),
							...(note === undefined ? {} : { notes: [note] }),
							...suiteInput(parsed),
						}
					);
				} else if (parsed.action === 'suggest') {
					result = await executeSpecimenCommand(bench, 'specimen-suggest', {
						...(parsed.positionals[0] ? { component: parsed.positionals[0] } : {}),
						...(parsed.options.has('pattern') ? { pattern: parsed.options.get('pattern') } : {}),
						...(parsed.options.has('gaps')
							? { gaps: (parsed.options.get('gaps') ?? '').split(',').filter(Boolean) }
							: {}),
						...suiteInput(parsed),
					});
					const out = parsed.options.get('out');
					// Never over a file someone may have corrected.
					if (out && result.success)
						await writeFile(resolve(root, out), (result.data as { source: string }).source, {
							flag: 'wx',
						});
				} else if (parsed.action === 'contract') {
					result = await executeSpecimenCommand(bench, 'specimen-contract', {
						...(parsed.positionals[0] ? { component: parsed.positionals[0] } : {}),
						...suiteInput(parsed),
					});
				} else if (parsed.action === 'coverage') {
					result = await executeSpecimenCommand(bench, 'specimen-coverage', {
						...(parsed.positionals[0] ? { component: parsed.positionals[0] } : {}),
						...(parsed.options.has('pattern') ? { pattern: parsed.options.get('pattern') } : {}),
						...(parsed.options.has('obligations')
							? { obligations: parsed.options.get('obligations') }
							: {}),
						...(parsed.options.has('captures') ? { captures: parsed.options.get('captures') } : {}),
						...suiteInput(parsed),
					});
				} else if (parsed.action === 'pack' || parsed.action === 'pack-check') {
					result = await executeSpecimenCommand(
						bench,
						parsed.action === 'pack' ? 'specimen-pack' : 'specimen-pack-check',
						{
							...(parsed.positionals[0] ? { component: parsed.positionals[0] } : {}),
							...(parsed.options.has('allow-failed')
								? {
										allowFailed: (parsed.options.get('allow-failed') ?? '')
											.split(',')
											.filter(Boolean),
									}
								: {}),
							...suiteInput(parsed),
						}
					);
				} else if (parsed.action === 'pack-export') {
					result = await executeSpecimenCommand(bench, 'specimen-pack-export', {
						directory: resolve(root, parsed.positionals[0] ?? ''),
						...(parsed.options.has('revision') ? { revision: parsed.options.get('revision') } : {}),
					});
				} else if (parsed.action === 'point') {
					const role = parsed.options.get('role');
					const name = parsed.options.get('name');
					const selector = parsed.options.get('selector');
					if (role && selector) throw new Error('Give either --role or --selector, not both');
					if (name !== undefined && !role) throw new Error('Option --name requires --role');
					if (role || selector) {
						const mergedContext = { ...context, ...raw };
						const target = role ? { role, ...(name !== undefined ? { name } : {}) } : { selector };
						result = await executeSpecimenCommand(bench, 'specimen-point', {
							id: parsed.positionals[0],
							...(Object.keys(mergedContext).length ? { context: mergedContext } : {}),
							...(parsed.options.has('checkpoint')
								? { checkpoint: parsed.options.get('checkpoint') }
								: {}),
							target,
						});
					} else {
						const hasContextFlags =
							Object.keys(context).length > 0 ||
							Object.keys(raw).length > 0 ||
							parsed.options.has('checkpoint');
						if (hasContextFlags) {
							throw new Error(
								'Pointer URI carries its own context and checkpoint; omit context flags or pass --role / --selector'
							);
						}
						result = await executeSpecimenCommand(bench, 'specimen-point', {
							pointer: parsed.positionals[0],
						});
					}
				} else if (parsed.action === 'point-move') {
					const rawIndex = parsed.options.get('index');
					let index: number | undefined;
					if (rawIndex !== undefined) {
						const parsedIndex = Number(rawIndex);
						if (!rawIndex.trim() || !Number.isInteger(parsedIndex)) {
							throw new Error('--index expects a whole number');
						}
						index = parsedIndex;
					}
					result = await executeSpecimenCommand(bench, 'specimen-point-move', {
						id: parsed.positionals[0],
						to: parsed.positionals[1],
						...(index === undefined ? {} : { index }),
					});
				} else if (parsed.action === 'point-check') {
					result = await executeSpecimenCommand(bench, 'specimen-point-check', {
						id: parsed.positionals[0],
					});
				} else if (parsed.action === 'note-add') {
					const rawTimeout = parsed.options.get('timeout');
					let timeoutMs: number | undefined;
					if (rawTimeout !== undefined) {
						const parsedTimeout = Number(rawTimeout);
						if (!rawTimeout.trim() || !Number.isInteger(parsedTimeout)) {
							throw new Error('--timeout expects a whole number');
						}
						timeoutMs = parsedTimeout;
					}
					const targetPos = parsed.positionals[0];
					const point = parsed.options.get('point');
					const pointer = parsed.options.get('pointer');
					const targetField =
						point !== undefined
							? { point }
							: pointer !== undefined
								? { pointer }
								: targetPos?.startsWith('specimen:')
									? { pointer: targetPos }
									: { point: targetPos };
					result = await executeSpecimenCommand(bench, 'specimen-note-add', {
						...targetField,
						text: parsed.options.get('text') ?? '',
						...(parsed.options.has('assignee') ? { assignee: parsed.options.get('assignee') } : {}),
						...(timeoutMs !== undefined ? { timeoutMs } : {}),
					});
				} else if (parsed.action === 'note-list') {
					const rawLimit = parsed.options.get('limit');
					let limit: number | undefined;
					if (rawLimit !== undefined) {
						const parsedLimit = Number(rawLimit);
						if (!rawLimit.trim() || !Number.isInteger(parsedLimit)) {
							throw new Error('--limit expects a whole number');
						}
						limit = parsedLimit;
					}
					result = await executeSpecimenCommand(bench, 'specimen-note-list', {
						...(parsed.options.has('specimen') ? { specimen: parsed.options.get('specimen') } : {}),
						...(parsed.options.has('state') ? { state: parsed.options.get('state') } : {}),
						...(parsed.options.has('assignee') ? { assignee: parsed.options.get('assignee') } : {}),
						...(parsed.flags.has('orphaned') ? { orphaned: true } : {}),
						...(parsed.flags.has('no-orphaned') ? { orphaned: false } : {}),
						...(limit !== undefined ? { limit } : {}),
						...(parsed.options.has('after') ? { after: parsed.options.get('after') } : {}),
					});
				} else if (parsed.action === 'note-check') {
					const rawTimeout = parsed.options.get('timeout');
					let timeoutMs: number | undefined;
					if (rawTimeout !== undefined) {
						const parsedTimeout = Number(rawTimeout);
						if (!rawTimeout.trim() || !Number.isInteger(parsedTimeout)) {
							throw new Error('--timeout expects a whole number');
						}
						timeoutMs = parsedTimeout;
					}
					const specimen = parsed.options.get('specimen') ?? parsed.positionals[0];
					result = await executeSpecimenCommand(bench, 'specimen-note-check', {
						...(specimen !== undefined ? { specimen } : {}),
						...(timeoutMs !== undefined ? { timeoutMs } : {}),
					});
				} else if (parsed.action === 'note-move') {
					const rawTimeout = parsed.options.get('timeout');
					let timeoutMs: number | undefined;
					if (rawTimeout !== undefined) {
						const parsedTimeout = Number(rawTimeout);
						if (!rawTimeout.trim() || !Number.isInteger(parsedTimeout)) {
							throw new Error('--timeout expects a whole number');
						}
						timeoutMs = parsedTimeout;
					}
					const targetPos = parsed.positionals[1];
					const point = parsed.options.get('point');
					const pointer = parsed.options.get('pointer');
					const targetField =
						point !== undefined
							? { point }
							: pointer !== undefined
								? { pointer }
								: targetPos?.startsWith('specimen:')
									? { pointer: targetPos }
									: { point: targetPos };
					result = await executeSpecimenCommand(bench, 'specimen-note-move', {
						id: parsed.positionals[0],
						...targetField,
						...(parsed.options.has('reason') ? { reason: parsed.options.get('reason') } : {}),
						...(timeoutMs !== undefined ? { timeoutMs } : {}),
					});
				} else if (parsed.action === 'note-resolve') {
					const revision = parsed.options.get('revision');
					const capture = parsed.options.get('capture');
					const evidence =
						revision !== undefined || capture !== undefined
							? {
									...(revision !== undefined ? { revision } : {}),
									...(capture !== undefined ? { capture } : {}),
								}
							: undefined;
					const idFields = parsed.options.has('ids')
						? { ids: (parsed.options.get('ids') ?? '').split(',').filter(Boolean) }
						: parsed.positionals.length === 1
							? { id: parsed.positionals[0] }
							: { ids: parsed.positionals };
					result = await executeSpecimenCommand(bench, 'specimen-note-resolve', {
						...idFields,
						outcome: parsed.options.get('outcome'),
						...(parsed.options.has('reason') ? { reason: parsed.options.get('reason') } : {}),
						...(evidence !== undefined ? { evidence } : {}),
					});
				} else if (parsed.action === 'note-reopen') {
					result = await executeSpecimenCommand(bench, 'specimen-note-reopen', {
						id: parsed.positionals[0],
						...(parsed.options.has('reason') ? { reason: parsed.options.get('reason') } : {}),
					});
				} else if (parsed.action === 'job-create') {
					const rawCaptures = parsed.options.get('captures');
					const pinClock = parsed.options.get('pin-clock');
					result = await executeSpecimenCommand(bench, 'specimen-job-create', {
						id: parsed.positionals[0],
						...(parsed.options.has('scenario') ? { scenario: parsed.options.get('scenario') } : {}),
						...(parsed.options.has('module') ? { module: parsed.options.get('module') } : {}),
						...(parsed.options.has('export-name')
							? { exportName: parsed.options.get('export-name') }
							: {}),
						...(parsed.options.has('target') ? { target: parsed.options.get('target') } : {}),
						...(parsed.options.has('title') ? { title: parsed.options.get('title') } : {}),
						...(parsed.options.has('runner') ? { runner: parsed.options.get('runner') } : {}),
						...(pinClock !== undefined ? { pin: { clock: pinClock } } : {}),
						...(rawCaptures !== undefined ? { captures: parseCapturesOption(rawCaptures) } : {}),
					});
				} else if (parsed.action === 'job-run') {
					const rawTimeout = parsed.options.get('timeout');
					let timeoutMs: number | undefined;
					if (rawTimeout !== undefined) {
						const parsedTimeout = Number(rawTimeout);
						if (!rawTimeout.trim() || !Number.isInteger(parsedTimeout)) {
							throw new Error('--timeout expects a whole number');
						}
						timeoutMs = parsedTimeout;
					}
					const mergedContext = { ...context, ...raw };
					const pinClock = parsed.options.get('pin-clock');
					result = await executeSpecimenCommand(bench, 'specimen-job-run', {
						id: parsed.positionals[0],
						...(Object.keys(mergedContext).length > 0 ? { context: mergedContext } : {}),
						...(parsed.options.has('label') ? { label: parsed.options.get('label') } : {}),
						...(parsed.flags.has('no-axe') ? { axe: false } : {}),
						...(timeoutMs !== undefined ? { timeoutMs } : {}),
						...(pinClock !== undefined ? { pin: { clock: pinClock } } : {}),
					});
				} else if (parsed.action === 'a11y') {
					const mergedContext = { ...context, ...raw };
					const set = parsed.options.get('set');
					result = await executeSpecimenCommand(bench, 'specimen-a11y', {
						...(parsed.positionals[0] ? { id: parsed.positionals[0] } : {}),
						...(set !== undefined
							? {
									set,
									...(Object.keys(mergedContext).length > 0 ? { context: mergedContext } : {}),
								}
							: { context: mergedContext }),
						...(parsed.options.has('checkpoint')
							? { checkpoint: parsed.options.get('checkpoint') }
							: {}),
						...suiteInput(parsed),
					});
				} else if (parsed.action === 'run' && parsed.positionals.length === 0)
					result = await executeSpecimenCommand(bench, 'specimen-run', {
						context: { ...context, ...raw },
						...suiteInput(parsed),
					});
				else {
					const mergedContext = { ...context, ...raw };
					const set = parsed.options.get('set');
					const input = {
						id: parsed.positionals[0],
						...(set !== undefined
							? {
									set,
									...(Object.keys(mergedContext).length > 0 ? { context: mergedContext } : {}),
								}
							: { context: mergedContext }),
						...(parsed.options.has('checkpoint')
							? { checkpoint: parsed.options.get('checkpoint') }
							: {}),
						...(parsed.options.has('screenshot')
							? { screenshot: resolve(root, parsed.options.get('screenshot') ?? '') }
							: {}),
						...(parsed.action === 'run' && parsed.options.has('capture')
							? { capture: parsed.options.get('capture') }
							: {}),
					};
					result = await executeSpecimenCommand(
						bench,
						parsed.action === 'run'
							? 'specimen-run'
							: parsed.action === 'inspect'
								? 'specimen-inspect'
								: 'specimen-render',
						input
					);
				}
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
				'Use specimen list, validate [--id ID | --file PATH], inspect ID, render ID [--set SET], capture [IDS...] [--label NAME], compare ID1 ID2..., review (BEFORE AFTER | --before SET --after SET) [--ids A,B], run ID, a11y [ID] [--set SET], themes [ID] [--theme light,dark] [--threshold 0.02], migrate [--files A,B] [--helpers] [--apply], diff LEFT RIGHT, build OUTDIR, pack [TAG], pack-check [TAG], pack-export DIR, point POINTER | ID (--role ROLE [--name NAME] | --selector CSS), point-move POINT_ID DIRECTION [--index N], point-check POINT_ID, note-add (--point ID | --pointer URI) --text TEXT [--assignee NAME], note-list [--specimen ID] [--state open|resolved|all] [--assignee NAME] [--orphaned] [--limit N] [--after ID], note-check [SPECIMEN_ID], note-move NOTE_ID (--point ID | --pointer URI) --reason TEXT, note-resolve (NOTE_ID | --ids A,B) --outcome OUTCOME --reason TEXT [--revision SHA] [--capture REF], note-reopen NOTE_ID --reason TEXT, job-create ID --scenario PATH --module PATH --export-name NAME --target ID --captures STEPS, job-run ID [--label NAME], decision-record --chosen VAL --reason TEXT (--set SET --slug SLUG --question TEXT | --supersedes IDS | --items ITEMS | --card CARD | --cards CARDS), decision-get ID, decision-list [--kind choice|card|answer|all] [--released|--unreleased] [--limit N] [--after ID], decision-check [--files A,B] [--specimens A,B] [--tokens A,B], design-states [COMMANDS...] [--commands A,B] [--scenario PATH] [--consumer NAME] [--include-proposed] [--limit N] [--after CURSOR], panel-walk --job ID --persona ID --modality MODALITY --target URL, design-card-list [--card ID] [--status STATUS] [--severity SEV] [--scope SCOPE] [--include-provisional] [--include-decided] [--limit N] [--after ID], design-release --release VER --decisions IDS [--scope SCOPE] [--released-at ISO], pattern-fork --source LIB/PAT [--target PAT] [--bind], pattern-compare [--pattern PAT] [--upstream-version VER] [--all-statements], or pattern-merge --pattern PAT [--upstream-version VER] [--accept IDS] [--decline IDS] [--waivers JSON] [--resolutions JSON]; check option values and file paths.',
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
	return result.success && !storiesFailed(result) ? 0 : 1;
}
