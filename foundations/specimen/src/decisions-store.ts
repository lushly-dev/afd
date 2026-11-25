import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import {
	copyFile,
	lstat,
	mkdir,
	readdir,
	readFile,
	realpath,
	rename,
	rm,
	stat,
} from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { COMPARE_DATA_FILE } from './compare.js';
import type { SpecimenHostError } from './host.js';
import { CROCKFORD_BASE32 } from './point.js';
import {
	assertRealContained,
	assertRealFileContained,
	captureSetsDir,
	captureStorageStem,
	readCaptureSetManifest,
	SET_ID_PATTERN,
	writeFileAtomic,
} from './sets.js';
import type {
	AnswerDecisionRecord,
	CaptureSetEntry,
	CaptureSetManifest,
	ChoiceDecisionRecord,
	ComparePageData,
	DecisionEvidenceCapture,
	DecisionEvidenceManifest,
	DecisionRecord,
	DecisionRecordSingleResult,
	DecisionSubjects,
} from './types.js';
import { compileSubjectGlob } from './validate.js';

export const SPECIMENS_DIR = 'specimens';
export const DECISIONS_DIR = join(SPECIMENS_DIR, 'decisions');
export const EVIDENCE_DIR = join(SPECIMENS_DIR, 'evidence');
export const DECISION_ID_LENGTH = 12;
export const DECISION_ID_PATTERN = /^dec-[0-9a-hjkmnp-tv-z]{12}$/;

const SAFE_EVIDENCE_FILENAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const IGNORED_WALK_DIRS = new Set(['.git', 'node_modules', '.specimen']);

