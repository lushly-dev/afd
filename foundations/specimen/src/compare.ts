import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { RANDOM_SEED } from './baseline.js';
import { renderComparePageHtml } from './compare-page.js';
import { resolveContext } from './config.js';
import { diffObservations } from './diff.js';
import type { SpecimenHostError } from './host.js';
import {
	assertRealContained,
	assertRealFileContained,
	type CaptureSetHost,
	captureSetsDir,
	captureStorageStem,
	nearestSpecimenIds,
	resolveCaptureSetId,
	specimenDataDir,
	themeAvailabilityReason,
	type WriteCaptureSetItem,
	writeCaptureSet,
	writeFileAtomic,
} from './sets.js';
import { DEFAULT_SUITE_WORKERS, pool } from './suite.js';
import type {
	CaptureCheckpoint,
	CaptureSetManifest,
	ChannelDifference,
	CompareCapture,
	CompareDifference,
	ComparePageCapture,
	ComparePageData,
	ComparePageDifference,
	CompareRequest,
	CompareRun,
	SpecimenContext,
	SpecimenEntry,
	SpecimenTheme,
} from './types.js';
import { parseCompareRequest } from './validate.js';

export const COMPARE_DATA_FILE = 'compare.json';
export const COMPARE_PAGE_FILE = 'compare.html';

