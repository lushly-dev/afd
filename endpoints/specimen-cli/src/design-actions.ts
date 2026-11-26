/** CLI dispatch helpers for Agent-First Design & copied-pattern commands. */
import type { CommandResult } from '@lushly-dev/afd-core';
import { executeSpecimenCommand, type SpecimenCommandBench } from '@lushly-dev/specimen-afd';

export interface DesignParsedArguments {
	action: string;
	positionals: string[];
	options: Map<string, string>;
	flags: Set<string>;
}

export type CliConfirmResult =
	| { humanConfirmed: true; channel: 'cli'; confirmedBy?: string }
	| undefined;

export const DESIGN_ALLOWED_OPTIONS: Record<string, Set<string>> = {
	'design-states': new Set([
		'root',
		'config',
		'output',
		'commands',
		'scenario',
		'consumer',
		'include-proposed',
		'limit',
		'after',
	]),
	'panel-walk': new Set([
		'root',
		'config',
		'output',
		'job',
		'persona',
		'modality',
		'target',
		'app-date',
		'max-actions',
		'baseline-walk',
		'requested-tools',
	]),
	'design-card-list': new Set([
		'root',
		'config',
		'output',
		'card',
		'status',
		'severity',
		'scope',
		'include-provisional',
		'include-decided',
		'limit',
		'after',
	]),
	'design-release': new Set([
		'root',
		'config',
		'output',
		'release',
		'decisions',
		'scope',
		'released-at',
	]),
	'pattern-fork': new Set(['root', 'config', 'output', 'source', 'target', 'bind']),
	'pattern-compare': new Set([
		'root',
		'config',
		'output',
		'pattern',
		'upstream-version',
		'all-statements',
	]),
	'pattern-merge': new Set([
		'root',
		'config',
		'output',
		'pattern',
		'upstream-version',
		'accept',
		'decline',
		'waivers',
		'resolutions',
	]),
	'panel-review': new Set([
		'root',
		'config',
		'output',
		'action',
		'change',
		'author',
		'jobs',
		'target',
		'app-date',
		'before',
		'after',
		'panel-size',
		'max-rounds',
		'max-cost-usd',
		'baseline',
		'run',
		'reason',
	]),
	'panel-calibrate': new Set([
		'root',
		'config',
		'output',
		'action',
		'count',
		'seed',
		'sample',
		'judgements',
	]),
};

export function isDesignCliAction(action: string): boolean {
	return Object.hasOwn(DESIGN_ALLOWED_OPTIONS, action);
}

function parseJsonArrayOption<T>(raw: string, flagName: string): T[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error(`--${flagName} expects a valid JSON array`);
	}
	if (!Array.isArray(parsed)) {
		throw new Error(`--${flagName} expects a JSON array`);
	}
	return parsed as T[];
}