export function compareCodeUnits(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

export function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

export function typedError(
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

export function decisionNotFoundError(id: string): SpecimenHostError {
	return typedError(
		'DECISION_NOT_FOUND',
		`Decision not found: ${id}`,
		'Use decision-list to see current decision ids.',
		{ decision: id }
	);
}

/** Generate a random lowercase Crockford base-32 decision id (`dec-<12>`). */
export function generateDecisionId(bytes: Uint8Array = randomBytes(DECISION_ID_LENGTH)): string {
	let suffix = '';
	for (let index = 0; index < DECISION_ID_LENGTH; index++) {
		suffix += CROCKFORD_BASE32[(bytes[index] ?? 0) & 31];
	}
	return `dec-${suffix}`;
}

export function decisionsDir(root: string): string {
	return join(resolve(root), DECISIONS_DIR);
}

export function decisionFilePath(root: string, id: string): string {
	return join(decisionsDir(root), `${id}.json`);
}

export function decisionRelativePath(id: string): string {
	return `${SPECIMENS_DIR}/decisions/${id}.json`;
}

export function evidenceRootDir(root: string): string {
	return join(resolve(root), EVIDENCE_DIR);
}

export function evidenceSetDir(root: string, setId: string): string {
	return join(evidenceRootDir(root), setId);
}

export function evidenceRelativeDir(setId: string): string {
	return `${SPECIMENS_DIR}/evidence/${setId}/`;
}

function normalizePosixPath(value: string): string {
	let normalized = value.replaceAll('\\', '/');
	while (normalized.startsWith('./')) normalized = normalized.slice(2);
	return normalized;
}

export function normalizeFileForMatching(root: string, file: string): string {
	if (isAbsolute(file)) {
		const rel = relative(resolve(root), resolve(file));
		if (rel && !rel.startsWith('..') && !isAbsolute(rel)) {
			return normalizePosixPath(rel);
		}
	}
	return normalizePosixPath(file);
}

function safeCompileGlob(pattern: string): RegExp | null {
	try {
		return compileSubjectGlob(pattern);
	} catch {
		return null;
	}
}

/** Match a repo-relative file path against a POSIX subject glob (supports `*`, `**`, `?`, `[]`, `{}`). */
export function matchesSubjectGlob(filePath: string, pattern: string): boolean {
	const normalizedFile = normalizePosixPath(filePath);
	const matcher = safeCompileGlob(pattern);
	if (!matcher) return false;
	return matcher.test(normalizedFile);
}

function globStaticPrefix(pattern: string): string {
	const normalized = normalizePosixPath(pattern);
	const segments = normalized.split('/');
	const prefix: string[] = [];
	for (const segment of segments) {
		if (/[*?[\]{}]/.test(segment)) break;
		prefix.push(segment);
	}
	return prefix.join('/');
}

export async function globMatchesAnyFile(root: string, pattern: string): Promise<boolean> {
	const normalizedPattern = normalizePosixPath(pattern);
	if (
		!normalizedPattern ||
		normalizedPattern.startsWith('/') ||
		normalizedPattern.split('/').includes('..')
	) {
		return false;
	}
	const matcher = safeCompileGlob(normalizedPattern);
	if (!matcher) return false;
	const absRoot = resolve(root);
	let realRoot: string;
	try {
		realRoot = await realpath(absRoot);
	} catch {
		return false;
	}

	const prefix = globStaticPrefix(normalizedPattern);
	let startDir = absRoot;
	let startRel = '';
	if (prefix) {
		const candidate = resolve(absRoot, prefix);
		try {
			await assertRealContained(absRoot, candidate, `Glob escapes root: ${pattern}`);
			const info = await stat(candidate);
			if (info.isFile()) {
				return matcher.test(prefix);
			}
			if (info.isDirectory()) {
				startDir = candidate;
				startRel = prefix;
			} else {
				return false;
			}
		} catch {
			return false;
		}
	}

	const explicitlyTargetsIgnored = (name: string) =>
		normalizedPattern === name ||
		normalizedPattern.startsWith(`${name}/`) ||
		normalizedPattern.includes(`/${name}/`);

	let startRealDir: string;
	try {
		startRealDir = await realpath(startDir);
	} catch {
		return false;
	}
	const visited = new Set<string>([startRealDir]);
	const stack: { dir: string; rel: string }[] = [{ dir: startDir, rel: startRel }];
	while (stack.length > 0) {
		const current = stack.pop() as { dir: string; rel: string };
		let entries: Dirent[];
		try {
			entries = await readdir(current.dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const childRel = current.rel ? `${current.rel}/${entry.name}` : entry.name;
			const childAbs = join(current.dir, entry.name);
			if (entry.isDirectory()) {
				if (IGNORED_WALK_DIRS.has(entry.name) && !explicitlyTargetsIgnored(entry.name)) {
					continue;
				}
				try {
					const realChild = await realpath(childAbs);
					if (visited.has(realChild)) continue;
					visited.add(realChild);
					stack.push({ dir: childAbs, rel: childRel });
				} catch {
					// Skip unreadable directories.
				}
			} else if (entry.isFile()) {
				if (matcher.test(childRel)) return true;
			} else if (entry.isSymbolicLink()) {
				try {
					const resolvedTarget = await realpath(childAbs);
					const relFromRealRoot = relative(realRoot, resolvedTarget);
					if (
						relFromRealRoot === '..' ||
						relFromRealRoot.startsWith(`..${sep}`) ||
						isAbsolute(relFromRealRoot)
					) {
						continue;
					}
					const targetStat = await stat(resolvedTarget);
					if (targetStat.isFile() && matcher.test(childRel)) return true;
					if (targetStat.isDirectory()) {
						if (IGNORED_WALK_DIRS.has(entry.name) && !explicitlyTargetsIgnored(entry.name)) {
							continue;
						}
						if (visited.has(resolvedTarget)) continue;
						visited.add(resolvedTarget);
						stack.push({ dir: childAbs, rel: childRel });
					}
				} catch {
					// Ignore broken symlinks.
				}
			}
		}
	}
	return false;
}

export function dedupeStrings(values: readonly string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		if (!seen.has(value)) {
			seen.add(value);
			result.push(value);
		}
	}
	return result;
}

export function cleanSubjects(subjects: DecisionSubjects | undefined): DecisionSubjects {
	if (!subjects) return {};
	return {
		...(subjects.specimens !== undefined ? { specimens: dedupeStrings(subjects.specimens) } : {}),
		...(subjects.files !== undefined ? { files: dedupeStrings(subjects.files) } : {}),
		...(subjects.tokens !== undefined ? { tokens: dedupeStrings(subjects.tokens) } : {}),
	};
}

export function swapChosenSubject(
	oldSubjects: DecisionSubjects,
	oldChosen: string,
	newChosen: string
): DecisionSubjects {
	const base = cleanSubjects(oldSubjects);
	if (oldChosen === newChosen) return base;
	const existing = base.specimens ?? [oldChosen];
	let swapped = false;
	const nextSpecimens: string[] = [];
	for (const specimen of existing) {
		const candidate = specimen === oldChosen ? newChosen : specimen;
		if (specimen === oldChosen) swapped = true;
		if (!nextSpecimens.includes(candidate)) nextSpecimens.push(candidate);
	}
	if (!swapped && !nextSpecimens.includes(newChosen)) {
		nextSpecimens.unshift(newChosen);
	}
	return {
		...base,
		specimens: nextSpecimens,
	};
}

export async function readCompareVariantOrder(
	root: string,
	setId: string
): Promise<string[] | null> {
	const setDir = join(captureSetsDir(root), setId);
	const comparePath = join(setDir, COMPARE_DATA_FILE);
	try {
		await assertRealFileContained(root, comparePath, `Compare data escapes root: ${setId}`);
		await assertRealFileContained(setDir, comparePath, `Compare data escapes set: ${setId}`);
		const parsed = JSON.parse(await readFile(comparePath, 'utf8')) as Partial<ComparePageData>;
		if (Array.isArray(parsed.captures)) {
			const ids = parsed.captures
				.map((item) => (typeof item?.id === 'string' ? item.id : null))
				.filter((id): id is string => id !== null && id.length > 0);
			if (ids.length > 0) return ids;
		}
	} catch {
		// Fall back to manifest capture order.
	}
	return null;
}

function evidenceScreenshotFilename(
	key: string,
	lowercaseCounts: ReadonlyMap<string, number>
): string {
	const lower = key.toLowerCase();
	if (
		SAFE_EVIDENCE_FILENAME.test(key) &&
		key !== '.' &&
		key !== '..' &&
		(lowercaseCounts.get(lower) ?? 0) === 1
	) {
		return `${key}.png`;
	}
	return `${captureStorageStem(key)}.png`;
}

async function copyFileAtomic(source: string, destination: string): Promise<void> {
	const tmpPath = `${destination}.${randomUUID()}.tmp`;
	try {
		await copyFile(source, tmpPath);
		await rename(tmpPath, destination);
	} finally {
		await rm(tmpPath, { force: true });
	}
}

async function isCommittedEvidenceComplete(
	root: string,
	existing: DecisionEvidenceManifest
): Promise<boolean> {
	const targetDir = evidenceSetDir(root, existing.set);
	for (const capture of existing.captures) {
		if (!capture.screenshot) continue;
		const expectedPrefix = evidenceRelativeDir(existing.set);
		if (!capture.screenshot.startsWith(expectedPrefix)) return false;
		const absScreenshot = resolve(root, capture.screenshot);
		try {
			await assertRealFileContained(
				targetDir,
				absScreenshot,
				`Committed evidence screenshot escapes directory: ${capture.screenshot}`
			);
		} catch {
			return false;
		}
	}
	return true;
}

/**
 * Copy a capture set's screenshots and write a compact evidence manifest under
 * `specimens/evidence/<setId>/` (never running `git commit`; full observations remain in `.specimen/`).
 * Reuses an already-complete committed evidence snapshot for `manifest.set` so recording another
 * decision against the same set id never mutates prior committed evidence.
 */
export async function writeDecisionEvidence(
	root: string,
	manifest: CaptureSetManifest,
	orderedKeys?: readonly string[]
): Promise<{ ref: { set: string; dir: string }; manifest: DecisionEvidenceManifest }> {
	const setId = manifest.set;
	if (!SET_ID_PATTERN.test(setId)) {
		throw new Error(`Invalid capture set id for decision evidence: ${setId}`);
	}

	const existing = await readDecisionEvidenceManifest(root, setId);
	if (existing && (await isCommittedEvidenceComplete(root, existing))) {
		return {
			ref: { set: setId, dir: evidenceRelativeDir(setId) },
			manifest: existing,
		};
	}

	const targetDir = evidenceSetDir(root, setId);
	await assertRealContained(root, targetDir, `Evidence directory escapes root: ${setId}`);
	const sourceSetDir = join(captureSetsDir(root), setId);
	await assertRealContained(root, sourceSetDir, `Source capture set escapes root: ${setId}`);

	const manifestKeys = Object.keys(manifest.captures);
	const keys = orderedKeys
		? [
				...orderedKeys.filter((k) => Object.hasOwn(manifest.captures, k)),
				...manifestKeys.filter((k) => !orderedKeys.includes(k)),
			]
		: manifestKeys;

	const lowercaseCounts = new Map<string, number>();
	for (const key of keys) {
		const lower = key.toLowerCase();
		lowercaseCounts.set(lower, (lowercaseCounts.get(lower) ?? 0) + 1);
	}

	// Validate all declared source screenshots before mutating specimens/evidence/<setId>/.
	const plannedCopies: { srcAbs: string; fileName: string; key: string }[] = [];
	const captures: DecisionEvidenceCapture[] = [];
	for (const key of keys) {
		const entry = manifest.captures[key] as CaptureSetEntry;
		let screenshotRel: string | null = null;
		if (entry.screenshot) {
			const srcAbs = resolve(sourceSetDir, entry.screenshot);
			await assertRealFileContained(
				root,
				srcAbs,
				`Source screenshot escapes root: ${entry.screenshot}`
			);
			await assertRealFileContained(
				sourceSetDir,
				srcAbs,
				`Source screenshot escapes capture set: ${entry.screenshot}`
			);
			const fileName = evidenceScreenshotFilename(key, lowercaseCounts);
			plannedCopies.push({ srcAbs, fileName, key });
			screenshotRel = `${evidenceRelativeDir(setId)}${fileName}`;
		}
		captures.push({
			key: entry.key,
			id: entry.id,
			status: entry.status,
			hash: entry.hash,
			...(entry.checkpoint !== undefined ? { checkpoint: entry.checkpoint } : {}),
			axe: entry.axe?.status ?? 'not-run',
			...(entry.axe && entry.axe.violations.length > 0
				? { violations: [...entry.axe.violations] }
				: {}),
			screenshot: screenshotRel,
			...(entry.reason !== undefined ? { reason: entry.reason } : {}),
		});
	}

	await mkdir(targetDir, { recursive: true });
	for (const copy of plannedCopies) {
		const destAbs = join(targetDir, copy.fileName);
		await assertRealContained(
			targetDir,
			destAbs,
			`Evidence screenshot escapes evidence directory: ${copy.fileName}`
		);
		await copyFileAtomic(copy.srcAbs, destAbs);
	}

	const evidenceManifest: DecisionEvidenceManifest = {
		version: 1,
		set: setId,
		kind: manifest.kind,
		context: manifest.context,
		checkpoint: manifest.checkpoint.name,
		revision: manifest.revision,
		dirty: manifest.dirty,
		captures,
	};
	const manifestPath = join(targetDir, 'manifest.json');
	await assertRealContained(
		targetDir,
		manifestPath,
		`Evidence manifest escapes directory: ${setId}`
	);
	await writeFileAtomic(manifestPath, `${JSON.stringify(evidenceManifest, null, 2)}\n`);

	return {
		ref: { set: setId, dir: evidenceRelativeDir(setId) },
		manifest: evidenceManifest,
	};
}

/** Read a committed evidence manifest from `specimens/evidence/<setId>/manifest.json`. */
export async function readDecisionEvidenceManifest(
	root: string,
	setId: string
): Promise<DecisionEvidenceManifest | null> {
	if (!SET_ID_PATTERN.test(setId)) return null;
	const targetDir = evidenceSetDir(root, setId);
	const manifestPath = join(targetDir, 'manifest.json');
	try {
		await assertRealFileContained(root, manifestPath, `Evidence manifest escapes root: ${setId}`);
		const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
		if (
			typeof parsed === 'object' &&
			parsed !== null &&
			!Array.isArray(parsed) &&
			(parsed as DecisionEvidenceManifest).set === setId &&
			Array.isArray((parsed as DecisionEvidenceManifest).captures)
		) {
			return parsed as DecisionEvidenceManifest;
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw error;
	}
	return null;
}

/** Read a single decision JSON file from `specimens/decisions/<id>.json`. */
export async function readDecisionRecord(root: string, id: string): Promise<DecisionRecord> {
	if (!DECISION_ID_PATTERN.test(id)) {
		throw decisionNotFoundError(id);
	}
	const filePath = decisionFilePath(root, id);
	try {
		await assertRealFileContained(root, filePath, `Decision path escapes root: ${id}`);
		const parsed: unknown = JSON.parse(await readFile(filePath, 'utf8'));
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
			throw new Error(`Invalid decision record ${id}: expected a JSON object.`);
		}
		const record = parsed as DecisionRecord;
		if (record.id !== id) {
			throw new Error(
				`Invalid decision record ${id}: file id (${String(record.id)}) does not match filename.`
			);
		}
		return record;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			throw decisionNotFoundError(id);
		}
		throw error;
	}
}

/** Read all valid decision files in `specimens/decisions/`, sorted by `id` ascending. */
export async function readAllDecisions(root: string): Promise<DecisionRecord[]> {
	const dir = decisionsDir(root);
	try {
		await assertRealContained(root, dir, `Decisions directory escapes root: ${DECISIONS_DIR}`);
		const dirStat = await lstat(dir);
		if (!dirStat.isDirectory()) return [];
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw error;
	}
	const entries = await readdir(dir, { withFileTypes: true });
	const ids = entries
		.filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith('.json'))
		.map((entry) => entry.name.slice(0, -'.json'.length))
		.filter((id) => DECISION_ID_PATTERN.test(id))
		.sort(compareCodeUnits);

	const records: DecisionRecord[] = [];
	for (const id of ids) {
		records.push(await readDecisionRecord(root, id));
	}
	return records;
}