function compareCodeUnits(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function typedError(
	code: string,
	message: string,
	suggestion: string,
	details?: Record<string, unknown>
): SpecimenHostError {
	const error: SpecimenHostError = new Error(message);
	error.code = code;
	error.suggestion = suggestion;
	if (details !== undefined) error.details = details;
	return error;
}

function declaredThemeList(entry: SpecimenEntry): SpecimenTheme[] {
	const themesSupported = entry.themes?.supported;
	const contextsThemes = entry.contexts?.themes;
	if (themesSupported?.length && contextsThemes?.length) {
		return themesSupported.filter((theme) => contextsThemes.includes(theme));
	}
	if (themesSupported?.length) return [...themesSupported];
	if (contextsThemes?.length) return [...contextsThemes];
	return [];
}

/**
 * Validate `specimen-compare` variant ids and declared theme availability before capturing anything.
 * Preserves the exact caller `ids` order so index 0 is the comparison baseline.
 */
export function selectCompareEntries(
	entries: readonly SpecimenEntry[],
	request: CompareRequest,
	context: SpecimenContext
): SpecimenEntry[] {
	const byId = new Map(entries.map((entry) => [entry.id, entry]));
	const missing = request.ids.filter((id) => !byId.has(id));
	if (missing.length > 0) {
		const first = missing[0] as string;
		const nearest = nearestSpecimenIds(first, [...byId.keys()]);
		const hint = nearest.length
			? `Did you mean ${nearest.join(', ')}?`
			: 'Use specimen-list to see available specimen ids.';
		throw typedError('SPECIMEN_NOT_FOUND', `Specimen not found: ${missing.join(', ')}`, hint, {
			missing,
			nearest,
		});
	}
	const selected = request.ids.map((id) => byId.get(id) as SpecimenEntry);
	for (const entry of selected) {
		const reason = themeAvailabilityReason(entry, context.theme);
		if (reason !== null) {
			const declared = declaredThemeList(entry);
			const suggestion = declared.length
				? `Compare in a theme ${entry.id} declares (${declared.join(', ')}), or remove ${entry.id} from ids.`
				: `Compare in a theme ${entry.id} supports, or remove ${entry.id} from ids.`;
			throw typedError(
				'VARIANT_UNAVAILABLE',
				`Variant ${entry.id} is unavailable in theme ${context.theme}: ${reason}`,
				suggestion,
				{
					id: entry.id,
					requestedTheme: context.theme,
					declaredThemes: declared,
				}
			);
		}
	}
	return selected;
}

/**
 * Orchestrate `specimen-compare`: validate ids and themes, capture 2–8 variants with axe and
 * screenshots under one context and checkpoint, diff each against the first, persist a `compare`
 * capture set plus `compare.json` / `compare.html`, and return compact summaries (no observations).
 */
export async function runCompare(
	host: CaptureSetHost,
	rawRequest: CompareRequest
): Promise<CompareRun> {
	const request = parseCompareRequest(rawRequest);
	const context = resolveContext(request.context);
	const selected = selectCompareEntries(host.entries, request, context);
	const checkpointName = request.checkpoint ?? 'mount';
	const workers = request.workers ?? host.workers ?? DEFAULT_SUITE_WORKERS;
	const stagingDir = join(specimenDataDir(host.root), 'tmp', randomUUID());

	const sourcePromise = host.sourceState();
	const items: WriteCaptureSetItem[] = new Array<WriteCaptureSetItem>(selected.length);
	const themeMismatches: { id: string; rendered: SpecimenTheme }[] = [];

	try {
		await assertRealContained(
			host.root,
			stagingDir,
			`Staging directory escapes root: ${stagingDir}`
		);
		await mkdir(stagingDir, { recursive: true });
		await host.prepare();

		await pool(
			selected.map((_, index) => index),
			workers,
			async (index) => {
				const entry = selected[index] as SpecimenEntry;
				const screenshotPath = join(stagingDir, `${captureStorageStem(entry.id)}.png`);
				try {
					const observation = await host.render({
						entry,
						context,
						checkpoint: checkpointName,
						axe: true,
						screenshot: screenshotPath,
						...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
					});
					if (observation.manifest.context.theme !== context.theme) {
						await rm(screenshotPath, { force: true });
						themeMismatches.push({
							id: entry.id,
							rendered: observation.manifest.context.theme,
						});
						return;
					}
					items[index] = {
						key: entry.id,
						id: entry.id,
						status: 'captured',
						observation,
						screenshotSource: observation.channels.visual.path ? screenshotPath : null,
					};
				} catch (error) {
					await rm(screenshotPath, { force: true });
					const rawMessage = error instanceof Error ? error.message : String(error ?? '');
					items[index] = {
						key: entry.id,
						id: entry.id,
						status: 'unavailable',
						reason:
							rawMessage.trim().length > 0 ? rawMessage : `Variant ${entry.id} failed to render.`,
					};
				}
			}
		);

		if (themeMismatches.length > 0) {
			themeMismatches.sort((a, b) => request.ids.indexOf(a.id) - request.ids.indexOf(b.id));
			const first = themeMismatches[0] as { id: string; rendered: SpecimenTheme };
			throw typedError(
				'VARIANT_UNAVAILABLE',
				`Variant ${first.id} rendered in theme ${first.rendered} instead of requested theme ${context.theme}.`,
				`Compare in theme ${first.rendered}, or update ${first.id} to follow ${context.theme}.`,
				{
					id: first.id,
					requestedTheme: context.theme,
					renderedTheme: first.rendered,
				}
			);
		}

		// Compute diffs against the first variant before writing so incompatibilities refuse cleanly.
		const baselineItem = items[0] as WriteCaptureSetItem;
		const baselineId = (selected[0] as SpecimenEntry).id;
		const differences: CompareDifference[] = [];
		const pageDifferences: ComparePageDifference[] = [];

		for (let i = 1; i < selected.length; i++) {
			const variantId = (selected[i] as SpecimenEntry).id;
			const variantItem = items[i] as WriteCaptureSetItem;
			if (
				baselineItem.status !== 'captured' ||
				!baselineItem.observation ||
				variantItem.status !== 'captured' ||
				!variantItem.observation
			) {
				const reason =
					variantItem.status !== 'captured'
						? (variantItem.reason ?? `Variant ${variantId} could not be captured.`)
						: (baselineItem.reason ?? `Baseline variant ${baselineId} could not be captured.`);
				differences.push({
					id: variantId,
					against: baselineId,
					status: 'insufficient-evidence',
					channels: [],
				});
				pageDifferences.push({
					id: variantId,
					against: baselineId,
					status: 'insufficient-evidence',
					channels: [],
					items: [],
					limitations: [reason],
				});
				continue;
			}
			const diff = diffObservations(baselineItem.observation, variantItem.observation);
			const channels = [...new Set(diff.differences.map((entry) => entry.channel))].sort(
				compareCodeUnits
			) as ChannelDifference['channel'][];
			differences.push({
				id: variantId,
				against: baselineId,
				status: diff.status,
				channels,
			});
			pageDifferences.push({
				id: variantId,
				against: baselineId,
				status: diff.status,
				channels,
				items: diff.differences,
				limitations: diff.limitations,
			});
		}

		const source = await sourcePromise;
		const firstObs = items.find((item) => item.observation !== undefined)?.observation;
		const checkpoint: CaptureSetManifest['checkpoint'] = firstObs
			? {
					name: firstObs.manifest.checkpoint.name,
					actionMode: firstObs.manifest.checkpoint.actionMode,
					baseline: firstObs.manifest.checkpoint.baseline,
				}
			: {
					name: checkpointName,
					actionMode: 'none' as CaptureCheckpoint['actionMode'],
					baseline: {
						clock: 'real',
						random: { source: 'seeded', seed: RANDOM_SEED },
						storage: 'empty',
					},
				};
		const browser = firstObs
			? { name: firstObs.manifest.browser.name, version: firstObs.manifest.browser.version }
			: null;

		const { manifest } = await writeCaptureSet(host.root, {
			kind: 'compare',
			order: selected.map((entry) => entry.id),
			context,
			checkpoint,
			browser,
			axe: true,
			revision: source.revision,
			dirty: source.dirty,
			entries: items,
			skipped: { jobs: 0, gates: 0 },
		});

		const captures: CompareCapture[] = [];
		const pageCaptures: ComparePageCapture[] = [];
		for (const entry of selected) {
			const saved = manifest.captures[entry.id];
			if (!saved || saved.status === 'unavailable') {
				const reason =
					saved?.reason && saved.reason.trim().length > 0
						? saved.reason
						: `Variant ${entry.id} could not be captured.`;
				captures.push({
					id: entry.id,
					status: 'unavailable',
					axe: 'not-run',
					violations: [],
					screenshot: null,
					reason,
				});
				pageCaptures.push({
					id: entry.id,
					title: entry.title,
					status: 'unavailable',
					axe: 'not-run',
					violations: [],
					incompleteChecks: [],
					screenshot: null,
					reason,
				});
				continue;
			}
			const axeStatus = saved.axe?.status ?? 'not-run';
			const violations = saved.axe?.violations ?? [];
			const incompleteChecks = saved.axe?.incompleteChecks ?? [];
			const screenshot = saved.screenshot
				? `.specimen/sets/${manifest.set}/${saved.screenshot}`
				: null;
			captures.push({
				id: entry.id,
				status: 'captured',
				axe: axeStatus,
				violations,
				screenshot,
			});
			pageCaptures.push({
				id: entry.id,
				title: entry.title,
				status: 'captured',
				axe: axeStatus,
				violations,
				incompleteChecks,
				screenshot: saved.screenshot,
			});
		}

		const pageData: ComparePageData = {
			version: 1,
			set: manifest.set,
			context,
			checkpoint: checkpoint.name,
			revision: source.revision,
			dirty: source.dirty,
			captures: pageCaptures,
			differences: pageDifferences,
		};
		const setDir = join(captureSetsDir(host.root), manifest.set);
		const compareDataPath = join(setDir, COMPARE_DATA_FILE);
		const comparePagePath = join(specimenDataDir(host.root), COMPARE_PAGE_FILE);
		await assertRealContained(
			host.root,
			compareDataPath,
			`Compare data path escapes root: ${manifest.set}`
		);
		await assertRealContained(
			host.root,
			comparePagePath,
			`Compare page path escapes root: ${COMPARE_PAGE_FILE}`
		);
		await writeFileAtomic(compareDataPath, `${JSON.stringify(pageData, null, 2)}\n`);
		await writeFileAtomic(comparePagePath, renderComparePageHtml());

		return {
			set: manifest.set,
			context,
			checkpoint: checkpoint.name,
			captures,
			differences,
			page: `${COMPARE_PAGE_FILE}?set=${manifest.set}`,
		};
	} finally {
		await rm(stagingDir, { recursive: true, force: true });
	}
}

/** Read `.specimen/sets/<setId>/compare.json` by set id or local label. */
export async function readComparePageData(root: string, ref: string): Promise<ComparePageData> {
	const setId = await resolveCaptureSetId(root, ref);
	const setDir = join(captureSetsDir(root), setId);
	const dataPath = join(setDir, COMPARE_DATA_FILE);
	await assertRealFileContained(
		setDir,
		dataPath,
		`Compare data path escapes capture set: ${setId}`
	);
	const parsed: unknown = JSON.parse(await readFile(dataPath, 'utf8'));
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new Error(`Invalid compare data for ${setId}: expected an object.`);
	}
	return parsed as ComparePageData;
}
