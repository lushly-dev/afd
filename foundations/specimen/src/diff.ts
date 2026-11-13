import { normalizeDom } from './normalize.js';
import { normalizeElements } from './normalize-ids.js';
import {
	CAPTURE_VERSION,
	type CaptureCheckpoint,
	type ChannelDifference,
	type Completeness,
	type DiffOptions,
	type ElementObservation,
	NORMALIZATION_VERSION,
	type Observation,
	type ObservationDiff,
	type RecordedContext,
} from './types.js';

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (typeof value === 'object' && value !== null) {
		return `{${Object.entries(value)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
			.join(',')}}`;
	}
	return JSON.stringify(value) ?? 'undefined';
}

function requireEqual(label: string, left: unknown, right: unknown): void {
	if (canonical(left) !== canonical(right)) {
		throw new Error(
			`Incompatible captures: ${label} differs. Capture both sides with the same ${label}, or explicitly allow a supported context axis.`
		);
	}
}

function validateCompatibility(left: Observation, right: Observation, options: DiffOptions): void {
	for (const observation of [left, right]) {
		if (observation.manifest.captureVersion !== CAPTURE_VERSION) {
			throw new Error(
				`Unsupported capture version ${observation.manifest.captureVersion}; recapture with version ${CAPTURE_VERSION}.`
			);
		}
		if (observation.manifest.normalizationVersion !== NORMALIZATION_VERSION) {
			throw new Error(
				`Unsupported normalization version ${observation.manifest.normalizationVersion}; recapture with version ${NORMALIZATION_VERSION}.`
			);
		}
	}
	requireEqual('browser', left.manifest.browser, right.manifest.browser);
	// How each page got ready, and how long it was allowed, is no part of what is compared.
	const condition = ({ name, actionMode, baseline }: CaptureCheckpoint) => ({
		name,
		actionMode,
		baseline,
	});
	requireEqual(
		'checkpoint',
		condition(left.manifest.checkpoint),
		condition(right.manifest.checkpoint)
	);
	const keys = new Set([
		...Object.keys(left.manifest.context),
		...Object.keys(right.manifest.context),
	] as (keyof RecordedContext)[]);
	for (const key of keys) {
		// What the document observed and loaded is evidence about the capture, not its request.
		if (key === 'observed' || key === 'resources') continue;
		if (!(options.allowContextDifferences as string[] | undefined)?.includes(key)) {
			requireEqual(`context.${key}`, left.manifest.context[key], right.manifest.context[key]);
		}
	}
}

function evidenceLimitations(
	left: Observation,
	right: Observation
): { limitations: string[]; incomplete: boolean } {
	const limitations = [
		'Structured comparison covers DOM, ARIA snapshots, layout, selected styles and live state; it does not establish visual equivalence.',
	];
	if (
		canonical(left.manifest.context.resources.fonts) !==
		canonical(right.manifest.context.resources.fonts)
	)
		limitations.push(
			'The two captures loaded different fonts, which can change layout without any change to the component.'
		);
	let incomplete = false;
	for (const [side, observation] of [
		['left', left],
		['right', right],
	] as const) {
		for (const channel of ['dom', 'a11y', 'layout', 'styles'] as const) {
			const completion = observation.completeness[channel];
			const ariaOnly =
				channel === 'a11y' &&
				completion.status === 'partial' &&
				completion.reasons.length > 0 &&
				completion.reasons.every((reason) => reason === 'AXE_NOT_RUN');
			if (completion.status !== 'complete') {
				limitations.push(describeCompleteness(side, channel, completion));
				if (!ariaOnly) incomplete = true;
			}
		}
		for (const channel of ['tokens', 'events'] as const) {
			if (observation.completeness[channel].status !== 'complete') {
				limitations.push(describeCompleteness(side, channel, observation.completeness[channel]));
			}
		}
	}
	if (left.manifest.dependencies !== right.manifest.dependencies) {
		limitations.push(
			'Dependency identities differ; observed changes cannot be attributed to source changes alone.'
		);
	}
	return { limitations: [...new Set(limitations)], incomplete };
}

function describeCompleteness(side: string, channel: string, value: Completeness): string {
	return `${side}.${channel}: ${value.status} (${value.scope})${value.reasons.length ? `: ${value.reasons.join('; ')}` : ''}`;
}

function compareRecord(
	differences: ChannelDifference[],
	channel: ChannelDifference['channel'],
	target: string,
	prefix: string,
	left: Record<string, unknown>,
	right: Record<string, unknown>
): void {
	const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
	for (const property of [...keys].sort()) {
		if (canonical(left[property]) !== canonical(right[property])) {
			differences.push({
				channel,
				target,
				property: prefix ? `${prefix}.${property}` : property,
				left: Object.hasOwn(left, property) ? left[property] : { missing: true },
				right: Object.hasOwn(right, property) ? right[property] : { missing: true },
			});
		}
	}
}

function elementMap(elements: ElementObservation[]): Map<string, ElementObservation> {
	const result = new Map<string, ElementObservation>();
	for (const item of normalizeElements(elements)) {
		if (result.has(item.ref))
			throw new Error(
				`Ambiguous capture: duplicate element reference ${item.ref}. Recapture with unique structural references.`
			);
		result.set(item.ref, item);
	}
	return result;
}

