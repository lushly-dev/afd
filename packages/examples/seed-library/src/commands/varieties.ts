/**
 * @fileoverview The catalogue: varieties, their lots, and substitutes for one that has run out.
 */

import type { Alternative, Source, Warning } from '@lushly-dev/afd-core';
import { defineCommand, success, type ZodCommandDefinition } from '@lushly-dev/afd-server';
import { z } from 'zod';
import { LibraryErrors, matches, nowOf, plural, refuse, unavailable } from '../refusals.js';
import {
	lotListOutput,
	substituteSuggestOutput,
	varietyGetOutput,
	varietyKind,
	varietyListOutput,
	varietyRetireOutput,
} from '../schemas.js';
import { iso, type LibraryStore, type Lot } from '../store.js';

/** The question a screen asks before it calls `variety-retire` (bench task T3). */
export const VARIETY_RETIRE_PROMPT =
	'Retire this variety? Its packets on the shelf are withdrawn and nobody can borrow it again. Loans already out stay open. This cannot be undone.';

const varietyNotFound = (id: string) =>
	refuse('NOT_FOUND', `The library has no variety ${id}`, 'Call variety-list to find the variety', {
		id,
	});

/** The caution for a variety whose packets on the shelf are old seed, or none. */
export function oldSeedWarning(store: LibraryStore, varietyId: string): Warning | undefined {
	const lot = store.freshestLot(varietyId);
	if (!lot || lot.germination.estimate >= store.rules.oldSeedBelow) return undefined;
	const { estimate, basis } = lot.germination;
	return {
		code: 'OLD_SEED',
		message: `The packets of ${store.varietyRef(varietyId).name} on the shelf are from ${lot.harvestYear}; about ${Math.round(estimate * 100)}% of the seed is expected to germinate, judged by its ${basis === 'tested' ? 'test' : 'age'}`,
		severity: 'caution',
		details: { lotId: lot.id, estimate, basis },
	};
}

function lotEvidence(store: LibraryStore, varietyName: string, lot: Lot): Source | undefined {
	const type = lot.germination.basis === 'tested' ? 'test' : 'document';
	const entry = store.evidence.find((item) => item.type === type);
	if (!entry) return undefined;
	const { location, ...source } = entry;
	// A table's line is cited only for the crop it is about.
	return location?.startsWith(`${varietyName}:`) ? { ...source, location } : source;
}

