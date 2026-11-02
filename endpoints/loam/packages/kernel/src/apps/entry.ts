/**
 * @fileoverview Deciding what one deployment entry becomes (phase 1 specification, sections 3 and 10):
 * its record, what refuses it as `loam deployment check` would, and its first layout.
 */

import type { CommandError } from '@lushly-dev/afd-core';
import {
	GRANT_CATALOG_V1,
	type ManifestRefusal,
	type ManifestRefusalCode,
	type ManifestV1,
	type ProjectionAppV1,
	TRUST_LINES_V1,
} from '@lushly-dev/loam-manifest';
import { fromJSONSchema, type ZodType } from 'zod';
import type { LoamKernelErrorCode } from '../errors.js';
import {
	createDefaultLayout,
	type LayoutPart,
	type LayoutStateV0,
	validateLayoutPatch,
} from '../layout.js';
import type { AppKindV1 } from '../types.js';
import type { AppRecord } from './operations.js';

const SERVED_GRANTS: ReadonlySet<string> = new Set(
	GRANT_CATALOG_V1.filter((grant) => grant.servedFrom === 1).map((grant) => grant.name)
);
const PARTS: readonly LayoutPart[] = ['sidebar', 'inspector', 'panel'];
const TRUST: Readonly<Record<AppKindV1, AppRecord['detail']['trust']>> = {
	native: 'trusted',
	view: 'sandboxed',
	mounted: 'external',
};
/** Keys of a projection entry only a mounted instance has. */
export const MOUNTED_KEYS = [
	'prefix',
	'audience',
	'transport',
	'route',
	'projects',
	'space',
	'expose',
	'commands',
] as const;
const DEFAULT_ICON = 'system/folder';
const DEFAULT_ORDER = 100;

export const errorOf = (
	code: LoamKernelErrorCode | ManifestRefusalCode,
	message: string,
	suggestion: string,
	details?: Record<string, unknown>
): CommandError => ({
	code,
	message,
	suggestion,
	retryable: false,
	...(details !== undefined ? { details } : {}),
});

/** What fixes a record's shape: the manifest, when one was read, else only the entry. */
export function baseRecord(
	entry: ProjectionAppV1,
	manifest: ManifestV1 | undefined,
	rawKind: unknown
): AppRecord {
	const rail = manifest?.ui?.surfaces?.rail;
	const hasMountedKey = MOUNTED_KEYS.some((key) => entry[key] !== undefined);
	const kind: AppKindV1 =
		manifest?.plugin.kind ??
		(rawKind === 'native' || rawKind === 'view' || rawKind === 'mounted'
			? rawKind
			: hasMountedKey
				? 'mounted'
				: 'native');
	return {
		instance: entry.instance,
		app: entry.app,
		kind,
		title: entry.title ?? rail?.label ?? manifest?.plugin.title ?? entry.instance,
		icon: rail?.icon ?? DEFAULT_ICON,
		order: entry.order ?? rail?.order ?? DEFAULT_ORDER,
		entry,
		state: 'ready',
		warnings: [],
		notices: [],
		detail: {
			version: manifest?.plugin.version ?? '',
			trust: TRUST[kind],
			trustLine: TRUST_LINES_V1[kind].line,
			surfaces: Object.keys(manifest?.ui?.surfaces ?? {}),
			compositions: [...(manifest?.ui?.compositions ?? [])],
			grants: (manifest?.grants ?? []).map((grant) => ({
				name: grant.name,
				required: grant.required ?? true,
				served: SERVED_GRANTS.has(grant.name),
				reason: grant.reason,
			})),
			contexts: (manifest?.contexts ?? []).map((context) => context.name),
			skills: (manifest?.skills ?? []).map((skill) => skill.name),
		},
		commands: [],
		statusItemIds: new Set(manifest?.ui?.surfaces?.status?.items?.map((item) => item.id) ?? []),
		selection: null,
		statusValues: new Map(),
		...(manifest !== undefined ? { manifest } : {}),
	};
}

export function refusalError(refusals: readonly ManifestRefusal[]): CommandError {
	const first = refusals[0] as ManifestRefusal;
	return errorOf(first.code, first.message, first.suggestion, {
		key: first.key,
		refusals,
	});
}

