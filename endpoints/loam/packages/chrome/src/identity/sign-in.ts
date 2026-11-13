/**
 * @fileoverview `loam-sign-in-dialog`, the `sign-in` chunk (phase 3 specification, 5.2 and 14), loaded when "Sign in"
 * is pressed in a `provider` deployment: "Sign in with a passkey" first, where focus starts; the email field with
 * `autocomplete="username webauthn"`, whose autofill ceremony starts as the dialog opens when the browser can offer
 * it; then each other way in the deployment allows. Every way in is `auth-sign-in`, so each is journaled, with no
 * credential. A failed or cancelled ceremony is announced in the dialog's live region and focus stays; Escape closes
 * it and returns focus to the button that opened it. The browser's own passkey prompt is outside the page.
 */

import { css, FASTElement, html, observable, when } from '@lushly-dev/fast-element';
import type { LoamKernelV3 } from '@lushly-dev/loam-kernel';
import { actionButton } from '../apps/action-styles.js';
import { deepActiveElement } from '../elements/events.js';
import { trapTab } from '../elements/focus.js';
import type { LoamShell } from '../elements/shell.js';

interface Answer {
	success: boolean;
	data?: { status?: string } | null;
	error?: { code?: string; message?: string; suggestion?: string };
}

const template = html<LoamSignInDialog>`
	<dialog
		aria-labelledby="sign-in-title"
		@cancel="${(x, c) => x.cancel(c.event)}"
		@close="${(x) => x.closed()}"
		@keydown="${(x, c) => x.keydown(c.event as KeyboardEvent)}"
	>
		<h2 id="sign-in-title">Sign in to ${(x) => x.organization}</h2>
		<button
			class="action primary passkey"
			type="button"
			aria-disabled="${(x) => (x.busy ? 'true' : null)}"
			@click="${(x) => x.passkey()}"
		>
			Sign in with a passkey
		</button>
		<form @submit="${(x, c) => x.password(c.event)}">
			<label for="email">Email</label>
			<input
				id="email"
				name="email"
				type="email"
				autocomplete="username webauthn"
				spellcheck="false"
			/>
			${when(
				(x) => x.methods.includes('password'),
				html<LoamSignInDialog>`
					<label for="password">Password</label>
					<input
						id="password"
						name="password"
						type="password"
						autocomplete="current-password"
					/>
					<button class="action" type="submit" aria-disabled="${(x) => (x.busy ? 'true' : null)}">
						Sign in with a password
					</button>
				`
			)}
		</form>
		<div class="oidc"></div>
		<p class="message" role="status" aria-live="polite">${(x) => x.message}</p>
		<div class="buttons">
			<button class="action cancel" type="button" @click="${(x) => x.dialog.close()}">Cancel</button>
		</div>
	</dialog>
`;

const styles = [
	actionButton,
	css`
		:host {
			display: contents;
		}
		dialog {
			box-sizing: border-box;
			inline-size: min(92vw, 28rem);
			max-block-size: 80dvh;
			padding: var(--space-layout-md);
			border: 0;
			border-radius: var(--radius-lg);
			background: var(--color-surface-floating);
			box-shadow: var(--shadow-floating);
			color: var(--color-text-primary);
			font-family: 'Montserrat', 'Segoe UI', sans-serif;
		}
		dialog[open] {
			display: grid;
			gap: var(--space-stack-md);
		}
		dialog::backdrop {
			background: color-mix(in srgb, var(--color-surface-page) 60%, transparent);
		}
		h2 {
			margin: 0;
			font-size: var(--type-title-sm-size);
			line-height: var(--type-title-sm-line);
			font-weight: var(--type-title-sm-weight);
		}
		form {
			display: grid;
			gap: var(--space-stack-sm);
		}
		label {
			font-size: var(--type-label-sm-size);
			line-height: var(--type-label-sm-line);
			font-weight: var(--type-label-sm-weight);
		}
		input {
			box-sizing: border-box;
			min-block-size: var(--size-target-natural);
			padding-inline: var(--size-space-md);
			border: 1px solid var(--color-border-strong);
			border-radius: var(--radius-md);
			background: var(--color-surface-page);
			color: var(--color-text-primary);
			font: inherit;
			font-size: var(--type-body-md-size);
		}
		input:focus-visible {
			outline: var(--shell-size-focus) solid var(--color-focus-ring);
			outline-offset: var(--size-space-xs);
		}
		.oidc {
			display: grid;
			gap: var(--space-stack-sm);
		}
		.oidc:empty {
			display: none;
		}
		.message {
			margin: 0;
			color: var(--color-text-secondary);
			font-size: var(--type-body-md-size);
			line-height: var(--type-body-md-line);
		}
		.message:empty {
			display: none;
		}
		.buttons {
			display: flex;
			justify-content: flex-end;
		}
		@media (forced-colors: active) {
			dialog {
				border: 1px solid CanvasText;
			}
			input {
				border-color: CanvasText;
			}
		}
	`,
];