/**
 * Derive every superseded choice id from both `status: 'superseded'` and `supersedes` back-links,
 * so readers never observe contradictory current choices even after an interrupted write.
 */
export function supersededIdsFromRecords(records: readonly DecisionRecord[]): Set<string> {
	const superseded = new Set<string>();
	for (const record of records) {
		if (record.kind === 'choice') {
			if (record.status === 'superseded') superseded.add(record.id);
			if (record.supersedes) superseded.add(record.supersedes);
		}
	}
	return superseded;
}

export function currentChoicesFromRecords(
	records: readonly DecisionRecord[]
): ChoiceDecisionRecord[] {
	const superseded = supersededIdsFromRecords(records);
	return records
		.filter(
			(record): record is ChoiceDecisionRecord =>
				record.kind === 'choice' && !superseded.has(record.id)
		)
		.sort((a, b) => compareCodeUnits(a.id, b.id));
}

export async function allocateDecisionId(
	root: string,
	reserved: ReadonlySet<string>
): Promise<string> {
	const dir = decisionsDir(root);
	for (let attempt = 0; attempt < 16; attempt++) {
		const candidate = generateDecisionId();
		if (reserved.has(candidate)) continue;
		const candidatePath = join(dir, `${candidate}.json`);
		try {
			await lstat(candidatePath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return candidate;
			}
			throw error;
		}
	}
	throw new Error('Could not allocate a unique decision id after 16 attempts.');
}