/** Each kind's own refusal of an entry, as `loam deployment check` names them. */
export function kindRefusal(
	entry: ProjectionAppV1,
	manifest: ManifestV1
): CommandError | undefined {
	if (manifest.plugin.id !== entry.app) {
		return errorOf(
			'DEPLOYMENT_APP_MISMATCH',
			`\`app\` says \`${entry.app}\`, and the package is \`${manifest.plugin.id}\`.`,
			'Name the app the package holds, or point `package` at the right one.'
		);
	}
	const { kind } = manifest.plugin;
	if (kind === 'mounted') {
		if (entry.audience === undefined) {
			return errorOf(
				'DEPLOYMENT_AUDIENCE_REQUIRED',
				'A mounted instance says who it serves.',
				'Set `audience` to `team` or `person`.'
			);
		}
		if (entry.audience === 'team' && transportOf(entry, manifest) === 'stdio') {
			return errorOf(
				'DEPLOYMENT_TEAM_NEEDS_HTTP',
				'A team instance is reached over `http`.',
				'Set `transport = "http"` with a `url`, or `audience = "person"`.'
			);
		}
		return undefined;
	}
	const stray = MOUNTED_KEYS.find((key) => entry[key] !== undefined);
	if (stray !== undefined) {
		return errorOf(
			'DEPLOYMENT_INSTANCE_MISMATCH',
			`\`${stray}\` is for a mounted instance, and this package is \`${kind}\`.`,
			'Remove the key, or point `package` at a mounted app.'
		);
	}
	return undefined;
}

export const transportOf = (entry: ProjectionAppV1, manifest: ManifestV1): 'http' | 'stdio' =>
	entry.transport ?? manifest.mount?.transport ?? 'http';

export function configRefusal(
	entry: ProjectionAppV1,
	manifest: ManifestV1
): CommandError | undefined {
	const suggestion = "Match the manifest's `config.schema`.";
	const schema = manifest.config?.schema;
	if (schema === undefined) {
		return entry.config === undefined
			? undefined
			: errorOf('APP_CONFIG_INVALID', 'This app declares no `config.schema`.', suggestion);
	}
	let parsed: ReturnType<ZodType['safeParse']>;
	try {
		parsed = fromJSONSchema(schema as Parameters<typeof fromJSONSchema>[0]).safeParse(
			entry.config ?? {}
		);
	} catch {
		return errorOf(
			'APP_CONFIG_INVALID',
			"The manifest's `config.schema` cannot be read.",
			suggestion
		);
	}
	if (parsed.success) return undefined;
	// The paths and rules, never the values: a config may hold what a log should not.
	const issues = parsed.error.issues.map(
		(issue) => `${issue.path.join('.') || '(root)'}: ${issue.code}`
	);
	return errorOf(
		'APP_CONFIG_INVALID',
		`The config does not match its schema: ${issues.join(', ')}.`,
		suggestion
	);
}

/** An instance's first layout: the defaults, undeclared parts closed, with the preset over them (4.5). */
export function firstLayout(manifest: ManifestV1 | undefined): {
	initial: LayoutStateV0;
	declared: Set<LayoutPart>;
} {
	const surfaces = manifest?.ui?.surfaces ?? {};
	const declared = new Set(PARTS.filter((part) => surfaces[part] !== undefined));
	const seeded = validateLayoutPatch(createDefaultLayout(), manifest?.ui?.layout ?? {});
	const initial = seeded.valid ? seeded.state : createDefaultLayout();
	for (const part of PARTS) if (!declared.has(part)) initial[part].open = false;
	return { initial, declared };
}

/** The shell's own domains and every domain a deployment entry has taken so far (D66). */
export class DomainHolders {
	private readonly held = new Map<string, string>();
	private readonly appsSeen = new Set<string>();

	constructor(private readonly shell: ReadonlySet<string>) {}

	/** Claim an app's id as its domain. */
	claimApp(entry: ProjectionAppV1): CommandError | undefined {
		const id = entry.app;
		const holder = this.held.get(id);
		if (holder !== undefined) {
			return errorOf(
				'APP_DOMAIN_CONFLICT',
				`The domain \`${id}\` is already used by instance \`${holder}\`.`,
				'Rename the app, or set another prefix on that instance.'
			);
		}
		this.held.set(id, entry.instance);
		return undefined;
	}

	/** Claim a mounted instance's prefix, as `deployment check` does (3.1). */
	claimPrefix(entry: ProjectionAppV1, manifest: ManifestV1 | undefined): CommandError | undefined {
		const { instance, app } = entry;
		const named = entry.prefix !== undefined;
		const first = !this.appsSeen.has(app);
		this.appsSeen.add(app);
		if (!named && !first) {
			return errorOf(
				'INSTANCE_PREFIX_REQUIRED',
				`A further instance of \`${app}\` must name its own prefix.`,
				`Set \`prefix\` on \`${instance}\`.`
			);
		}
		const prefix = entry.prefix ?? manifest?.mount?.prefix;
		if (prefix === undefined) return undefined;
		const holder = this.held.get(prefix);
		if (holder !== undefined || this.shell.has(prefix)) {
			return errorOf(
				'INSTANCE_PREFIX_CONFLICT',
				holder !== undefined
					? `Command prefix \`${prefix}\` is already used by instance \`${holder}\`; choose another prefix for \`${instance}\`.`
					: `Command prefix \`${prefix}\` is a shell domain; choose another prefix for \`${instance}\`.`,
				'Choose another prefix.'
			);
		}
		this.held.set(prefix, instance);
		return undefined;
	}
}
