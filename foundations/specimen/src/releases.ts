import type { Dirent } from 'node:fs';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { designReleaseManifestSchema } from './card-schema.js';
import {
	type CardUnmeasuredEntry,
	type DesignReleaseManifest,
	type DesignReleaseRequest,
	type DesignReleaseResult,
	RELEASE_ID_PATTERN,
	RELEASES_DIR,
} from './card-types.js';
import { parseDesignReleaseRequest } from './card-validate.js';
import { readAllCards } from './cards.js';
import {
	compareCodeUnits,
	readAllDecisions,
	readDecisionRecord,
	supersededIdsFromRecords,
	typedError,
} from './decisions-store.js';
import {
	assertRealContained,
	assertRealFileContained,
	specimenDataDir,
	withFileLock,
	writeFileAtomic,
} from './sets.js';
import type { DecisionRecord } from './types.js';

export function releasesDir(root: string): string {
	return join(resolve(root), RELEASES_DIR);
}

export function releaseFilePath(root: string, release: string): string {
	return join(releasesDir(root), `${release}.json`);
}

export function releaseRelativePath(release: string): string {
	return `specimens/releases/${release}.json`;
}

/** Read one release manifest from `specimens/releases/<release>.json` if it exists. */
export async function readReleaseManifest(
	root: string,
	release: string
): Promise<DesignReleaseManifest | undefined> {
	if (!RELEASE_ID_PATTERN.test(release)) return undefined;
	const filePath = releaseFilePath(root, release);
	let rawText: string;
	try {
		await assertRealFileContained(
			root,
			filePath,
			`Release manifest escapes workspace root: ${release}`
		);
		rawText = await readFile(filePath, 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
		throw error;
	}
	let raw: unknown;
	try {
		raw = JSON.parse(rawText);
	} catch {
		throw typedError(
			'VALIDATION_ERROR',
			`Release manifest '${release}' contains invalid JSON.`,
			'Inspect the release manifest under specimens/releases/.'
		);
	}
	const parsed = designReleaseManifestSchema.safeParse(raw);
	if (!parsed.success) {
		throw typedError(
			'VALIDATION_ERROR',
			`Release manifest '${release}' failed schema validation: ${parsed.error.message}`,
			'Inspect the release manifest under specimens/releases/.'
		);
	}
	return parsed.data;
}

/** Read all release manifests under `specimens/releases/`. */
export async function readAllReleases(root: string): Promise<DesignReleaseManifest[]> {
	const dir = releasesDir(root);
	let entries: Dirent[];
	try {
		await assertRealContained(root, dir, `Releases directory escapes workspace root: ${dir}`);
		entries = await readdir(dir, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw error;
	}
	const ids = entries
		.filter((e) => (e.isFile() || e.isSymbolicLink()) && e.name.endsWith('.json'))
		.map((e) => e.name.slice(0, -5))
		.filter((id) => RELEASE_ID_PATTERN.test(id))
		.sort(compareCodeUnits);

	const manifests: DesignReleaseManifest[] = [];
	for (const id of ids) {
		const m = await readReleaseManifest(root, id);
		if (m) manifests.push(m);
	}
	return manifests;
}

export interface RecordDesignReleaseOptions {
	decidedBy?: {
		kind: 'person' | 'panel' | 'script' | 'test';
		id?: string;
		channel?: 'review-page' | 'cli' | 'mcp-relay';
	};
	actor?: {
		kind: 'person' | 'agent' | 'script' | 'test';
		id?: string;
		channel?: 'review-page' | 'cli' | 'mcp-relay';
	};
	humanConfirmed?: boolean;
	now?: () => Date;
}

function isApprovedDecision(
	record: DecisionRecord,
	supersededIds: ReadonlySet<string>,
	cardsById: ReadonlyMap<string, { status: string; decision?: string }>
): boolean {
	if (supersededIds.has(record.id)) return false;
	if (record.decidedBy.kind !== 'person' && record.decidedBy.kind !== 'test') return false;
	if (record.kind === 'choice') return true;
	if (record.kind === 'card') {
		if (record.chosen !== 'approve') return false;
		const card = cardsById.get(record.card);
		if (card && card.status !== 'approved') return false;
		return true;
	}
	return false;
}

function releaseUnmeasured(): CardUnmeasuredEntry[] {
	return [
		{
			area: 'post-release-outcomes',
			reason: 'Release manifests record approved decisions before users interact with the release.',
			addToMeasure: 'Run design-observe against post-release AFD command journals.',
		},
	];
}

/**
 * Enforce the pre-ship release gate and write an append-only release manifest under
 * `specimens/releases/<release>.json`.
 */
export async function recordDesignRelease(
	root: string,
	rawRequest: DesignReleaseRequest,
	options: RecordDesignReleaseOptions = {}
): Promise<DesignReleaseResult> {
	const request = parseDesignReleaseRequest(rawRequest);
	const releaseId = request.release.trim();
	const decisionIds = request.decisions.map((id) => id.trim());
	const requestedReleasedAt = request.releasedAt?.trim();
	const actor = options.decidedBy ?? options.actor;
	const actorKind = actor?.kind ?? 'script';
	const isAuthorizedHuman =
		options.humanConfirmed === true || actorKind === 'person' || actorKind === 'test';
	if (!isAuthorizedHuman) {
		throw typedError(
			'PERSON_REQUIRED',
			'design-release requires a host-verified person or interactive person confirmation.',
			'Stop retrying as an agent or script; hand the release to a person for approval.'
		);
	}

	const lockPath = join(specimenDataDir(root), '.releases.lock');
	await assertRealContained(root, lockPath, `Releases lock escapes workspace root: ${lockPath}`);
	return withFileLock(lockPath, async () => {
		const scope = request.scope ?? 'all';
		const existingReleases = await readAllReleases(root);

		// Check idempotent re-call for identical (release, decisions) pair
		const existingSame = existingReleases.find((r) => r.release === releaseId);
		const sortedInput = [...decisionIds].sort(compareCodeUnits);
		if (existingSame) {
			const sortedExisting = [...existingSame.decisions].sort(compareCodeUnits);
			const identical =
				sortedExisting.length === sortedInput.length &&
				sortedExisting.every((id, idx) => id === sortedInput[idx]);
			if (identical) {
				return {
					release: existingSame.release,
					manifestPath: releaseRelativePath(existingSame.release),
					releasedAt: existingSame.releasedAt,
					decisions: existingSame.decisions,
					nextSteps: [
						`Run design-observe with a post-release AFD command journal against decision ${existingSame.decisions[0]}.`,
					],
					unmeasured: releaseUnmeasured(),
				};
			}
			throw typedError(
				'VALIDATION_ERROR',
				`Release '${releaseId}' already exists with a different decision set.`,
				'Pass a new release identifier or the exact decision list already recorded for this release.',
				{ release: releaseId }
			);
		}

		// Map decisions already released under another release
		const releasedUnder = new Map<string, string>();
		for (const rel of existingReleases) {
			for (const decId of rel.decisions) {
				releasedUnder.set(decId, rel.release);
			}
		}

		const allDecisions = await readAllDecisions(root);
		const supersededIds = supersededIdsFromRecords(allDecisions);
		const allCards = await readAllCards(root);
		const cardsById = new Map(allCards.map((c) => [c.card, c]));

		// Validate every named decision exists, is an active non-provisional person approval, and not already released
		let latestDecidedMs = Number.NEGATIVE_INFINITY;
		for (const decId of decisionIds) {
			const record = await readDecisionRecord(root, decId);
			if (!isApprovedDecision(record, supersededIds, cardsById)) {
				throw typedError(
					'DECISION_NOT_APPROVED',
					`Decision '${decId}' is not an active non-provisional person-approved decision (kind=${record.kind}, chosen=${record.chosen}, actor=${record.decidedBy.kind}).`,
					'Pass only active, non-superseded, person-approved decisions to design-release.',
					{
						decision: decId,
						kind: record.kind,
						chosen: record.chosen,
						actorKind: record.decidedBy.kind,
					}
				);
			}
			const priorRelease = releasedUnder.get(decId);
			if (priorRelease !== undefined) {
				throw typedError(
					'DECISION_NOT_APPROVED',
					`Decision '${decId}' was already released under '${priorRelease}'.`,
					'Pass only approved decisions not already released under another release.',
					{ decision: decId, existingRelease: priorRelease }
				);
			}
			const ms = Date.parse(record.decidedAt);
			if (Number.isFinite(ms) && ms > latestDecidedMs) {
				latestDecidedMs = ms;
			}
		}

		// Enforce release gate: block if any card in scope is 'open' or 'changes-requested'
		const blockingCards = allCards.filter(
			(card) =>
				(scope === 'all' || card.scope === scope) &&
				(card.status === 'open' || card.status === 'changes-requested')
		);
		if (blockingCards.length > 0) {
			throw typedError(
				'UNAPPROVED_CARDS_OPEN',
				`Cannot release '${releaseId}': ${blockingCards.length} card(s) remain open or changes-requested (${blockingCards.map((c) => c.card).join(', ')}).`,
				'Review and decide all open and changes-requested cards in design-card-list before releasing.',
				{ blockingCards: blockingCards.map((c) => ({ card: c.card, status: c.status })) }
			);
		}

		const releasedAt = requestedReleasedAt ?? (options.now?.() ?? new Date()).toISOString();
		const releasedMs = Date.parse(releasedAt);
		if (
			requestedReleasedAt !== undefined &&
			Number.isFinite(latestDecidedMs) &&
			releasedMs < latestDecidedMs
		) {
			throw typedError(
				'VALIDATION_ERROR',
				`releasedAt (${releasedAt}) cannot predate the latest approved decision timestamp.`,
				'Omit releasedAt to use the server clock or pass a timestamp on or after the latest approval.'
			);
		}

		const manifest: DesignReleaseManifest = {
			version: 1,
			release: releaseId,
			scope,
			releasedAt,
			decisions: decisionIds,
			releasedBy: {
				kind: actorKind === 'test' && !options.humanConfirmed ? 'test' : 'person',
				...(actor?.id ? { id: actor.id } : {}),
				...(actor?.channel
					? { channel: actor.channel }
					: options.humanConfirmed
						? { channel: 'mcp-relay' }
						: {}),
			},
		};

		const dir = releasesDir(root);
		await assertRealContained(root, dir, `Releases directory escapes workspace root: ${dir}`);
		await mkdir(dir, { recursive: true });
		const filePath = releaseFilePath(root, releaseId);
		await assertRealContained(
			root,
			filePath,
			`Release manifest escapes workspace root: ${releaseId}`
		);
		await writeFileAtomic(filePath, `${JSON.stringify(manifest, null, '\t')}\n`);

		return {
			release: manifest.release,
			manifestPath: releaseRelativePath(manifest.release),
			releasedAt: manifest.releasedAt,
			decisions: manifest.decisions,
			nextSteps: [
				`Run design-observe with a post-release AFD command journal against decision ${manifest.decisions[0]}.`,
			],
			unmeasured: releaseUnmeasured(),
		};
	});
}
