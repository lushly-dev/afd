/**
 * Two-stage ramp constraint evaluation (`type: 'ramp'`).
 *
 * Enforces Stage 1 (`ref.*`) / Stage 2 (purpose-named semantic) discipline:
 * - Broken references fail immediately (`ramp:broken-ref`)
 * - Semantic aliases must terminate on the constraint's `ramp` glob (`ramp:wrong-family`)
 * - Optional `pairWith` checks symmetric cross-step pairings (`ramp:pair`)
 * - Off-ramp literals require a non-empty human `reason` (`ramp:unreasoned`), reporting
 *   nearest unit-matched ramp steps
 * - Repeated off-ramp literals across `applyTo` emit advisory warnings (`ramp:repeat`)
 */

import type {
	Constraint,
	ConstraintSeverity,
	ConstraintViolation,
	RampConfig,
} from '../types/constraint.js';
import { matchGlobCaptures, matchesGlob } from '../utils/glob.js';
import type { ValidatorToken } from './validators.js';

/** Legacy auto-generated reason stamped by pre-Scales `import.json` / `import.tree`. */
export const LEGACY_IMPORT_REASON = 'Imported from JSON';

/** Advisory sub-check codes whose `'warning'` severity is never overwritten by `constraint.severity`. */
export const ADVISORY_VIOLATION_CODES = new Set<string>(['ramp:repeat']);

/** A numeric value paired with its normalized CSS unit (empty string for unitless numbers). */
export interface ParsedNumericUnit {
	value: number;
	unit: string;
}

/**
 * Parse a numeric value together with its CSS unit (e.g. `"5px"` -> `{ value: 5, unit: "px" }`).
 */
export function parseNumericWithUnit(value: unknown): ParsedNumericUnit | null {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? { value, unit: '' } : null;
	}
	if (typeof value === 'string') {
		const match = value.match(/^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-zA-Z%]*)\s*$/);
		if (match) {
			const parsed = Number.parseFloat(match[1]);
			if (Number.isFinite(parsed)) {
				return { value: parsed, unit: match[2].toLowerCase() };
			}
		}
	}
	return null;
}

/** True when a token carries a real human reason (blank or legacy `'Imported from JSON'` returns false). */
export function hasHumanReason(reason: string | undefined): boolean {
	if (!reason) return false;
	const trimmed = reason.trim();
	return trimmed.length > 0 && trimmed !== LEGACY_IMPORT_REASON;
}

