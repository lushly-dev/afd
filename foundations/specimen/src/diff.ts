import { normalizeDom } from './normalize.js';
import { normalizeElements } from './normalize-ids.js';
import {
	CAPTURE_VERSION,
	type ChannelDifference,
	type Completeness,
	type DiffOptions,
	type ElementObservation,
	NORMALIZATION_VERSION,
	type Observation,
	type ObservationDiff,
	type SpecimenContext,
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
	requireEqual('checkpoint', left.manifest.checkpoint, right.manifest.checkpoint);
	const keys = new Set([
		...Object.keys(left.manifest.context),
		...Object.keys(right.manifest.context),
	] as (keyof SpecimenContext)[]);
	for (const key of keys) {
		if (!options.allowContextDifferences?.includes(key)) {
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
