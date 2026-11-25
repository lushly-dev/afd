/**
 * Native token resolution and export.
 *
 * The same steps the `tokens.resolve` and `export` commands take, without a command registry or
 * an AFD envelope: results are plain values and failures throw TokenDomainError with the code,
 * message and suggestion those commands report.
 */

import { buildRampRepeatGroups, buildRampUnevenViolations } from './constraints/ramp.js';
import { validateConstraintForToken } from './constraints/validators.js';
import {
	InheritanceResolutionError,
	type ResolveOptions,
	resolveInheritance,
} from './engine/resolver.js';
import { initializeExport } from './export/index.js';
import { transformerRegistry } from './export/registry.js';
import type { TransformOptions } from './export/transformer.js';
import type { Database } from './storage.js';
import type {
	ConstraintViolation,
	ConstraintWithSource,
	TokenValidationResult,
	ValidationSummary,
} from './types/constraint.js';
import { type ErrorCode, ErrorCodes } from './types/error-codes.js';
import type { ResolvedToken } from './types/token.js';
import { matchesGlob } from './utils/glob.js';

/** A native failure; adapters choose their own response envelope. */
export class TokenDomainError extends Error {
	constructor(
		readonly code: ErrorCode,
		message: string,
		readonly suggestion?: string,
		options?: { cause?: unknown },
	) {
		super(message, options);
		this.name = 'TokenDomainError';
	}
}

export const EXPORT_FORMATS = [
	'json',
	'css',
	'scss',
	'typescript',
	'swift',
	'kotlin',
	'dart',
	'tailwind',
	'lua',
] as const;

export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export interface ResolveTokensOptions {
	/** Glob over token ids, like "color.*" */
	filter?: string;
	/** Omit tokens whose id starts with any of these prefixes (e.g. ["ref."]), after full resolution */
	excludePrefixes?: string[];
	/** Keep inheritance chains and operation history on each token */
	includeLineage?: boolean;
	/** A cache shared by several resolutions of one unchanged store */
	cache?: ResolveOptions['cache'];
}

export interface TokenResolution {
	nodeId: string;
	ancestryChain: string[];
	tokens: ResolvedToken[];
}

const cycleSuggestion = (action: string) =>
	`Remove the copy or include that creates the loop (see token.lineage / node.get) and ${action} again`;

async function resolveOrThrow(
	run: () => Promise<ResolvedToken[]>,
	action: string,
): Promise<ResolvedToken[]> {
	try {
		return await run();
	} catch (error) {
		if (error instanceof InheritanceResolutionError)
			throw new TokenDomainError(
				ErrorCodes.CIRCULAR_REFERENCE,
				error.message,
				cycleSuggestion(action),
				{
					cause: error,
				},
			);
		throw error;
	}
}

/**
 * Every token of a node with inheritance applied. Broken references do not fail resolution:
 * they are flagged on each token's `referenceError`.
 */
export async function resolveTokens(
	db: Database,
	nodeId: string,
	options: ResolveTokensOptions = {},
): Promise<TokenResolution> {
	const node = await db.getNode(nodeId);
	if (!node)
		throw new TokenDomainError(
			ErrorCodes.NODE_NOT_FOUND,
			`Node '${nodeId}' not found`,
			`Use 'node.list' to see available nodes`,
		);
	if (node.deletedAt)
		throw new TokenDomainError(ErrorCodes.NODE_NOT_FOUND, `Node '${nodeId}' has been deleted`);
	const ancestryChain = await db.getAncestryChain(nodeId);
	const tokens = await resolveOrThrow(
		() =>
			resolveInheritance(db, nodeId, ancestryChain, options.includeLineage ?? false, {
				cache: options.cache,
			}),
		'resolve',
	);
	const filter = options.filter;
	const excludePrefixes = options.excludePrefixes;
	let selected = filter ? tokens.filter((token) => matchesGlob(token.id, filter)) : tokens;
	if (excludePrefixes && excludePrefixes.length > 0) {
		selected = selected.filter((token) => !hasExcludedPrefix(token.id, excludePrefixes));
	}
	return {
		nodeId,
		ancestryChain,
		tokens: selected,
	};
}

