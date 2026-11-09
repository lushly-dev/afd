/**
 * @fileoverview The documents section's inspector (documents specification, 5.1 and 10), in the `documents`
 * chunk beside the tree: while the editor area shows, the active tab's type's `inspector` element, native
 * only, in a mount of its plugin made through the app surfaces' `host()`, with a surface port fixed to the
 * document's scope and the document's reference, in the shell's inspector part. `loam.layout.~documents`
 * declares the part while that tab's plugin has a type with one. The inspector hears each change to its
 * document, its links among them, as `documentChanged`, and goes when its tab stops being the active one.
 */

import type { KernelEventV2, LoamKernelV2 } from '@lushly-dev/loam-kernel';
import type {
	DocumentRecordV1,
	DocumentRefV1,
	DocumentTypeV1,
	LoamEditorElementV1,
} from '@lushly-dev/loam-sdk';
import type { SurfaceHostV1 } from '../editor/editor-frame.js';
import type { LoamMount } from '../elements/mount.js';
import type { LoamShell } from '../elements/shell.js';

interface Held {
	key: string;
	mount: LoamMount | null;
	/** The inspector's plugin, whose own calls its events name as `caller`. */
	instance: string;
	document: string;
}

const held = new WeakMap<LoamShell, Held>();

const heard = new WeakSet<LoamShell>();

/** The active group's active tab's document, from `editor-get`, or undefined with none. */
async function activeDocument(kernel: LoamKernelV2): Promise<string | undefined> {
	const read = await kernel.call<{
		activeGroup: string;
		groups: Array<{
			id: string;
			active: string | null;
			tabs: Array<{ id: string; document: string }>;
		}>;
	}>('editor-get');
	const state = read.data;
	const group = state?.groups.find((each) => each.id === state.activeGroup);
	return group?.tabs.find((tab) => tab.id === group.active)?.document;
}

function drop(shell: LoamShell, part?: HTMLElement | null): void {
	const was = held.get(shell);
	held.delete(shell);
	if (!was?.mount) return;
	// The part's own heading and empty state again, once nothing of a type shows there (A-S3).
	part?.setAttribute('heading', 'Inspector');
	const empty = part?.querySelector<HTMLElement>('loam-empty-state');
	if (empty) empty.hidden = false;
	try {
		void (was.mount.surface as LoamEditorElementV1 | null)?.dispose?.();
	} catch (cause) {
		reportError(cause);
	}
	was.mount.remove();
}

/**
 * Show the active tab's type's inspector, or none: `shows` is whether the editor area holds main. True when
 * one shows, so the title bar's toggle is offered.
 */
export async function syncInspector(
	shell: LoamShell,
	shows: boolean,
	resync: () => void
): Promise<boolean> {
	const kernel = shell.kernel as LoamKernelV2;
	const part = shell.shadowRoot?.querySelector<HTMLElement>('loam-inspector');
	if (!heard.has(shell)) {
		heard.add(shell);
		kernel.subscribe((event) => hear(shell, event, resync));
	}
	const document = shows ? await activeDocument(kernel) : undefined;
	const read =
		document === undefined
			? undefined
			: await kernel.call<DocumentRecordV1>('document-get', { document });
	const record = read?.success ? read.data : undefined;
	const types = record
		? await kernel.call<{ types: DocumentTypeV1[] }>('document-type-list', { all: true })
		: undefined;
	const type = types?.data?.types.find((each) => each.id === record?.type);
	const declared = type
		? kernel.appPort(type.instance).manifest.ui?.documents?.find((each) => each.id === type.id)
				?.inspector
		: undefined;
	const element = type?.editorKind === 'native' ? declared?.element : undefined;
	const key =
		record && element
			? `${record.id} ${record.scope.project ?? ''} ${element} ${record.title}`
			: '';
	const was = held.get(shell);
	if (was?.key === key) return !!was.mount;
	// Focus in the inspector it replaces goes with the person: into the editor its open made active, else into
	// the new inspector, else onto the part (5.8; A-B1).
	const focused = !!was?.mount?.matches(':focus-within');
	drop(shell, part);
	if (!part || !record || !type || element === undefined) {
		if (focused && part) focusAfter(shell, part);
		// No inspector for the active type: `layout-get` answers the part closed, writing nothing, so the shell hides
		// it, and a note shows it again as the person left it (A-S3; the re-check's B1).
		return false;
	}
	const host = (shell.apps as { host?(): SurfaceHostV1 } | null)?.host?.();
	if (!host) return false;
	const mine: Held = { key, mount: null, document: record.id, instance: type.instance };
	held.set(shell, mine);
	try {
		await host.ensureActivated(type.instance);
	} catch (cause) {
		reportError(cause);
		return false;
	}
	// A later sync took its place while the plugin activated.
	if (held.get(shell) !== mine) return false;
	const reference: DocumentRefV1 = {
		id: record.id,
		type: record.type,
		title: record.title,
		scope: record.scope,
		contentVersion: record.contentVersion,
		binding: record.binding,
		readOnly: false,
	};
	mine.mount = host.createMount(type.instance, element, {
		scope: record.scope,
		document: reference,
	});
	part.setAttribute('heading', `${type.title} details`);
	const empty = part.querySelector<HTMLElement>('loam-empty-state');
	if (empty) empty.hidden = true;
	part.prepend(mine.mount);
	if (focused) focusAfter(shell, part, mine.mount);
	return true;
}

