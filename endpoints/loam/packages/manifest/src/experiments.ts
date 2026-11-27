/**
 * @fileoverview An app's experiments and the gates that name one (phase 4 specification, 5.1 and 5.3; D119): the
 * declaration's type, and the manifest's `ui.experiments` and `requires_experiment` rules beyond the schema. No clock:
 * whether an experiment's `ends` has passed is the kernel's to say, at the call that lists it (`EXPERIMENT_OVERDUE`).
 */

import type { Finding } from './core-rules.js';
import type { ManifestRefusalCode, ManifestV3 } from './types.js';

/** An experiment's lifecycle stage, its author's (5.1). */
export type ExperimentStageV1 = 'hidden' | 'visible' | 'graduated' | 'removed';

/** One experiment an app declares (5.1). Its full id is `<plugin.id>.<id>`. */
export interface ExperimentV1 {
	/** `^[a-z0-9][a-z0-9-]{0,39}$`, unique in the app. */
	id: string;
	/** 1 to 60. */
	title: string;
	/** 1 to 400, plain text: what may change while it is on, shown before a person turns it on. */
	changes: string;
	/** `YYYY-MM-DD`. Nothing turns off on the date; past it, the experiment is overdue. */
	ends: string;
	stage: ExperimentStageV1;
}

/** At most this many experiments per app (`MANIFEST_EXPERIMENTS_LIMIT`). */
export const MANIFEST_EXPERIMENTS_MAX = 8;

/** The surfaces a gate may sit on (5.3): every part an app can lack. Main and the rail are the app's own, gated whole. */
export const GATED_SURFACES_V1: readonly string[] = Object.freeze([
	'sidebar',
	'header',
	'inspector',
	'panel',
	'status',
]);

/** In display text: any control or bidirectional formatting character (`textRules`'s). */
const DISPLAY_CONTROL = /[\p{Cc}\p{Bidi_Control}]/u;

/** Whether `ends` names a real day, `YYYY-MM-DD` (the schema checks the digits, not the calendar). */
export function isExperimentDate(ends: string): boolean {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ends);
	if (!match) return false;
	const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
	const date = new Date(Date.UTC(year, month - 1, day));
	return (
		date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
	);
}

/** Every gate a manifest declares, by where it sits: `app`, a surface's name, or `settings:<section id>`. */
export function gatesOf(
	manifest: ManifestV3
): Array<{ place: string; pointer: string; experiment: string }> {
	const gates: Array<{ place: string; pointer: string; experiment: string }> = [];
	const named = (value: unknown): value is string => typeof value === 'string';
	const app = (manifest.app as { requires_experiment?: unknown } | undefined)?.requires_experiment;
	if (named(app))
		gates.push({ place: 'app', pointer: '/app/requires_experiment', experiment: app });
	const surfaces = (manifest.ui?.surfaces ?? {}) as Record<
		string,
		{ requires_experiment?: unknown } | undefined
	>;
	for (const surface of GATED_SURFACES_V1) {
		const experiment = surfaces[surface]?.requires_experiment;
		if (named(experiment))
			gates.push({
				place: surface,
				pointer: `/ui/surfaces/${surface}/requires_experiment`,
				experiment,
			});
	}
	((manifest.ui?.settings ?? []) as Array<{ id: string; requires_experiment?: unknown }>).forEach(
		(section, index) => {
			if (named(section.requires_experiment))
				gates.push({
					place: `settings:${section.id}`,
					pointer: `/ui/settings/${index}/requires_experiment`,
					experiment: section.requires_experiment,
				});
		}
	);
	return gates;
}

type Refuse = (
	code: ManifestRefusalCode,
	pointer: string,
	message: string,
	suggestion: string
) => void;

/**
 * `ui.experiments`' and the gates' rules beyond the schema (5.1, 5.3, 12.1): no experiment for a mounted app; at most
 * eight; each id once; `ends` a real day; display text plain; and each gate naming one of this app's own experiments,
 * by its full id, since a gate decides what this app shows and no other app's author may decide it.
 */
export function experimentRules(manifest: ManifestV3, refuse: Refuse, _warnings: Finding[]): void {
	const experiments = (manifest.ui?.experiments ?? []) as ExperimentV1[];
	const gates = gatesOf(manifest);
	if (experiments.length === 0 && gates.length === 0) return;
	if (manifest.plugin.kind === 'mounted') {
		refuse(
			'MANIFEST_SETTINGS_MOUNTED',
			experiments.length > 0 ? '/ui/experiments' : (gates[0] as { pointer: string }).pointer,
			"A mounted app declares no experiment and no gate in phase 4: its server's tools are what it serves.",
			'Remove `ui.experiments` and `requires_experiment`.'
		);
		return;
	}
	if (experiments.length > MANIFEST_EXPERIMENTS_MAX) {
		refuse(
			'MANIFEST_EXPERIMENTS_LIMIT',
			`/ui/experiments/${MANIFEST_EXPERIMENTS_MAX}`,
			`An app declares at most ${MANIFEST_EXPERIMENTS_MAX} experiments; this one declares ${experiments.length}.`,
			'Graduate or remove the experiments that have ended.'
		);
	}
	const seen = new Set<string>();
	experiments.forEach((experiment, index) => {
		const at = `/ui/experiments/${index}`;
		if (seen.has(experiment.id)) {
			refuse(
				'MANIFEST_DUPLICATE',
				`${at}/id`,
				`The experiment \`${experiment.id}\` is repeated.`,
				'Give each experiment its own id; a removed one keeps its id, and a new one takes another.'
			);
		}
		seen.add(experiment.id);
		if (!isExperimentDate(experiment.ends)) {
			refuse(
				'MANIFEST_EXPERIMENT_DATE',
				`${at}/ends`,
				`\`${experiment.ends}\` is not a day of the calendar.`,
				'Give `ends` as YYYY-MM-DD, a real day, such as 2027-03-01.'
			);
		}
		for (const field of ['title', 'changes'] as const) {
			// `changes` may hold a line break, as plain text does; nothing else that reorders what a person reads.
			const text =
				field === 'changes' ? experiment[field].replace(/[\n\r]/g, '') : experiment[field];
			if (DISPLAY_CONTROL.test(text)) {
				refuse(
					'MANIFEST_TEXT_INVALID',
					`${at}/${field}`,
					"It holds a control or bidirectional formatting character, and it reaches a person's screen.",
					'Remove the control character.'
				);
			}
		}
	});
	const own = new Set(experiments.map((experiment) => `${manifest.plugin.id}.${experiment.id}`));
	for (const gate of gates) {
		if (own.has(gate.experiment)) continue;
		refuse(
			'MANIFEST_EXPERIMENT_UNKNOWN',
			gate.pointer,
			`\`${gate.experiment}\` is not one of this app's experiments.`,
			`Name one of \`ui.experiments\` by its full id, \`${manifest.plugin.id}.<id>\`.`
		);
	}
}
