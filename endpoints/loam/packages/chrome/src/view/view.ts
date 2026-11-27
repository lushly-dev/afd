/**
 * @fileoverview `@lushly-dev/loam-chrome/view`: what a view app adds to a page, a chunk of its own, so a
 * shell with no view app loads none of it (phase 1 specification, 9.2).
 */

import { css, type FASTElement } from '@lushly-dev/fast-element';
import type { AppPort, MountedUiSlotV1 } from '@lushly-dev/loam-kernel';
import type { DocumentRefV1 } from '@lushly-dev/loam-sdk';
import {
	documentViewSource,
	LoamViewFrame,
	type ViewFrameOptions,
	viewFrameDefinition,
} from './view-frame.js';

export { openHandlerFrame } from './handler-frame.js';
export {
	type DocumentViewSource,
	documentViewSource,
	LoamViewFrame,
	packageViewSource,
	type ViewFrameFailure,
	type ViewFrameOptions,
	type ViewSource,
} from './view-frame.js';

let defined: Promise<void> | null = null;

/** Define `loam-view-frame` once. `defineAppElements` has defined the notice its failed state shows. */
export function defineViewFrame(): Promise<void> {
	defined ??= (async () => {
		if (!customElements.get(viewFrameDefinition.name))
			await LoamViewFrame.define(viewFrameDefinition);
	})();
	return defined;
}

/**
 * A document's view, its editor or its embed (documents specification, 5.6 and 9.2): a `loam-view-frame` of
 * the type's resource, through a {@link documentViewSource}, whose broker is a surface port's fixed to the
 * document's scope, read-only for an embed, so every `tools/call` holds to it. Not yet connected.
 */
export async function documentView(
	port: AppPort,
	document: DocumentRefV1,
	resource: string,
	options: Pick<ViewFrameOptions, 'hostVersion' | 'theme' | 'onSettled'>
): Promise<LoamViewFrame> {
	await defineViewFrame();
	const frame = globalThis.document.createElement(viewFrameDefinition.name) as LoamViewFrame;
	frame.configure({
		...options,
		port,
		view: port.surface({ scope: document.scope, readOnly: document.readOnly }).view,
		source: documentViewSource(port, document, resource),
		heading: document.title,
		resource,
		scope: document.scope,
		document,
	});
	return frame;
}

/** Main with the mounted-ui slot: the slot's frame alone, filling it, over whatever else main holds. */
const slotStyles = css`
	:host([data-mounted-ui]) {
		display: flex;
		flex-direction: column;
		padding: 0;
		overflow: hidden;
	}
	:host([data-mounted-ui]) .landing,
	:host([data-mounted-ui]) ::slotted(:not([data-mounted-ui])) {
		display: none;
	}
	::slotted([data-mounted-ui]) {
		flex: 1 1 auto;
		min-block-size: 0;
	}
`;
const styled = new WeakSet<Element>();
let turn = 0;

/**
 * `shell-open`'s mounted-ui slot (phase 5 specification, 9.3, T32): the view a kernel event names, or none for `null`. It
 * renders only in a `loam-view-frame`, so in `ProxyChannel`'s two frames on the sandbox origin, the inner one opaque,
 * under the view CSP with `form-action 'none'` and no permission, and its broker is the slot's, which calls no tool. The
 * frame is the page's alone, never persisted, so a reload shows none and fetches nothing.
 */
export async function showMountedView(
	shell: HTMLElement & { appearance: { resolved: string } },
	slot: MountedUiSlotV1 | null,
	hostVersion: number
): Promise<void> {
	const mine = ++turn;
	await defineViewFrame();
	const main = shell.shadowRoot?.querySelector('loam-main') as FASTElement | null | undefined;
	// A later event decides.
	if (mine !== turn || !main) return;
	for (const old of main.querySelectorAll('loam-view-frame[data-mounted-ui]'))
		(old as LoamViewFrame).leave();
	main.toggleAttribute('data-mounted-ui', slot !== null);
	if (slot === null) return;
	if (!styled.has(main)) {
		styled.add(main);
		main.$fastController.addStyles(slotStyles);
	}
	const frame = shell.ownerDocument.createElement(viewFrameDefinition.name) as LoamViewFrame;
	frame.dataset.mountedUi = '';
	frame.configure({
		port: { instance: slot.instance } as AppPort,
		view: slot.view,
		source: slot.source,
		heading: slot.instance,
		hostVersion: String(hostVersion),
		resource: slot.uri,
		scope: slot.scope,
		mounted: true,
		theme: () => (shell.appearance.resolved === 'dark' ? 'dark' : 'light'),
	});
	main.append(frame);
}