/** Whether the inspector's own `document-open` came while it held focus, which then follows the document (A-B1). */
let opened = false;

/**
 * Where focus goes once an inspector that held it is replaced: into the active tab's editor after the inspector's
 * own open, as Enter on a tab does (5.8); else the new inspector's first control; else the part.
 */
/** The shells whose inspector drawer was seen open, until a sync sees it closed. */
const drawers = new WeakSet<LoamShell>();

const drawerOpen = (shell: LoamShell) => shell.presentation.inspector === 'drawer';

/**
 * Focus lost to the page as the inspector's drawer closed, for the active type has none: the drawer hands focus
 * back to what opened it, which may be the page, so the active editor takes it (B1). Seen open, by any call or
 * sync, until a sync sees it closed: the shell's own read of the layout may close it before this sync runs.
 */
export function refocus(shell: LoamShell): void {
	const doc = shell.ownerDocument;
	const part = shell.shadowRoot?.querySelector<HTMLElement>('loam-inspector');
	if (drawerOpen(shell) || !drawers.delete(shell)) return;
	if (part?.hidden && doc.activeElement === doc.body) focusAfter(shell, part);
}

function focusAfter(shell: LoamShell, part: HTMLElement, mount?: LoamMount): void {
	const open = opened;
	opened = false;
	const kernel = shell.kernel as LoamKernelV2;
	requestAnimationFrame(async () => {
		// With no inspector to take it, the part is about to hide: focus goes to the active editor, else main (S2).
		const read =
			open || !mount
				? await kernel.call<{
						activeGroup: string;
						groups: Array<{ id: string; active: string | null }>;
					}>('editor-get')
				: undefined;
		const active = read?.data?.groups.find((group) => group.id === read.data?.activeGroup)?.active;
		const frame =
			active &&
			shell.shadowRoot?.querySelector<HTMLElement & { focusEditor(): void }>(
				`loam-main loam-editor-frame[data-tab="${active}"]`
			);
		if (frame) return frame.focusEditor();
		if ((mount?.surface as (HTMLElement & { focusFirst?(): boolean }) | null)?.focusFirst?.())
			return;
		const target = mount ? part : shell.shadowRoot?.querySelector<HTMLElement>('loam-main');
		target?.setAttribute('tabindex', '-1');
		target?.focus();
	});
}

/** A change to the inspector's document or its links reaches it, as an editor's does (5.7). */
function hear(shell: LoamShell, event: KernelEventV2, resync: () => void): void {
	// The inspector's drawer open as this call landed, before the shell reads the layout again.
	if (drawerOpen(shell)) drawers.add(shell);
	const now = held.get(shell);
	const surface = now?.mount?.surface as LoamEditorElementV1 | null | undefined;
	// A mutation's, never a query's: the inspector's own reads are queries, and would read again forever.
	if (!event.success || !event.mutation) return;
	// Only the inspector's own open, from its surface while it holds focus: an agent's never moves focus.
	if (
		event.command === 'document-open' &&
		(event as { caller?: string }).caller === now?.instance &&
		now?.mount?.matches(':focus-within')
	)
		opened = true;
	if (surface && (event.document === now?.document || /^document-/.test(event.command))) {
		try {
			surface.documentChanged?.({
				document: now?.document as string,
				command: event.command,
				...(event.seq !== undefined ? { seq: event.seq } : {}),
			});
		} catch (cause) {
			reportError(cause);
		}
	}
	// The active tab may have changed: the next sync shows its inspector, or none.
	if (
		/^(editor-(activate|close|move)|document-(open|rename|trash|move))$/.test(event.command) ||
		event.scopeChanged
	)
		resync();
}
