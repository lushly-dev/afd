/**
 * @fileoverview The join and recovery pages (phase 3 specification, 5.6, 5.7 and 14), in the `account` chunk: top-level
 * pages over the provider alone, with no kernel. One heading, one primary action, the link's expiry in words; with a
 * session present the page stops and says "Sign out first".
 */

import {
	AccountElement,
	type Answer,
	button,
	dateText,
	defineOnce,
	el,
	ROLE_NAMES,
} from './account-parts.js';

/** The join or recovery page's element: its styles, and a shadow root the page is built in. */
export class LoamLinkPage extends AccountElement {
	static override extra =
		`:host{padding:var(--space-layout-md);background:var(--color-surface-page);min-block-size:100dvh;}.section{margin-inline:auto;}`;
}
const LINK_PAGE = 'loam-link-page';

/** What a join or recovery page asks of the provider (5.6, 5.7): given by the host, which holds its client. */
export interface LinkProviderV1 {
	checkJoin(
		invitation: string,
		token: string
	): Promise<
		Answer<{
			organization: { name: string };
			role: string;
			email: string;
			expiresAt: string;
			password: boolean;
		}>
	>;
	checkRecover(token: string): Promise<Answer<{ expiresAt: string; password: boolean }>>;
	/** The single sign-on ceremony's return (5.7). */
	completeOidc(): Promise<Answer>;
	/** Register a passkey: with a `join:`/`recover:` context, signing in; with none, for the session's person. */
	registerPasskey(context?: string): Promise<Answer>;
	/** The name other members will see, given before a join's passkey (5.6). */
	setName(invitation: string, token: string, name: string): Promise<Answer>;
	setPassword(kind: 'join' | 'recover', fields: Record<string, string>): Promise<Answer>;
	signOut(): Promise<void>;
}

export interface LinkPageOptions {
	themeCss: string;
	/** The deployment's root: where "Open Loam" goes. */
	base: string;
	/** `location.search`'s parameters. */
	query: URLSearchParams;
	kind: 'join' | 'recover';
	provider: LinkProviderV1;
}

/**
 * The join or recovery page (5.6, 5.7, 14): one heading, one primary action, the link's expiry in words. With a
 * session present it stops and says "Sign out first"; a join for an email that has an account says to sign in and
 * accept the invitation there.
 */
