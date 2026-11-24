/**
 * @fileoverview The OAuth login and consent pages (phase 3 specification, 9.4 and 14; step 7), in the `account` chunk:
 * top-level pages over the provider alone, with no kernel, at `<base>~/oauth/login` and `<base>~/oauth/consent`, which
 * the hosted lane serves with `frame-ancestors 'none'` and `form-action 'self'`. Connecting an app creates an agent the
 * person sponsors (D98), so the consent page says exactly what it may do and who said so.
 *
 * - **Login:** the sign-in dialog's methods, passkey first; once signed in, the page goes back to the provider's own
 *   `/oauth2/authorize` with the request it was sent with, which checks it again and continues to the consent page or
 *   the client. It never follows a redirect target of its own.
 * - **Consent:** the client id's host in bold (or "registered by the deployer"), the client's name marked "name given by
 *   the app", each scope in words, the redirect's host and the loopback warning, the sponsor sentence, and with
 *   `loam:write` the autonomy sentence. Approve and Deny post `/oauth2/consent` and go to the provider's answer.
 */

import { AccountElement, type Answer, button, defineOnce, el } from './account-parts.js';

/** What the OAuth pages ask of the provider: given by the host, which holds its client. */
export interface OAuthProviderV1 {
	/** The client's public fields, for a signed-in person. */
	client(clientId: string): Promise<Answer<{ client_name?: string; client_id: string }>>;
	/** The bound organization's name, for the scopes' words, and whether someone is signed in. */
	whoami(): Promise<{ signedIn: boolean; organization: string | null }>;
	signInWithPasskey(): Promise<Answer>;
	signInWithPassword(email: string, password: string): Promise<Answer>;
	/**
	 * Single sign-on with one of the deployer's providers (`oidc:<id>`), returning to this page, which then resumes: it
	 * leaves the page, so it answers only when it could not start.
	 */
	signInWithProvider(provider: string, returnTo: string): Promise<Answer>;
	/** `/oauth2/consent` with the signed request: the provider's redirect, to the client or back to it. */
	consent(accept: boolean, oauthQuery: string): Promise<Answer<{ url?: string }>>;
	/** Where the provider's `/oauth2/authorize` is: the login page resumes there. */
	authorizeUrl: string;
}

export interface OAuthPageOptions {
	themeCss: string;
	/** The deployment's root: where "Open Loam" goes. */
	base: string;
	/** `location.search`'s parameters: the provider's signed authorization request. */
	query: URLSearchParams;
	kind: 'login' | 'consent';
	provider: OAuthProviderV1;
	/** The ways to sign in the deployment allows (D99). */
	methods: readonly string[];
	/** Go to a URL the provider answered: the page's own navigation, which a test may watch. */
	navigate?(url: string): void;
}

export class LoamOAuthPage extends AccountElement {
	static override extra =
		`:host{padding:var(--violet-space-layout-md);background:var(--violet-color-surface-page);min-block-size:100dvh;}.section{margin-inline:auto;}.scopes{margin:0;padding-inline-start:var(--violet-space-layout-md);}`;
}
const OAUTH_PAGE = 'loam-oauth-page';

/**
 * What the login page leaves out when it goes back to `/oauth2/authorize`: the signature (`sig`, `exp`, `ba_*`), which
 * the provider makes again, `max_age`, which the sign-in just satisfied, and the page's own `loam_resume` mark; of
 * `prompt`, only `login` (below). Kept, they would send the person back to sign in again.
 */
const RESUME_DROPS = /^(sig|exp|ba_.*|max_age|loam_resume)$/;

/** Only a web address the provider answered: never a script, data or other scheme a page could be sent to. */
const webAddress = (url: string): boolean => {
	try {
		const { protocol } = new URL(url, location.href);
		return protocol === 'https:' || protocol === 'http:';
	} catch {
		return false;
	}
};

/** Each scope in words (9.4), with the organization's name. */
export function scopeWords(scope: string, organization: string): string {
	if (scope === 'loam:read') return `Read what you can read in ${organization}`;
	if (scope === 'loam:write') return `Change what you can change in ${organization}`;
	if (scope === 'offline_access') return 'Stay connected until you disconnect it';
	return scope;
}

/** A redirect URI's host, and whether it is a loopback address: an app running on the person's own computer. */
export function redirectOf(uri: string): { host: string; loopback: boolean } {
	try {
		const url = new URL(uri);
		const hostname = url.hostname.replace(/^\[|\]$/g, '');
		return {
			host: url.host,
			loopback: hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1',
		};
	} catch {
		return { host: uri, loopback: false };
	}
}

/** The client id's host: a metadata document's URL names one; a client the deployer registered names none (9.4). */
export function clientHostOf(clientId: string): string | null {
	try {
		const url = new URL(clientId);
		return url.protocol === 'https:' ? url.host : null;
	} catch {
		return null;
	}
}

