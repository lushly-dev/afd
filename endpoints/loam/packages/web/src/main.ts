/**
 * The browser host's entry (phase 0 specification, step 7): the kernel over IndexedDB, the chrome
 * with Loam's theme, and the "open in another tab" notice when the journal's writer lock is held. Every
 * deployment paints the same first frame: `readBoot` reads `deployment.json` with no validator, and the
 * reader and the ports load in stage B, after it (phase 2 specification, 2.2).
 */

import { mountShell, parseRoute, renderNotice, type ShellIdentity } from '@lushly-dev/loam-chrome';
import type { AppsLoad } from '@lushly-dev/loam-kernel';
import { readBoot } from '@lushly-dev/loam-manifest';
import themeCss from '@lushly-dev/loam-theme/loam-theme.css?inline';
// The theme's typefaces (D159), served with the shell: a stylesheet of `@font-face` rules the build
// links from `index.html`, and the woff2 files beside it, since Loam loads nothing from another origin.
import '@lushly-dev/loam-theme/loam-fonts.css';
import { lazyCopilot } from './copilot-lazy.js';
import { captureDesktopInvoke } from './desktop-ipc.js';
import { createHostKernel, mediaEnvironment, OTHER_TAB_NOTICE } from './host.js';
import { type ProviderIdentity, probeIdentity } from './identity.js';
import { applyPageAppearance } from './page-appearance.js';
import { createSessionRefresh } from './session-refresh.js';

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

/** Captured once at boot before stage B loads any native app (defense in depth, not realm isolation: D54). */
const desktopInvoke = captureDesktopInvoke(window);
// The desktop app's webview, where the chrome keeps D34's scoped-registry polyfill for WebKitGTK (D174, amended).
if (desktopInvoke) document.documentElement.dataset.loamWebview = 'desktop';

/**
 * Phase 3's 4.3 refresh, its provider given once probed: the hosted relay's own `401` runs it, as the trust-record
 * transport's does (phase 6 specification, 8.1). Never an instance's answer, which the relay does not mark.
 */
const session = createSessionRefresh(base, desktopInvoke);

/** The reader and the ports, in a chunk of their own: what stage B calls. */
async function loadApps(raw: unknown): Promise<AppsLoad> {
	// Named here because this chunk has the bundler's dynamic import helper, and that one does not.
	return (await import('./deployment.js')).readOrNotice(
		raw,
		document,
		base,
		() => import('@lushly-dev/loam-chrome/view'),
		session.mountChunk
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
	// The OAuth login and consent pages (phase 3 specification, 9.4): a page of their own over the provider, as above.
	const oauth = /^~\/oauth\/(login|consent)$/.exec(
		new URL(location.href).pathname.slice(new URL(base).pathname.length)
	)?.[1];
	if (oauth) {
		const authBase =
			identity?.mode === 'provider' && AUTH_PATH.test(String(identity.path))
				? new URL(identity.path, base).href
				: undefined;
		if (!authBase) {
			await renderNotice(document.body, {
				themeCss,
				heading: 'This page does not work here',
				message: 'This deployment has no sign-in provider, so no app can connect to it.',
			});
			return;
		}
		const [{ mountOAuthPage }, { createOAuthProvider }] = await Promise.all([
			import('@lushly-dev/loam-chrome/account'),
			import('./auth.js'),
		]);
		// The person's appearance where this profile knows it, else the system's, as the shell would show (R9).
		await applyPageAppearance(document, window);
		await mountOAuthPage(document.body, {
			themeCss,
			base,
			query: new URL(location.href).searchParams,
			kind: oauth as 'login' | 'consent',
			provider: createOAuthProvider(authBase),
			methods:
				identity?.mode === 'provider' && Array.isArray(identity.methods)
					? identity.methods.map(String)
					: ['passkey'],
		});
		document.documentElement.dataset.loamHost = 'oauth';
		return;
	}
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
		await applyPageAppearance(document, window);
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
	// The copilot, when the deployment names a provider (phase 5 specification, 3.2 and 4.1): its chunk, frame and
	// transport load the first time a turn starts or the panel opens, never in first paint. A provider but `test`
	// reaches a model through the desktop's Rust host, the only host that holds a key until milestone C.
	const named = read.copilot;
	const copilot = named
		? lazyCopilot(named.projection, async () => {
				const { createHostTransport, createWebCopilot } = await import('./copilot.js');
				return createWebCopilot({
					document,
					sandboxOrigin: named.sandboxOrigin,
					transport: createHostTransport(window, undefined, desktopInvoke),
				}).host;
			})
		: undefined;
	// The page's anchors for `popover-open` (phase 4 specification, 6.3): the shell answers once it renders.
	const overlayAnchors = {};
	// A hosted `provider` deployment runs its trust-record commands on the server (phase 6 specification, 6.1): the
	// transport's port, its mapping loaded on the first routed call. Stage B's reader checks the projection's `host`.
	const hosted = (raw as { host?: { kind?: unknown } } | undefined)?.host?.kind === 'hosted';
	if (provider) session.use(provider);
	const identityPorts = provider && session.identityPorts(provider.ports, hosted);
	let host = await createHostKernel({
		overlayAnchors,
		...(provider ? { auth: provider.adapter, membership: provider.membership, identityPorts } : {}),
		environment: mediaEnvironment(window),
		boot: read,
		appsLoader: () => loadApps(raw),
		// Any shape at this workspace names the scope: a project's slug, or `null` for workspace level, so
		// `/personal/hello` paints the workspace whatever `loam.scope` records (6.3, as amended by step 5).
		...(workspace === read.workspace.id ? { initialScope: { project: project ?? null } } : {}),
		...(copilot ? { copilot: copilot.options } : {}),
	});
	if (host.kind === 'locked') {
		const notice = await renderNotice(document.body, { themeCss, ...OTHER_TAB_NOTICE });
		document.documentElement.dataset.loamHost = 'locked';
		try {
			// Stay on the notice with a blocking Web Lock wait, then boot as soon as the predecessor or other tab lets go (#1634).
			while (host.kind === 'locked') host = await host.waitForLock();
		} finally {
			notice.remove();
		}
	}
	await mountShell(document.body, {
		kernel: host.kernel,
		overlayAnchors,
		journal: host.journal,
		themeCss,
		listsApps: read.apps.length > 0,
		base,
		...(shown ? { identity: shown } : {}),
		// With no provider named, the shell's panel part keeps its empty state.
		...(copilot ? { copilot: { host: copilot.panel } } : {}),
	});
	// The desktop's inbound endpoint (phase 6 specification, 10.8): its dispatcher in a chunk of its own, once stage B
	// has loaded, and only where Tauri's IPC is in the page; a browser never loads it.
	if (desktopInvoke) {
		const ready = host;
		void host.kernel.appsReady
			.then(() => import('./inbound.js'))
			.then(({ startInbound }) => startInbound(window, ready, undefined, undefined, desktopInvoke))
			.catch(reportError);
	}
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