export async function writeDecisionFile(root: string, record: DecisionRecord): Promise<string> {
	const dir = decisionsDir(root);
	await assertRealContained(root, dir, `Decisions directory escapes root: ${DECISIONS_DIR}`);
	const filePath = decisionFilePath(root, record.id);
	await assertRealContained(root, filePath, `Decision path escapes root: ${record.id}`);
	await writeFileAtomic(filePath, `${JSON.stringify(record, null, 2)}\n`);
	return decisionRelativePath(record.id);
}

export function formatSingleChoiceResult(
	record: ChoiceDecisionRecord,
	path: string
): DecisionRecordSingleResult {
	return {
		decision: record.id,
		kind: 'choice',
		path,
		chosen: record.chosen,
		kept: record.kept,
		...(record.supersedes !== undefined ? { supersedes: record.supersedes } : {}),
		...(record.answers !== undefined ? { answers: record.answers } : {}),
		evidence: record.evidence,
		evidenceDir: record.evidence.dir,
		subjects: record.subjects,
	};
}

export function formatSingleAnswerResult(
	record: AnswerDecisionRecord,
	path: string
): DecisionRecordSingleResult {
	return {
		decision: record.id,
		kind: 'answer',
		path,
		chosen: record.chosen,
		answers: record.answers,
	};
}