export class LoamSignInDialog extends FASTElement {
	// Read from the shadow root, not by `ref`: a lazy chunk importing `ref` would part it from first paint (13).
	get dialog(): HTMLDialogElement {
		return this.shadowRoot?.querySelector('dialog') as HTMLDialogElement;
	}
	get email(): HTMLInputElement {
		return this.shadowRoot?.querySelector('#email') as HTMLInputElement;
	}
	get secret(): HTMLInputElement | null {
		return this.shadowRoot?.querySelector('#password') ?? null;
	}
	declare message: string;
	declare busy: boolean;
	organization = '';
	methods: readonly string[] = [];
	kernel: LoamKernelV3 | null = null;
	/** Where focus returns when the dialog closes: the button that opened it. */
	opener: HTMLElement | null = null;

	constructor() {
		super();
		this.message = '';
		this.busy = false;
	}

	/**
	 * Open as a modal, focus on "Sign in with a passkey", and start the autofill ceremony where the browser has it.
	 * Each single sign-on provider the deployment allows gets its button, built here: FAST's `repeat` would cost
	 * this chunk 11 KB for a short list that never changes while the dialog is open.
	 */
	open(): void {
		this.message = '';
		const list = this.shadowRoot?.querySelector('.oidc');
		for (const method of this.methods.filter((held) => held.startsWith('oidc:'))) {
			const button = this.ownerDocument.createElement('button');
			button.type = 'button';
			button.className = 'action';
			button.textContent = `Continue with ${method.slice(5)}`;
			button.addEventListener('click', () => void this.oidc(method.slice(5)));
			list?.append(button);
		}
		this.dialog.showModal();
		this.shadowRoot?.querySelector<HTMLElement>('.passkey')?.focus();
		void this.#autofill();
	}

	async #autofill(): Promise<void> {
		const conditional = (
			globalThis.PublicKeyCredential as unknown as
				| { isConditionalMediationAvailable?(): Promise<boolean> }
				| undefined
		)?.isConditionalMediationAvailable;
		if (!(await conditional?.().catch(() => false))) return;
		const answer = (await this.kernel?.call('auth-sign-in', {
			method: 'passkey',
			autoFill: true,
		})) as Answer | undefined;
		// A cancelled or superseded autofill says nothing: the person may still choose another way.
		if (answer?.success && this.dialog.open) this.dialog.close();
	}

	/** Run one way in; on success close, otherwise say why, keeping focus where it is. */
	async #run(input: Record<string, unknown>): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		this.message = '';
		const focused = deepActiveElement(this.ownerDocument) as HTMLElement | null;
		try {
			const answer = (await this.kernel?.call('auth-sign-in', input)) as Answer | undefined;
			if (answer?.success && answer.data?.status === 'authenticated') {
				this.dialog.close();
				return;
			}
			const error = answer?.error;
			this.message =
				error?.code === 'PASSKEY_CANCELLED'
					? 'The passkey prompt was closed. Try again, or choose another way to sign in.'
					: [error?.message ?? 'Signing in did not finish.', error?.suggestion]
							.filter(Boolean)
							.join('. ');
		} finally {
			// `aria-disabled`, never `disabled`: a disabled button drops focus, which must stay (14); `busy` refuses a
			// second press while the first runs.
			this.busy = false;
			if (this.dialog.open && deepActiveElement(this.ownerDocument) !== focused) focused?.focus();
		}
	}

	passkey(): Promise<void> {
		return this.#run({ method: 'passkey' });
	}

	password(event: Event): void {
		event.preventDefault();
		void this.#run({
			method: 'credentials',
			email: this.email.value.trim(),
			password: this.secret?.value ?? '',
		}).then(() => {
			if (this.secret) this.secret.value = '';
		});
	}

	oidc(provider: string): Promise<void> {
		return this.#run({ method: 'oauth', provider, redirectTo: location.href });
	}

	/** Tab wraps inside the dialog; every other key goes on (FAST prevents the default of a handler not answering true). */
	keydown(event: KeyboardEvent): boolean {
		trapTab(event, this.dialog);
		return true;
	}

	/** Escape closes, but not while a ceremony runs, when it is the browser's prompt's. */
	cancel(_event: Event): boolean {
		return !this.busy;
	}

	closed(): void {
		if (this.secret) this.secret.value = '';
		this.opener?.focus();
		this.remove();
	}
}
observable(LoamSignInDialog.prototype, 'message');
observable(LoamSignInDialog.prototype, 'busy');

/** Open the sign-in dialog over the shell, once at a time. */
export async function openSignIn(shell: LoamShell): Promise<LoamSignInDialog> {
	if (!customElements.get('loam-sign-in-dialog')) {
		await LoamSignInDialog.define({ name: 'loam-sign-in-dialog', template, styles });
	}
	const root = shell.shadowRoot as ShadowRoot;
	const held = root.querySelector('loam-sign-in-dialog') as LoamSignInDialog | null;
	if (held?.dialog.open) return held;
	const dialog = shell.ownerDocument.createElement('loam-sign-in-dialog') as LoamSignInDialog;
	dialog.kernel = shell.kernel;
	dialog.organization = shell.identity?.organization ?? '';
	dialog.methods = shell.identity?.methods ?? ['passkey'];
	// The title bar's account button, which Escape returns focus to (14); main's "Sign in" too.
	dialog.opener =
		(deepActiveElement(shell.ownerDocument) as HTMLElement | null) ??
		(root
			.querySelector('loam-titlebar')
			?.shadowRoot?.querySelector('.account') as HTMLElement | null);
	root.append(dialog);
	dialog.open();
	return dialog;
}
