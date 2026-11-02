/**
 * @fileoverview `@lushly-dev/loam-chrome/view`: what a view app adds to a page, a chunk of its own, so a
 * shell with no view app loads none of it (phase 1 specification, 9.2).
 */

import { LoamViewFrame, viewFrameDefinition } from './view-frame.js';

export { openHandlerFrame } from './handler-frame.js';
export {
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
