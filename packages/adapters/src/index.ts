/**
 * @afd/adapters - Frontend adapters for rendering CommandResult to styled HTML.
 *
 * Uses CSS custom properties for theming. Set these in your stylesheet:
 *   --afd-success, --afd-error, --afd-warning, --afd-info, --afd-muted
 *
 * @example
 * ```typescript
 * import { WebAdapter } from '@afd/adapters';
 *
 * const result = await fetch('/api/execute', { command: 'lint' });
 * const html = WebAdapter.renderPackageResults(result.data);
 * container.innerHTML = html;
 * ```
 */

export { AFD_CSS_VARIABLES, STATUS_COLORS, StatusType } from './css-variables.js';
export type {
	CommandErrorInput,
	CommandResultInput,
	PackageResult,
	PackageResults,
	PipelineStepInput,
	RenderOptions,
	WarningInput,
} from './types.js';
export { escapeHtml, styledSpan } from './utils.js';
export { WebAdapter } from './web-adapter.js';
