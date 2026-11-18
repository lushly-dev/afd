/**
 * @lushly-dev/loam-chrome/copilot: the copilot's panel (phase 5 specification, 2 and 3.2), a chunk of its own that
 * the shell loads when its panel part first opens.
 */

import type { FASTElement } from '@lushly-dev/fast-element';
import {
	COPILOT_PANEL_DEFINITION,
	type CopilotPanelHostV1,
	type CopilotPanelKernelV1,
	LoamCopilotPanel,
} from './panel.js';

export { type ConversationViewV1, CopilotConversation } from './conversation.js';
export {
	type CopilotPanelHostV1,
	type CopilotPanelKernelV1,
	LoamCopilotPanel,
	NO_MODEL_NOTICE,
	toolState,
} from './panel.js';

/** Define the panel once, and put it in the shell's panel part in place of its empty state. */
export async function mountCopilotPanel(
	part: HTMLElement,
	options: { kernel: CopilotPanelKernelV1; host?: CopilotPanelHostV1 | undefined }
): Promise<LoamCopilotPanel> {
	if (!customElements.get(COPILOT_PANEL_DEFINITION.name))
		await (LoamCopilotPanel as unknown as typeof FASTElement).define(COPILOT_PANEL_DEFINITION);
	const panel = part.ownerDocument.createElement(COPILOT_PANEL_DEFINITION.name) as LoamCopilotPanel;
	panel.kernel = options.kernel;
	panel.host = options.host ?? null;
	for (const empty of part.querySelectorAll(':scope > loam-empty-state'))
		empty.setAttribute('hidden', '');
	part.append(panel);
	return panel;
}