export async function mountOAuthPage(
	target: HTMLElement,
	options: OAuthPageOptions
): Promise<void> {
	const theme = new CSSStyleSheet();
	theme.replaceSync(options.themeCss);
	document.adoptedStyleSheets = [...document.adoptedStyleSheets, theme];
	defineOnce(OAUTH_PAGE, LoamOAuthPage);
	const host = document.createElement(OAUTH_PAGE);
	target.replaceChildren(host);
	const root = host.shadowRoot as ShadowRoot;
	const status = el('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
	const heading = el('h1', { tabindex: '-1', id: 'oauth-heading' });
	const body = el('div', { class: 'section' });
	root.append(
		el('main', { class: 'section', 'aria-labelledby': 'oauth-heading' }, heading, body, status)
	);
	const go = options.navigate ?? ((url: string) => location.assign(url));
	const navigate = (url: string) => {
		if (webAddress(url)) go(url);
		else status.textContent = 'The sign-in provider answered an address this page does not open';
	};
	const words = (answer: Answer) =>
		[answer.error?.message ?? 'That did not work', answer.error?.suggestion]
			.filter(Boolean)
			.join('. ');
	const { query, provider } = options;
	const signed = query.toString();

	if (options.kind === 'login') {
		heading.textContent = 'Sign in to connect an app';
		// Back to the provider's own authorize endpoint with the request as sent, less its signature: it checks the
		// request again, now with the session, and continues (9.4).
		const resume = () => {
			const request = new URLSearchParams([...query].filter(([key]) => !RESUME_DROPS.test(key)));
			// Only `login` leaves `prompt`, which the sign-in satisfied: `consent` and the rest are the client's still.
			const prompt = (request.get('prompt') ?? '')
				.split(' ')
				.filter((each) => each && each !== 'login');
			if (prompt.length > 0) request.set('prompt', prompt.join(' '));
			else request.delete('prompt');
			navigate(`${provider.authorizeUrl}?${request}`);
		};
		// Back from this page's own single sign-on, or already signed in when the client asked for no fresh sign-in: resume
		// at once. A client's `prompt=login` with a session already here asks for a sign-in now, which the page offers.
		// `max_age` asks for a sign-in as recent as it says, which a session already here may not be.
		const fresh = (query.get('prompt') ?? '').split(' ').includes('login') || query.has('max_age');
		if ((await provider.whoami()).signedIn && (!fresh || query.get('loam_resume') === '1'))
			return resume();
		const after = async (answer: Answer) => {
			if (answer.success) return resume();
			status.textContent = words(answer);
		};
		const children: Node[] = [
			el('p', {}, 'Sign in as yourself. You will then see what the app asks for, and choose.'),
		];
		if (options.methods.includes('passkey')) {
			children.push(
				el(
					'div',
					{ class: 'row' },
					button('Sign in with a passkey', async () => after(await provider.signInWithPasskey()), {
						class: 'action primary',
					})
				)
			);
		}
		// Each of the deployer's single sign-on providers (D99), after the passkey: they return to this page.
		for (const method of options.methods) {
			if (!method.startsWith('oidc:')) continue;
			const id = method.slice('oidc:'.length);
			children.push(
				el(
					'div',
					{ class: 'row' },
					button(`Sign in with ${id}`, async () => {
						const back = new URL(location.href);
						back.searchParams.set('loam_resume', '1');
						const started = await provider.signInWithProvider(id, back.href);
						if (!started.success) status.textContent = words(started);
					})
				)
			);
		}
		if (options.methods.includes('password')) {
			const email = el('input', {
				type: 'email',
				name: 'email',
				autocomplete: 'username webauthn',
				required: '',
			}) as HTMLInputElement;
			const password = el('input', {
				type: 'password',
				name: 'password',
				autocomplete: 'current-password',
				required: '',
			}) as HTMLInputElement;
			const form = el(
				'form',
				{ class: 'section' },
				el('label', {}, 'Email', email),
				el('label', {}, 'Password', password),
				el('div', { class: 'row' }, el('button', { type: 'submit', class: 'action' }, 'Sign in'))
			) as HTMLFormElement;
			form.addEventListener('submit', async (event) => {
				event.preventDefault();
				await after(await provider.signInWithPassword(email.value, password.value));
			});
			children.push(form);
		}
		body.replaceChildren(...children);
		heading.focus();
		return;
	}

	// The consent page (9.4).
	const clientId = query.get('client_id') ?? '';
	const scopes = (query.get('scope') ?? '').split(' ').filter(Boolean);
	const redirect = redirectOf(query.get('redirect_uri') ?? '');
	const [who, client] = await Promise.all([provider.whoami(), provider.client(clientId)]);
	if (!who.signedIn) {
		heading.textContent = 'Sign in first';
		body.replaceChildren(el('p', {}, 'Open the app again and sign in when it asks.'));
		heading.focus();
		return;
	}
	const organization = who.organization ?? 'this workspace';
	const name = client.data?.client_name?.trim() || 'An app';
	const clientHost = clientHostOf(clientId);
	heading.textContent = `Connect ${name} to ${organization}?`;
	const answer = async (accept: boolean) => {
		const answered = await provider.consent(accept, signed);
		if (answered.success && answered.data?.url) return navigate(answered.data.url);
		status.textContent = words(answered);
	};
	body.replaceChildren(
		el(
			'p',
			{},
			'From ',
			clientHost
				? el('strong', {}, clientHost)
				: el('strong', {}, 'an app registered by the deployer'),
			': ',
			el('span', { class: 'client-name' }, name),
			' (name given by the app)'
		),
		el('p', {}, 'It asks to:'),
		el(
			'ul',
			{ class: 'scopes' },
			...scopes.map((scope) => el('li', {}, scopeWords(scope, organization)))
		),
		el('p', {}, 'After you choose, you return to ', el('strong', {}, redirect.host), '.'),
		...(redirect.loopback
			? [
					el(
						'p',
						{ class: 'warning', role: 'note' },
						'This app runs on your own computer. Connect it only if you started it yourself.'
					),
				]
			: []),
		el(
			'p',
			{},
			'Connecting it creates an agent you sponsor, which owners can see. You or an owner can disconnect it at any time.'
		),
		...(scopes.includes('loam:write')
			? [
					el(
						'p',
						{ class: 'warning', role: 'note' },
						`This agent can make any change you can make in ${organization}, without asking you first.`
					),
				]
			: []),
		el(
			'div',
			{ class: 'row' },
			button('Connect', () => answer(true), { class: 'action primary' }),
			button('Deny', () => answer(false), { class: 'action' })
		)
	);
	heading.focus();
}
