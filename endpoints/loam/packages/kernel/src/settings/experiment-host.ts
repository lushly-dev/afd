/**
 * @fileoverview What the experiments read of the rest of the shell (phase 4 specification, 5.3, R14): the person's
 * dirty tabs of an app's document types, their pending confirmations of its commands, and an app's unload. In `late`,
 * beside the editor, the overlays and the confirmations it reaches; the experiments themselves are `late-settings`'.
 */

import type { CommandContext } from '@lushly-dev/afd-core';
import type { DataAdapter } from '@lushly-dev/local-db';
import type { AppsRuntime } from '../apps-runtime.js';
import type { EditorDraftsV1 } from '../documents/editor-state.js';
import type { OverlayStore } from '../overlays/store.js';
import type { ScopeRuntime } from '../scope/runtime.js';
import type { ShellState } from '../shell-state.js';
import type { StoredConfirmation } from './confirmation-parts.js';

export interface ExperimentHostDeps {
	store: DataAdapter;
	apps(): AppsRuntime;
	overlays: OverlayStore;
	state: Pick<ShellState, 'activeApp'>;
	/** Where an unload that closes the active app notes that main moved, as any call that moves it does. */
	scope?: Pick<ScopeRuntime, 'note' | 'seen'>;
	drafts: EditorDraftsV1;
	/** The document table. */
	documentTable: string;
	/** Close every clean open tab of `instance`'s document types when its experiment holds it out (#2113). */
	closeTabs(instance: string, context: CommandContext | undefined): Promise<{ dirty: boolean }>;
	/** The person the shell is for, and the clock. */
	person(): string | undefined;
	now(): number;
	confirmations: {
		pending(
			person: string,
			match: (row: StoredConfirmation) => boolean,
			now: number
		): Promise<boolean>;
		withdraw(context: CommandContext, match: (row: StoredConfirmation) => boolean): Promise<number>;
	};
}

/** `sha256:<hex>` of a text, the digest the copilot, the confirmations and the experiments keep (phase 4's 5.2, 7.2). */
export async function sha256(text: string): Promise<string> {
	const hash = new Uint8Array(
		await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
	);
	return `sha256:${Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** The instance whose manifest declares `type`, even while that app is held out by its experiment (#2113). */
export function manifestTypeOwner(apps: AppsRuntime, type: string): string | undefined {
	for (const summary of apps.summaries()) {
		try {
			if (apps.port(summary.instance).manifest.ui?.documents?.some((doc) => doc.id === type))
				return summary.instance;
		} catch {}
	}
	return undefined;
}

/** Whether `type` belongs to an app whose own experiment currently holds it out (#2113). */
export function isManifestTypeGated(
	apps: AppsRuntime,
	experiments: { ready(): boolean; gated(instance: string): boolean } | undefined,
	type: string
): boolean {
	const owner = manifestTypeOwner(apps, type);
	return owner !== undefined && experiments?.ready() === true && experiments.gated(owner);
}

export function experimentHost(deps: ExperimentHostDeps) {
	const owns = (instance: string) => (row: StoredConfirmation) =>
		deps.apps().owners.get(row.confirmation.command)?.instance === instance;
	return {
		/**
		 * The tabs of the shell's person holding an unsaved change of `instance`'s document types (R14). A document that
		 * cannot be read counts as the app's: a failed read never lets an unload lose a tab.
		 */
		async unsavedTabs(instance: string): Promise<Array<{ tab: string; document: string }>> {
			const found: Array<{ tab: string; document: string }> = [];
			for (const [held, document] of deps.drafts.dirty) {
				const tab = held.slice(held.indexOf(' ') + 1);
				let type: string | undefined;
				// Only a read that fails is unread; a document that is gone belongs to no app.
				let unread = false;
				try {
					type = (await deps.store.get<{ type?: string }>(deps.documentTable, document))?.type;
				} catch {
					unread = true;
				}
				if (unread || (type !== undefined && manifestTypeOwner(deps.apps(), type) === instance))
					found.push({ tab, document });
			}
			return found;
		},
		/** Whether the shell's person has a pending confirmation for one of `instance`'s commands. */
		async pending(instance: string): Promise<boolean> {
			const person = deps.person();
			return person !== undefined && deps.confirmations.pending(person, owns(instance), deps.now());
		},
		closeTabs: deps.closeTabs,
		/**
		 * R14's unload: closes clean document tabs first (aborting without side effects if a tab became dirty mid-read),
		 * then cancels open dialogs/questions, withdraws pending confirmations, and closes the app if active.
		 */
		async unload(instance: string, context: CommandContext | undefined): Promise<boolean> {
			const closed = await deps.closeTabs(instance, context);
			if (closed.dirty) return false;
			for (const overlay of deps.overlays.list(instance)) {
				if (overlay.kind !== 'toast') deps.overlays.close(overlay.overlayId, 'cancel', 'withdrawn');
			}
			if (context) await deps.confirmations.withdraw(context, owns(instance));
			if (deps.state.activeApp() === instance) {
				deps.apps().close();
				// Main moved, noted on the call as `app-open`'s close is, so what follows main hears it (the mounted view, 9.3);
				// a move the call already noted keeps its own history (`editor-close`'s `push`, whose settle unloads).
				const traceId = context?.traceId;
				if (traceId !== undefined && !deps.scope?.seen.get(traceId)?.mainChanged)
					deps.scope?.note(traceId, { mainChanged: 'replace' });
			}
			return true;
		},
	};
}