export function varietyCommands(store: LibraryStore): ZodCommandDefinition[] {
	const varietyList = defineCommand({
		name: 'variety-list',
		category: 'catalogue',
		description:
			"Search the library's varieties by name, with the packets on the shelf and the germination estimate of the lot a loan would come from",
		expose: { mcp: true },
		input: z.object({
			query: z.string().optional().describe('Part of the variety name, any case'),
			kind: varietyKind.optional(),
			includeRetired: z.boolean().default(false).describe('Also list retired varieties'),
		}),
		output: varietyListOutput,
		errors: ['SERVICE_UNAVAILABLE'],
		async handler(input) {
			if (!store.available) return unavailable('catalogue', 'variety-list');
			const varieties = [...store.varieties.values()]
				.filter((variety) => input.includeRetired || !variety.retired)
				.filter((variety) => !input.kind || variety.kind === input.kind)
				.filter((variety) => matches(input.query, variety.name))
				.map((variety) => {
					const lot = store.freshestLot(variety.id);
					return {
						id: variety.id,
						name: variety.name,
						kind: variety.kind,
						rare: variety.rare,
						packetsAvailable: store.packetsAvailable(variety.id),
						...(lot && { germination: { ...lot.germination } }),
						retired: variety.retired ?? false,
					};
				});
			return success(
				{ varieties, total: varieties.length },
				{
					reasoning:
						varieties.length === 0
							? `No variety matches${input.query ? ` "${input.query}"` : ''}`
							: `Found ${plural(varieties.length, 'variety', 'varieties')}`,
				}
			);
		},
	});

	const varietyGet = defineCommand({
		name: 'variety-get',
		category: 'catalogue',
		description:
			'Get one variety: its kind, whether it is rare, the packets on the shelf and who is waiting for it',
		expose: { mcp: true },
		input: z.object({ id: z.string().describe('The variety id, such as var-borlotti') }),
		output: varietyGetOutput,
		errors: ['NOT_FOUND'],
		async handler(input) {
			const variety = store.variety(input.id);
			if (!variety) return varietyNotFound(input.id);
			return success({
				id: variety.id,
				name: variety.name,
				kind: variety.kind,
				rare: variety.rare,
				packetsAvailable: store.packetsAvailable(variety.id),
				waiting: store.waitingFor(variety.id).map((entry, index) => ({
					member: store.memberRef(entry.memberId),
					position: index + 1,
				})),
				retired: variety.retired ?? false,
				...(variety.retiredAt && { retiredAt: variety.retiredAt }),
			});
		},
	});

	const varietyRetire = defineCommand({
		name: 'variety-retire',
		category: 'catalogue',
		description:
			"Retires a variety that has stopped coming true and removes its packets from the shelf; nobody can borrow it again. Loans already out stay open. Cannot be undone. Only a person with the steward's role may call it",
		expose: { mcp: true },
		mutation: true,
		destructive: true,
		confirmPrompt: VARIETY_RETIRE_PROMPT,
		approval: 'not-required',
		input: z.object({ id: z.string().describe('The variety id') }),
		output: varietyRetireOutput,
		errors: ['NOT_FOUND', 'CONFLICT', 'CONFIRMATION_REQUIRED', 'FORBIDDEN'],
		async handler(input, context) {
			const variety = store.variety(input.id);
			if (!variety) return varietyNotFound(input.id);
			if (variety.retired) {
				return refuse(
					'CONFLICT',
					`${variety.name} was retired already${variety.retiredAt ? `, at ${variety.retiredAt}` : ''}`,
					`Call variety-get with id ${variety.id} to see it; a retired variety cannot be retired again or brought back`,
					{ id: variety.id, retired: true }
				);
			}
			let packetsWithdrawn = 0;
			for (const lot of store.lotsOf(variety.id)) {
				packetsWithdrawn += lot.packets;
				lot.packets = 0;
			}
			variety.retired = true;
			variety.retiredAt = iso(nowOf(context));
			return success(
				{ id: variety.id, retired: true, retiredAt: variety.retiredAt, packetsWithdrawn },
				{
					reasoning: `Retired ${variety.name} and withdrew ${plural(packetsWithdrawn, 'packet')}`,
				}
			);
		},
	});

	const lotList = defineCommand({
		name: 'lot-list',
		category: 'catalogue',
		description:
			"List a variety's lots, with each lot's harvest year, packets and germination estimate, and what the estimate rests on",
		expose: { mcp: true },
		input: z.object({ varietyId: z.string().describe('The variety id') }),
		output: lotListOutput,
		errors: ['NOT_FOUND'],
		async handler(input) {
			const variety = store.variety(input.varietyId);
			if (!variety) return varietyNotFound(input.varietyId);
			const lots = store.lotsOf(variety.id);
			const reasons = lots.map((lot) =>
				lot.germination.basis === 'tested'
					? `The ${lot.harvestYear} lot's estimate comes from the library's own germination test`
					: `The ${lot.harvestYear} lot has not been tested, so its estimate is from its age`
			);
			const sources: Source[] = [];
			for (const lot of lots) {
				const source = lotEvidence(store, variety.name, lot);
				if (source && !sources.some((item) => item.id === source.id)) sources.push(source);
			}
			// How far the estimates can be trusted: a test more than an age, weighted by packets.
			const weight = (lot: Lot) => (lot.germination.basis === 'tested' ? 0.9 : 0.6);
			const packets = lots.reduce((sum, lot) => sum + lot.packets, 0);
			const confidence =
				lots.length === 0
					? 1
					: packets > 0
						? lots.reduce((sum, lot) => sum + weight(lot) * lot.packets, 0) / packets
						: lots.reduce((sum, lot) => sum + weight(lot), 0) / lots.length;
			const warning = oldSeedWarning(store, variety.id);
			return success(
				{
					lots: lots.map((lot) => ({
						id: lot.id,
						harvestYear: lot.harvestYear,
						packets: lot.packets,
						source: lot.source,
						germination: { ...lot.germination },
					})),
					total: lots.length,
				},
				{
					reasoning:
						lots.length === 0
							? `${variety.name} has no lots`
							: `${variety.name}: ${reasons.join('. ')}`,
					confidence: Math.round(confidence * 100) / 100,
					...(sources.length > 0 && { sources }),
					...(warning && { warnings: [warning] }),
				}
			);
		},
	});

	const substituteSuggest = defineCommand({
		name: 'substitute-suggest',
		category: 'catalogue',
		description:
			'Suggest the closest variety on the shelf to one that has run out, with the others as alternatives',
		expose: { mcp: true },
		input: z.object({ varietyId: z.string().describe('The variety the member asked for') }),
		output: substituteSuggestOutput,
		errors: ['NOT_FOUND', LibraryErrors.NO_SUBSTITUTE],
		async handler(input) {
			const variety = store.variety(input.varietyId);
			if (!variety) return varietyNotFound(input.varietyId);
			const offers = store.substitutes
				.filter((entry) => entry.for === variety.id)
				.map((entry) => ({ entry, offered: store.variety(entry.offer) }))
				.filter(
					({ offered }) =>
						offered !== undefined && !offered.retired && store.packetsAvailable(offered.id) > 0
				)
				.sort((a, b) => b.entry.confidence - a.entry.confidence)
				.map(({ entry }) => ({
					data: {
						variety: {
							...store.varietyRef(entry.offer),
							packetsAvailable: store.packetsAvailable(entry.offer),
						},
					},
					reason: entry.reason,
					confidence: entry.confidence,
				}));
			const [best, ...rest] = offers;
			if (!best) {
				const onShelf = store.packetsAvailable(variety.id) > 0;
				return refuse(
					LibraryErrors.NO_SUBSTITUTE,
					onShelf
						? `Nothing the library keeps is close to ${variety.name}`
						: `${variety.name} has run out, and nothing the library keeps is close to it`,
					onShelf
						? `${variety.name} has packets on the shelf: lend one with loan-create`
						: `Call waitlist-join with the member and varietyId ${variety.id} to put them on the waiting list`,
					{ varietyId: variety.id }
				);
			}
			const alternatives: Alternative<typeof best.data>[] = rest.map((offer) => ({
				...offer,
				label: offer.data.variety.name,
			}));
			return success(best.data, {
				reasoning: best.reason,
				confidence: best.confidence,
				...(alternatives.length > 0 && { alternatives }),
			});
		},
	});

	return [varietyList, varietyGet, varietyRetire, lotList, substituteSuggest];
}
