/**
 * @fileoverview The reference workspace of the accelerator admission rule (D37; phase 0
 * specification, 8.2): deterministic for a seed.
 */

import type { DocumentLinkV1, DocumentRecordV1 } from '@lushly-dev/loam-sdk';
import type { KernelInterfaceV0 } from './kernel.js';
import { createSeededRandom, type SessionCall } from './session.js';
import type { CommandSummaryV0 } from './types.js';

// ─── Reference workspace (D37) ──────────────────────────────────────────────────

export interface ReferenceWorkspaceOptions {
	seed: string;
	/** Command summaries generated, and calls in the session. */
	size: number;
	/** Fixed queries generated. Default 200. */
	queries?: number;
	/** Document records generated, half at workspace level and half in five projects (A4). Default 0. */
	documents?: number;
	/** Links generated among those documents, of both kinds, some to themselves (A4). Default 0. */
	links?: number;
}

export interface ReferenceWorkspace {
	seed: string;
	size: number;
	/** `size` command summaries with unique, valid names, for the palette index (A1). */
	commands: CommandSummaryV0[];
	/** Fixed queries over those summaries, some matching nothing (A1). */
	queries: string[];
	/**
	 * `size` calls of mixed shell commands, each journaled, for replay and diff (A2, A3); run them
	 * with {@link recordSession}.
	 */
	calls: SessionCall[];
	/** `documents` records of the `notes` type, for the link index (A4; documents specification, 9.3). */
	documents: DocumentRecordV1[];
	/** `links` links among them, in the `document-link` table's shape. */
	links: DocumentLinkV1[];
}

const DOMAINS = [
	'note',
	'task',
	'project',
	'document',
	'board',
	'calendar',
	'contact',
	'invoice',
	'report',
	'issue',
	'release',
	'build',
	'deploy',
	'metric',
	'alert',
	'team',
	'member',
	'role',
	'policy',
	'secret',
	'file',
	'folder',
	'image',
	'video',
	'comment',
	'thread',
	'message',
	'channel',
	'workspace',
	'setting',
	'theme',
	'layout',
	'panel',
	'view',
	'query',
	'index',
	'search',
	'snippet',
	'template',
	'workflow',
];
const ACTIONS = [
	'create',
	'get',
	'list',
	'update',
	'delete',
	'archive',
	'restore',
	'share',
	'export',
	'import',
	'move',
	'copy',
	'rename',
	'pin',
	'unpin',
	'open',
	'close',
	'merge',
	'split',
	'sync',
	'publish',
	'review',
	'approve',
	'reject',
	'assign',
];
const WORDS = [
	'the',
	'current',
	'selected',
	'every',
	'shared',
	'recent',
	'pinned',
	'draft',
	'item',
	'record',
	'entry',
	'workspace',
	'project',
	'scope',
	'layout',
	'panel',
	'sidebar',
	'view',
	'with',
	'from',
	'into',
	'and',
	'its',
	'history',
	'owner',
	'status',
	'label',
	'filter',
	'changes',
	'version',
	'copy',
	'link',
	'access',
	'settings',
	'person',
	'agent',
	'journal',
];

function pick<T>(random: () => number, items: readonly T[]): T {
	return items[Math.floor(random() * items.length)] as T;
}

function sentence(random: () => number, words: number): string {
	const text = Array.from({ length: words }, () => pick(random, WORDS)).join(' ');
	return `${text[0]?.toUpperCase()}${text.slice(1)}`;
}

function titleCase(name: string): string {
	return name
		.split('-')
		.map((part) => `${part[0]?.toUpperCase()}${part.slice(1)}`)
		.join(' ');
}

function referenceCommands(random: () => number, size: number): CommandSummaryV0[] {
	const commands: CommandSummaryV0[] = [];
	for (let i = 0; i < size; i++) {
		const base = `${DOMAINS[i % DOMAINS.length]}-${ACTIONS[Math.floor(i / DOMAINS.length) % ACTIONS.length]}`;
		const round = Math.floor(i / (DOMAINS.length * ACTIONS.length));
		const name = round === 0 ? base : `${base}-v${round}`;
		commands.push({
			name,
			...(random() < 0.5 ? { title: titleCase(name) } : {}),
			description: sentence(random, 6 + Math.floor(random() * 10)),
			mutation: random() < 0.5,
			needsInput: random() < 0.3,
		});
	}
	return commands;
}

function referenceQueries(
	random: () => number,
	commands: readonly CommandSummaryV0[],
	count: number
): string[] {
	const queries: string[] = [];
	for (let i = 0; i < count; i++) {
		const kind = i % 4;
		if (kind === 3) {
			// Matches nothing: letters no generated text holds in this order.
			queries.push(`zq${Math.floor(random() * 1000)}x`);
			continue;
		}
		const command = pick(random, commands);
		const source =
			kind === 0
				? command.name
				: kind === 1
					? (command.title ?? command.name)
					: command.description;
		const letters = source.toLowerCase().replace(/[^a-z]/g, '');
		const length = 2 + Math.floor(random() * 5);
		let query = '';
		let at = Math.floor(random() * Math.max(1, letters.length - length));
		while (query.length < length && at < letters.length) {
			query += letters[at];
			at += 1 + Math.floor(random() * 3);
		}
		queries.push(query.length > 0 ? query : 'la');
	}
	return queries;
}

