/**
 * @fileoverview `@lushly-dev/loam-chrome/view`: what a view app adds to a page, a chunk of its own, so a
 * shell with no view app loads none of it (phase 1 specification, 9.2).
 */

import type { AppPortV2 } from '@lushly-dev/loam-kernel';
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
	port: AppPortV2,
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