export async function mountLinkPage(target: HTMLElement, options: LinkPageOptions): Promise<void> {
	// The theme, as the shell's notice applies it, then the page's own element and styles.
	const theme = new CSSStyleSheet();
	theme.replaceSync(options.themeCss);
	document.adoptedStyleSheets = [...document.adoptedStyleSheets, theme];
	defineOnce(LINK_PAGE, LoamLinkPage);
	const host = document.createElement(LINK_PAGE);
	target.replaceChildren(host);
	const root = host.shadowRoot as ShadowRoot;
	const status = el('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
	const heading = el('h1', { tabindex: '-1' });
	const body = el('div', { class: 'section' });
	const page = el(
		'main',
		{ class: 'section', 'aria-labelledby': 'link-heading' },
		heading,
		body,
		status
	);
	heading.id = 'link-heading';
	root.append(page);
	const home = () => el('p', {}, el('a', { href: options.base }, 'Open Loam'));
	const words = (answer: Answer) =>
		[answer.error?.message ?? 'That did not work', answer.error?.suggestion]
			.filter(Boolean)
			.join('. ');
	const stop = (title: string, text: string, ...more: Node[]) => {
		heading.textContent = title;
		body.replaceChildren(el('p', {}, text), ...more);
		heading.focus();
	};
	const signOutFirst = () =>
		stop(
			'Sign out first',
			'This link creates a sign-in for its own account, so no one may be signed in in this browser.',
			el(
				'div',
				{ class: 'row' },
				button(
					'Sign out',
					async () => {
						await options.provider.signOut();
						// Again with the link as it was read: the address bar no longer holds it (N3).
						await mountLinkPage(target, options);
					},
					{ class: 'action primary' }
				)
			)
		);
	const done = (title: string, text: string) => stop(title, text, home());
	const { query, provider } = options;

	if (options.kind === 'recover' && query.get('via') === 'oidc') {
		// The single sign-on ceremony's return (5.7): complete it, then register a passkey with that session.
		const completed = await provider.completeOidc();
		if (!completed.success)
			return stop('Your access could not be restored', words(completed), home());
		heading.textContent = 'Create a new passkey';
		body.replaceChildren(
			el(
				'p',
				{},
				'Your single sign-on confirmed it is you, and your other sessions are signed out. Create a passkey to sign in from now on.'
			),
			el(
				'div',
				{ class: 'row' },
				button(
					'Create a passkey',
					async () => {
						const made = await provider.registerPasskey();
						if (made.success) done('Your access is restored', 'Your new passkey is ready.');
						else status.textContent = words(made);
					},
					{ class: 'action primary' }
				)
			)
		);
		heading.focus();
		return;
	}

	const token = query.get('token') ?? '';
	const invitation = query.get('invitation') ?? '';
	// The token leaves the address bar and the history entry once read (the review of step 4's N3).
	if (token) history.replaceState(null, '', location.pathname);
	const checked =
		options.kind === 'join'
			? await provider.checkJoin(invitation, token)
			: await provider.checkRecover(token);
	if (!checked.success || !checked.data) {
		const code = checked.error?.code;
		if (code === 'SIGN_OUT_FIRST') return signOutFirst();
		if (code === 'ACCOUNT_EXISTS') {
			return stop(
				'You already have an account',
				'Sign in, then accept the invitation in your account.',
				home()
			);
		}
		return stop('This link does not work', words(checked), home());
	}
	const data = checked.data as {
		organization?: { name: string };
		role?: string;
		email?: string;
		expiresAt: string;
		password: boolean;
	};
	const expires = el('p', {}, `This link expires at ${dateText(data.expiresAt)}.`);
	const context = options.kind === 'join' ? `join:${invitation}.${token}` : `recover:${token}`;
	// The name other members will see (5.6; I1): required at join, nothing taken from the email.
	const name = el('input', {
		id: 'link-name',
		autocomplete: 'name',
		maxlength: '80',
		required: '',
	}) as HTMLInputElement;
	const named = async (): Promise<boolean> => {
		if (options.kind !== 'join') return true;
		if (name.value.trim() === '') {
			status.textContent = 'Give the name other members will see, then create your passkey.';
			name.focus();
			return false;
		}
		const set = await provider.setName(invitation, token, name.value.trim());
		if (!set.success) status.textContent = words(set);
		return set.success;
	};
	const passkey = button(
		'Create a passkey',
		async () => {
			if (!(await named())) return;
			const made = await provider.registerPasskey(context);
			if (made.success) {
				return options.kind === 'join'
					? done(
							`Welcome to ${data.organization?.name ?? 'the workspace'}`,
							'Your account and passkey are ready.'
						)
					: done(
							'Your access is restored',
							'Your new passkey is ready, and your other sessions are signed out.'
						);
			}
			if (made.error?.code === 'SIGN_OUT_FIRST') return signOutFirst();
			status.textContent = words(made);
		},
		{ class: 'action primary' }
	);
	const parts: Node[] = [];
	if (options.kind === 'join') {
		heading.textContent = `Join ${data.organization?.name ?? ''}`;
		parts.push(
			el(
				'p',
				{},
				`You are invited as ${ROLE_NAMES[data.role ?? ''] ?? data.role} with ${data.email}.`
			),
			el('label', { for: 'link-name' }, 'Your name, as other members will see it', name)
		);
	} else {
		heading.textContent = 'Restore your access';
		parts.push(
			el(
				'p',
				{},
				'Create a new passkey for your account. Every other session of yours is signed out.'
			)
		);
	}
	parts.push(expires, el('div', { class: 'row' }, passkey));
	if (data.password) {
		const field = el('input', {
			id: 'link-password',
			type: 'password',
			autocomplete: 'new-password',
			minlength: '8',
			maxlength: '128',
			required: '',
		}) as HTMLInputElement;
		const form = el(
			'form',
			{ 'aria-label': options.kind === 'join' ? 'Set a password instead' : 'Set a new password' },
			el(
				'label',
				{ for: 'link-password' },
				options.kind === 'join' ? 'Or set a password' : 'Or set a new password',
				field
			),
			el(
				'button',
				{ type: 'submit', class: 'action' },
				options.kind === 'join' ? 'Join with a password' : 'Set a new password'
			)
		);
		form.addEventListener('submit', async (event) => {
			event.preventDefault();
			const fields: Record<string, string> =
				options.kind === 'join'
					? { invitation, token, password: field.value, name: name.value.trim() }
					: { token, password: field.value };
			const set = await provider.setPassword(options.kind, fields);
			if (set.success)
				done(options.kind === 'join' ? 'Welcome' : 'Your access is restored', 'You are signed in.');
			else status.textContent = words(set);
		});
		parts.push(form);
	}
	body.replaceChildren(...parts);
	(options.kind === 'join' ? name : passkey).focus();
}
