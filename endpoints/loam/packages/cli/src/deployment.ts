/**
 * @fileoverview `@lushly-dev/loam-cli/deployment`: `writeDeployment` (phase 1 specification, 3.2). Only
 * what makes the file unreadable stops a write; a bad package stays in the projection, so the kernel
 * refuses it at load and the rail shows it (D66). Nothing of a location, a credential or a command
 * line reaches the projection.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type {
	DeploymentV1,
	DeploymentV2,
	DeploymentV3,
	DeploymentV4,
	DeploymentWorkspaceV2,
	HostKindV1,
	IdentityV1,
	ProjectionAppV2,
	ProjectionAppV4,
	ProjectionBootV2,
	ProjectionV4,
} from '@lushly-dev/loam-manifest';
import { DEFAULT_WORKSPACE_V2, readProjection } from '@lushly-dev/loam-manifest/validate';
import {
	analyzeDeployment,
	appKey,
	type DeploymentFinding,
	type DeploymentNotice,
	type InstanceEffect,
	type ModelAccess,
	type MountAccess,
	type StdioMountAccess,
	secretPaths,
} from './deployment-analysis.js';
import { copyListed, isWithin, listCopy, OUTPUT_MARKER, realish, replaceable } from './tree.js';

export {
	type AnalyzeDeploymentOptions,
	analyzeDeployment,
	type DeploymentAnalysis,
	type DeploymentFinding,
	type DeploymentNotice,
	desktopOrigins,
	type ModelAccess,
	type MountAccess,
	type StdioMountAccess,
} from './deployment-analysis.js';

export interface WriteDeploymentOptions {
	/** `loam.deployment.toml`. */
	config: string;
	/** The web host's `dist`. */
	dist: string;
	out: string;
	/** Where the CLI writes the `mounts` list, mode 0600 and outside everything served. */
	mountsOut?: string;
	/**
	 * Where a desktop deployment's `models.json` goes, beside `mounts.json` and under its rule (phase 5 specification,
	 * 4.2): owner-only, outside everything served. Required when `[copilot]` lists a provider but `test`.
	 */
	modelsOut?: string;
	/** Write the site as if the file's `[sandbox] origin` were this one (`AnalyzeDeploymentOptions`). */
	sandboxOrigin?: string;
	/**
	 * `--host` (phase 6 specification, 3.3): the kind, set when the file names none and refused when it names
	 * another (`DEPLOYMENT_HOST_MISMATCH`). The hosted server writes its site with `hosted`.
	 */
	host?: HostKindV1;
	/** The platform a desktop deployment is written for (its origins, `mounts.json`'s ACL). Default: this one. */
	platform?: NodeJS.Platform;
}

export type WriteDeploymentResult =
	| {
			ok: true;
			out: string;
			projection: ProjectionV4;
			/** In memory: what the caller's relay needs. */
			mounts: MountAccess[];
			/** Each instance the kernel will refuse, and the packages' warnings. */
			warnings: DeploymentFinding[];
			notices: DeploymentNotice[];
	  }
	| { ok: false; refusals: DeploymentFinding[]; warnings: DeploymentFinding[] };

const PARTS = ['sidebar', 'inspector', 'panel'] as const;
const DEFAULT_ICON = 'system/folder';
const DEFAULT_ORDER = 100;