export async function runDesignCliAction(
	bench: SpecimenCommandBench,
	parsed: DesignParsedArguments,
	confirmRelease: (prompt: string) => Promise<CliConfirmResult>
): Promise<CommandResult<unknown> | undefined> {
	if (parsed.action === 'design-states') {
		const rawLimit = parsed.options.get('limit');
		let limit: number | undefined;
		if (rawLimit !== undefined) {
			const parsedLimit = Number(rawLimit);
			if (!rawLimit.trim() || !Number.isInteger(parsedLimit)) {
				throw new Error('--limit expects a whole number');
			}
			limit = parsedLimit;
		}
		const commands = parsed.options.has('commands')
			? (parsed.options.get('commands') ?? '')
					.split(',')
					.map((name) => name.trim())
					.filter(Boolean)
			: parsed.positionals.length > 0
				? parsed.positionals
				: undefined;
		return executeSpecimenCommand(bench, 'design-states', {
			...(commands !== undefined ? { commands } : {}),
			...(parsed.options.has('scenario') ? { scenario: parsed.options.get('scenario') } : {}),
			...(parsed.options.has('consumer') ? { consumer: parsed.options.get('consumer') } : {}),
			...(parsed.flags.has('include-proposed') ? { includeProposed: true } : {}),
			...(limit !== undefined ? { limit } : {}),
			...(parsed.options.has('after') ? { after: parsed.options.get('after') } : {}),
		});
	}
	if (parsed.action === 'panel-walk') {
		const rawMaxActions = parsed.options.get('max-actions');
		let maxActions: number | undefined;
		if (rawMaxActions !== undefined) {
			const parsedMax = Number(rawMaxActions);
			if (!rawMaxActions.trim() || !Number.isInteger(parsedMax) || parsedMax < 1) {
				throw new Error('--max-actions expects a positive integer');
			}
			maxActions = parsedMax;
		}
		const rawTools = parsed.options.get('requested-tools');
		let requestedTools: string[] | undefined;
		if (rawTools !== undefined) {
			requestedTools = rawTools
				.split(',')
				.map((t) => t.trim())
				.filter(Boolean);
			if (requestedTools.length === 0) {
				throw new Error('--requested-tools expects at least one tool name');
			}
		}
		return executeSpecimenCommand(bench, 'panel-walk', {
			job: parsed.options.get('job') ?? parsed.positionals[0],
			persona: parsed.options.get('persona'),
			modality: parsed.options.get('modality'),
			target: parsed.options.get('target'),
			...(parsed.options.has('app-date') ? { appDate: parsed.options.get('app-date') } : {}),
			...(maxActions !== undefined ? { maxActions } : {}),
			...(parsed.options.has('baseline-walk')
				? { baselineWalk: parsed.options.get('baseline-walk') }
				: {}),
			...(requestedTools !== undefined ? { requestedTools } : {}),
		});
	}
	if (parsed.action === 'design-card-list') {
		const rawLimit = parsed.options.get('limit');
		let limit: number | undefined;
		if (rawLimit !== undefined) {
			const parsedLimit = Number(rawLimit);
			if (!rawLimit.trim() || !Number.isInteger(parsedLimit)) {
				throw new Error('--limit expects a whole number');
			}
			limit = parsedLimit;
		}
		return executeSpecimenCommand(bench, 'design-card-list', {
			...(parsed.options.has('card') ? { card: parsed.options.get('card') } : {}),
			...(parsed.options.has('status') ? { status: parsed.options.get('status') } : {}),
			...(parsed.options.has('severity') ? { severity: parsed.options.get('severity') } : {}),
			...(parsed.options.has('scope') ? { scope: parsed.options.get('scope') } : {}),
			...(parsed.flags.has('include-provisional') ? { includeProvisional: true } : {}),
			...(parsed.flags.has('include-decided') ? { includeDecided: true } : {}),
			...(limit !== undefined ? { limit } : {}),
			...(parsed.options.has('after') ? { after: parsed.options.get('after') } : {}),
		});
	}
	if (parsed.action === 'design-release') {
		const decisions = (parsed.options.get('decisions') ?? '').split(',').filter(Boolean);
		const releaseConfirmation = await confirmRelease(
			`Confirm design-release ${parsed.options.get('release') ?? ''} with ${decisions.length} decision(s)?`
		);
		return executeSpecimenCommand(
			bench,
			'design-release',
			{
				...(parsed.options.has('release') ? { release: parsed.options.get('release') } : {}),
				decisions,
				...(parsed.options.has('scope') ? { scope: parsed.options.get('scope') } : {}),
				...(parsed.options.has('released-at')
					? { releasedAt: parsed.options.get('released-at') }
					: {}),
			},
			releaseConfirmation
		);
	}
	if (parsed.action === 'pattern-fork') {
		return executeSpecimenCommand(bench, 'specimen-pattern-fork', {
			source: parsed.options.get('source') ?? parsed.positionals[0],
			...(parsed.options.has('target')
				? { target: parsed.options.get('target') }
				: parsed.positionals[1]
					? { target: parsed.positionals[1] }
					: {}),
			...(parsed.flags.has('bind') ? { bind: true } : {}),
		});
	}
	if (parsed.action === 'pattern-compare') {
		const pattern = parsed.options.get('pattern') ?? parsed.positionals[0];
		return executeSpecimenCommand(bench, 'specimen-pattern-compare', {
			...(pattern !== undefined ? { pattern } : {}),
			...(parsed.options.has('upstream-version')
				? { upstreamVersion: parsed.options.get('upstream-version') }
				: {}),
			...(parsed.flags.has('all-statements') ? { onlyChanged: false } : {}),
		});
	}
	if (parsed.action === 'pattern-merge') {
		const pattern = parsed.options.get('pattern') ?? parsed.positionals[0];
		const accept = parsed.options.has('accept')
			? (parsed.options.get('accept') ?? '')
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean)
			: undefined;
		const decline = parsed.options.has('decline')
			? (parsed.options.get('decline') ?? '')
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean)
			: undefined;
		const waivers = parsed.options.has('waivers')
			? parseJsonArrayOption<{ id: string; reason: string }>(
					parsed.options.get('waivers') ?? '',
					'waivers'
				)
			: undefined;
		const resolutions = parsed.options.has('resolutions')
			? parseJsonArrayOption<{ id: string; text: string; gate?: string; setup?: string }>(
					parsed.options.get('resolutions') ?? '',
					'resolutions'
				)
			: undefined;
		return executeSpecimenCommand(bench, 'specimen-pattern-merge', {
			pattern,
			...(parsed.options.has('upstream-version')
				? { upstreamVersion: parsed.options.get('upstream-version') }
				: {}),
			...(accept !== undefined ? { accept } : {}),
			...(decline !== undefined ? { decline } : {}),
			...(waivers !== undefined ? { waivers } : {}),
			...(resolutions !== undefined ? { resolutions } : {}),
		});
	}
	if (parsed.action === 'panel-review') {
		const subAction = parsed.options.get('action');
		if (subAction !== undefined && subAction !== 'review' && subAction !== 'withdraw') {
			throw new Error(`Invalid --action for panel-review: ${subAction}; use review or withdraw`);
		}
		if (subAction === 'withdraw') {
			return executeSpecimenCommand(bench, 'panel-review', {
				action: 'withdraw',
				run: parsed.options.get('run') ?? parsed.positionals[0],
				reason: parsed.options.get('reason'),
			});
		}
		const jobs = (parsed.options.get('jobs') ?? '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		const rawPanelSize = parsed.options.get('panel-size');
		let panelSize: number | undefined;
		if (rawPanelSize !== undefined) {
			const n = Number(rawPanelSize);
			if (!rawPanelSize.trim() || !Number.isInteger(n) || n < 1) {
				throw new Error('--panel-size expects a positive integer');
			}
			panelSize = n;
		}
		const rawMaxRounds = parsed.options.get('max-rounds');
		let maxRounds: number | undefined;
		if (rawMaxRounds !== undefined) {
			const n = Number(rawMaxRounds);
			if (!rawMaxRounds.trim() || !Number.isInteger(n) || n < 0) {
				throw new Error('--max-rounds expects a non-negative integer');
			}
			maxRounds = n;
		}
		const rawMaxCost = parsed.options.get('max-cost-usd');
		let maxCostUsd: number | undefined;
		if (rawMaxCost !== undefined) {
			const n = Number(rawMaxCost);
			if (!rawMaxCost.trim() || !Number.isFinite(n) || n < 0) {
				throw new Error('--max-cost-usd expects a non-negative number');
			}
			maxCostUsd = n;
		}
		const captures =
			parsed.options.has('before') || parsed.options.has('after')
				? {
						...(parsed.options.has('before') ? { before: parsed.options.get('before') } : {}),
						...(parsed.options.has('after') ? { after: parsed.options.get('after') } : {}),
					}
				: undefined;
		const budget =
			maxRounds !== undefined || maxCostUsd !== undefined
				? {
						...(maxRounds !== undefined ? { maxRounds } : {}),
						...(maxCostUsd !== undefined ? { maxCostUsd } : {}),
					}
				: undefined;
		return executeSpecimenCommand(bench, 'panel-review', {
			...(subAction === 'review' ? { action: 'review' } : {}),
			change: parsed.options.get('change') ?? parsed.positionals[0],
			...(parsed.options.has('author') ? { author: parsed.options.get('author') } : {}),
			jobs,
			target: parsed.options.get('target'),
			appDate: parsed.options.get('app-date'),
			...(captures !== undefined ? { captures } : {}),
			...(panelSize !== undefined ? { panelSize } : {}),
			...(budget !== undefined ? { budget } : {}),
			...(parsed.options.has('baseline') ? { baseline: parsed.options.get('baseline') } : {}),
		});
	}
	if (parsed.action === 'panel-calibrate') {
		const subAction = parsed.options.get('action') ?? parsed.positionals[0];
		if (subAction !== 'sample' && subAction !== 'record') {
			throw new Error(
				`Invalid action for panel-calibrate: ${subAction ?? '(missing)'}; use sample or record`
			);
		}
		if (subAction === 'record') {
			const positionalSample = parsed.options.has('action')
				? parsed.positionals[0]
				: parsed.positionals[1];
			const sample = parsed.options.get('sample') ?? positionalSample;
			const judgements = parsed.options.has('judgements')
				? parseJsonArrayOption<{ item: string; verdict: 'accept' | 'reject'; reason?: string }>(
						parsed.options.get('judgements') ?? '',
						'judgements'
					)
				: [];
			const confirmation = await confirmRelease(
				`Confirm panel-calibrate record for sample ${sample ?? ''} (${judgements.length} judgement(s))?`
			);
			return executeSpecimenCommand(
				bench,
				'panel-calibrate',
				{
					action: 'record',
					sample,
					judgements,
				},
				confirmation
			);
		}
		const rawCount = parsed.options.get('count');
		let count: number | undefined;
		if (rawCount !== undefined) {
			const n = Number(rawCount);
			if (!rawCount.trim() || !Number.isInteger(n) || n < 1) {
				throw new Error('--count expects a positive integer');
			}
			count = n;
		}
		const rawSeed = parsed.options.get('seed');
		let seed: number | undefined;
		if (rawSeed !== undefined) {
			const n = Number(rawSeed);
			if (!rawSeed.trim() || !Number.isInteger(n) || n < 0) {
				throw new Error('--seed expects a non-negative integer');
			}
			seed = n;
		}
		return executeSpecimenCommand(bench, 'panel-calibrate', {
			action: 'sample',
			...(count !== undefined ? { count } : {}),
			...(seed !== undefined ? { seed } : {}),
		});
	}
	return undefined;
}
