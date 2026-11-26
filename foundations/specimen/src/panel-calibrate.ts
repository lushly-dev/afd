/**
 * Blind panel agreement calibration (`panel-calibrate`, Agent-First Design Phase C3, #2563).
 *
 * - `action: 'sample'`: draws a blind sample of non-withdrawn provisional panel agreements
 *   (strictly omitting `panelVerdict`), returning visual/walk evidence for independent review.
 * - `action: 'record'`: verifies person authority (`PERSON_REQUIRED`), compares independent human
 *   verdicts server-side against the hidden `panelVerdict`, computes `disagreed` and
 *   `disagreementRate`, and reopens every disagreed item as an open decision card in
 *   `specimens/cards/`.
 */

import { createHash, randomBytes, randomInt } from 'node:crypto';
import { type Dirent, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { DesignCardRecord } from './card-types.js';
import { cardFilePath, generateCardId, writeCardRecord } from './cards.js';
import { compareCodeUnits, typedError } from './decisions-store.js';
import type { UnmeasuredEntry } from './design-types.js';
import { readAllPanelRuns } from './panel-review.js';
import {
	DEFAULT_CALIBRATION_COUNT,
	PANEL_CALIBRATIONS_DIR,
	type PanelCalibrateRequest,
	type PanelCalibrateResult,
	type PanelCalibrationSampleRecord,
	type RunPanelCalibrateOptions,
	SAMPLE_ID_LENGTH,
	SAMPLE_ID_PATTERN,
} from './panel-review-types.js';
import { parsePanelCalibrateRequest } from './panel-review-validate.js';
import { CROCKFORD_BASE32 } from './point.js';
import {
	assertRealContained,
	assertRealFileContained,
	specimenDataDir,
	withFileLock,
	writeFileAtomic,
} from './sets.js';

/** Generate a 12-character lowercase Crockford base-32 calibration sample id (`cal-<12>`). */
export function generateSampleId(): string {
	const bytes = randomBytes(SAMPLE_ID_LENGTH);
	let body = '';
	for (let i = 0; i < SAMPLE_ID_LENGTH; i++) {
		body += CROCKFORD_BASE32[(bytes[i] ?? 0) & 31];
	}
	return `cal-${body}`;
}

export function panelCalibrationsDir(root: string): string {
	return join(specimenDataDir(root), PANEL_CALIBRATIONS_DIR);
}

export function panelCalibrationFilePath(root: string, sampleId: string): string {
	return join(panelCalibrationsDir(root), `${sampleId}.json`);
}

function defaultCalibrateUnmeasured(): UnmeasuredEntry[] {
	return [
		{
			area: 'unsampled-agreements',
			reason:
				'Calibration samples a subset of provisional panel agreements and does not audit unsampled items.',
			addToMeasure:
				'Increase panel-calibrate sample count or run additional blind calibration rounds.',
		},
	];
}

/** Deterministic mulberry32 PRNG for reproducible calibration sampling when `seed` is supplied. */
function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function deterministicShuffle<T>(items: readonly T[], seed?: number): T[] {
	const copy = [...items];
	const rand = seed !== undefined ? mulberry32(seed) : undefined;
	for (let i = copy.length - 1; i > 0; i--) {
		const j = rand !== undefined ? Math.floor(rand() * (i + 1)) : randomInt(0, i + 1);
		const tmp = copy[i] as T;
		copy[i] = copy[j] as T;
		copy[j] = tmp;
	}
	return copy;
}

async function readAllCalibrationSamples(root: string): Promise<PanelCalibrationSampleRecord[]> {
	const dir = panelCalibrationsDir(root);
	if (!existsSync(dir)) return [];
	await assertRealContained(root, dir, `Calibrations directory escapes workspace root: ${dir}`);
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => [] as Dirent[]);
	const names = entries
		.filter((e) => (e.isFile() || e.isSymbolicLink()) && e.name.endsWith('.json'))
		.map((e) => e.name)
		.sort(compareCodeUnits);
	const samples: PanelCalibrationSampleRecord[] = [];
	for (const name of names) {
		const sampleId = name.slice(0, -5);
		if (!SAMPLE_ID_PATTERN.test(sampleId)) continue;
		const filePath = join(dir, name);
		try {
			await assertRealFileContained(
				root,
				filePath,
				`Calibration file escapes workspace root: ${name}`
			);
			const parsed = JSON.parse(await readFile(filePath, 'utf8')) as PanelCalibrationSampleRecord;
			if (parsed && parsed.version === 1 && parsed.sample === sampleId) {
				samples.push(parsed);
			}
		} catch {
			// Skip malformed scratch files.
		}
	}
	return samples;
}

