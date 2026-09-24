/**
 * @fileoverview Tool categories for filtering and grouping.
 */

import type { McpTool } from '@lushly-dev/afd-core';

/**
 * The category a tool is listed under: its `_meta.category`, else the kebab-case
 * domain before the first `-` (`todo-create` → `todo`), else its whole name.
 * This matches how AFD servers group commands.
 */
export function toolCategory(tool: McpTool): string {
	const advertised = tool._meta?.category;
	if (typeof advertised === 'string' && advertised !== '') return advertised;
	return tool.name.split('-')[0] || tool.name;
}

/** Whether a tool belongs to `category`, as {@link toolCategory} defines it. */
export function matchesCategory(tool: McpTool, category: string): boolean {
	return toolCategory(tool) === category;
}
