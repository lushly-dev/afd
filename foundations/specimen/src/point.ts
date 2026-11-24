import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { type ClimbNode, climbSelection, nodeAccessible, observationClimbTree } from './climb.js';
import { defaultContext, type LoadedConfig } from './config.js';
import type { SpecimenHostError } from './host.js';
import { DEFAULT_PIN, PointerError, type PointerPin } from './pointer.js';
import type {
	ElementObservation,
	Observation,
	Point,
	PointCheckResult,
	PointContextInput,
	PointMoveDirection,
	PointNodeSummary,
	SpecimenContext,
	SpecimenEntry,
} from './types.js';
import { parseContext } from './validate.js';

/** Lowercase Crockford base-32 alphabet (excludes i, l, o, u; Proposal §4.0). */
export const CROCKFORD_BASE32 = '0123456789abcdefghjkmnpqrstvwxyz';
export const POINT_ID_LENGTH = 12;
export const POINT_ID_PATTERN = /^pt-[0-9a-hjkmnp-tv-z]{12}$/;
const POINT_ID_READ_PATTERN = /^pt-[0-9a-z]{12}$/;

export const MAX_POINT_TEXT_LENGTH = 200;
export const MAX_POINT_SIBLINGS = 8;
export const MAX_POINT_CHILDREN = 12;
export const POINT_SOURCE_DIGEST_LENGTH = 16;
export const POINTS_DIR = join('.specimen', 'points');

const CHECK_GUIDANCE: Point['check'] = {
	command: 'specimen-point-check',
	when: 'before editing source for this point',
};

const KNOWN_CONTEXT_KEYS = new Set([
	'viewport',
	'container',
	'theme',
	'locale',
	'reducedMotion',
	'motion',
	'themeMedia',
]);