/** Normalize an off-ramp literal for repeat clustering. */
function normalizeOffRampLiteral(value: string | number): string {
	return String(value).trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * True when a token is a Stage 1 `ref.*` ramp step exempted from Stage 2 semantic ramp checks (§5.1).
 * Uses `ref.*` only (not `config.ramp`) so a broad `config.ramp` such as `*` can never disable validation.
 */
function isStageOneRefToken(tokenId: string): boolean {
	return tokenId.startsWith('ref.');
}

/**
 * Precompute normalized off-ramp literal clusters for a `ramp` constraint over a node's full
 * token map so repeat detection runs in O(n) across the node instead of rescanning per token.
 */
export function buildRampRepeatGroups(
	applyTo: string,
	allTokens: Map<string, ValidatorToken>,
): Map<string, string[]> {
	const groups = new Map<string, string[]>();
	for (const candidate of allTokens.values()) {
		if (
			candidate.referenceError ||
			candidate.aliasOf !== undefined ||
			isStageOneRefToken(candidate.id) ||
			!matchesGlob(candidate.id, applyTo)
		) {
			continue;
		}
		const key = normalizeOffRampLiteral(candidate.resolvedValue);
		const list = groups.get(key);
		if (list) {
			list.push(candidate.id);
		} else {
			groups.set(key, [candidate.id]);
		}
	}
	for (const list of groups.values()) {
		list.sort();
	}
	return groups;
}

/** Follow `aliasOf` links to the terminal token id, with a cycle guard. */
function resolveTerminalAlias(
	token: ValidatorToken,
	allTokens: Map<string, ValidatorToken>,
): string | undefined {
	if (!token.aliasOf) return undefined;
	const visited = new Set<string>([token.id]);
	let current = token.aliasOf;
	while (current) {
		if (visited.has(current)) return current;
		visited.add(current);
		const target = allTokens.get(current);
		if (!target?.aliasOf) return current;
		current = target.aliasOf;
	}
	return undefined;
}

/** Two wildcard capture tuples match when they have equal length and identical captures (including both empty). */
function sameCaptures(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((part, i) => part === b[i]);
}

function formatNearestHint(
	resolvedValue: string | number,
	rampGlob: string,
	allTokens: Map<string, ValidatorToken>,
): string {
	const rampTokens = Array.from(allTokens.values())
		.filter((candidate) => !candidate.referenceError && matchesGlob(candidate.id, rampGlob))
		.sort((a, b) => a.id.localeCompare(b.id));

	if (rampTokens.length === 0) {
		return `no ramp steps found matching '${rampGlob}'`;
	}

	const parsedSteps = rampTokens.flatMap((step) => {
		const parsed = parseNumericWithUnit(step.resolvedValue);
		return parsed
			? [{ id: step.id, raw: String(step.resolvedValue), value: parsed.value, unit: parsed.unit }]
			: [];
	});

	const target = parseNumericWithUnit(resolvedValue);
	if (!target) {
		const sample = rampTokens
			.slice(0, 5)
			.map((step) => `${step.id} (${step.resolvedValue})`)
			.join(', ');
		return `value is not numeric; available ramp steps: ${sample}`;
	}

	const sameUnit = parsedSteps
		.filter((step) => step.unit === target.unit)
		.sort((a, b) => a.value - b.value || a.id.localeCompare(b.id));

	if (sameUnit.length === 0) {
		const units = [...new Set(parsedSteps.map((step) => step.unit || 'unitless'))].sort();
		const sample = rampTokens
			.slice(0, 5)
			.map((step) => `${step.id} (${step.resolvedValue})`)
			.join(', ');
		return `unit '${target.unit || 'unitless'}' does not match ramp units (${units.join(', ') || 'none'}); available ramp steps: ${sample}`;
	}

	let lower: (typeof sameUnit)[number] | undefined;
	let higher: (typeof sameUnit)[number] | undefined;
	for (const step of sameUnit) {
		if (step.value <= target.value) {
			lower = step;
		}
		if (step.value >= target.value && !higher) {
			higher = step;
		}
	}

	if (lower && higher && lower.id === higher.id) {
		return `nearest: ${lower.id} (${lower.raw})`;
	}
	const bounds = [lower, higher]
		.filter((step): step is NonNullable<typeof step> => Boolean(step))
		.map((step) => `${step.id} (${step.raw})`);
	return `nearest: ${bounds.join(', ')}`;
}

function checkPairMismatch(
	primary: ValidatorToken,
	sibling: ValidatorToken,
	config: RampConfig,
	constraintId: string,
	constraintName: string,
	severity: ConstraintSeverity,
	allTokens: Map<string, ValidatorToken>,
): ConstraintViolation | null {
	if (!config.pairWith) return null;
	if (primary.referenceError || sibling.referenceError) return null;
	const primaryTerminal = resolveTerminalAlias(primary, allTokens);
	const siblingTerminal = resolveTerminalAlias(sibling, allTokens);
	if (!primaryTerminal || !siblingTerminal) return null;

	const primaryCaptures = matchGlobCaptures(primaryTerminal, config.ramp);
	const siblingCaptures = matchGlobCaptures(siblingTerminal, config.pairWith.rampTarget);
	if (!primaryCaptures || !siblingCaptures) return null;
	if (sameCaptures(primaryCaptures, siblingCaptures)) return null;

	if (hasHumanReason(primary.reason) || hasHumanReason(sibling.reason)) {
		return null;
	}

	return {
		constraintId,
		constraintName,
		severity,
		code: 'ramp:pair',
		message: `Cross-step pairing without reason: '${primary.id}' aliases '${primaryTerminal}' (step ${primaryCaptures.join('.')}) while '${sibling.id}' aliases '${siblingTerminal}' (step ${siblingCaptures.join('.')})`,
		expected: `matching ramp step for '${primary.id}' and '${sibling.id}', or a reason on either token`,
		actual: `${primaryTerminal} / ${siblingTerminal}`,
	};
}

function evaluateSiblingPairOnly(
	token: ValidatorToken,
	constraint: Constraint & { config: RampConfig },
	allTokens: Map<string, ValidatorToken>,
): ConstraintViolation[] {
	const { id: constraintId, name: constraintName, applyTo, severity, config } = constraint;
	const pairWith = config.pairWith;
	if (!pairWith || !applyTo.endsWith(pairWith.fromSuffix)) {
		return [];
	}
	const siblingApplyTo = `${applyTo.slice(0, -pairWith.fromSuffix.length)}${pairWith.toSuffix}`;
	if (!matchesGlob(token.id, siblingApplyTo) || !token.id.endsWith(pairWith.toSuffix)) {
		return [];
	}
	const primaryId = `${token.id.slice(0, -pairWith.toSuffix.length)}${pairWith.fromSuffix}`;
	const primary = allTokens.get(primaryId);
	if (!primary) return [];
	const mismatch = checkPairMismatch(
		primary,
		token,
		config,
		constraintId,
		constraintName,
		severity,
		allTokens,
	);
	return mismatch ? [mismatch] : [];
}

function evaluateOffRampLiteral(
	token: ValidatorToken,
	constraint: Constraint & { config: RampConfig },
	allTokens: Map<string, ValidatorToken>,
	repeatGroups?: Map<string, string[]>,
): ConstraintViolation[] {
	const { id: constraintId, name: constraintName, applyTo, severity, config } = constraint;
	const violations: ConstraintViolation[] = [];

	const requireReason = config.requireOffRampReason ?? true;
	if (requireReason && !hasHumanReason(token.reason)) {
		const hint = formatNearestHint(token.resolvedValue, config.ramp, allTokens);
		violations.push({
			constraintId,
			constraintName,
			severity,
			code: 'ramp:unreasoned',
			message: `Off-ramp literal '${token.resolvedValue}' on '${token.id}' requires a reason (${hint})`,
			expected: `alias matching ${config.ramp} or off-ramp literal with reason`,
			actual: String(token.resolvedValue),
		});
	}

	const repeatThreshold = config.repeatThreshold ?? 2;
	const groups = repeatGroups ?? buildRampRepeatGroups(applyTo, allTokens);
	const peers = groups.get(normalizeOffRampLiteral(token.resolvedValue)) ?? [];
	if (peers.length >= repeatThreshold) {
		violations.push({
			constraintId,
			constraintName,
			severity: 'warning',
			code: 'ramp:repeat',
			message: `Off-ramp literal '${token.resolvedValue}' is shared by ${peers.length} tokens (${peers.join(', ')}); consider promoting it to '${config.ramp}'`,
			expected: `unique off-ramp literal or alias matching ${config.ramp}`,
			actual: String(token.resolvedValue),
		});
	}

	return violations;
}

/**
 * Evaluate a single `type: 'ramp'` constraint against one token.
 *
 * Returns all matching violations (0, 1, or 2: e.g. `ramp:unreasoned` error plus
 * `ramp:repeat` warning). Primary violations carry `constraint.severity`;
 * advisory `ramp:repeat` always keeps `severity: 'warning'`.
 */
export function evaluateRampConstraint(
	token: ValidatorToken,
	constraint: Constraint & { config: RampConfig },
	allTokens: Map<string, ValidatorToken>,
	repeatGroups?: Map<string, string[]>,
): ConstraintViolation[] {
	const { id: constraintId, name: constraintName, applyTo, severity, config } = constraint;

	if (isStageOneRefToken(token.id)) {
		return [];
	}

	if (!matchesGlob(token.id, applyTo)) {
		return evaluateSiblingPairOnly(token, constraint, allTokens);
	}

	// 1. Broken reference first (before aliasOf)
	if (token.referenceError) {
		return [
			{
				constraintId,
				constraintName,
				severity,
				code: 'ramp:broken-ref',
				message: `Broken reference (${token.referenceError.code}): ${token.referenceError.message}`,
				expected: `valid alias matching ${config.ramp}`,
				actual: token.aliasOf ?? String(token.resolvedValue),
			},
		];
	}

	// 2. Alias path: follow chain to terminal target
	const terminalTarget = resolveTerminalAlias(token, allTokens);
	if (terminalTarget !== undefined) {
		if (!matchesGlob(terminalTarget, config.ramp)) {
			return [
				{
					constraintId,
					constraintName,
					severity,
					code: 'ramp:wrong-family',
					message: `Token '${token.id}' aliases '${terminalTarget}', which does not match ramp '${config.ramp}'`,
					expected: `alias matching ${config.ramp}`,
					actual: token.aliasOf ?? terminalTarget,
				},
			];
		}

		if (config.pairWith && token.id.endsWith(config.pairWith.fromSuffix)) {
			const siblingId = `${token.id.slice(0, -config.pairWith.fromSuffix.length)}${config.pairWith.toSuffix}`;
			const sibling = allTokens.get(siblingId);
			if (sibling) {
				const mismatch = checkPairMismatch(
					token,
					sibling,
					config,
					constraintId,
					constraintName,
					severity,
					allTokens,
				);
				return mismatch ? [mismatch] : [];
			}
		}
		return [];
	}

	// 3. Off-ramp literal: check unreasoned + repeat clustering
	return evaluateOffRampLiteral(token, constraint, allTokens, repeatGroups);
}
