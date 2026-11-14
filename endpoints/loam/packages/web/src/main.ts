/**
 * The browser host's entry (phase 0 specification, step 7): the kernel over IndexedDB, the chrome
 * with Loam's theme, and the "open in another tab" notice when the journal's writer lock is held. Every
 * deployment paints the same first frame: `readBoot` reads `deployment.json` with no validator, and the
 * reader and the ports load in stage B, after it (phase 2 specification, 2.2).
 */

import { mountShell, parseRoute, renderNotice, type ShellIdentity } from '@lushly-dev/loam-chrome';
import type { AppsLoadV2 } from '@lushly-dev/loam-kernel';
import { readBoot } from '@lushly-dev/loam-manifest';
import themeCss from '@lushly-dev/loam-theme/loam-theme.css?inline';
import { createHostKernel, mediaEnvironment, OTHER_TAB_NOTICE } from './host.js';
import { type ProviderIdentity, probeIdentity } from './identity.js';

const CANNOT_START = 'Loam cannot start';

/**
 * `identity.path`'s pattern, as `projection.v3.json` has it: stage A reads `identity` unchecked (phase 3
 * specification, 13), so the probe is sent only to a path that holds it, under the deployment's root.
 */
const AUTH_PATH = /^(?!\.\.?(\/|$))(?!.*\/\.\.?(\/|$))[A-Za-z0-9._~-]+(\/[A-Za-z0-9._~-]+)*$/;

/**
 * The deployment's root: the entry is always `assets/index-*.js` under it, so this holds at any path the
 * shell is served at, under any `base_path`. Nothing reads the document's base URL, which a deep link moves and
 * `base-uri 'none'` forbids setting (phase 2 specification, 6.2).
 */
const base = new URL('../', /* @vite-ignore */ import.meta.url).href;

/** The reader and the ports, in a chunk of their own: what stage B calls. */
async function loadApps(raw: unknown): Promise<AppsLoadV2> {
	// Named here because this chunk has the bundler's dynamic import helper, and that one does not.
	return (await import('./deployment.js')).readOrNotice(
		raw,
		document,
		base,
		() => import('@lushly-dev/loam-chrome/view'),
		() => import('./mount.js')
	);
}

/**
 * Why a `deployment.json` `readBoot` could not read is refused, from the reader itself, which refuses
 * whatever `readBoot` does: the version, the list and the workspace's pattern.
 */
async function refusalOf(raw: unknown): Promise<string> {
	return ((await loadApps(raw)) as { refused: string }).refused;
}

async function boot(): Promise<void> {
	const raw: unknown = await fetch(new URL('deployment.json', base))
		.then((response) => response.json())
		.catch(() => undefined);
	const read = readBoot(raw);
	if (read === undefined) {
		// Nothing Loam wrote: the reader loads at once to say why (9.4).
		await renderNotice(document.body, {
			themeCss,
			heading: CANNOT_START,
			message: await refusalOf(raw),
		});
		document.documentElement.dataset.loamHost = 'failed';
		return;
	}
	const { identity } = read;
	// A join or recovery link (phase 3 specification, 5.6, 5.7): a page of its own over the provider, with no kernel.
	const link = /^~\/(join|recover)$/.exec(
		new URL(location.href).pathname.slice(new URL(base).pathname.length)
	)?.[1];
	if (link) {
		const authBase =
			identity?.mode === 'provider' && AUTH_PATH.test(String(identity.path))
				? new URL(identity.path, base).href
				: undefined;
		if (!authBase) {
			await renderNotice(document.body, {
				themeCss,
				heading: 'This link does not work here',
				message:
					'This deployment has no sign-in provider, so it has no invitations or recovery links.',
			});
			return;
		}
		const [{ mountLinkPage }, { createLinkProvider }] = await Promise.all([
			import('@lushly-dev/loam-chrome/account'),
			import('./auth.js'),
		]);
		await mountLinkPage(document.body, {
			themeCss,
			base,
			query: new URL(location.href).searchParams,
			kind: link as 'join' | 'recover',
			provider: createLinkProvider(authBase),
		});
		document.documentElement.dataset.loamHost = 'link';
		return;
	}
	// A `provider` deployment's session probe, before stage A chooses a scope for its person (phase 3
	// specification, 4.2); the `auth` chunk loads in stage B. `local` sends no probe.
	let provider: ProviderIdentity | undefined;
	let shown: ShellIdentity | undefined;
	if (identity?.mode === 'provider') {
		// A path off the pattern sends nothing: signed out, and stage B refuses the projection (fail closed).
		const authBase = AUTH_PATH.test(String(identity.path))
			? new URL(identity.path, base).href
			: undefined;
		const held = await probeIdentity(
			authBase && `${authBase}/loam/whoami`,
			async (current, from) => {
				if (!authBase) throw new Error('This deployment names no provider path Loam can use');
				const { createProviderAdapter } = await import('./auth.js');
				return createProviderAdapter(authBase, current(), from);
			}
		);
		provider = held;
		shown = {
			organization: String(identity.organization ?? ''),
			methods: Array.isArray(identity.methods) ? identity.methods.map(String) : ['passkey'],
			standing() {
				const last = held.last();
				return {
					member: last.membership !== null,
					...(last.warning ? { warning: last.warning } : {}),
				};
			},
			// Recovery (5.7), from the `auth` chunk, which the sign-in dialog's "Can't sign in?" loads.
			...(authBase
				? {
						recover: async (email: string) =>
							(await import('./auth.js')).requestRecovery(authBase, email),
						recoverWith: async (provider: string) =>
							(await import('./auth.js')).recoverWithProvider(authBase, provider),
					}
				: {}),
		};
	}
	// The URL's project, by slug, for the first frame: the kernel enters it only if the actor may (6.3).
	const { workspace, project } = parseRoute(location.href, base) as Partial<Record<string, string>>;
	const host = await createHostKernel({
		...(provider
			? { auth: provider.adapter, membership: provider.membership, identityPorts: provider.ports }
			: {}),
		environment: mediaEnvironment(window),
		boot: read,
		appsLoader: () => loadApps(raw),
		// Any shape at this workspace names the scope: a project's slug, or `null` for workspace level, so
		// `/personal/hello` paints the workspace whatever `loam.scope` records (6.3, as amended by step 5).
		...(workspace === read.workspace.id ? { initialScope: { project: project ?? null } } : {}),
	});
	if (host.kind === 'locked') {
		await renderNotice(document.body, { themeCss, ...OTHER_TAB_NOTICE });
		document.documentElement.dataset.loamHost = 'locked';
		return;
	}
	await mountShell(document.body, {
		kernel: host.kernel,
		journal: host.journal,
		themeCss,
		listsApps: read.apps.length > 0,
		base,
		...(shown ? { identity: shown } : {}),
	});
	// Stage B loads Better Auth's client in `provider` mode only (4.2).
	if (provider)
		void host.kernel.appsReady
			.then(() => (provider as ProviderIdentity).adapter.load())
			.catch(reportError);
	document.documentElement.dataset.loamHost = 'web';
}

boot().catch(async (error: unknown) => {
	// A store that cannot open (blocked, out of quota, a newer version) leaves no blank page.
	reportError(error);
	await renderNotice(document.body, {
		themeCss,
		heading: CANNOT_START,
		message: `Its local stores could not open: ${error instanceof Error ? error.message : String(error)}. Reload to try again.`,
	});
	document.documentElement.dataset.loamHost = 'failed';
});