/** Create a structured Specimen error carrying AFD `code`, `suggestion`, and optional `details`. */
export function pointError(
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

/** Generate a collision-free random point id (`pt-` + 12 lowercase Crockford base-32 chars). */
export function generatePointId(bytes: Uint8Array = randomBytes(POINT_ID_LENGTH)): string {
	let suffix = '';
	for (let index = 0; index < POINT_ID_LENGTH; index++) {
		suffix += CROCKFORD_BASE32[(bytes[index] ?? 0) & 31];
	}
	return `pt-${suffix}`;
}

function editDistance(left: string, right: string): number {
	const rows = left.length + 1;
	const cols = right.length + 1;
	const prev = new Array<number>(cols);
	const curr = new Array<number>(cols);
	for (let col = 0; col < cols; col++) prev[col] = col;
	for (let row = 1; row < rows; row++) {
		curr[0] = row;
		for (let col = 1; col < cols; col++) {
			const cost = left[row - 1] === right[col - 1] ? 0 : 1;
			curr[col] = Math.min(
				(prev[col] ?? 0) + 1,
				(curr[col - 1] ?? 0) + 1,
				(prev[col - 1] ?? 0) + cost
			);
		}
		for (let col = 0; col < cols; col++) prev[col] = curr[col] ?? 0;
	}
	return prev[cols - 1] ?? 0;
}

/** Rank up to `limit` nearest specimen ids so `SPECIMEN_NOT_FOUND` avoids an unfiltered list. */
export function nearestSpecimenIds(
	unknownId: string,
	knownIds: readonly string[],
	limit = 5
): string[] {
	const needle = unknownId.toLowerCase();
	const scored = knownIds.map((candidate) => {
		const lower = candidate.toLowerCase();
		const distance = editDistance(needle, lower);
		const prefixBonus = lower.startsWith(needle) || needle.startsWith(lower) ? -3 : 0;
		const includesBonus = lower.includes(needle) || needle.includes(lower) ? -2 : 0;
		return { candidate, score: distance + prefixBonus + includesBonus, distance };
	});
	scored.sort(
		(a, b) =>
			a.score - b.score ||
			a.distance - b.distance ||
			a.candidate.localeCompare(b.candidate, 'en-US')
	);
	return scored.slice(0, limit).map((item) => item.candidate);
}

/** Throw `SPECIMEN_NOT_FOUND` naming the nearest specimen ids in its suggestion (Proposal §4.0). */
export function specimenNotFoundError(id: string, knownIds: readonly string[]): SpecimenHostError {
	const nearest = nearestSpecimenIds(id, knownIds);
	const suggestion = nearest.length
		? `Nearest specimen ids: ${nearest.join(', ')}. Retry with one of these ids.`
		: 'No specimens are configured in this project; check specimen.config.json.';
	return pointError('SPECIMEN_NOT_FOUND', `Specimen not found: ${id}`, suggestion, {
		id,
		nearest,
	});
}

function parseDimensionString(
	raw: string,
	heightOptional: boolean,
	field: string
): { width: number; height?: number } {
	const pattern = heightOptional ? /^([1-9]\d*)(?:x([1-9]\d*))?$/ : /^([1-9]\d*)x([1-9]\d*)$/;
	const match = pattern.exec(raw);
	if (!match) {
		throw new TypeError(
			`Invalid ${field}: expected ${heightOptional ? 'WIDTH or WIDTHxHEIGHT' : 'WIDTHxHEIGHT'}`
		);
	}
	const width = Number(match[1]);
	const height = match[2] === undefined ? undefined : Number(match[2]);
	if (!Number.isSafeInteger(width) || width < 1 || width > 8192) {
		throw new TypeError(`Invalid ${field}.width: expected an integer from 1 to 8192`);
	}
	if (height !== undefined && (!Number.isSafeInteger(height) || height < 1 || height > 8192)) {
		throw new TypeError(`Invalid ${field}.height: expected an integer from 1 to 8192`);
	}
	return height === undefined ? { width } : { width, height };
}

/** Convert string-or-object point context input into `Partial<SpecimenContext>` for rendering. */
export function normalizePointContextInput(
	input: PointContextInput | Record<string, string> | undefined,
	source: 'pointer' | 'request' = 'request'
): Partial<SpecimenContext> {
	if (!input) return {};
	const normalized: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(input)) {
		if (value === undefined) continue;
		if (!KNOWN_CONTEXT_KEYS.has(key)) {
			if (source === 'pointer') {
				throw new PointerError(`Unknown pointer context parameter: ${key}.`, { field: key });
			}
			throw new TypeError(`Invalid context: unrecognized key "${key}"`);
		}
		if (key === 'viewport' && typeof value === 'string') {
			try {
				normalized.viewport = parseDimensionString(value, false, 'context.viewport');
			} catch (error) {
				if (source === 'pointer') {
					throw new PointerError(
						error instanceof Error ? error.message : `Invalid viewport: ${value}`,
						{ field: 'viewport', value }
					);
				}
				throw error;
			}
			continue;
		}
		if (key === 'container' && typeof value === 'string') {
			try {
				normalized.container = parseDimensionString(value, true, 'context.container');
			} catch (error) {
				if (source === 'pointer') {
					throw new PointerError(
						error instanceof Error ? error.message : `Invalid container: ${value}`,
						{ field: 'container', value }
					);
				}
				throw error;
			}
			continue;
		}
		normalized[key] = value;
	}
	try {
		return parseContext(normalized, 'context', true);
	} catch (error) {
		if (source === 'pointer') {
			throw new PointerError(error instanceof Error ? error.message : 'Invalid pointer context.', {
				field: 'context',
			});
		}
		throw error;
	}
}

/** Format a resolved `SpecimenContext` into the flat string map stored on `Point.context`. */
export function formatPointContext(
	resolved: SpecimenContext,
	explicit?: Partial<SpecimenContext>
): Record<string, string> {
	const context: Record<string, string> = {
		theme: resolved.theme,
		viewport: `${resolved.viewport.width}x${resolved.viewport.height}`,
	};
	if (resolved.container) {
		context.container =
			resolved.container.height === undefined
				? String(resolved.container.width)
				: `${resolved.container.width}x${resolved.container.height}`;
	}
	if (resolved.locale !== defaultContext.locale || explicit?.locale !== undefined) {
		context.locale = resolved.locale;
	}
	if (
		resolved.reducedMotion !== defaultContext.reducedMotion ||
		explicit?.reducedMotion !== undefined
	) {
		context.reducedMotion = resolved.reducedMotion;
	}
	if (resolved.motion !== defaultContext.motion || explicit?.motion !== undefined) {
		context.motion = resolved.motion;
	}
	if (resolved.themeMedia !== undefined) {
		context.themeMedia = resolved.themeMedia;
	}
	return context;
}

