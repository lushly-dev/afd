/**
 * @fileoverview `readBoot`: what stage A reads of `deployment.json` (phase 2 specification, 2.2), in
 * first paint and holding no validator. Each field is checked as it is read. A boot record is for
 * display: the rail's text and a layout's first shape. Stage B reads the projection with
 * `readProjection` and each manifest with `readManifest`, and corrects whatever a record got wrong.
 * The one value stage A trusts further is `workspace.id`, so it is held to its pattern here.
 */

export interface BootRefusalV2 {
	code: string;
	message: string;
	suggestion: string;
}

export interface BootAppV2 {
	instance: string;
	app: string;
	title: string;
	kind: 'native' | 'view' | 'mounted';
	icon: string;
	order: number;
	scopeLevels: Array<'workspace' | 'project'>;
	rail: boolean;
	parts: string[];
	layout: unknown;
	refusal: BootRefusalV2 | null;
}

/** A way to sign in to a `provider` deployment (phase 3 specification, 2.2; D99). */
export type IdentityMethodV1 = 'passkey' | 'password' | `oidc:${string}`;

/**
 * A deployment's identity as its projection carries it (phase 3 specification, 2.1 and 2.2): `local`, a
 * personal store where every actor is a member and an owner, or `provider`, with the bound organization's
 * slug for display only, the provider's path relative to `site.base_path`, and the ways in.
 */
export type IdentityV1 =
	| { mode: 'local'; organization?: undefined }
	| { mode: 'provider'; organization: string; path: string; methods: IdentityMethodV1[] };

export interface BootProjectionV2 {
	generation: string;
	workspace: { id: string; name: string };
	apps: BootAppV2[];
	/** Version 3's `identity`; `readBoot` always sets it, `local` for a version 2 projection or none (2.2). */
	identity?: IdentityV1;
}

/** An instance id or app id, as the projection's schema has it. */
const ID = /^[a-z][a-z0-9]{0,31}$/;
/**
 * A workspace id (4.1), with the segments a deployment's own files use reserved (6.1). Those with a dot
 * or a `~` are off the pattern already.
 */
const WORKSPACE_ID = /^(?!(?:apps|assets|mounts|sandbox|p)$)[a-z0-9][a-z0-9-]{0,62}$/;
const ICON = /^[a-z][a-z0-9-]{0,30}\/[a-z0-9][a-z0-9-]{0,31}$/;
/** The bound organization's slug, as the deployment file has it (2.2). */
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** `path` relative to `site.base_path`: no leading `/`, no `.` or `..` segment (2.2). */
const AUTH_PATH = /^(?!\.\.?(\/|$))(?!.*\/\.\.?(\/|$))[A-Za-z0-9._~-]+(\/[A-Za-z0-9._~-]+)*$/;
const METHOD = /^(passkey|password|oidc:[a-z0-9][a-z0-9-]{0,31})$/;

type Unchecked = Record<string, unknown>;

/** `value` when it is a plain object, else undefined, so a field of it can be read. */
const recordOf = (value: unknown): Unchecked | undefined =>
	typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Unchecked)
		: undefined;

const text = (value: unknown, max: number): string | undefined =>
	typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined;

const integer = (value: unknown): number | undefined =>
	Number.isSafeInteger(value) ? (value as number) : undefined;

/** `value` when it is one of the space-separated `allowed`. */
const oneOf = (value: unknown, allowed: string): string | undefined =>
	typeof value === 'string' && allowed.split(' ').includes(value) ? value : undefined;

/** The first of each value from `allowed`, or undefined when the list holds anything else. */
function members(value: unknown, allowed: string): string[] | undefined {
	return Array.isArray(value) && value.every((item) => oneOf(item, allowed))
		? [...new Set(value as string[])]
		: undefined;
}

/** One entry, or undefined when its `instance` or `app` would name a layout id or a record wrongly. */
function appOf(value: unknown): BootAppV2 | undefined {
	const entry = recordOf(value);
	const instance = entry?.instance;
	const app = entry?.app;
	if (
		typeof instance !== 'string' ||
		!ID.test(instance) ||
		typeof app !== 'string' ||
		!ID.test(app)
	) {
		return undefined;
	}
	const boot = recordOf(entry?.boot) ?? {};
	const refusal = recordOf(boot.refusal);
	const { code, message, suggestion } = refusal ?? {};
	return {
		instance,
		app,
		title: text(boot.title, 80) ?? text(entry?.title, 80) ?? instance,
		kind: (oneOf(boot.kind, 'native view mounted') ?? 'native') as BootAppV2['kind'],
		icon: typeof boot.icon === 'string' && ICON.test(boot.icon) ? boot.icon : 'system/folder',
		order: integer(boot.order) ?? integer(entry?.order) ?? 100,
		scopeLevels: (members(boot.scope_levels, 'workspace project')?.length
			? members(boot.scope_levels, 'workspace project')
			: ['workspace']) as BootAppV2['scopeLevels'],
		rail: typeof boot.rail === 'boolean' ? boot.rail : true,
		parts: members(boot.parts, 'sidebar inspector panel') ?? [],
		layout: recordOf(boot.layout) ?? {},
		refusal:
			typeof code === 'string' && typeof message === 'string' && typeof suggestion === 'string'
				? { code, message, suggestion }
				: null,
	};
}

/**
 * A version 3 projection's `identity`, checked as it is read: absent is `local`; one out of shape is
 * undefined, and so is the whole projection, so a `provider` deployment never boots as `local` by a field
 * stage A could not read (2.1).
 */
function identityOf(value: unknown): IdentityV1 | undefined {
	const identity = recordOf(value);
	if (value === undefined || identity?.mode === 'local') return { mode: 'local' };
	const { organization, path, methods } = identity ?? {};
	return identity?.mode === 'provider' &&
		typeof organization === 'string' &&
		SLUG.test(organization) &&
		typeof path === 'string' &&
		AUTH_PATH.test(path) &&
		Array.isArray(methods) &&
		methods.length > 0 &&
		methods.every((method) => typeof method === 'string' && METHOD.test(method))
		? { mode: 'provider', organization, path, methods: [...new Set(methods)] }
		: undefined;
}

/**
 * Undefined when `raw` is not a version 2 or 3 projection at all. Each field is checked as it is read, as
 * `unavailableApps` did: a display field out of shape takes its default, after the entry's own `title`
 * and `order` where it has them, and the entry stays listed,
 * since stage B will refuse it with its reason. An entry whose `instance` or `app` fails its pattern,
 * or repeats an instance, is dropped. A `workspace.id` off its pattern makes the whole result undefined.
 */
export function readBoot(raw: unknown): BootProjectionV2 | undefined {
	const projection = recordOf(raw);
	const workspace = recordOf(projection?.workspace);
	const id = workspace?.id;
	const version = projection?.deployment_version;
	const identity = version === 3 ? identityOf(projection?.identity) : { mode: 'local' as const };
	if (
		!projection ||
		(version !== 2 && version !== 3) ||
		identity === undefined ||
		!Array.isArray(projection.apps) ||
		typeof id !== 'string' ||
		!WORKSPACE_ID.test(id)
	) {
		return undefined;
	}
	const seen = new Set<string>();
	const apps: BootAppV2[] = [];
	for (const entry of projection.apps) {
		const app = appOf(entry);
		if (!app || seen.has(app.instance)) continue;
		seen.add(app.instance);
		apps.push(app);
	}
	return {
		generation: typeof projection.generation === 'string' ? projection.generation : '',
		workspace: { id, name: text(workspace?.name, 80) ?? id },
		apps,
		identity,
	};
}