export interface ExportTokensOptions extends Omit<TransformOptions, 'filter'> {
	/** One of EXPORT_FORMATS, or a format registered on transformerRegistry */
	format: string;
	/** Glob over token ids, like "color.*" */
	filter?: string;
	/** Omit tokens whose id starts with any of these prefixes (e.g. ["ref."]), after full resolution */
	excludePrefixes?: string[];
}

export interface TokenExport {
	format: string;
	content: string;
	tokenCount: number;
	nodeId: string;
}

/** The defaults the `export` command applies to omitted options. */
const EXPORT_DEFAULTS = {
	pretty: true,
	includeComments: false,
	groupByCategory: false,
	exportStyle: 'nested',
	exportType: 'both',
	outputReferences: false,
} as const satisfies TransformOptions;

/**
 * Resolve a node and render it with an export transformer. Exports never emit unresolved
 * aliases: the first broken reference fails the export.
 */
export async function exportTokens(
	db: Database,
	nodeId: string,
	options: ExportTokensOptions,
): Promise<TokenExport> {
	const { format, filter, excludePrefixes, ...rest } = options;
	const transform: TransformOptions = { ...EXPORT_DEFAULTS, ...dropUndefined(rest) };
	if (!(await db.getNode(nodeId)))
		throw new TokenDomainError(
			ErrorCodes.NODE_NOT_FOUND,
			`Node '${nodeId}' not found`,
			`Use 'node.list' to see available nodes`,
		);
	initializeExport();
	const transformer = transformerRegistry.get(format);
	if (!transformer)
		throw new TokenDomainError(
			ErrorCodes.VALIDATION_ERROR,
			`Unknown export format '${format}'`,
			'Available formats: json, css, scss, typescript, swift, kotlin, dart, tailwind, lua',
		);
	const ancestryChain = await db.getAncestryChain(nodeId);
	const tokens = (
		await resolveOrThrow(() => resolveInheritance(db, nodeId, ancestryChain, false), 'export')
	).sort((a, b) => a.id.localeCompare(b.id));
	if (transform.outputReferences && format !== 'css')
		throw new TokenDomainError(
			ErrorCodes.VALIDATION_ERROR,
			`outputReferences is only supported for css exports, not ${format}`,
			'Drop outputReferences to export resolved values',
		);
	let selected = filter ? tokens.filter((token) => matchesGlob(token.id, filter)) : tokens;
	if (excludePrefixes && excludePrefixes.length > 0) {
		selected = selected.filter((token) => !hasExcludedPrefix(token.id, excludePrefixes));
	}
	const broken = selected.find((token) => token.referenceError);
	if (broken?.referenceError) {
		const { code, message } = broken.referenceError;
		throw new TokenDomainError(
			ErrorCodes[code],
			message,
			code === 'NOT_IMPLEMENTED'
				? `Replace the transform on '${broken.id}' with a literal value`
				: code === 'CIRCULAR_REFERENCE'
					? `Point one of the tokens in the loop at a literal value (see tokens.resolve for '${nodeId}')`
					: `Add the referenced token to '${nodeId}' or one of its ancestors, or fix the reference on '${broken.id}'`,
		);
	}
	let content: string;
	try {
		content = transformer.transform(selected, transform);
	} catch (error) {
		throw new TokenDomainError(
			ErrorCodes.VALIDATION_ERROR,
			`Export to ${format} failed: ${error instanceof Error ? error.message : String(error)}`,
			'Check the export options against the tokens in this node',
			{ cause: error },
		);
	}
	return { format, content, tokenCount: selected.length, nodeId };
}

export interface ValidateConstraintsOptions {
	/** Glob over token ids, like "color.*" */
	filter?: string;
	/** Omit passing tokens (`violations: []`) from `results` (default: false) */
	onlyViolating?: boolean;
	/** A cache shared by several validations of one unchanged store */
	cache?: ResolveOptions['cache'];
}

export interface DisabledConstraintSummary {
	constraintId: string;
	name: string;
	source: string;
	reason?: string;
}

