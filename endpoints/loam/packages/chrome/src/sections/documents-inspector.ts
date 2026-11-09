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

function drop(shell: LoamShell): void {
	const was = held.get(shell);
	held.delete(shell);
	if (!was?.mount) return;
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
	drop(shell);
	if (!part || !record || !type || element === undefined) return false;
	const host = (shell.apps as { host?(): SurfaceHostV1 } | null)?.host?.();
	if (!host) return false;
	const mine: Held = { key, mount: null, document: record.id };
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
	part.prepend(mine.mount);
	return true;
}

/** A change to the inspector's document or its links reaches it, as an editor's does (5.7). */
function hear(shell: LoamShell, event: KernelEventV2, resync: () => void): void {
	const now = held.get(shell);
	const surface = now?.mount?.surface as LoamEditorElementV1 | null | undefined;
	// A mutation's, never a query's: the inspector's own reads are queries, and would read again forever.
	if (!event.success || !event.mutation) return;
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
