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
 * - Optional `warnUneven` checks progression jumps across `config.ramp` steps (`ramp:uneven`)
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
export const ADVISORY_VIOLATION_CODES = new Set<string>(['ramp:repeat', 'ramp:uneven']);

/** Deterministic locale-independent token ID comparator (UTF-16 code unit order). */
function compareIds(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

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

interface RampNumericStep {
	id: string;
	raw: string;
	value: number;
}

function collectRampStepsByUnit(
	rampGlob: string,
	ignoreAbove: number | undefined,
	allTokens: Map<string, ValidatorToken>,
): Map<string, RampNumericStep[]> {
	const byUnit = new Map<string, RampNumericStep[]>();
	const rampTokens = Array.from(allTokens.values())
		.filter((candidate) => !candidate.referenceError && matchesGlob(candidate.id, rampGlob))
		.sort((a, b) => compareIds(a.id, b.id));

	for (const candidate of rampTokens) {
		const parsed = parseNumericWithUnit(candidate.resolvedValue);
		if (!parsed || parsed.value <= 0) continue;
		if (ignoreAbove !== undefined && parsed.value > ignoreAbove) continue;
		const entry: RampNumericStep = {
			id: candidate.id,
			raw: String(candidate.resolvedValue),
			value: parsed.value,
		};
		const list = byUnit.get(parsed.unit);
		if (list) list.push(entry);
		else byUnit.set(parsed.unit, [entry]);
	}
	return byUnit;
}

function collectUnitUnevenViolations(
	steps: RampNumericStep[],
	maxRatioSpread: number,
	constraintId: string,
	constraintName: string,
	violations: Map<string, ConstraintViolation>,
): void {
	if (steps.length < 3) return;
	steps.sort((a, b) => a.value - b.value || compareIds(a.id, b.id));

	const pairs = steps.slice(1).map((upper, index) => {
		const lower = steps[index];
		return { lower, upper, ratio: upper.value / lower.value };
	});
	const minRatio = Math.min(...pairs.map((pair) => pair.ratio));
	const limit = minRatio * maxRatioSpread;

	for (const pair of pairs) {
		if (pair.ratio <= limit) continue;
		violations.set(pair.upper.id, {
			constraintId,
			constraintName,
			severity: 'warning',
			code: 'ramp:uneven',
			message: `Uneven ramp jump on '${pair.upper.id}' (${pair.lower.raw} -> ${pair.upper.raw}, ${pair.ratio.toFixed(2)}x exceeds ${limit.toFixed(2)}x from min ratio ${minRatio.toFixed(2)}x * ${maxRatioSpread})`,
			expected: `adjacent step ratio <= ${limit.toFixed(2)}x (min ratio ${minRatio.toFixed(2)}x * maxRatioSpread ${maxRatioSpread})`,
			actual: `${pair.ratio.toFixed(2)}x (${pair.lower.raw} -> ${pair.upper.raw})`,
		});
	}
}

/**
 * Precompute advisory `ramp:uneven` violations for a `ramp` constraint's `warnUneven` check
 * across all tokens matching `config.ramp` (not `constraint.applyTo`).
 *
 * Collects unit-matched positive numeric steps (excluding any step `> ignoreAbove`), sorts each
 * unit group ascending by value (tie-breaking deterministically by token id), computes adjacent
 * ratios `r_i = v[i] / v[i-1]`, and emits an advisory `'warning'` on each upper step `v[i]` whose
 * ratio exceeds `min(r) * maxRatioSpread`.
 */
export function buildRampUnevenViolations(
	constraint: Constraint & { config: RampConfig },
	allTokens: Map<string, ValidatorToken>,
): Map<string, ConstraintViolation> {
	const violations = new Map<string, ConstraintViolation>();
	const warnUneven = constraint.config.warnUneven;
	if (
		!warnUneven ||
		!Number.isFinite(warnUneven.maxRatioSpread) ||
		warnUneven.maxRatioSpread <= 1
	) {
		return violations;
	}

	const byUnit = collectRampStepsByUnit(constraint.config.ramp, warnUneven.ignoreAbove, allTokens);
	for (const unit of Array.from(byUnit.keys()).sort(compareIds)) {
		const steps = byUnit.get(unit);
		if (steps) {
			collectUnitUnevenViolations(
				steps,
				warnUneven.maxRatioSpread,
				constraint.id,
				constraint.name,
				violations,
			);
		}
	}
	return violations;
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

function evaluateSemanticRampToken(
	token: ValidatorToken,
	constraint: Constraint & { config: RampConfig },
	allTokens: Map<string, ValidatorToken>,
	repeatGroups?: Map<string, string[]>,
): ConstraintViolation[] {
	const { id: constraintId, name: constraintName, severity, config } = constraint;

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

/**
 * Evaluate a single `type: 'ramp'` constraint against one token.
 *
 * Returns all matching violations (e.g. `ramp:unreasoned` error plus `ramp:repeat`
 * warning, or `ramp:uneven` advisory warning on `config.ramp` steps). Primary
 * violations carry `constraint.severity`; advisory `ramp:repeat` and `ramp:uneven`
 * always keep `severity: 'warning'`.
 */
export function evaluateRampConstraint(
	token: ValidatorToken,
	constraint: Constraint & { config: RampConfig },
	allTokens: Map<string, ValidatorToken>,
	repeatGroups?: Map<string, string[]>,
	unevenViolations?: Map<string, ConstraintViolation>,
): ConstraintViolation[] {
	const { applyTo, config } = constraint;
	const trailing: ConstraintViolation[] = [];

	if (config.warnUneven && matchesGlob(token.id, config.ramp)) {
		const uneven = (unevenViolations ?? buildRampUnevenViolations(constraint, allTokens)).get(
			token.id,
		);
		if (uneven) trailing.push(uneven);
	}

	if (isStageOneRefToken(token.id)) {
		return trailing;
	}

	if (!matchesGlob(token.id, applyTo)) {
		return [...evaluateSiblingPairOnly(token, constraint, allTokens), ...trailing];
	}

	return [...evaluateSemanticRampToken(token, constraint, allTokens, repeatGroups), ...trailing];
}
