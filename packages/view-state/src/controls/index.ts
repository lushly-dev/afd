/**
 * @fileoverview Controls: `@lushly-dev/afd-view-state/controls`.
 *
 * The controls an application binds on a screen, so an agent can read and fill a form through
 * the `control-*` commands, which `@lushly-dev/afd-view-state/controls/commands` makes. This
 * entry loads no command definition, no MCP transport and no Node.js builtin.
 *
 * @packageDocumentation
 */

export { ControlRegistry, type ControlRegistryOptions, type ControlScreen } from './registry.js';
export type {
	Control,
	ControlChoice,
	ControlFormat,
	ControlHandler,
	ControlKind,
	ControlState,
	ControlValue,
} from './types.js';