function referenceCall(random: () => number, signedIn: { value: boolean }): SessionCall {
	const iface: KernelInterfaceV0 = random() < 0.7 ? 'palette' : 'agent';
	const call = (name: string, input: unknown = {}): SessionCall => ({
		interface: iface,
		name,
		input,
	});
	const roll = random();
	if (roll < 0.3) {
		const part = pick(random, ['sidebar', 'inspector'] as const);
		const width =
			part === 'sidebar' ? 180 + Math.floor(random() * 320) : 220 + Math.floor(random() * 320);
		return call('layout-set', { [part]: { width, open: random() < 0.5 } });
	}
	if (roll < 0.4)
		return call('layout-set', {
			panel: { open: random() < 0.5, height: 100 + Math.floor(random() * 400) },
		});
	if (roll < 0.47) {
		return call('layout-set', {
			compact: { drawer: pick(random, ['sidebar', 'inspector', null]), sheet: random() < 0.5 },
		});
	}
	if (roll < 0.57) return call('layout-get');
	if (roll < 0.6) return call('layout-reset');
	if (roll < 0.66) {
		return call('appearance-set', {
			theme: pick(random, ['system', 'light', 'dark', 'high-contrast']),
			density: pick(random, ['comfortable', 'compact']),
		});
	}
	if (roll < 0.7) return call('appearance-get');
	if (roll < 0.78) {
		return call('view-state-set', {
			id: 'loam.layout',
			state: { sidebar: { open: random() < 0.5 }, panel: { maximized: random() < 0.5 } },
		});
	}
	if (roll < 0.82)
		return call('view-state-get', { id: pick(random, ['loam.layout', 'loam.appearance']) });
	if (roll < 0.88) return call(pick(random, ['palette-open', 'palette-close']));
	if (roll < 0.92) return call('shell-info-get');
	if (roll < 0.95) {
		signedIn.value = !signedIn.value;
		return signedIn.value
			? call('auth-sign-in', { method: 'credentials', email: 'person@example.com' })
			: call('auth-sign-out');
	}
	return call('auth-session-get');
}

const REFERENCE_WORKSPACE = 'personal';

/** An id of `prefix` and twelve base-36 characters, as the kernel's commands make them. */
const idOf = (prefix: string, random: () => number): string =>
	`${prefix}_${`${random().toString(36).slice(2)}000000000000`.slice(0, 12)}`;

function referenceDocuments(random: () => number, count: number): DocumentRecordV1[] {
	const at = Date.UTC(2026, 10, 1);
	return Array.from({ length: count }, (_, index): DocumentRecordV1 => {
		const project = index % 2 === 0 ? undefined : `prj_reference${index % 5}`;
		const scope =
			project === undefined
				? { workspace: REFERENCE_WORKSPACE }
				: { workspace: REFERENCE_WORKSPACE, project };
		return {
			id: idOf('doc', random),
			workspace: REFERENCE_WORKSPACE,
			type: 'notes',
			instance: 'notes',
			title: sentence(random, 2 + Math.floor(random() * 4)),
			scope,
			scopeKey: project === undefined ? 'w' : `p:${project}`,
			owner: 'local',
			tags: [],
			status: random() < 0.05 ? 'trashed' : 'active',
			trashedAt: null,
			trashedFrom: null,
			contentVersion: 1,
			binding: {
				model: 'command',
				selection: 'text-range',
				locator: 'text-range',
				conflict: 'last-writer-wins',
			},
			epoch: 0,
			createdAt: at + index,
			updatedAt: at + index,
			createdBy: 'local',
			updatedBy: 'local',
		};
	});
}

function referenceLinks(
	random: () => number,
	documents: readonly DocumentRecordV1[],
	count: number
): DocumentLinkV1[] {
	if (documents.length === 0) return [];
	const at = Date.UTC(2026, 10, 2);
	return Array.from({ length: count }, (_, index): DocumentLinkV1 => {
		const from = pick(random, documents).id;
		return {
			id: idOf('lnk', random),
			workspace: REFERENCE_WORKSPACE,
			from,
			to: random() < 0.02 ? from : pick(random, documents).id,
			anchor: { kind: 'text-range', start: index, end: index + 8 },
			kind: random() < 0.2 ? 'embed' : 'reference',
			createdAt: at + index,
			createdBy: 'local',
		};
	});
}

/**
 * The reference workspace of the accelerator admission rule: deterministic for a seed. In phase
 * 0 it holds command summaries and queries for the palette index (A1) and calls whose journal
 * replay (A2) and diff (A3) are measured on; phase 2 adds documents and the links among them, which
 * the link index is built from (A4).
 */
export function createReferenceWorkspace(options: ReferenceWorkspaceOptions): ReferenceWorkspace {
	const { seed, size } = options;
	const random = createSeededRandom(seed);
	const commands = referenceCommands(random, size);
	const queries = referenceQueries(random, commands, options.queries ?? 200);
	const signedIn = { value: false };
	const calls = Array.from({ length: size }, () => referenceCall(random, signedIn));
	const documents = referenceDocuments(random, options.documents ?? 0);
	const links = referenceLinks(random, documents, options.links ?? 0);
	return { seed, size, commands, queries, calls, documents, links };
}