async function readCalibrationSample(
	root: string,
	sampleId: string
): Promise<PanelCalibrationSampleRecord | undefined> {
	if (!SAMPLE_ID_PATTERN.test(sampleId)) return undefined;
	const filePath = panelCalibrationFilePath(root, sampleId);
	if (!existsSync(filePath)) return undefined;
	await assertRealFileContained(
		root,
		filePath,
		`Calibration file escapes workspace root: ${sampleId}`
	);
	const parsed = JSON.parse(await readFile(filePath, 'utf8')) as PanelCalibrationSampleRecord;
	if (parsed?.version !== 1 || parsed.sample !== sampleId) return undefined;
	return parsed;
}

async function writeCalibrationSample(
	root: string,
	record: PanelCalibrationSampleRecord
): Promise<void> {
	const dir = panelCalibrationsDir(root);
	await assertRealContained(root, dir, `Calibrations directory escapes workspace root: ${dir}`);
	await mkdir(dir, { recursive: true });
	const filePath = panelCalibrationFilePath(root, record.sample);
	await assertRealContained(
		root,
		filePath,
		`Calibration file escapes workspace root: ${record.sample}`
	);
	await writeFileAtomic(filePath, `${JSON.stringify(record, null, '\t')}\n`);
}

/**
 * Execute `panel-calibrate` (`action: 'sample'` or `action: 'record'`).
 * Over MCP, the command declares static `confirmationMode: 'host-verified'`; in-process/CLI
 * callers still enforce `PERSON_REQUIRED` on `action: 'record'`.
 */
