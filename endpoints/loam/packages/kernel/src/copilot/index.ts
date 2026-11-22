/**
 * @lushly-dev/loam-kernel/copilot: the copilot's records and the ports' trusted halves (phase 5 specification,
 * 3.2 to 3.5). A host builds a runner with {@link createCopilotHost} and gives it to `createKernel` as
 * `copilot.runner`. The commands themselves are in the kernel's `late-copilot` chunk, which this entry never loads.
 */

export type { CopilotConfirmationCardV1, CopilotSuggestionCardV1 } from './commands.js';
export {
	type CopilotHostOptionsV1,
	type CopilotHostV1,
	checkPortMessage,
	createCopilotHost,
	MODEL_PORT_LIMITS,
	type ModelResponseV1,
	type ModelTransportV1,
	type PanelEventV1,
	type PortLike,
	panelEvent,
	type RuntimeLauncherV1,
	type RuntimePortsV1,
	UsageReader,
} from './host.js';
export * from './types.js';
export {
	composerBodyIs,
	UNIT_LIMITS,
	UNIT_PROMPT,
	type UnitContextV1,
	unitContext,
} from './units.js';
