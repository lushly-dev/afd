import { createHash, randomUUID } from 'node:crypto';
import {
	copyFile,
	lstat,
	mkdir,
	open,
	readFile,
	realpath,
	rename,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { RANDOM_SEED } from './baseline.js';
import { resolveContext } from './config.js';
import { canonicalJson, diffObservations } from './diff.js';
import type { SpecimenHostError } from './host.js';
import { normalizeDom } from './normalize.js';
import { normalizeElements } from './normalize-ids.js';
import { DEFAULT_SUITE_WORKERS, pool, selectEntries } from './suite.js';
import {
	CAPTURE_VERSION,
	type CaptureCheckpoint,
	type CaptureEntryKind,
	type CaptureRef,
	type CaptureSetEntry,
	type CaptureSetEntryAxe,
	type CaptureSetManifest,
	type CaptureSetRequest,
	type CaptureSetRun,
	type DiffRequest,
	NORMALIZATION_VERSION,
	type Observation,
	type ObservationDiff,
	type SpecimenContext,
	type SpecimenEntry,
	type SpecimenTheme,
} from './types.js';

/** Local gitignored directory holding capture sets and pointer labels. */
export const SPECIMEN_DATA_DIR = '.specimen';
export const CAPTURE_SETS_DIR = 'sets';
export const CAPTURE_LABELS_FILE = 'labels.json';
export const SET_ID_PATTERN = /^set-[0-9a-f]{12}$/;
export const LABEL_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/;

const LOCK_TIMEOUT_MS = 10_000;
const LOCK_STALE_MS = 30_000;
const RENAME_RETRIES = 6;

function compareCodeUnits(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex');
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

function isContained(base: string, target: string): boolean {
	const rel = relative(base, target);
	return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export async function assertRealContained(
	baseDir: string,
	targetPath: string,
	message: string
): Promise<void> {
	const absBase = resolve(baseDir);
	const absTarget = resolve(targetPath);
	if (!isContained(absBase, absTarget)) throw new Error(message);
	const realBase = await realpath(absBase);
	const segments = relative(absBase, absTarget).split(sep).filter(Boolean);
	let current = absBase;
	for (const segment of segments) {
		current = join(current, segment);
		try {
			const entry = await lstat(current);
			if (entry.isSymbolicLink()) {
				const resolved = await realpath(current).catch(() => null);
				if (resolved === null || !isContained(realBase, resolved)) throw new Error(message);
			} else {
				const resolved = await realpath(current);
				if (!isContained(realBase, resolved)) throw new Error(message);
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
			throw error;
		}
	}
}

export async function assertRealFileContained(
	baseDir: string,
	targetPath: string,
	message: string
): Promise<void> {
	const absBase = resolve(baseDir);
	const absTarget = resolve(targetPath);
	if (!isContained(absBase, absTarget)) throw new Error(message);
	const [realBase, realTarget] = await Promise.all([realpath(absBase), realpath(absTarget)]);
	if (!isContained(realBase, realTarget)) throw new Error(message);
}

/** Validate a local label name so it never traverses paths, mimics a set id, or carries control characters. */
export function isValidLabel(label: string): boolean {
	if (!LABEL_PATTERN.test(label) || SET_ID_PATTERN.test(label)) return false;
	return !label.split('/').some((segment) => segment === '' || segment === '.' || segment === '..');
}

function assertValidCaptureKey(key: string): void {
	if (!key || key.includes('\0') || key.startsWith('/') || key.includes('\\'))
		throw new Error(`Invalid capture key: ${key}`);
	if (key.split('/').some((segment) => segment === '' || segment === '.' || segment === '..'))
		throw new Error(`Invalid capture key: ${key}`);
}

/** Case-insensitive-safe, single-segment filename stem for a capture key. */
export function captureStorageStem(key: string): string {
	assertValidCaptureKey(key);
	const slug =
		key
			.toLowerCase()
			.replace(/[^a-z0-9._-]+/g, '_')
			.replace(/^_+|_+$/g, '')
			.slice(0, 64) || 'capture';
	return `${slug}--${sha256(key).slice(0, 12)}`;
}

function levenshtein(a: string, b: string): number {
	const rows = a.length + 1;
	const cols = b.length + 1;
	const prev = new Array<number>(cols);
	const curr = new Array<number>(cols);
	for (let j = 0; j < cols; j++) prev[j] = j;
	for (let i = 1; i < rows; i++) {
		curr[0] = i;
		const ca = a.charCodeAt(i - 1);
		for (let j = 1; j < cols; j++) {
			const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
			curr[j] = Math.min(
				(prev[j] as number) + 1,
				(curr[j - 1] as number) + 1,
				(prev[j - 1] as number) + cost
			);
		}
		for (let j = 0; j < cols; j++) prev[j] = curr[j] as number;
	}
	return prev[cols - 1] as number;
}

/** Suggest the closest known specimen ids for a misspelled or missing id. */
export function nearestSpecimenIds(missing: string, known: readonly string[], limit = 3): string[] {
	const needle = missing.toLowerCase();
	return [...new Set(known)]
		.map((candidate) => {
			const lower = candidate.toLowerCase();
			const distance = levenshtein(needle, lower);
			const prefixBoost = lower.startsWith(needle) || needle.startsWith(lower) ? -2 : 0;
			const containsBoost = lower.includes(needle) || needle.includes(lower) ? -1 : 0;
			return { candidate, score: distance + prefixBoost + containsBoost, distance };
		})
		.sort(
			(a, b) =>
				a.score - b.score || a.distance - b.distance || compareCodeUnits(a.candidate, b.candidate)
		)
		.slice(0, limit)
		.map((item) => item.candidate);
}

/**
 * Compute a capture's content hash: SHA-256 over every normalized input that affects
 * `specimen-diff` or `specimen-review` outcomes, excluding volatile fields (timestamps,
 * elapsed times, ready deadlines, screenshot bytes/paths, revision and dirty state).
 */
export function captureContentHash(observation: Observation): string {
	const dom = normalizeDom(observation.channels.dom.raw);
	const a11ySnapshot = observation.channels.a11y.snapshot;
	const rawAxe = observation.channels.a11y.axe;
	const axe =
		rawAxe === 'not-run'
			? 'not-run'
			: {
					status: rawAxe.status,
					violations: rawAxe.violations
						.map((v) => [v.id, v.impact, [...v.targets].sort(compareCodeUnits)] as const)
						.sort((a, b) => compareCodeUnits(canonicalJson(a), canonicalJson(b))),
					incompleteChecks: rawAxe.incompleteChecks
						.map((c) => [c.id, [...c.targets].sort(compareCodeUnits)] as const)
						.sort((a, b) => compareCodeUnits(canonicalJson(a), canonicalJson(b))),
				};
	const eventsStatus = observation.completeness.events.status;
	const events =
		eventsStatus === 'not-requested' || eventsStatus === 'unsupported'
			? null
			: observation.channels.events.history.map((event) => ({
					type: event.type,
					target: event.target ?? null,
					step: event.step ?? null,
				}));
	const elements = normalizeElements(observation.channels.elements)
		.map((element) => ({
			ref: element.ref,
			tag: element.tag,
			attributes: element.attributes,
			box: element.box,
			scroll: element.scroll,
			styles: element.styles,
			state: element.state,
			...(element.accessibility ? { accessibility: element.accessibility } : {}),
		}))
		.sort((a, b) => compareCodeUnits(a.ref, b.ref));
	const completeness = {
		dom: observation.completeness.dom,
		a11y: observation.completeness.a11y,
		layout: observation.completeness.layout,
		styles: observation.completeness.styles,
		tokens: observation.completeness.tokens,
		events: observation.completeness.events,
		visual: observation.completeness.visual,
	};
	const fonts = [...observation.manifest.context.resources.fonts]
		.map((font) => ({
			family: font.family,
			weight: font.weight,
			style: font.style,
			status: font.status,
		}))
		.sort((a, b) => compareCodeUnits(canonicalJson(a), canonicalJson(b)));
	return sha256(
		canonicalJson({
			dom,
			a11ySnapshot,
			axe,
			events,
			elements,
			completeness,
			fonts,
		})
	);
}

/** Content-addressed set id (`set-` + 12 hex digits) over conditions and sorted capture hashes. */
export function computeSetId(input: {
	kind?: CaptureSetManifest['kind'];
	order?: readonly string[];
	context: SpecimenContext;
	checkpoint: CaptureSetManifest['checkpoint'];
	browser: { name: string; version: string } | null;
	captureVersion: string;
	normalizationVersion: string;
	axe: boolean;
	captures: readonly {
		key: string;
		status: 'captured' | 'unavailable';
		hash: string | null;
		reason?: string;
		checkpoint?: string;
	}[];
}): string {
	const context: SpecimenContext = {
		viewport: input.context.viewport,
		...(input.context.container ? { container: input.context.container } : {}),
		theme: input.context.theme,
		locale: input.context.locale,
		reducedMotion: input.context.reducedMotion,
		motion: input.context.motion,
		...(input.context.themeMedia ? { themeMedia: input.context.themeMedia } : {}),
	};
	const captures = [...input.captures]
		.sort((a, b) => compareCodeUnits(a.key, b.key))
		.map((entry) => ({
			key: entry.key,
			status: entry.status,
			hash: entry.hash,
			...(entry.reason !== undefined ? { reason: entry.reason } : {}),
			...(entry.checkpoint !== undefined ? { checkpoint: entry.checkpoint } : {}),
		}));
	const payload = {
		...(input.kind === 'compare' ? { kind: input.kind } : {}),
		...(input.order !== undefined ? { order: [...input.order] } : {}),
		context,
		checkpoint: {
			name: input.checkpoint.name,
			actionMode: input.checkpoint.actionMode,
			baseline: input.checkpoint.baseline,
		},
		browser: input.browser ? { name: input.browser.name, version: input.browser.version } : null,
		captureVersion: input.captureVersion,
		normalizationVersion: input.normalizationVersion,
		axe: input.axe,
		captures,
	};
	return `set-${sha256(canonicalJson(payload)).slice(0, 12)}`;
}

/** Classify a specimen entry for capture selection and default skipping. */
export function entryKind(entry: SpecimenEntry): CaptureEntryKind {
	const tagged = entry as SpecimenEntry & { kind?: string; job?: unknown; gate?: unknown };
	const rawKind: string | undefined = tagged.kind;
	if (rawKind === 'job' || tagged.job !== undefined) return 'job';
	if (rawKind === 'gate' || tagged.gate !== undefined) return 'gate';
	if (entry.story !== undefined) return 'story';
	return 'component';
}

/** Check whether an entry declares a theme limit excluding `theme`. */
export function themeAvailabilityReason(entry: SpecimenEntry, theme: SpecimenTheme): string | null {
	if (entry.themes && !entry.themes.supported.includes(theme)) {
		const supported = entry.themes.supported.join(', ');
		const suffix = entry.themes.reason ? ` (${entry.themes.reason})` : '';
		return `Supports ${supported} theme${entry.themes.supported.length === 1 ? '' : 's'} only${suffix}; requested ${theme}.`;
	}
	if (entry.contexts?.themes && !entry.contexts.themes.includes(theme)) {
		const supported = entry.contexts.themes.join(', ');
		return `Supports ${supported} theme${entry.contexts.themes.length === 1 ? '' : 's'} only (${entry.contexts.reason}); requested ${theme}.`;
	}
	return null;
}

/** Select entries for `specimen-capture`, validating explicit ids and skipping gates (and jobs when no job runner is configured) by default. */
export function selectCaptureEntries(
	entries: readonly SpecimenEntry[],
	request: CaptureSetRequest,
	root: string,
	options: { includeJobs?: boolean; localLibrary?: string } = {}
): { selected: SpecimenEntry[]; skipped: CaptureSetRun['skipped'] } {
	if (request.ids !== undefined) {
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
		const seen = new Set<string>();
		const selected: SpecimenEntry[] = [];
		for (const id of request.ids) {
			if (seen.has(id)) continue;
			seen.add(id);
			selected.push(byId.get(id) as SpecimenEntry);
		}
		return { selected, skipped: { jobs: 0, gates: 0 } };
	}
	const { kind: kinds, ...suiteFilter } = request.filter ?? {};
	const hasSuiteFilter = Object.keys(suiteFilter).length > 0;
	const matched = hasSuiteFilter
		? selectEntries(entries, suiteFilter, root, options.localLibrary)
		: [...entries];
	const kindSet = kinds ? new Set(kinds) : null;
	const selected: SpecimenEntry[] = [];
	let skippedJobs = 0;
	let skippedGates = 0;
	for (const entry of matched) {
		const kind = entryKind(entry);
		if (kindSet) {
			if (!kindSet.has(kind)) continue;
			selected.push(entry);
			continue;
		}
		if (kind === 'job') {
			if (options.includeJobs) {
				selected.push(entry);
			} else {
				skippedJobs++;
			}
			continue;
		}
		if (kind === 'gate') {
			skippedGates++;
			continue;
		}
		selected.push(entry);
	}
	const skipped: CaptureSetRun['skipped'] = {
		jobs: skippedJobs,
		gates: skippedGates,
		...(skippedJobs > 0
			? {
					next: 'specimen-job-run' as const,
					reason:
						'Job specimens were skipped because no job runner plugin is configured; configure jobSources and plugins or run them with specimen-job-run.',
				}
			: {}),
		...(skippedGates > 0 ? { gatesNext: 'specimen-run' as const } : {}),
	};
	return { selected, skipped };
}

/** Extract compact axe metadata for a capture set manifest. */
export function summarizeCaptureAxe(
	axe: Observation['channels']['a11y']['axe']
): CaptureSetEntryAxe | null {
	if (axe === 'not-run') return null;
	return {
		status: axe.status,
		violations: [...new Set(axe.violations.map((v) => v.id))].sort(compareCodeUnits),
		incomplete: axe.incomplete,
		incompleteChecks: axe.incompleteChecks.map((check) => ({
			id: check.id,
			help: check.help,
			targets: [...check.targets],
		})),
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function renameWithRetry(source: string, destination: string): Promise<void> {
	for (let attempt = 0; ; attempt++) {
		try {
			await rename(source, destination);
			return;
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (attempt < RENAME_RETRIES && (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY')) {
				await sleep(10 + attempt * 15);
				continue;
			}
			throw error;
		}
	}
}

export async function withFileLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
	await mkdir(dirname(lockPath), { recursive: true });
	const deadline = Date.now() + LOCK_TIMEOUT_MS;
	let acquired = false;
	while (Date.now() <= deadline) {
		try {
			const handle = await open(lockPath, 'wx');
			try {
				await handle.writeFile(`${process.pid}:${Date.now()}\n`, 'utf8');
			} finally {
				await handle.close();
			}
			acquired = true;
			break;
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === 'ENOENT') {
				await mkdir(dirname(lockPath), { recursive: true });
				continue;
			}
			if (code !== 'EEXIST') throw error;
			try {
				const info = await stat(lockPath);
				if (Date.now() - info.mtimeMs > LOCK_STALE_MS) {
					await rm(lockPath, { force: true });
					continue;
				}
			} catch (statError) {
				if ((statError as NodeJS.ErrnoException).code === 'ENOENT') continue;
			}
			await sleep(10 + Math.floor(Math.random() * 20));
		}
	}
	if (!acquired) throw new Error(`Timed out waiting for capture set lock: ${lockPath}`);
	try {
		return await fn();
	} finally {
		await rm(lockPath, { force: true });
	}
}

export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
	await mkdir(dirname(filePath), { recursive: true });
	const tmpPath = `${filePath}.${randomUUID()}.tmp`;
	try {
		await writeFile(tmpPath, content, { encoding: 'utf8', flag: 'wx' });
		await renameWithRetry(tmpPath, filePath);
	} finally {
		await rm(tmpPath, { force: true });
	}
}

async function moveFile(source: string, destination: string): Promise<void> {
	await mkdir(dirname(destination), { recursive: true });
	const tmpPath = `${destination}.${randomUUID()}.tmp`;
	try {
		try {
			await renameWithRetry(source, tmpPath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
			await copyFile(source, tmpPath);
			await rm(source, { force: true });
		}
		await renameWithRetry(tmpPath, destination);
	} finally {
		await rm(tmpPath, { force: true });
	}
}

export function specimenDataDir(root: string): string {
	return join(resolve(root), SPECIMEN_DATA_DIR);
}

export function captureSetsDir(root: string): string {
	return join(specimenDataDir(root), CAPTURE_SETS_DIR);
}

export function captureLabelsPath(root: string): string {
	return join(specimenDataDir(root), CAPTURE_LABELS_FILE);
}

async function readLabels(root: string): Promise<Record<string, string>> {
	const path = captureLabelsPath(root);
	await assertRealContained(root, path, `Capture labels path escapes root: ${path}`);
	const result: Record<string, string> = Object.create(null);
	try {
		const raw = await readFile(path, 'utf8');
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return result;
		for (const [key, value] of Object.entries(parsed)) {
			if (isValidLabel(key) && typeof value === 'string' && SET_ID_PATTERN.test(value)) {
				result[key] = value;
			}
		}
		return result;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return result;
		throw error;
	}
}

/** Update a local pointer label in `.specimen/labels.json` to reference `setId`. */
export async function updateCaptureSetLabel(
	root: string,
	label: string,
	setId: string
): Promise<void> {
	if (!isValidLabel(label)) throw new Error(`Invalid capture set label: ${label}`);
	if (!SET_ID_PATTERN.test(setId)) throw new Error(`Invalid capture set id: ${setId}`);
	const labelsPath = captureLabelsPath(root);
	const lockPath = join(specimenDataDir(root), '.labels.lock');
	await assertRealContained(root, labelsPath, `Capture labels path escapes root: ${labelsPath}`);
	await assertRealContained(root, lockPath, `Capture labels lock escapes root: ${lockPath}`);
	await withFileLock(lockPath, async () => {
		const labels = await readLabels(root);
		labels[label] = setId;
		const sorted = Object.fromEntries(
			Object.entries(labels).sort(([a], [b]) => compareCodeUnits(a, b))
		);
		await assertRealContained(root, labelsPath, `Capture labels path escapes root: ${labelsPath}`);
		await writeFileAtomic(labelsPath, `${JSON.stringify(sorted, null, 2)}\n`);
	});
}

export interface WriteCaptureSetItem {
	key: string;
	id: string;
	status: 'captured' | 'unavailable';
	observation?: Observation;
	screenshotSource?: string | null;
	reason?: string;
	checkpoint?: string;
	step?: number;
	job?: string;
}

export interface WriteCaptureSetOptions {
	kind: CaptureSetManifest['kind'];
	order?: readonly string[];
	context: SpecimenContext;
	checkpoint: CaptureSetManifest['checkpoint'];
	browser: { name: string; version: string } | null;
	axe: boolean;
	revision: string | null;
	dirty: boolean | null;
	label?: string;
	entries: readonly WriteCaptureSetItem[];
	skipped: CaptureSetRun['skipped'];
}

/** Persist a capture set under `.specimen/sets/<setId>/`, update its label, and return compact counts. */
export async function writeCaptureSet(
	root: string,
	options: WriteCaptureSetOptions
): Promise<{ manifest: CaptureSetManifest; run: CaptureSetRun }> {
	const createdUtc = new Date().toISOString();
	const hashedItems = options.entries.map((item) => {
		assertValidCaptureKey(item.key);
		if (item.status === 'captured') {
			if (!item.observation)
				throw new Error(`Captured entry ${item.key} is missing its observation.`);
			return {
				item,
				hash: captureContentHash(item.observation),
			};
		}
		return { item, hash: null as string | null };
	});
	const setId = computeSetId({
		kind: options.kind,
		...(options.order !== undefined ? { order: options.order } : {}),
		context: options.context,
		checkpoint: options.checkpoint,
		browser: options.browser,
		captureVersion: CAPTURE_VERSION,
		normalizationVersion: NORMALIZATION_VERSION,
		axe: options.axe,
		captures: hashedItems.map(({ item, hash }) => ({
			key: item.key,
			status: item.status,
			hash,
			...(item.reason !== undefined ? { reason: item.reason } : {}),
			...(item.checkpoint !== undefined ? { checkpoint: item.checkpoint } : {}),
		})),
	});
	const setsRoot = captureSetsDir(root);
	const setDir = join(setsRoot, setId);
	await assertRealContained(root, setDir, `Capture set path escapes root: ${setId}`);
	const capturesDir = join(setDir, 'captures');
	const screenshotsDir = join(setDir, 'screenshots');
	const manifestPath = join(setDir, 'manifest.json');
	const manifestLockPath = join(setDir, '.manifest.lock');
	await assertRealContained(root, capturesDir, `Capture set directory escapes root: ${setId}`);
	await assertRealContained(root, screenshotsDir, `Screenshot directory escapes root: ${setId}`);
	await assertRealContained(root, manifestPath, `Manifest path escapes root: ${setId}`);
	await assertRealContained(root, manifestLockPath, `Manifest lock escapes root: ${setId}`);

	const sorted = [...hashedItems].sort((a, b) => compareCodeUnits(a.item.key, b.item.key));

	const { manifest, run } = await withFileLock(manifestLockPath, async () => {
		await assertRealContained(root, capturesDir, `Capture set directory escapes root: ${setId}`);
		await mkdir(capturesDir, { recursive: true });

		let existingManifest: Partial<CaptureSetManifest> | undefined;
		try {
			await assertRealContained(root, manifestPath, `Manifest path escapes root: ${setId}`);
			const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
			if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
				existingManifest = parsed as Partial<CaptureSetManifest>;
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		}

		const existingCaptures =
			existingManifest?.captures &&
			typeof existingManifest.captures === 'object' &&
			!Array.isArray(existingManifest.captures)
				? existingManifest.captures
				: null;

		const captures: Record<string, CaptureSetEntry> = {};
		const unavailable: { id: string; reason: string }[] = [];
		let capturedCount = 0;
		let axePassed = 0;
		let axeFailed = 0;
		let axeIncomplete = 0;

		for (const { item, hash } of sorted) {
			if (item.status === 'unavailable') {
				const reason = item.reason ?? 'Specimen could not be captured.';
				unavailable.push({ id: item.id, reason });
				captures[item.key] = {
					key: item.key,
					id: item.id,
					status: 'unavailable',
					hash: null,
					reason,
					...(item.checkpoint !== undefined ? { checkpoint: item.checkpoint } : {}),
					...(item.step !== undefined ? { step: item.step } : {}),
					...(item.job !== undefined ? { job: item.job } : {}),
					axe: null,
					observation: null,
					screenshot: null,
				};
				continue;
			}
			capturedCount++;
			const stem = captureStorageStem(item.key);
			const obsRel = `captures/${stem}.json`;
			const obsAbs = join(setDir, obsRel);
			await assertRealContained(setDir, obsAbs, `Observation path escapes capture set: ${obsRel}`);

			const rawExistingScreenshot =
				existingCaptures && Object.hasOwn(existingCaptures, item.key)
					? (existingCaptures[item.key]?.screenshot ?? null)
					: null;
			let screenshotRel: string | null = null;
			let screenshotAbs: string | null = null;
			if (typeof rawExistingScreenshot === 'string' && rawExistingScreenshot.length > 0) {
				const candidateAbs = resolve(setDir, rawExistingScreenshot);
				if (isContained(setDir, candidateAbs)) {
					try {
						await assertRealContained(
							setDir,
							candidateAbs,
							`Screenshot path escapes capture set: ${rawExistingScreenshot}`
						);
						screenshotRel = rawExistingScreenshot;
						screenshotAbs = candidateAbs;
					} catch {
						// Ignore tampered or escaping screenshot pointers from prior manifests.
					}
				}
			}
			if (item.screenshotSource) {
				screenshotRel = `screenshots/${stem}.png`;
				screenshotAbs = join(screenshotsDir, `${stem}.png`);
				await assertRealContained(
					setDir,
					screenshotAbs,
					`Screenshot path escapes capture set: ${screenshotRel}`
				);
				await moveFile(item.screenshotSource, screenshotAbs);
			}
			const rawObs = item.observation as Observation;
			const savedObs: Observation = {
				...rawObs,
				manifest: {
					...rawObs.manifest,
					set: setId,
				},
				...(screenshotAbs
					? {
							channels: {
								...rawObs.channels,
								visual: { path: screenshotAbs },
							},
						}
					: {}),
			};
			await writeFileAtomic(obsAbs, `${JSON.stringify(savedObs, null, 2)}\n`);
			const axeSummary = summarizeCaptureAxe(rawObs.channels.a11y.axe);
			if (axeSummary) {
				if (axeSummary.status === 'passed') axePassed++;
				else if (axeSummary.status === 'failed') axeFailed++;
				if (axeSummary.incomplete > 0 || axeSummary.incompleteChecks.length > 0) axeIncomplete++;
			}
			captures[item.key] = {
				key: item.key,
				id: item.id,
				status: 'captured',
				hash,
				...(item.checkpoint !== undefined ? { checkpoint: item.checkpoint } : {}),
				...(item.step !== undefined ? { step: item.step } : {}),
				...(item.job !== undefined ? { job: item.job } : {}),
				axe: axeSummary,
				observation: obsRel,
				screenshot: screenshotRel,
			};
		}

		const existingRevisions: CaptureSetManifest['revisions'] = Array.isArray(
			existingManifest?.revisions
		)
			? existingManifest.revisions
			: [];
		const last = existingRevisions.at(-1);
		const revisions =
			last && last.revision === options.revision && last.dirty === options.dirty
				? existingRevisions
				: [
						...existingRevisions,
						{ revision: options.revision, dirty: options.dirty, capturedUtc: createdUtc },
					];

		const builtManifest: CaptureSetManifest = {
			version: 1,
			set: setId,
			kind: options.kind,
			createdUtc:
				typeof existingManifest?.createdUtc === 'string' && existingManifest.createdUtc.length > 0
					? existingManifest.createdUtc
					: createdUtc,
			context: options.context,
			checkpoint: options.checkpoint,
			browser: options.browser,
			captureVersion: CAPTURE_VERSION,
			normalizationVersion: NORMALIZATION_VERSION,
			axe: options.axe,
			revision: options.revision,
			dirty: options.dirty,
			revisions,
			captures,
		};
		await writeFileAtomic(manifestPath, `${JSON.stringify(builtManifest, null, 2)}\n`);

		const builtRun: CaptureSetRun = {
			set: setId,
			label: options.label ?? null,
			revision: options.revision,
			dirty: options.dirty,
			counts: {
				captured: capturedCount,
				unavailable: unavailable.length,
				axe: {
					passed: axePassed,
					failed: axeFailed,
					incomplete: axeIncomplete,
				},
			},
			unavailable,
			skipped: options.skipped,
		};
		return { manifest: builtManifest, run: builtRun };
	});

	if (options.label !== undefined) {
		await updateCaptureSetLabel(root, options.label, setId);
	}

	return { manifest, run };
}

function captureSetNotFoundError(ref: string): SpecimenHostError {
	const suggestion = SET_ID_PATTERN.test(ref)
		? 'Run specimen-capture first to create a capture set; labels are local pointers, not git refs.'
		: `Run specimen-capture with label "${ref}" first; labels are local pointers, not git refs.`;
	return typedError('CAPTURE_SET_NOT_FOUND', `Capture set not found: ${ref}`, suggestion, {
		set: ref,
	});
}

/** Resolve a capture set id or local label to its `set-<12hex>` directory id. */
export async function resolveCaptureSetId(root: string, ref: string): Promise<string> {
	const setsRoot = captureSetsDir(root);
	if (SET_ID_PATTERN.test(ref)) {
		const manifestPath = join(setsRoot, ref, 'manifest.json');
		try {
			await assertRealFileContained(
				root,
				manifestPath,
				`Capture set manifest path escapes root: ${ref}`
			);
			await readFile(manifestPath, 'utf8');
			return ref;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		}
	}
	const labels = await readLabels(root);
	const mapped = Object.hasOwn(labels, ref) ? labels[ref] : undefined;
	if (mapped && SET_ID_PATTERN.test(mapped)) {
		const manifestPath = join(setsRoot, mapped, 'manifest.json');
		try {
			await assertRealFileContained(
				root,
				manifestPath,
				`Capture set manifest path escapes root: ${mapped}`
			);
			await readFile(manifestPath, 'utf8');
			return mapped;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		}
	}
	throw captureSetNotFoundError(ref);
}

/** Read a saved capture set's manifest by set id or local label. */
export async function readCaptureSetManifest(
	root: string,
	ref: string
): Promise<CaptureSetManifest> {
	const setId = await resolveCaptureSetId(root, ref);
	const setsRoot = captureSetsDir(root);
	const setDir = join(setsRoot, setId);
	const manifestPath = join(setDir, 'manifest.json');
	await assertRealFileContained(
		root,
		manifestPath,
		`Capture set manifest path escapes root: ${setId}`
	);
	const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new Error(`Invalid capture set manifest for ${setId}: expected an object.`);
	}
	const manifest = parsed as CaptureSetManifest;
	if (manifest.set !== setId) {
		throw new Error(
			`Invalid capture set manifest for ${setId}: manifest.set (${String(manifest.set)}) does not match directory id.`
		);
	}
	if (
		typeof manifest.captures !== 'object' ||
		manifest.captures === null ||
		Array.isArray(manifest.captures)
	) {
		throw new Error(`Invalid capture set manifest for ${setId}: captures must be an object.`);
	}
	return manifest;
}

/** Read one saved `Observation` using an already-loaded capture set manifest. */
export async function readSetCaptureFromManifest(
	root: string,
	setId: string,
	manifest: CaptureSetManifest,
	id: string
): Promise<Observation> {
	const entry = Object.hasOwn(manifest.captures, id) ? manifest.captures[id] : undefined;
	if (!entry) {
		const nearest = nearestSpecimenIds(id, Object.keys(manifest.captures));
		const hint = nearest.length
			? `Capture "${id}" is not in set ${setId}. Did you mean ${nearest.join(', ')}?`
			: `Capture "${id}" is not in set ${setId}; recapture with specimen-capture.`;
		throw typedError('SPECIMEN_NOT_FOUND', `Capture not found in set ${setId}: ${id}`, hint, {
			set: setId,
			id,
			nearest,
		});
	}
	if (entry.status !== 'captured' || !entry.observation) {
		throw typedError(
			'SPECIMEN_NOT_FOUND',
			`Capture "${id}" is unavailable in set ${setId}: ${entry.reason ?? 'no observation recorded'}`,
			'Fix the specimen or capture it in a supported context with specimen-capture.',
			{ set: setId, id, reason: entry.reason ?? null }
		);
	}
	const setDir = join(captureSetsDir(root), setId);
	const obsPath = resolve(setDir, entry.observation);
	await assertRealFileContained(
		setDir,
		obsPath,
		`Observation path escapes capture set directory: ${entry.observation}`
	);
	return JSON.parse(await readFile(obsPath, 'utf8')) as Observation;
}

/** Read one saved `Observation` from a capture set by `{ set, id }`. */
export async function readSetCapture(root: string, ref: CaptureRef): Promise<Observation> {
	const setId = await resolveCaptureSetId(root, ref.set);
	const manifest = await readCaptureSetManifest(root, setId);
	return readSetCaptureFromManifest(root, setId, manifest, ref.id);
}

/** Distinguish a `{ set, id }` capture reference from a raw `Observation`. */
export function isCaptureRef(value: unknown): value is CaptureRef {
	return (
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		typeof (value as CaptureRef).set === 'string' &&
		typeof (value as CaptureRef).id === 'string' &&
		!('manifest' in value)
	);
}

/** Compare two observations or `{ set, id }` set references against `<root>/.specimen/sets/`. */
export async function diffCaptures(root: string, request: DiffRequest): Promise<ObservationDiff> {
	const [left, right] = await Promise.all([
		isCaptureRef(request.left) ? readSetCapture(root, request.left) : Promise.resolve(request.left),
		isCaptureRef(request.right)
			? readSetCapture(root, request.right)
			: Promise.resolve(request.right),
	]);
	return diffObservations(left, right, {
		allowContextDifferences: request.allowContextDifferences,
		requireVisual: request.requireVisual,
	});
}

export interface CaptureSetHost {
	root: string;
	entries: readonly SpecimenEntry[];
	workers: number;
	prepare(): Promise<void>;
	sourceState(): Promise<{ revision: string | null; dirty: boolean | null }>;
	render(options: {
		entry: SpecimenEntry;
		context: SpecimenContext;
		checkpoint: string;
		axe: boolean;
		screenshot: string;
		timeoutMs?: number;
	}): Promise<Observation>;
	/** Optional job execution hook; when provided, `specimen-capture` runs job specimens through the runner into `<id>/<step>` captures. */
	runJob?: (options: {
		entry: SpecimenEntry;
		context: SpecimenContext;
		axe: boolean;
		stagingDir: string;
		timeoutMs?: number;
	}) => Promise<WriteCaptureSetItem[]>;
	localLibrary?: string;
}

/** Orchestrate `specimen-capture`: select entries, check theme support, capture with axe and screenshots, persist set. */
export async function runCaptureSet(
	host: CaptureSetHost,
	request: CaptureSetRequest = {}
): Promise<CaptureSetRun> {
	const { selected, skipped } = selectCaptureEntries(host.entries, request, host.root, {
		includeJobs: host.runJob !== undefined,
		localLibrary: host.localLibrary,
	});
	if (selected.length === 0 && skipped.jobs === 0 && skipped.gates === 0 && request.filter) {
		throw new Error('No specimen matches the filter.');
	}
	const context = resolveContext(request.context);
	const checkpointName = request.checkpoint ?? 'mount';
	const axe = request.axe ?? true;
	const workers = request.workers ?? host.workers ?? DEFAULT_SUITE_WORKERS;
	const stagingDir = join(specimenDataDir(host.root), 'tmp', randomUUID());

	const sourcePromise = host.sourceState();
	const itemBuckets: WriteCaptureSetItem[][] = new Array<WriteCaptureSetItem[]>(selected.length);
	const renderIndices: number[] = [];

	for (let i = 0; i < selected.length; i++) {
		const entry = selected[i] as SpecimenEntry;
		const reason = themeAvailabilityReason(entry, context.theme);
		if (reason !== null) {
			itemBuckets[i] = [
				{
					key: entry.id,
					id: entry.id,
					status: 'unavailable',
					reason,
					...(entryKind(entry) === 'job' ? { job: entry.id } : {}),
				},
			];
		} else if (entryKind(entry) === 'job' && !host.runJob) {
			itemBuckets[i] = [
				{
					key: entry.id,
					id: entry.id,
					status: 'unavailable',
					reason:
						'No job runner plugin is configured (RUNNER_MISSING); configure jobSources and plugins in specimen.config.json.',
					job: entry.id,
				},
			];
		} else {
			renderIndices.push(i);
		}
	}

	try {
		if (renderIndices.length > 0) {
			await assertRealContained(
				host.root,
				stagingDir,
				`Staging directory escapes root: ${stagingDir}`
			);
			await mkdir(stagingDir, { recursive: true });
			await host.prepare();
			await pool(renderIndices, workers, async (index) => {
				const entry = selected[index] as SpecimenEntry;
				if (entryKind(entry) === 'job' && host.runJob) {
					const jobStaging = join(stagingDir, captureStorageStem(entry.id));
					try {
						await mkdir(jobStaging, { recursive: true });
						const jobItems = await host.runJob({
							entry,
							context,
							axe,
							stagingDir: jobStaging,
							...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
						});
						itemBuckets[index] =
							jobItems.length > 0
								? jobItems
								: [
										{
											key: entry.id,
											id: entry.id,
											status: 'unavailable',
											reason: `Job specimen '${entry.id}' produced no captures.`,
											job: entry.id,
										},
									];
					} catch (error) {
						itemBuckets[index] = [
							{
								key: entry.id,
								id: entry.id,
								status: 'unavailable',
								reason: error instanceof Error ? error.message : String(error),
								job: entry.id,
							},
						];
					}
					return;
				}
				const screenshotPath = join(stagingDir, `${captureStorageStem(entry.id)}.png`);
				try {
					const renderedObservation = await host.render({
						entry,
						context,
						checkpoint: checkpointName,
						axe,
						screenshot: screenshotPath,
						...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
					});
					const observation: Observation =
						!axe && renderedObservation.channels.a11y.axe !== 'not-run'
							? {
									...renderedObservation,
									channels: {
										...renderedObservation.channels,
										a11y: {
											...renderedObservation.channels.a11y,
											axe: 'not-run',
										},
									},
									completeness: {
										...renderedObservation.completeness,
										a11y: {
											status: 'partial',
											scope: 'ARIA snapshot; axe not run',
											reasons: ['AXE_NOT_RUN'],
										},
									},
								}
							: renderedObservation;
					if (observation.manifest.context.theme !== context.theme) {
						await rm(screenshotPath, { force: true });
						itemBuckets[index] = [
							{
								key: entry.id,
								id: entry.id,
								status: 'unavailable',
								reason: `Rendered in ${observation.manifest.context.theme} theme only; requested ${context.theme}.`,
							},
						];
						return;
					}
					itemBuckets[index] = [
						{
							key: entry.id,
							id: entry.id,
							status: 'captured',
							observation,
							...(observation.manifest.checkpoint.name !== checkpointName
								? { checkpoint: observation.manifest.checkpoint.name }
								: {}),
							screenshotSource: observation.channels.visual.path ? screenshotPath : null,
						},
					];
				} catch (error) {
					await rm(screenshotPath, { force: true });
					itemBuckets[index] = [
						{
							key: entry.id,
							id: entry.id,
							status: 'unavailable',
							reason: error instanceof Error ? error.message : String(error),
						},
					];
				}
			});
		}

		const items = itemBuckets.flat();
		const source = await sourcePromise;
		const sortedForManifest = [...items].sort((a, b) => compareCodeUnits(a.key, b.key));
		const firstObs =
			sortedForManifest.find((item) => item.job === undefined && item.observation !== undefined)
				?.observation ??
			sortedForManifest.find((item) => item.observation !== undefined)?.observation;
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

		const { run } = await writeCaptureSet(host.root, {
			kind: 'capture',
			context,
			checkpoint,
			browser,
			axe,
			revision: source.revision,
			dirty: source.dirty,
			...(request.label !== undefined ? { label: request.label } : {}),
			entries: items,
			skipped,
		});
		return run;
	} finally {
		await rm(stagingDir, { recursive: true, force: true });
	}
}