function compareElements(
	differences: ChannelDifference[],
	left: Observation,
	right: Observation
): void {
	const leftElements = elementMap(left.channels.elements);
	const rightElements = elementMap(right.channels.elements);
	const refs = new Set([...leftElements.keys(), ...rightElements.keys()]);
	for (const ref of refs) {
		const before = leftElements.get(ref);
		const after = rightElements.get(ref);
		if (!before || !after) {
			differences.push({
				channel: 'dom',
				target: ref,
				property: 'element',
				left: before ?? null,
				right: after ?? null,
			});
			continue;
		}
		if (before.tag !== after.tag)
			differences.push({
				channel: 'dom',
				target: ref,
				property: 'tag',
				left: before.tag,
				right: after.tag,
			});
		compareRecord(differences, 'dom', ref, 'attributes', before.attributes, after.attributes);
		compareRecord(differences, 'layout', ref, 'box', before.box, after.box);
		compareRecord(differences, 'layout', ref, 'scroll', before.scroll, after.scroll);
		compareRecord(differences, 'styles', ref, '', before.styles, after.styles);
		compareRecord(differences, 'state', ref, '', before.state, after.state);
		compareRecord(
			differences,
			'a11y',
			ref,
			'accessibility',
			before.accessibility ?? {},
			after.accessibility ?? {}
		);
	}
}

// Comparison derives normalized DOM from raw DOM every time, never from a capture's stored
// value. Normalization is a pure function of raw, so recent results are reused: comparing one
// baseline against many captures parses it once, and repeated comparison does not drive the
// parser into the optimizing compilers.
const NORMALIZED_LIMIT = 32;
const normalizedCache = new Map<string, string>();
function normalizedDom(raw: string): string {
	const cached = normalizedCache.get(raw);
	if (cached !== undefined) {
		normalizedCache.delete(raw);
		normalizedCache.set(raw, cached);
		return cached;
	}
	const normalized = normalizeDom(raw);
	normalizedCache.set(raw, normalized);
	if (normalizedCache.size > NORMALIZED_LIMIT) {
		const oldest = normalizedCache.keys().next().value;
		if (oldest !== undefined) normalizedCache.delete(oldest);
	}
	return normalized;
}

/**
 * Compare the default structured scope. Token/event capture is not part of this
 * feasibility comparator; missing structural evidence can never mean unchanged.
 * Screenshots are review artifacts, not pixel comparison evidence.
 */
/** The declared events in order, by type, target and interval; `null` when none were declared. */
function eventHistory(observation: Observation): string | null {
	const { status } = observation.completeness.events;
	if (status === 'not-requested' || status === 'unsupported') return null;
	return observation.channels.events.history
		.map((event) => `${event.type} ${event.target ?? '-'} ${event.step ?? '-'}`)
		.join('\n');
}

/** What axe found in a capture, as sorted rule and target pairs; `null` when it did not run. */
function axeFindings(observation: Observation): string | null {
	const { axe } = observation.channels.a11y;
	if (axe === 'not-run') return null;
	return axe.violations
		.flatMap((violation) => violation.targets.map((target) => `${violation.id} ${target}`))
		.sort()
		.join('\n');
}

export function diffObservations(
	left: Observation,
	right: Observation,
	options: DiffOptions = {}
): ObservationDiff {
	validateCompatibility(left, right, options);
	const differences: ChannelDifference[] = [];
	const leftDom = normalizedDom(left.channels.dom.raw);
	const rightDom = normalizedDom(right.channels.dom.raw);
	if (leftDom !== rightDom) differences.push({ channel: 'dom', left: leftDom, right: rightDom });
	if (left.channels.a11y.snapshot !== right.channels.a11y.snapshot) {
		differences.push({
			channel: 'a11y',
			left: left.channels.a11y.snapshot,
			right: right.channels.a11y.snapshot,
		});
	}
	const leftEvents = eventHistory(left);
	const rightEvents = eventHistory(right);
	if (leftEvents !== null && rightEvents !== null && leftEvents !== rightEvents)
		differences.push({ channel: 'events', left: leftEvents, right: rightEvents });
	const leftAxe = axeFindings(left);
	const rightAxe = axeFindings(right);
	if (leftAxe !== null && rightAxe !== null && leftAxe !== rightAxe)
		differences.push({ channel: 'a11y', left: leftAxe, right: rightAxe });
	compareElements(differences, left, right);
	const evidence = evidenceLimitations(left, right);
	if (options.requireVisual) {
		const screenshotsPresent =
			left.channels.visual.path !== null &&
			right.channels.visual.path !== null &&
			left.completeness.visual.status === 'complete' &&
			right.completeness.visual.status === 'complete';
		evidence.limitations.push(
			screenshotsPresent
				? 'PIXEL_COMPARISON_UNAVAILABLE: screenshots are available for human review, but their pixels have not been compared.'
				: 'VISUAL_EVIDENCE_UNAVAILABLE: both compatible screenshots are required for visual review; pixel comparison is not implemented.'
		);
		evidence.incomplete = true;
	}
	return {
		status: evidence.incomplete
			? 'insufficient-evidence'
			: differences.length
				? 'changed'
				: 'no-change-observed',
		differences,
		limitations: evidence.limitations,
	};
}