/** The finding that refuses `id`, the first of those `deployment check` reports for it. */
function refusalFor(
	id: string,
	findings: readonly DeploymentFinding[]
): ProjectionBootV2['refusal'] {
	const key = appKey(id);
	const found = findings.find(
		(finding) =>
			finding.key === key ||
			(/^[.:[]/.test(finding.key.slice(key.length)) && finding.key.startsWith(key))
	);
	return found ? { code: found.code, message: found.message, suggestion: found.suggestion } : null;
}

/**
 * An entry's boot record (phase 2 specification, 2.2): what `app-list` will say of it, for the rail
 * and a layout's first shape before stage B reads its manifest. Display only.
 */
export function bootRecordOf(
	effect: InstanceEffect,
	findings: readonly DeploymentFinding[]
): ProjectionBootV2 {
	const { id, entry, manifest } = effect;
	const surfaces = manifest?.ui?.surfaces ?? {};
	const rail = surfaces.rail;
	// `ui.documents` is manifest version 2's (8.3); a version 1 manifest never has it.
	const documents = (manifest?.ui as { documents?: unknown } | undefined)?.documents !== undefined;
	const levels: ProjectionBootV2['scope_levels'] =
		effect.mounted && entry.projects !== undefined
			? ['project']
			: (manifest?.app?.scope_levels ?? ['workspace']);
	const appGate = (manifest?.app as { requires_experiment?: unknown } | undefined)
		?.requires_experiment;
	const gated =
		typeof appGate === 'string' &&
		!(manifest?.ui?.experiments as Array<{ id: string; stage: string }> | undefined)?.some(
			(exp) => `${manifest?.plugin.id}.${exp.id}` === appGate && exp.stage === 'graduated'
		);
	return {
		title: entry.title ?? rail?.label ?? manifest?.plugin.title ?? id,
		kind: manifest?.plugin.kind ?? 'native',
		icon: rail?.icon ?? DEFAULT_ICON,
		order: entry.order ?? rail?.order ?? DEFAULT_ORDER,
		scope_levels: levels,
		rail: !(documents && !rail && !surfaces.sidebar && !surfaces.main),
		...(gated ? { gated: true } : {}),
		parts: PARTS.filter((part) => surfaces[part] !== undefined),
		layout: (manifest?.ui?.layout ?? {}) as ProjectionBootV2['layout'],
		refusal: refusalFor(id, findings),
	};
}

/** JSON with every object's keys sorted, so equal values give equal text. */
export function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (typeof value === 'object' && value !== null) {
		const entries = Object.entries(value)
			.filter(([, item]) => item !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

/**
 * `sha256-` and the digest of `{ workspace, apps }` with each `boot` left out (2.2): it changes when a
 * deployer's entry changes, not when a package's display does. A version 4 projection's `host` joins it, so a
 * change of kind is applied, and journaled, as a change of entries is (phase 6 specification, 3.3 and A5), and so is
 * its `copilot`, so a swap of providers is too (phase 5 specification, 4.1); an earlier projection's generation is
 * unchanged.
 */
export function generationOf(
	workspace: DeploymentWorkspaceV2,
	apps: readonly ProjectionAppV2[],
	host?: NonNullable<ProjectionV4['host']>,
	copilot?: NonNullable<ProjectionV4['copilot']>
): string {
	const entries = apps.map(({ boot: _boot, ...entry }) => entry);
	const digest = createHash('sha256').update(
		canonicalJson({
			workspace,
			apps: entries,
			...(host ? { host } : {}),
			...(copilot ? { copilot } : {}),
		})
	);
	return `sha256-${digest.digest('hex')}`;
}

/**
 * The whitelist of what reaches a browser. A key not named here cannot arrive there. A version 3 file
 * writes a version 3 projection, with its identity's mode, slug, path and methods and nothing else of
 * it (phase 3 specification, 2.2); an earlier file, version 2, so phase 2's projections are unchanged. A
 * version 4 file writes a version 4 projection, which adds the host's kind, and for the hosted server the
 * same-origin path of its trust-record transport under `base_path`, and nothing else of it (phase 6
 * specification, 3.3).
 */
export function projectionOf(
	deployment: DeploymentV1 | DeploymentV2 | DeploymentV3 | DeploymentV4,
	instances: readonly InstanceEffect[],
	workspace: DeploymentWorkspaceV2 = DEFAULT_WORKSPACE_V2,
	findings: readonly DeploymentFinding[] = [],
	identity: IdentityV1 = { mode: 'local' },
	kind: HostKindV1 = 'static'
): ProjectionV4 {
	const apps: Array<ProjectionAppV2 & Pick<ProjectionAppV4, 'labels' | 'approvals' | 'views'>> =
		instances.map((effect) => {
			const { id, entry, mounted, prefix, transport } = effect;
			return {
				instance: id,
				app: entry.app,
				package: `apps/${id}/`,
				...(entry.order !== undefined ? { order: entry.order } : {}),
				...(entry.title !== undefined ? { title: entry.title } : {}),
				...(entry.config !== undefined ? { config: entry.config } : {}),
				...(mounted && prefix !== undefined ? { prefix } : {}),
				...(entry.audience !== undefined ? { audience: entry.audience } : {}),
				...(mounted && transport !== undefined ? { transport } : {}),
				// On the desktop a `stdio` instance has a route too: it only names the instance, which the Rust host
				// reaches by name, so the kernel discovers it as it does any other (10.4).
				...(mounted && (transport === 'http' || (kind === 'desktop' && transport === 'stdio'))
					? { route: `mounts/${id}/mcp` }
					: {}),
				...(entry.projects !== undefined ? { projects: entry.projects } : {}),
				...(entry.space !== undefined ? { space: entry.space } : {}),
				// Whose word decides a result's labels (phase 5 specification, 5.1): the deployer's, per instance.
				...(mounted &&
				'labels' in entry &&
				(entry.labels === 'whole' || entry.labels === 'per-part')
					? { labels: entry.labels }
					: {}),
				// Which of its commands the shell may release for a person (phase 5 specification, 7.2): the deployer's, per instance.
				...(mounted &&
				'approvals' in entry &&
				(entry.approvals === 'none' || entry.approvals === 'shell')
					? { approvals: entry.approvals }
					: {}),
				// Whether `shell-open` may render its `ui://` views (phase 5 specification, 9.3; D169): the deployer's opt-in.
				...(mounted && 'views' in entry && entry.views === true ? { views: true } : {}),
				...(entry.expose !== undefined ? { expose: entry.expose } : {}),
				...(entry.commands !== undefined ? { commands: entry.commands } : {}),
				boot: bootRecordOf(effect, findings),
			};
		});
	const version =
		deployment.deployment_version === 4 ? 4 : deployment.deployment_version === 3 ? 3 : 2;
	const host: ProjectionV4['host'] =
		version === 4 ? (kind === 'hosted' ? { kind, kernel: 'api/kernel' } : { kind }) : undefined;
	// The copilot's providers: each one's id, kind and model, never its key or endpoint (phase 5 specification, 4.1).
	const providers = deployment.deployment_version === 4 ? deployment.copilot?.providers : undefined;
	const first = providers?.[0];
	const copilot: ProjectionV4['copilot'] =
		deployment.deployment_version === 4 && providers && first
			? {
					default: deployment.copilot?.default ?? first.id,
					providers: providers.map(({ id, kind: providerKind, model }) => ({
						id,
						kind: providerKind,
						model,
					})),
				}
			: undefined;
	return {
		deployment_version: version,
		generation: generationOf(workspace, apps, host, copilot),
		workspace: { id: workspace.id, name: workspace.name },
		sandbox_origin: deployment.sandbox?.origin ?? null,
		...((deployment.deployment_version === 3 || deployment.deployment_version === 4) &&
		deployment.identity !== undefined
			? {
					identity:
						identity.mode === 'provider'
							? {
									mode: 'provider',
									organization: identity.organization,
									path: identity.path,
									// `readDeployment` refused an empty list.
									methods: identity.methods as [string, ...string[]],
								}
							: { mode: 'local' },
				}
			: {}),
		...(host ? { host } : {}),
		...(copilot ? { copilot } : {}),
		apps,
	};
}

/** A projection the schema refuses stops the write: nothing with an unknown key is ever served. */
export function checkedProjection(
	candidate: unknown
): { ok: true; projection: ProjectionV4 } | { ok: false; refusals: DeploymentFinding[] } {
	const read = readProjection(candidate);
	return read.ok
		? { ok: true, projection: read.projection }
		: {
				ok: false,
				refusals: read.refusals.map((refusal) => ({ ...refusal, code: 'DEPLOYMENT_INVALID' })),
			};
}

/**
 * `index.html`'s `src` and `href` from `./assets/` to `<base_path>assets/` (phase 2 specification, 4.2 and
 * 6.2), so a deep link such as `/acme/p/atlas/hello` loads the same files: `<base>` cannot do it under
 * `base-uri 'none'`. `basePath` has passed the deployment's pattern, both slashes and no dot segment.
 */
export function withBasePath(html: string, basePath: string): string {
	return html.replace(
		/(\s(?:src|href)=["'])\.\/assets\//g,
		(_all, lead: string) => `${lead}${basePath}assets/`
	);
}

/** Tauri's IPC: the `ipc:` scheme on macOS and Linux, `http://ipc.localhost` on Windows (S92). */
export const DESKTOP_IPC_SOURCES = 'ipc: http://ipc.localhost';

/**
 * The desktop's `connect-src` (phase 6 specification, 10.2): `'self'` plus the IPC sources Tauri's own example
 * uses, and nothing else. `undefined` when the page has no policy, or a `connect-src` other than exactly
 * `'self'`, the phase 0 policy's.
 */
export function withDesktopConnectSrc(html: string): string | undefined {
	const meta = /<meta\b(?=[^>]*http-equiv=["']Content-Security-Policy["'])[^>]*>/i.exec(html);
	const content = meta && /\bcontent="([^"]*)"/.exec(meta[0]);
	if (!meta || !content) return undefined;
	const policy = content[1] as string;
	const directive = /(^|;\s*)connect-src\s+'self'\s*(?=;|$)/;
	if (!directive.test(policy)) return undefined;
	const next = policy.replace(
		directive,
		(_all, lead: string) => `${lead}connect-src 'self' ${DESKTOP_IPC_SOURCES}`
	);
	const tag = meta[0].replace(content[0], () => `content="${next}"`);
	return `${html.slice(0, meta.index)}${tag}${html.slice(meta.index + meta[0].length)}`;
}

const run = promisify(execFile);

/**
 * `mounts.json` on Windows, where mode 0600 means nothing: inheritance removed and one entry, full control for
 * this user, the only ACL the desktop's host accepts (10.3).
 */
async function restrictToOwner(path: string): Promise<void> {
	// System32's tools by path: another `whoami` on `PATH` (Git's) takes other arguments.
	const root = process.env.SystemRoot ?? process.env.windir;
	if (!root)
		throw new Error('No SystemRoot: the Windows tools that restrict mounts.json cannot be found');
	const system = join(root, 'System32');
	const { stdout } = await run(join(system, 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], {
		windowsHide: true,
	});
	const sid = /"(S-1-[0-9-]+)"\s*$/.exec(stdout.trim())?.[1];
	if (!sid) throw new Error('whoami named no security identifier for this user');
	const icacls = join(system, 'icacls.exe');
	// Reset explicit ACEs first (for example `BUILTIN\Administrators:(F)` expanded from
	// `CREATOR OWNER` under elevated Administrator tokens), then strip inherited ACEs so
	// only `*<sid>:F` remains.
	await run(icacls, [path, '/reset'], {
		windowsHide: true,
	});
	await run(icacls, [path, '/inheritance:r', '/grant:r', `*${sid}:F`], {
		windowsHide: true,
	});
	// Under an elevated Administrator token (such as GitHub Actions `windows-latest`), newly
	// created files default to `BUILTIN\Administrators` as owner rather than the user's SID;
	// explicitly set the file owner so the Rust host's strict `EqualSid(owner, TokenUser)` holds.
	await run(icacls, [path, '/setowner', `*${sid}`], {
		windowsHide: true,
	});
}

/**
 * A desktop file only its owner can read (phase 6 specification, 10.3; phase 5 specification, 4.2): mode 0600, and on
 * Windows created empty and restricted before anything is written into it. Removed first, since a mode applies only
 * when a file is created.
 */
async function writeOwnerOnly(
	path: string,
	text: string,
	platform: NodeJS.Platform | undefined
): Promise<void> {
	await mkdir(dirname(resolve(path)), { recursive: true });
	await rm(path, { force: true });
	if ((platform ?? process.platform) === 'win32') {
		await writeFile(path, '', { mode: 0o600, flag: 'wx' });
		await restrictToOwner(path);
		await writeFile(path, text, { flag: 'r+' });
	} else await writeFile(path, text, { mode: 0o600, flag: 'wx' });
}

/** `frame-src` becomes the sandbox origin or `'none'`, and nothing else in the CSP changes. */
export function withFrameSrc(html: string, frameSrc: string): string | undefined {
	const meta = /<meta\b(?=[^>]*http-equiv=["']Content-Security-Policy["'])[^>]*>/i.exec(html);
	const content = meta && /\bcontent="([^"]*)"/.exec(meta[0]);
	if (!meta || !content) return undefined;
	const policy = content[1] as string;
	const directive = `frame-src ${frameSrc}`;
	const next = /(^|;\s*)frame-src\b[^;]*/.test(policy)
		? policy.replace(/(^|;\s*)frame-src\b[^;]*/, (_all, lead: string) => `${lead}${directive}`)
		: /;\s*object-src\b/.test(policy)
			? policy.replace(/;\s*object-src\b/, (found) => `; ${directive}${found}`)
			: `${policy}; ${directive}`;
	const tag = meta[0].replace(content[0], () => `content="${next}"`);
	return `${html.slice(0, meta.index)}${tag}${html.slice(meta.index + meta[0].length)}`;
}

/**
 * A different `workspace.id` from the one `--out` last held (4.2): a browser's records are under the
 * old one. A warning, since the deployer may mean it.
 */
async function workspaceChange(out: string, id: string): Promise<DeploymentFinding | undefined> {
	let previous: unknown;
	try {
		previous = JSON.parse(await readFile(join(out, 'deployment.json'), 'utf8'));
	} catch {
		return undefined;
	}
	const before = (previous as { workspace?: { id?: unknown } } | null)?.workspace?.id;
	if (typeof before !== 'string' || before === id) return undefined;
	return {
		code: 'DEPLOYMENT_WORKSPACE_CHANGED',
		key: 'workspace.id',
		message: `The workspace was \`${before}\` and is now \`${id}\`: what a browser holds under \`${before}\` is stranded there.`,
		suggestion: `Keep \`workspace.id = "${before}"\` unless you mean to start a new workspace.`,
	};
}

function pathRefusal(key: string, message: string, suggestion: string): DeploymentFinding {
	return { code: 'DEPLOYMENT_PATH_INVALID', key, message, suggestion };
}

/** Refuses paths that would destroy or serve what they must not, before anything is touched. */
async function pathRefusals(
	options: WriteDeploymentOptions,
	dist: string,
	out: string,
	deployment: DeploymentV1 | DeploymentV2 | DeploymentV3 | DeploymentV4,
	instances: readonly InstanceEffect[]
): Promise<DeploymentFinding[]> {
	const found: DeploymentFinding[] = [];
	if (!existsSync(join(dist, 'index.html'))) {
		found.push(
			pathRefusal('--dist', '`--dist` holds no `index.html`.', "Run the web host's `vite build`.")
		);
	}
	const secrets = await secretPaths(options.config, deployment);
	const packages = await Promise.all(instances.map(({ directory }) => realish(directory)));
	if (secrets.some((secret) => isWithin(secret, dist))) {
		found.push(
			pathRefusal(
				'--dist',
				'`--dist` holds the deployment file or a credential, and it is served whole.',
				'Keep them outside it.'
			)
		);
	}
	if (
		[...secrets, dist, ...packages].some((path) => isWithin(path, out)) ||
		[dist, ...packages].some((path) => isWithin(out, path))
	) {
		found.push(
			pathRefusal(
				'--out',
				'`--out` overlaps `--dist`, the deployment file, a credential or a package.',
				'Write to a directory of its own.'
			)
		);
	}
	if (!(await replaceable(out))) {
		found.push(
			pathRefusal(
				'--out',
				'`--out` holds files `loam deployment write` did not write.',
				'Choose an empty directory; an earlier deployment there is replaced.'
			)
		);
	}
	if (options.mountsOut) {
		// A link there is replaced at its own path, so both where it points and where it is must be safe.
		const direct = resolve(options.mountsOut);
		const places = [await realish(direct), join(await realish(dirname(direct)), basename(direct))];
		const served = [out, dist, ...packages];
		if (
			places.some(
				(place) => secrets.includes(place) || served.some((directory) => isWithin(place, directory))
			)
		) {
			found.push(
				pathRefusal(
					'--mounts-out',
					'`--mounts-out` is inside what is served, or would replace the deployment file or a credential.',
					'Write it outside `--out`, `--dist` and every package: it holds credentials.'
				)
			);
		}
	}
	if (options.modelsOut) {
		const direct = resolve(options.modelsOut);
		const places = [await realish(direct), join(await realish(dirname(direct)), basename(direct))];
		const served = [out, dist, ...packages];
		const mounts = options.mountsOut
			? [resolve(options.mountsOut), await realish(resolve(options.mountsOut))]
			: [];
		if (
			places.some(
				(place) =>
					secrets.includes(place) ||
					mounts.some((mount) => samePath(mount, place, options.platform)) ||
					served.some((directory) => isWithin(place, directory))
			)
		) {
			found.push(
				pathRefusal(
					'--models-out',
					'`--models-out` is inside what is served, or would replace `--mounts-out`, the deployment file or a credential.',
					'Write it beside `mounts.json`, outside `--out`, `--dist` and every package.'
				)
			);
		}
	}
	return found;
}

/** Two paths naming one file: on Windows and macOS, whose volumes ignore case by default, compared without it. */
function samePath(a: string, b: string, platform: NodeJS.Platform | undefined): boolean {
	const folds =
		(platform ?? process.platform) === 'win32' || (platform ?? process.platform) === 'darwin';
	return folds ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** What will be copied, listed first, so a problem found here costs nothing. A link leaving is skipped. */
async function planCopy(
	from: string,
	key: string
): Promise<{ copies: Array<{ source: string; path: string }>; skipped: DeploymentFinding[] }> {
	const root = await realish(from);
	const skipped: DeploymentFinding[] = [];
	const copies = await listCopy(root, {
		root,
		onEscape() {
			skipped.push({
				code: 'APP_PACKAGE_LINK_SKIPPED',
				key,
				message: 'A symbolic link here leaves it, leads to nothing or loops, and was not copied.',
				suggestion: 'Remove the link; `loam app pack` refuses one.',
			});
		},
	});
	return { copies, skipped };
}

export async function writeDeployment(
	options: WriteDeploymentOptions
): Promise<WriteDeploymentResult> {
	const analysis = await analyzeDeployment(options.config, {
		...(options.sandboxOrigin === undefined ? {} : { sandboxOrigin: options.sandboxOrigin }),
		...(options.host === undefined ? {} : { host: options.host }),
		desktop: options.platform === undefined ? {} : { platform: options.platform },
	});
	const warnings = [...analysis.instanceRefusals, ...analysis.warnings];
	const stop = (refusals: DeploymentFinding[]): WriteDeploymentResult => ({
		ok: false,
		refusals,
		warnings,
	});
	if (analysis.refusals.length > 0 || !analysis.deployment) return stop(analysis.refusals);
	const desktop = analysis.host === 'desktop';
	const dist = await realish(options.dist);
	const out = await realish(options.out);
	const paths = await pathRefusals(options, dist, out, analysis.deployment, analysis.instances);
	if (paths.length > 0) return stop(paths);
	const checked = checkedProjection(
		projectionOf(
			analysis.deployment,
			analysis.instances,
			analysis.workspace,
			analysis.instanceRefusals,
			analysis.identity,
			analysis.host
		)
	);
	if (!checked.ok) return stop(checked.refusals);
	const { projection } = checked;
	const changed = await workspaceChange(out, projection.workspace.id);
	if (changed) warnings.push(changed);
	// A model provider needs the Rust host's `models.json`, which only the desktop's host reads (4.2).
	if (analysis.models.length > 0 && !options.modelsOut) {
		return stop([
			pathRefusal(
				'--models-out',
				'A desktop copilot with a provider but `test` needs `--models-out`: the Rust host reads its providers there.',
				'Add `--models-out <app data>/models.json`, beside `--mounts-out`.'
			),
		]);
	}
	if (options.modelsOut && !desktop) {
		return stop([
			pathRefusal(
				'--models-out',
				'Only the desktop has a host that reads `models.json`.',
				'Drop `--models-out`, or write the deployment with `--host desktop`.'
			),
		]);
	}
	// The sandbox origin frames a view, a mounted instance's `ui://` view where the deployer let it render one
	// (`views = true`, phase 5 specification, 9.3; D169), and the copilot's runtime (3.2): a deployment that lists a
	// provider names it, since `'none'` would refuse the frame.
	const anyView =
		analysis.instances.some(({ rawKind }) => rawKind === 'view') ||
		projection.apps.some((app) => (app as { views?: unknown }).views === true);
	const frameSrc =
		(anyView || projection.copilot !== undefined) && projection.sandbox_origin
			? projection.sandbox_origin
			: "'none'";
	const source = await readFile(join(dist, 'index.html'), 'utf8');
	const connected = desktop ? withDesktopConnectSrc(source) : source;
	if (connected === undefined) {
		return stop([
			pathRefusal(
				'--dist',
				"`--dist`'s `index.html` has no `connect-src 'self'` for the desktop's IPC sources.",
				"Run the web host's `vite build`."
			),
		]);
	}
	const framed = withFrameSrc(connected, frameSrc);
	if (framed === undefined) {
		return stop([
			pathRefusal(
				'--dist',
				"`--dist`'s `index.html` has no Content-Security-Policy to set `frame-src` in.",
				"Run the web host's `vite build`."
			),
		]);
	}

	const page = withBasePath(framed, analysis.basePath ?? '/');

	const host = await planCopy(dist, '--dist');
	const packages = await Promise.all(
		analysis.instances
			.filter(({ packaged }) => packaged)
			.map(async ({ id, directory }) => ({
				id,
				...(await planCopy(directory, appKey(id, '/package'))),
			}))
	);
	warnings.push(...host.skipped, ...packages.flatMap(({ skipped }) => skipped));

	await rm(out, { recursive: true, force: true });
	await mkdir(out, { recursive: true });
	await copyListed(host.copies, out);
	for (const { id, copies } of packages) await copyListed(copies, join(out, 'apps', id));
	await writeFile(join(out, 'deployment.json'), `${JSON.stringify(projection, null, '\t')}\n`);
	await writeFile(join(out, 'index.html'), page);
	// For a static host that answers a missing path with `404.html` and nothing else (6.2).
	await writeFile(join(out, '404.html'), page);
	await writeFile(join(out, OUTPUT_MARKER), 'Written by loam deployment write.\n');
	if (options.mountsOut) {
		await mkdir(dirname(resolve(options.mountsOut)), { recursive: true });
		// Removed first, since a mode applies only when a file is created.
		await rm(options.mountsOut, { force: true });
		// A desktop deployment adds its `stdio` entries (10.4); every other kind has none.
		const mounts: Array<MountAccess | StdioMountAccess> = [
			...analysis.mounts,
			...analysis.stdioMounts,
		];
		// And the desktop's inbound switch (10.8, D137): on unless `[host] inbound = false`, read by the Rust host alone.
		const inbound =
			analysis.deployment?.deployment_version === 4
				? analysis.deployment.host?.inbound !== false
				: true;
		const text = `${JSON.stringify(desktop ? { mounts, inbound } : { mounts }, null, '\t')}\n`;
		if (desktop) await writeOwnerOnly(options.mountsOut, text, options.platform);
		else await writeFile(options.mountsOut, text, { mode: 0o600, flag: 'wx' });
	}
	if (options.modelsOut) {
		// Each provider's kind, model, endpoint and key reference, never a key (4.2).
		const models: ModelAccess[] = analysis.models;
		await writeOwnerOnly(
			options.modelsOut,
			`${JSON.stringify({ providers: models }, null, '\t')}\n`,
			options.platform
		);
	}
	return {
		ok: true,
		out,
		projection,
		mounts: analysis.mounts,
		warnings,
		notices: analysis.notices,
	};
}