function clampText(text: string, limit = MAX_POINT_TEXT_LENGTH): string {
	const chars = Array.from(text);
	return chars.length <= limit ? text : chars.slice(0, limit).join('');
}

function toPosixRelative(root: string, target: string): string | null {
	const rel = relative(root, target);
	if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
	return rel.replaceAll('\\', '/');
}

function normalizeDisplayPath(root: string, rawPath: string, baseDir = root): string {
	const resolved = isAbsolute(rawPath) ? rawPath : resolve(baseDir, rawPath);
	const rel = toPosixRelative(root, resolved);
	if (rel) return rel;
	return rawPath.replace(/^\.\//, '').replaceAll('\\', '/');
}

function summaryOf(node: ClimbNode<ElementObservation>): PointNodeSummary {
	const accessible = nodeAccessible(node);
	return {
		tag: node.tag,
		...(accessible?.role ? { role: accessible.role } : {}),
		...(accessible?.name ? { name: accessible.name } : {}),
	};
}

function ancestorSummaryOf(node: ClimbNode<ElementObservation>): PointNodeSummary {
	return {
		tag: node.tag,
		...(node.role ? { role: node.role } : {}),
		...(node.name ? { name: node.name } : {}),
	};
}

function treeChildrenOf(node: ClimbNode<ElementObservation>): ClimbNode<ElementObservation>[] {
	return [...node.shadowChildren(), ...node.children()];
}

function siblingGroupOf(
	tree: Map<string, ClimbNode<ElementObservation>>,
	node: ClimbNode<ElementObservation>
): ClimbNode<ElementObservation>[] {
	const parent = node.parent();
	if (!parent) {
		const topLevel: ClimbNode<ElementObservation>[] = [];
		for (const candidate of tree.values()) {
			if (candidate.parent() === null) topLevel.push(candidate);
		}
		return topLevel;
	}
	const shadowList = parent.shadowChildren();
	if (shadowList.some((child) => child.value.ref === node.value.ref)) {
		return [...shadowList];
	}
	return [...parent.children()];
}

function windowAround<T>(
	items: readonly T[],
	selfIndex: number,
	maxOther: number
): { kept: T[]; omitted: number } {
	const totalOther = Math.max(0, items.length - 1);
	if (totalOther <= maxOther) {
		return {
			kept: items.filter((_, index) => index !== selfIndex),
			omitted: 0,
		};
	}
	const beforeWanted = Math.floor(maxOther / 2);
	const afterWanted = maxOther - beforeWanted;
	let beforeCount = Math.min(selfIndex, beforeWanted);
	let afterCount = Math.min(items.length - 1 - selfIndex, afterWanted);
	const remaining = maxOther - (beforeCount + afterCount);
	if (remaining > 0) {
		const extraBefore = Math.min(selfIndex - beforeCount, remaining);
		beforeCount += extraBefore;
		afterCount += Math.min(items.length - 1 - selfIndex - afterCount, remaining - extraBefore);
	}
	const kept = [
		...items.slice(selfIndex - beforeCount, selfIndex),
		...items.slice(selfIndex + 1, selfIndex + 1 + afterCount),
	];
	return { kept, omitted: totalOther - kept.length };
}

function componentPositionOf(
	elements: readonly ElementObservation[],
	target: ElementObservation
): { tag: string; index: number } | undefined {
	if (!target.tag.includes('-')) return undefined;
	let index = 0;
	for (const element of elements) {
		if (element.ref === 'root') continue;
		if (element.tag === target.tag) {
			index++;
			if (element.ref === target.ref) return { tag: target.tag, index };
		}
	}
	return undefined;
}

function isRoleNameUnique(
	elements: readonly ElementObservation[],
	tree: Map<string, ClimbNode<ElementObservation>>,
	role: string,
	name: string
): boolean {
	const climbedRefs = new Set<string>();
	for (const element of elements) {
		if (element.ref === 'root') continue;
		if (element.accessibility?.role === role && element.accessibility?.name?.trim() === name) {
			const node = tree.get(element.ref);
			if (node) climbedRefs.add(climbSelection(node).selected.value.ref);
		}
	}
	return climbedRefs.size === 1;
}

/** Find the nearest custom-element tag on or above `node`, falling back to `entryComponent`. */
export function nearestComponentTag(
	node: ClimbNode<ElementObservation>,
	entryComponent?: string
): string | undefined {
	for (let cur: ClimbNode<ElementObservation> | null = node; cur; cur = cur.parent()) {
		if (cur.tag.includes('-')) return cur.tag;
	}
	return entryComponent;
}

export interface BuildPointInput {
	id: string;
	entry: SpecimenEntry;
	config: Pick<LoadedConfig, 'root' | 'file' | 'schemas' | 'manifestDirectory'> & {
		modules?: Record<string, string>;
	};
	observation: Observation;
	selected: ClimbNode<ElementObservation>;
	accessible?: { role?: string; name?: string; from?: ElementObservation };
	elementTexts?: Record<string, string>;
	slottedParents?: Readonly<Record<string, string>>;
	context: Record<string, string>;
	checkpoint?: string;
	pin?: PointerPin;
	sourceDigests: Record<string, string>;
}

/** Build the bounded `Point` wire object defined in Proposal §4.3. */
export function buildPoint(input: BuildPointInput): Point {
	const {
		id,
		entry,
		config,
		observation,
		selected,
		accessible,
		elementTexts,
		slottedParents,
		context,
		checkpoint,
		pin,
		sourceDigests,
	} = input;
	const elements = observation.channels.elements;
	const tree = observationClimbTree(elements, slottedParents);
	const selectedNode = tree.get(selected.value.ref) ?? selected;
	const obs = selectedNode.value;

	const rawText = elementTexts?.[obs.ref] ?? accessible?.name ?? '';
	const text = clampText(rawText, MAX_POINT_TEXT_LENGTH);

	const pointAccessible: Point['accessible'] = {
		...(accessible?.role ? { role: accessible.role } : {}),
		...(accessible?.name ? { name: accessible.name } : {}),
		...(accessible?.from ? { from: accessible.from.ref } : {}),
	};

	const roleName =
		pointAccessible.role && pointAccessible.name
			? { role: pointAccessible.role, name: pointAccessible.name }
			: undefined;
	const componentPosition = componentPositionOf(elements, obs);
	const strongest: Point['identity']['strongest'] =
		roleName && isRoleNameUnique(elements, tree, roleName.role, roleName.name)
			? 'role-name'
			: componentPosition
				? 'component-position'
				: 'ref';

	const componentTag = nearestComponentTag(selectedNode, entry.component);
	const schemaModule = componentTag ? config.schemas[componentTag]?.module : undefined;
	const componentModule = schemaModule
		? normalizeDisplayPath(config.root, schemaModule, config.manifestDirectory ?? config.root)
		: undefined;
	const component: Point['component'] = componentTag
		? {
				tag: componentTag,
				...(componentModule ? { module: componentModule } : {}),
			}
		: undefined;

	const resolvedSpecimenModule = config.modules?.[entry.id];
	const specimenModule = resolvedSpecimenModule
		? normalizeDisplayPath(config.root, resolvedSpecimenModule)
		: normalizeDisplayPath(config.root, entry.module, dirname(config.file));

	const ancestors: PointNodeSummary[] = [];
	for (let cur = selectedNode.parent(); cur; cur = cur.parent()) {
		ancestors.push(ancestorSummaryOf(cur));
	}

	const parentNode = selectedNode.parent();
	const siblingGroup = siblingGroupOf(tree, selectedNode);
	const selfIndex = siblingGroup.findIndex((item) => item.value.ref === obs.ref);
	const { kept: siblingNodes, omitted: omittedSiblings } =
		selfIndex >= 0
			? windowAround(siblingGroup, selfIndex, MAX_POINT_SIBLINGS)
			: { kept: [], omitted: 0 };

	const allChildren = treeChildrenOf(selectedNode);
	const keptChildren = allChildren.slice(0, MAX_POINT_CHILDREN);
	const omittedChildren = Math.max(0, allChildren.length - keptChildren.length);

	const resolvedPin = pin ? { x: pin.x, y: pin.y } : { ...DEFAULT_PIN };

	return {
		id,
		specimen: entry.id,
		...(checkpoint ? { checkpoint } : {}),
		context,
		element: {
			ref: obs.ref,
			tag: obs.tag,
			text,
			box: { ...obs.box },
		},
		accessible: pointAccessible,
		identity: {
			strongest,
			...(roleName ? { roleName } : {}),
			...(componentPosition ? { componentPosition } : {}),
			ref: obs.ref,
		},
		...(component ? { component } : {}),
		source: {
			specimen: { module: specimenModule, exportName: entry.exportName },
			...(componentModule ? { component: { module: componentModule } } : {}),
			...(observation.manifest.source.revision
				? { revision: observation.manifest.source.revision }
				: {}),
			digests: sourceDigests,
		},
		ancestors,
		neighbourhood: {
			pageData: true,
			...(parentNode ? { parent: summaryOf(parentNode) } : {}),
			siblings: siblingNodes.map(summaryOf),
			children: keptChildren.map(summaryOf),
			omitted: { siblings: omittedSiblings, children: omittedChildren },
		},
		pin: resolvedPin,
		check: { ...CHECK_GUIDANCE },
	};
}

/** Resolve `specimen-point-move` on a captured element tree, refusing invalid levels with `NO_SUCH_LEVEL`. */
export function resolvePointMove(
	elements: readonly ElementObservation[],
	currentRef: string,
	to: PointMoveDirection,
	index = 0,
	slottedParents?: Readonly<Record<string, string>>
): {
	target: ClimbNode<ElementObservation>;
	accessible?: { role?: string; name?: string; from: ElementObservation };
} {
	const tree = observationClimbTree(elements, slottedParents);
	const current = tree.get(currentRef);
	if (!current) {
		throw pointError(
			'POINT_STALE',
			`Point element ${currentRef} no longer exists in the rendered specimen.`,
			'Run specimen-point to point again.',
			{ ref: currentRef }
		);
	}

	const parent = current.parent();
	const children = treeChildrenOf(current);
	const siblings = siblingGroupOf(tree, current);
	const selfIndex = siblings.findIndex((item) => item.value.ref === current.value.ref);
	const previous = selfIndex > 0 ? siblings[selfIndex - 1] : undefined;
	const next =
		selfIndex >= 0 && selfIndex + 1 < siblings.length ? siblings[selfIndex + 1] : undefined;

	let componentAncestor: ClimbNode<ElementObservation> | undefined;
	for (let cur = parent; cur; cur = cur.parent()) {
		if (cur.tag.includes('-')) {
			componentAncestor = cur;
			break;
		}
	}

	const available: PointMoveDirection[] = [];
	if (parent) available.push('parent');
	if (children.length > 0) available.push('child');
	if (next) available.push('next');
	if (previous) available.push('previous');
	if (componentAncestor) available.push('component');

	let target: ClimbNode<ElementObservation> | undefined;
	if (to === 'parent') target = parent ?? undefined;
	else if (to === 'child') target = children[index];
	else if (to === 'next') target = next;
	else if (to === 'previous') target = previous;
	else if (to === 'component') target = componentAncestor;

	if (!target) {
		const movesHint = available.length
			? `Available moves from this element: ${available.join(', ')}.`
			: 'No moves are available from this element.';
		const indexHint =
			to === 'child' && children.length > 0
				? ` Valid child indices are 0..${children.length - 1}.`
				: '';
		throw pointError(
			'NO_SUCH_LEVEL',
			to === 'child' && children.length > 0
				? `Child index ${index} is out of range for ${current.tag} (${children.length} children).`
				: `No '${to}' level exists from ${current.tag} (${current.value.ref}).`,
			`${movesHint}${indexHint}`,
			{
				to,
				available,
				...(to === 'child' ? { index, childCount: children.length } : {}),
			}
		);
	}

	const acc = nodeAccessible(target);
	return {
		target,
		...(acc
			? {
					accessible: {
						...(acc.role ? { role: acc.role } : {}),
						...(acc.name ? { name: acc.name } : {}),
						from: acc.from.value,
					},
				}
			: {}),
	};
}

async function resolveCanonicalInside(realRoot: string, candidate: string): Promise<string | null> {
	try {
		const canonical = await realpath(candidate);
		return toPosixRelative(realRoot, canonical) ? canonical : null;
	} catch {
		return null;
	}
}

function normalizeHostPath(rawPath: string): string {
	if (rawPath.startsWith('\\\\?\\UNC\\')) return `\\\\${rawPath.slice(8)}`;
	if (rawPath.startsWith('\\\\?\\')) return rawPath.slice(4);
	return rawPath;
}

/**
 * Hash known repo-relative source files into sorted `{ [relPath]: sha256Prefix }`, verifying
 * canonical containment inside `root` so symlinks/junctions escaping `root` are never read.
 * `overrides` maps absolute paths to snapshot digests (used for loaded config/CEM files).
 */
export async function computeSourceDigests(
	root: string,
	candidatePaths: readonly string[],
	overrides?: Readonly<Record<string, string>>
): Promise<Record<string, string>> {
	const realRoot = await realpath(root);
	// Candidates may be spelt under the root as given or under its real path (macOS's /var is
	// /private/var); take the relative path against either, the given spelling first, since a
	// root linked inside its own real path would otherwise key a file by the link's path.
	// resolveCanonicalInside still checks containment against the real root before anything is read.
	const lexicalRoot = resolve(normalizeHostPath(root));
	const relativeToRoot = (absolute: string): string | null =>
		toPosixRelative(lexicalRoot, absolute) ?? toPosixRelative(realRoot, absolute);
	const overrideByRel = new Map<string, string>();
	if (overrides) {
		for (const [overridePath, value] of Object.entries(overrides)) {
			const normalized = normalizeHostPath(overridePath);
			const absolute = isAbsolute(normalized) ? resolve(normalized) : resolve(realRoot, normalized);
			const canonical = await resolveCanonicalInside(realRoot, absolute);
			const rel = canonical ? toPosixRelative(realRoot, canonical) : null;
			if (rel && !rel.startsWith('node_modules/') && !rel.includes('/node_modules/')) {
				overrideByRel.set(rel, value);
			}
		}
	}
	const seen = new Map<string, string>();
	for (const candidate of candidatePaths) {
		if (!candidate) continue;
		const normalized = normalizeHostPath(candidate);
		const absolute = isAbsolute(normalized) ? resolve(normalized) : resolve(realRoot, normalized);
		const rel = relativeToRoot(absolute);
		if (!rel || rel.startsWith('node_modules/') || rel.includes('/node_modules/')) continue;
		if (!seen.has(rel)) seen.set(rel, absolute);
	}
	const sorted = [...seen.entries()].sort(([a], [b]) => a.localeCompare(b, 'en-US'));
	const digests: Record<string, string> = {};
	await Promise.all(
		sorted.map(async ([rel, absolute]) => {
			const overridden = overrideByRel.get(rel);
			if (overridden !== undefined) {
				digests[rel] = overridden;
				return;
			}
			const canonical = await resolveCanonicalInside(realRoot, absolute);
			if (!canonical) return;
			const canonicalRel = toPosixRelative(realRoot, canonical);
			if (
				!canonicalRel ||
				canonicalRel.startsWith('node_modules/') ||
				canonicalRel.includes('/node_modules/')
			) {
				return;
			}
			const canonicalOverride = overrideByRel.get(canonicalRel);
			if (canonicalOverride !== undefined) {
				digests[rel] = canonicalOverride;
				return;
			}
			try {
				const bytes = await readFile(canonical);
				digests[rel] = createHash('sha256')
					.update(bytes)
					.digest('hex')
					.slice(0, POINT_SOURCE_DIGEST_LENGTH);
			} catch {
				// File does not exist on disk (e.g., virtual or unmaterialized CEM path).
			}
		})
	);
	return Object.fromEntries(
		Object.entries(digests).sort(([a], [b]) => a.localeCompare(b, 'en-US'))
	);
}

/** Re-hash every file recorded in `storedDigests` and return repo-relative paths that changed or vanished. */
export async function diffRecordedDigests(
	root: string,
	storedDigests: Record<string, string>
): Promise<string[]> {
	const realRoot = await realpath(root);
	const changed: string[] = [];
	const entries = Object.entries(storedDigests).sort(([a], [b]) => a.localeCompare(b, 'en-US'));
	for (const [relPath, recorded] of entries) {
		const absolute = resolve(realRoot, relPath);
		const safeRel = toPosixRelative(realRoot, absolute);
		if (!safeRel) {
			changed.push(relPath);
			continue;
		}
		const canonical = await resolveCanonicalInside(realRoot, absolute);
		if (!canonical) {
			changed.push(relPath);
			continue;
		}
		try {
			const fullHash = createHash('sha256')
				.update(await readFile(canonical))
				.digest('hex');
			if (!recorded || !fullHash.startsWith(recorded)) {
				changed.push(relPath);
			}
		} catch {
			changed.push(relPath);
		}
	}
	return changed;
}

/** Compare a stored point against fresh file digests and fresh rendered elements. */
export function evaluatePointStaleness(
	stored: Point,
	changedFiles: readonly string[],
	freshObservation: Observation | null,
	slottedParents?: Readonly<Record<string, string>>
): PointCheckResult {
	const changed = [...changedFiles];
	if (!freshObservation) {
		if (!changed.includes('specimen')) changed.push('specimen');
		return { status: 'stale', changed };
	}

	const elements = freshObservation.channels.elements;
	const tree = observationClimbTree(elements, slottedParents);
	const byRef = tree.get(stored.identity.ref);
	if (!byRef || byRef.tag !== stored.element.tag) {
		changed.push('identity.ref');
	}

	if (stored.identity.roleName) {
		const { role, name } = stored.identity.roleName;
		const freshAcc = byRef ? nodeAccessible(byRef) : null;
		const matchesOwnOrSole = Boolean(
			freshAcc &&
				freshAcc.role === role &&
				freshAcc.name === name &&
				(!stored.accessible?.from || freshAcc.from.value.ref === stored.accessible.from)
		);
		const fromNode =
			byRef && stored.accessible?.from ? tree.get(stored.accessible.from) : undefined;
		const matchesClimbedFrom = Boolean(
			byRef &&
				fromNode &&
				fromNode.role === role &&
				fromNode.name === name &&
				climbSelection(fromNode).selected.value.ref === byRef.value.ref
		);
		const uniqueClimbed = isRoleNameUnique(elements, tree, role, name);
		if (
			(!matchesOwnOrSole && !matchesClimbedFrom) ||
			(stored.identity.strongest === 'role-name' && !uniqueClimbed)
		) {
			changed.push('identity.role-name');
		}
	}

	if (stored.identity.componentPosition) {
		const { tag, index } = stored.identity.componentPosition;
		let count = 0;
		let matchedRef: string | undefined;
		for (const element of elements) {
			if (element.ref === 'root') continue;
			if (element.tag === tag) {
				count++;
				if (count === index) {
					matchedRef = element.ref;
					break;
				}
			}
		}
		if (matchedRef !== stored.element.ref) {
			changed.push('identity.component-position');
		}
	}

	const uniqueChanged = [...new Set(changed)];
	return {
		status: uniqueChanged.length === 0 ? 'current' : 'stale',
		changed: uniqueChanged,
	};
}

function pointNotFound(id: string, message = `Point not found: ${id}`): SpecimenHostError {
	return pointError('POINT_NOT_FOUND', message, 'Run specimen-point to create a point.', { id });
}

function pointFilePath(root: string, id: string): string {
	if (!POINT_ID_READ_PATTERN.test(id)) throw pointNotFound(id);
	const dir = resolve(root, POINTS_DIR);
	const file = resolve(dir, `${id}.json`);
	if (!toPosixRelative(dir, file)) throw pointNotFound(id);
	return file;
}

async function ensureContainedPointsDir(
	root: string
): Promise<{ realRoot: string; realDir: string }> {
	const realRoot = await realpath(root);
	let current = realRoot;
	for (const segment of ['.specimen', 'points']) {
		const next = join(current, segment);
		try {
			const stats = await lstat(next);
			if (stats.isSymbolicLink() || !stats.isDirectory()) {
				throw new Error(
					`Point storage path must be a real directory inside the project: ${segment}`
				);
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				await mkdir(next);
			} else {
				throw error;
			}
		}
		const canonical = await realpath(next);
		if (!toPosixRelative(realRoot, canonical)) {
			throw new Error(`Point storage path escapes the project root: ${segment}`);
		}
		current = canonical;
	}
	return { realRoot, realDir: current };
}

function isStringRecord(value: unknown): value is Record<string, string> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	return Object.values(value).every((entry) => typeof entry === 'string');
}

