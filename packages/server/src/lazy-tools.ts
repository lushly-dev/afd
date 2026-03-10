/**
 * @fileoverview Lazy-loading discovery tools: afd-discover, afd-detail.
 */

import type { CommandResult, JsonSchema } from '@lushly-dev/afd-core';
import { findSimilarTools, success } from '@lushly-dev/afd-core';
import type { ZodCommandDefinition } from './schema.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface CommandSummary {
	name: string;
	description: string;
	category?: string;
	mutation?: boolean;
}

interface DiscoverResult {
	commands: CommandSummary[];
	total: number;
	filtered: number;
	returned: number;
	hasMore: boolean;
	availableCategories: string[];
	availableTags: string[];
}

export interface DiscoverInput {
	category?: string;
	tag?: string | string[];
	tagMode?: 'all' | 'any';
	search?: string;
	includeMutation?: boolean;
	limit?: number;
	offset?: number;
}

export interface DetailInput {
	command: string | string[];
}

interface DetailResult {
	name: string;
	found: true;
	description: string;
	category?: string;
	tags?: string[];
	mutation: boolean;
	executionTime?: 'instant' | 'fast' | 'slow' | 'long-running';
	errors?: string[];
	inputSchema: JsonSchema;
	outputSchema?: JsonSchema;
	destructive?: boolean;
	confirmPrompt?: string;
	handoff?: boolean;
	handoffProtocol?: string;
	version?: string;
	callable: boolean;
}

interface DetailError {
	name: string;
	found: false;
	error: { code: string; message: string; suggestion: string };
}

type DetailEntry = DetailResult | DetailError;

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function truncateDescription(desc: string, max = 120): string {
	const firstSentence = desc.split(/\.\s/)[0] ?? desc;
	if (firstSentence.length <= max) return firstSentence;
	return `${desc.slice(0, max - 1)}\u2026`;
}

function deriveCategory(cmd: ZodCommandDefinition): string {
	return cmd.category || cmd.name.split('-')[0] || 'general';
}

function matchesSearch(cmd: ZodCommandDefinition, query: string): boolean {
	const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (tokens.length === 0) return true;
	const target = `${cmd.name} ${cmd.description}`.toLowerCase();
	return tokens.every((token) => target.includes(token));
}

function matchesTags(cmd: ZodCommandDefinition, tags: string[], mode: 'all' | 'any'): boolean {
	const cmdTags = cmd.tags ?? [];
	if (cmdTags.length === 0) return false;
	if (mode === 'all') {
		return tags.every((tag) => cmdTags.includes(tag));
	}
	return tags.some((tag) => cmdTags.includes(tag));
}

// ═══════════════════════════════════════════════════════════════════════════════
// DISCOVER
// ═══════════════════════════════════════════════════════════════════════════════

export function executeDiscover(
	commands: ZodCommandDefinition[],
	input: DiscoverInput
): CommandResult<DiscoverResult> {
	const startTime = performance.now();
	const {
		category,
		tag,
		tagMode = 'any',
		search,
		includeMutation = false,
		limit = 50,
		offset = 0,
	} = input;

	// Collect all categories and tags (before filtering)
	const allCategories = new Set<string>();
	const allTags = new Set<string>();
	for (const cmd of commands) {
		allCategories.add(deriveCategory(cmd));
		for (const t of cmd.tags ?? []) {
			allTags.add(t);
		}
	}

	// Filter
	let filtered = commands;
	if (category) {
		filtered = filtered.filter((cmd) => deriveCategory(cmd) === category);
	}
	if (tag) {
		const tagArray = Array.isArray(tag) ? tag : [tag];
		filtered = filtered.filter((cmd) => matchesTags(cmd, tagArray, tagMode));
	}
	if (search) {
		filtered = filtered.filter((cmd) => matchesSearch(cmd, search));
	}

	const total = commands.length;
	const filteredCount = filtered.length;

	// Paginate
	const clampedLimit = Math.min(Math.max(limit, 1), 200);
	const clampedOffset = Math.max(offset, 0);
	const page = filtered.slice(clampedOffset, clampedOffset + clampedLimit);
	const hasMore = clampedOffset + clampedLimit < filteredCount;

	// Map to summaries
	const summaries: CommandSummary[] = page.map((cmd) => ({
		name: cmd.name,
		description: truncateDescription(cmd.description),
		category: deriveCategory(cmd),
		...(includeMutation && { mutation: cmd.mutation ?? false }),
	}));

	const data: DiscoverResult = {
		commands: summaries,
		total,
		filtered: filteredCount,
		returned: summaries.length,
		hasMore,
		availableCategories: Array.from(allCategories).sort(),
		availableTags: Array.from(allTags).sort(),
	};

	const executionTimeMs = Math.round((performance.now() - startTime) * 100) / 100;

	return success(data, {
		reasoning: `Returned ${summaries.length} of ${filteredCount} matching commands (${total} total)${
			category ? ` in category '${category}'` : ''
		}${hasMore ? `. Use offset: ${clampedOffset + clampedLimit} to see more.` : ''}`,
		confidence: 1.0,
		metadata: { executionTimeMs },
	}) as CommandResult<DiscoverResult>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DETAIL
// ═══════════════════════════════════════════════════════════════════════════════

export function executeDetail(
	allRegisteredCommands: ZodCommandDefinition[],
	exposedCommandNames: Set<string>,
	input: DetailInput
): CommandResult<DetailEntry[]> {
	const startTime = performance.now();
	const rawNames = Array.isArray(input.command) ? input.command : [input.command];
	// Enforce max 10 commands per detail request
	const names = rawNames.slice(0, 10);
	const commandMap = new Map(allRegisteredCommands.map((c) => [c.name, c]));
	const allNames = allRegisteredCommands.map((c) => c.name);

	const entries: DetailEntry[] = names.map((name) => {
		const cmd = commandMap.get(name);
		if (!cmd) {
			const suggestions = findSimilarTools(name, allNames, 3);
			const suggestionText =
				suggestions.length > 0
					? `Did you mean '${suggestions[0]}'? Use afd-discover to list all commands.`
					: 'Use afd-discover to list all commands.';
			return {
				name,
				found: false as const,
				error: {
					code: 'COMMAND_NOT_FOUND',
					message: `No command named '${name}'`,
					suggestion: suggestionText,
				},
			};
		}

		return {
			name: cmd.name,
			found: true as const,
			description: cmd.description,
			category: cmd.category,
			tags: cmd.tags,
			mutation: cmd.mutation ?? false,
			executionTime: cmd.executionTime,
			errors: cmd.errors,
			inputSchema: cmd.jsonSchema,
			...(cmd.outputJsonSchema && { outputSchema: cmd.outputJsonSchema }),
			destructive: cmd.destructive,
			confirmPrompt: cmd.confirmPrompt,
			handoff: cmd.handoff,
			handoffProtocol: cmd.handoffProtocol,
			version: cmd.version,
			callable: exposedCommandNames.has(cmd.name),
		};
	});

	const foundCount = entries.filter((e) => e.found).length;
	const executionTimeMs = Math.round((performance.now() - startTime) * 100) / 100;

	return success(entries, {
		reasoning: `Resolved ${foundCount} of ${names.length} requested commands`,
		confidence: 1.0,
		metadata: { executionTimeMs },
	}) as CommandResult<DetailEntry[]>;
}