/**
 * Publish one or more successor choices safely: write all successor files first (rolling back
 * created files on failure so a partial multi-choice replacement never persists), then mark
 * every superseded predecessor as `status: 'superseded'`.
 */
export async function publishSupersession(
	root: string,
	planned: readonly { oldChoice: ChoiceDecisionRecord; nextChoice: ChoiceDecisionRecord }[]
): Promise<DecisionRecordSingleResult[]> {
	const writtenPaths: { id: string; relPath: string }[] = [];
	try {
		for (const { nextChoice } of planned) {
			const relPath = await writeDecisionFile(root, nextChoice);
			writtenPaths.push({ id: nextChoice.id, relPath });
		}
	} catch (error) {
		await Promise.all(
			writtenPaths.map(({ id }) => rm(decisionFilePath(root, id), { force: true }).catch(() => {}))
		);
		throw error;
	}
	for (const { oldChoice } of planned) {
		await writeDecisionFile(root, { ...oldChoice, status: 'superseded' });
	}
	return planned.map(({ nextChoice }, index) =>
		formatSingleChoiceResult(nextChoice, writtenPaths[index]?.relPath as string)
	);
}

export async function resolveEvidenceCapturesForGet(
	root: string,
	record: ChoiceDecisionRecord
): Promise<DecisionEvidenceCapture[]> {
	const evidenceManifest = await readDecisionEvidenceManifest(root, record.evidence.set);
	if (evidenceManifest) return evidenceManifest.captures;

	const setId = record.evidence.set;
	const evidenceDirAbs = evidenceSetDir(root, setId);
	const lowercaseCounts = new Map<string, number>();
	for (const variant of record.variants) {
		const lower = variant.toLowerCase();
		lowercaseCounts.set(lower, (lowercaseCounts.get(lower) ?? 0) + 1);
	}

	let localManifest: CaptureSetManifest | null = null;
	try {
		localManifest = await readCaptureSetManifest(root, setId);
	} catch (error) {
		if ((error as SpecimenHostError).code !== 'CAPTURE_SET_NOT_FOUND') throw error;
	}

	const captures: DecisionEvidenceCapture[] = [];
	for (const variant of record.variants) {
		const fileName = evidenceScreenshotFilename(variant, lowercaseCounts);
		const candidateAbs = join(evidenceDirAbs, fileName);
		let screenshot: string | null = null;
		try {
			await assertRealFileContained(root, candidateAbs, `Evidence screenshot escapes root`);
			screenshot = `${evidenceRelativeDir(setId)}${fileName}`;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		}
		const localEntry = localManifest?.captures[variant];
		captures.push({
			key: variant,
			id: variant,
			status: localEntry?.status ?? 'captured',
			hash: localEntry?.hash ?? null,
			...(localEntry?.checkpoint !== undefined ? { checkpoint: localEntry.checkpoint } : {}),
			axe: localEntry?.axe?.status ?? 'not-run',
			...(localEntry?.axe && localEntry.axe.violations.length > 0
				? { violations: [...localEntry.axe.violations] }
				: {}),
			screenshot,
		});
	}
	return captures;
}