function isValidStoredPoint(value: unknown, expectedId: string): value is Point {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const candidate = value as Record<string, unknown>;
	if (candidate.id !== expectedId) return false;
	if (typeof candidate.specimen !== 'string' || candidate.specimen.length === 0) return false;
	if (!isStringRecord(candidate.context)) return false;
	const element = candidate.element as Record<string, unknown> | undefined;
	if (
		!element ||
		typeof element !== 'object' ||
		typeof element.ref !== 'string' ||
		element.ref.length === 0 ||
		typeof element.tag !== 'string' ||
		element.tag.length === 0
	) {
		return false;
	}
	const identity = candidate.identity as Record<string, unknown> | undefined;
	if (
		!identity ||
		typeof identity !== 'object' ||
		typeof identity.ref !== 'string' ||
		identity.ref.length === 0 ||
		!['role-name', 'component-position', 'ref'].includes(String(identity.strongest))
	) {
		return false;
	}
	const source = candidate.source as Record<string, unknown> | undefined;
	if (!source || typeof source !== 'object' || !isStringRecord(source.digests)) {
		return false;
	}
	return true;
}

/** Write a point atomically to `<root>/.specimen/points/<id>.json`, confined inside `root`. */
export async function writePointFile(root: string, point: Point): Promise<string> {
	pointFilePath(root, point.id);
	const { realDir } = await ensureContainedPointsDir(root);
	const file = resolve(realDir, `${point.id}.json`);
	if (!toPosixRelative(realDir, file)) {
		throw new Error(`Point file path escapes points directory: ${point.id}`);
	}
	try {
		const existing = await lstat(file);
		if (existing.isSymbolicLink() || !existing.isFile()) {
			throw new Error(`Point file target is not a regular file: ${point.id}`);
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
	}
	const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
	try {
		await writeFile(tmp, `${JSON.stringify(point, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
		await rename(tmp, file);
	} finally {
		await rm(tmp, { force: true });
	}
	return file;
}

/** Read a stored point from `<root>/.specimen/points/<id>.json`, throwing `POINT_NOT_FOUND` if missing or invalid. */
export async function readPointFile(root: string, id: string): Promise<Point> {
	if (!POINT_ID_READ_PATTERN.test(id)) throw pointNotFound(id);
	const realRoot = await realpath(root);
	let realPointsDir: string;
	try {
		realPointsDir = await realpath(resolve(realRoot, POINTS_DIR));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw pointNotFound(id);
		throw error;
	}
	if (!toPosixRelative(realRoot, realPointsDir)) {
		throw pointNotFound(id);
	}
	const candidate = resolve(realPointsDir, `${id}.json`);
	if (!toPosixRelative(realPointsDir, candidate)) throw pointNotFound(id);
	let realFile: string;
	try {
		realFile = await realpath(candidate);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw pointNotFound(id);
		throw error;
	}
	if (!toPosixRelative(realPointsDir, realFile)) {
		throw pointNotFound(id);
	}
	let raw: string;
	try {
		raw = await readFile(realFile, 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw pointNotFound(id);
		throw error;
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!isValidStoredPoint(parsed, id)) {
			throw new Error('Malformed point record');
		}
		return parsed;
	} catch {
		throw pointError(
			'POINT_NOT_FOUND',
			`Point file for ${id} is unreadable or corrupted.`,
			'Run specimen-point to create a fresh point.',
			{ id }
		);
	}
}