export async function runPanelCalibrate(
	root: string,
	rawRequest: PanelCalibrateRequest,
	options: RunPanelCalibrateOptions = {}
): Promise<PanelCalibrateResult> {
	const request = parsePanelCalibrateRequest(rawRequest);
	const now = options.now ? options.now() : new Date();
	// Coordinate on `.panel-runs.lock` so calibration sampling/recording never races with `panel-review` withdraw.
	const lockPath = join(specimenDataDir(root), '.panel-runs.lock');
	await assertRealContained(root, lockPath, `Panel lock escapes root: ${lockPath}`);

	return withFileLock(lockPath, async () => {
		if (request.action === 'sample') {
			const runs = await readAllPanelRuns(root);
			const existingSamples = await readAllCalibrationSamples(root);
			const alreadyCalibratedItems = new Set<string>();
			for (const sample of existingSamples) {
				if (sample.status === 'recorded') {
					for (const j of sample.judgements ?? []) {
						alreadyCalibratedItems.add(j.item);
					}
				}
			}

			const pool: PanelCalibrationSampleRecord['items'] = [];
			for (const run of runs) {
				if (run.status === 'withdrawn') continue;
				for (const item of run.provisionalItems) {
					if (item.withdrawn) continue;
					if (alreadyCalibratedItems.has(item.item)) continue;
					pool.push({
						item: item.item,
						run: run.run,
						summary: item.summary,
						evidence: { ...item.evidence },
						panelVerdict: item.verdict,
					});
				}
			}

			if (pool.length === 0) {
				throw typedError(
					'NOTHING_TO_SAMPLE',
					'No uncalibrated provisional panel agreements are available to sample.',
					'Run panel-review first to generate provisional panel agreements before calling panel-calibrate.'
				);
			}

			pool.sort((a, b) => compareCodeUnits(a.item, b.item));
			const count = Math.min(request.count ?? DEFAULT_CALIBRATION_COUNT, pool.length);
			const sampled = deterministicShuffle(pool, request.seed).slice(0, count);
			const sampleId = generateSampleId();

			const record: PanelCalibrationSampleRecord = {
				version: 1,
				sample: sampleId,
				createdAt: now.toISOString(),
				...(request.seed === undefined ? {} : { seed: request.seed }),
				status: 'open',
				items: sampled,
			};
			await writeCalibrationSample(root, record);

			// Strictly blind output: omit `panelVerdict` during `action: 'sample'`.
			return {
				sample: sampleId,
				items: sampled.map(({ item, summary, evidence }) => ({
					item,
					summary,
					evidence: { ...evidence },
				})),
				unmeasured: defaultCalibrateUnmeasured(),
			};
		}

		// Record mode: enforce person authority (`PERSON_REQUIRED`)
		const invokingKind = options.invokingActorKind ?? 'script';
		const isPersonAuthorized =
			options.humanConfirmed === true || invokingKind === 'person' || invokingKind === 'test';
		if (!isPersonAuthorized) {
			throw typedError(
				'PERSON_REQUIRED',
				'Recording panel-calibrate judgements requires a host-verified person.',
				'Hand the blind calibration sample to a person; agents and scripts cannot record calibration verdicts.'
			);
		}

		const sampleRecord = await readCalibrationSample(root, request.sample);
		if (!sampleRecord) {
			throw typedError(
				'SAMPLE_NOT_FOUND',
				`Calibration sample '${request.sample}' was not found.`,
				'Run panel-calibrate with action: "sample" first to generate a valid sample id.',
				{ sample: request.sample }
			);
		}
		if (sampleRecord.status === 'recorded') {
			throw typedError(
				'VALIDATION_ERROR',
				`Calibration sample '${request.sample}' has already been recorded.`,
				'Draw a new sample with panel-calibrate (action: "sample") to record additional judgements.'
			);
		}
		if (request.judgements.length === 0) {
			throw typedError(
				'VALIDATION_ERROR',
				'Recording panel-calibrate requires at least one judgement so hidden panel verdicts are not disclosed without human review.',
				'Provide one or more judgements ({ item, verdict: "accept" | "reject" }) for items in this sample.'
			);
		}

		// Revalidate every judged item against current run state so withdrawn runs/items cannot contaminate calibration.
		const currentRuns = await readAllPanelRuns(root);
		const currentRunsById = new Map(currentRuns.map((r) => [r.run, r]));

		const sampleItemById = new Map(sampleRecord.items.map((item) => [item.item, item]));
		const seenItems = new Set<string>();
		for (const j of request.judgements) {
			if (seenItems.has(j.item)) {
				throw typedError(
					'VALIDATION_ERROR',
					`Duplicate judgement for calibration item '${j.item}'.`,
					'Provide at most one judgement per sampled item.'
				);
			}
			const sampleItem = sampleItemById.get(j.item);
			if (!sampleItem) {
				throw typedError(
					'VALIDATION_ERROR',
					`Judgement references item '${j.item}', which is not in sample '${request.sample}'.`,
					`Use only item ids returned in panel-calibrate sample '${request.sample}'.`
				);
			}
			const sourceRun = currentRunsById.get(sampleItem.run);
			const liveProvisional = sourceRun?.provisionalItems.find((p) => p.item === sampleItem.item);
			if (
				!sourceRun ||
				sourceRun.status === 'withdrawn' ||
				!liveProvisional ||
				liveProvisional.withdrawn
			) {
				throw typedError(
					'VALIDATION_ERROR',
					`Calibration item '${j.item}' from run '${sampleItem.run}' was withdrawn after sampling and cannot be recorded.`,
					'Draw a fresh blind sample with panel-calibrate (action: "sample").',
					{ sample: request.sample, item: j.item, run: sampleItem.run }
				);
			}
			seenItems.add(j.item);
		}

		const recorded = request.judgements.length;
		let disagreed = 0;
		const cardsToWrite: DesignCardRecord[] = [];

		for (const j of request.judgements) {
			const sampleItem = sampleItemById.get(
				j.item
			) as PanelCalibrationSampleRecord['items'][number];
			if (j.verdict !== sampleItem.panelVerdict) {
				disagreed += 1;
				const cardId = generateCardId();
				const humanReason =
					j.reason?.trim() ||
					`Person verdict '${j.verdict}' disagreed with provisional panel verdict '${sampleItem.panelVerdict}'.`;
				const changeSignature = createHash('sha256')
					.update(
						JSON.stringify({
							kind: 'calibration-disagreement',
							sample: sampleRecord.sample,
							item: sampleItem.item,
						}),
						'utf8'
					)
					.digest('hex');

				cardsToWrite.push({
					card: cardId,
					run: sampleItem.run,
					scope: 'interface',
					what: `Calibration disagreement on '${sampleItem.item}': ${sampleItem.summary}`,
					owner: 'product',
					touches: [
						sampleItem.item,
						...(sampleItem.evidence.walk ? [sampleItem.evidence.walk] : []),
					],
					severity: 'major',
					visual: {
						kind: sampleItem.evidence.visual ? 'captures' : 'transcript',
						...(sampleItem.evidence.visual ? { after: sampleItem.evidence.visual } : {}),
						summary: `Person (${j.verdict}) disagreed with panel (${sampleItem.panelVerdict}) on '${sampleItem.item}': ${humanReason}`,
					},
					why: {
						findings: [
							{
								summary: humanReason,
								evidence: 'observed',
							},
						],
						evidenceForBothSides: {
							for: [
								`Panel provisionally settled '${sampleItem.item}' as '${sampleItem.panelVerdict}': ${sampleItem.summary}`,
							],
							against: [
								`Person independently judged '${sampleItem.item}' as '${j.verdict}': ${humanReason}`,
							],
						},
						reviewerCount: 1,
						split: '1-1',
						trigger: 'conflicts-recorded-decision',
					},
					effect: {
						gatesBefore: { passed: 0, failed: 0 },
						gatesAfter: { passed: 0, failed: 0 },
						checksSummary: `Reopened from calibration sample '${sampleRecord.sample}'.`,
						regression: false,
					},
					risk: {
						affects: [sampleItem.run, sampleItem.item],
						undoable: true,
					},
					status: 'open',
					changeSignature,
					createdAt: now.toISOString(),
				});
			}
		}

		const disagreementRate = recorded > 0 ? Number((disagreed / recorded).toFixed(6)) : 0;
		const reopenedCards: string[] = [];
		const writtenCardPaths: string[] = [];

		try {
			for (const card of cardsToWrite) {
				await writeCardRecord(root, card);
				writtenCardPaths.push(cardFilePath(root, card.card));
				reopenedCards.push(card.card);
			}
			await writeCalibrationSample(root, {
				...sampleRecord,
				status: 'recorded',
				recordedAt: now.toISOString(),
				judgements: request.judgements.map((j) => ({ ...j })),
				disagreed,
				disagreementRate,
				reopenedCards,
			});
		} catch (error) {
			for (const p of writtenCardPaths) {
				await unlink(p).catch(() => {});
			}
			throw error;
		}

		// On `record`, reveal the hidden `panelVerdict` ONLY for items actually judged (preventing leaks on partial judgements).
		return {
			sample: sampleRecord.sample,
			items: sampleRecord.items.map(({ item, summary, evidence, panelVerdict }) => ({
				item,
				summary,
				evidence: { ...evidence },
				...(seenItems.has(item) ? { panelVerdict } : {}),
			})),
			recorded,
			disagreed,
			disagreementRate,
			reopenedCards,
			unmeasured: defaultCalibrateUnmeasured(),
		};
	});
}