export interface ConstraintValidationReport {
	nodeId: string;
	valid: boolean;
	results: TokenValidationResult[];
	summary: ValidationSummary;
	disabled: DisabledConstraintSummary[];
}

/**
 * Validate a node's resolved tokens against every enabled constraint inherited
 * from its ancestry chain and defined on the node itself.
 */
export async function validateConstraints(
	db: Database,
	nodeId: string,
	options: ValidateConstraintsOptions = {},
): Promise<ConstraintValidationReport> {
	const { ancestryChain, tokens: allTokens } = await resolveTokens(db, nodeId, {
		cache: options.cache,
	});
	const tokenMap = new Map<string, ResolvedToken>(allTokens.map((token) => [token.id, token]));

	const enabled: ConstraintWithSource[] = [];
	const disabled: ConstraintWithSource[] = [];
	for (const source of [...ancestryChain, nodeId]) {
		for (const constraint of await db.getConstraints(source)) {
			(constraint.enabled ? enabled : disabled).push({ ...constraint, source });
		}
	}

	const checkedTokens = (
		options.filter
			? allTokens.filter((token) => matchesGlob(token.id, options.filter as string))
			: [...allTokens]
	).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

	// Precompute ramp repeat clusters and uneven-jump checks once per ramp constraint across the full node
	const repeatGroupsByConstraint = new Map<ConstraintWithSource, Map<string, string[]>>();
	const unevenByConstraint = new Map<ConstraintWithSource, Map<string, ConstraintViolation>>();
	for (const constraint of enabled) {
		if (constraint.config.type === 'ramp') {
			repeatGroupsByConstraint.set(constraint, buildRampRepeatGroups(constraint.applyTo, tokenMap));
			if (constraint.config.warnUneven) {
				unevenByConstraint.set(
					constraint,
					buildRampUnevenViolations(
						constraint as ConstraintWithSource & {
							config: Extract<ConstraintWithSource['config'], { type: 'ramp' }>;
						},
						tokenMap,
					),
				);
			}
		}
	}

	const results: TokenValidationResult[] = [];
	const counts = { validTokens: 0, errors: 0, warnings: 0, infos: 0 };

	for (const token of checkedTokens) {
		const violations: ConstraintViolation[] = [];
		for (const constraint of enabled) {
			violations.push(
				...validateConstraintForToken(
					token,
					constraint,
					tokenMap,
					repeatGroupsByConstraint.get(constraint),
					unevenByConstraint.get(constraint),
				),
			);
		}

		tallyViolations(violations, counts);

		const valid = violations.every((violation) => violation.severity !== 'error');
		if (valid) {
			counts.validTokens++;
		}

		if (!options.onlyViolating || violations.length > 0) {
			results.push({
				tokenId: token.id,
				value: token.resolvedValue,
				valid,
				violations,
			});
		}
	}

	return {
		nodeId,
		valid: counts.errors === 0,
		results,
		summary: {
			totalTokens: checkedTokens.length,
			validTokens: counts.validTokens,
			errors: counts.errors,
			warnings: counts.warnings,
			infos: counts.infos,
		},
		disabled: disabled.map((constraint) => ({
			constraintId: constraint.id,
			name: constraint.name,
			source: constraint.source,
			...(constraint.disabledReason ? { reason: constraint.disabledReason } : {}),
		})),
	};
}

function tallyViolations(
	violations: readonly ConstraintViolation[],
	counts: { errors: number; warnings: number; infos: number },
): void {
	for (const violation of violations) {
		if (violation.severity === 'error') counts.errors++;
		else if (violation.severity === 'warning') counts.warnings++;
		else counts.infos++;
	}
}

function hasExcludedPrefix(
	tokenId: string,
	excludePrefixes: readonly string[] | undefined,
): boolean {
	return Boolean(excludePrefixes?.some((prefix) => tokenId.startsWith(prefix)));
}

function dropUndefined<T extends object>(value: T): Partial<T> {
	return Object.fromEntries(
		Object.entries(value).filter(([, entry]) => entry !== undefined),
	) as Partial<T>;
}
