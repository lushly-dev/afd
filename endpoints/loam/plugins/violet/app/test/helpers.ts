/**
 * @fileoverview Shared test constants for `@lushly-dev/loam-app-violet`.
 */

/** Pinned 7-entry interface for scenarios 09 and 14 (spec §6.3, §9.1). */
export const PINNED_INTERFACE = {
	contractVersion: 1,
	tokens: {
		'color.surface.page': { property: '--violet-color-surface-page', type: 'color' },
		'color.text.primary': { property: '--violet-color-text-primary', type: 'color' },
		'color.text.muted': { property: '--violet-color-text-muted', type: 'color' },
		'color.action.primary.background': {
			property: '--violet-color-action-primary-background',
			type: 'color',
		},
		'color.field.border': { property: '--violet-color-field-border', type: 'color' },
		'size.focus-ring.width': { property: '--violet-size-focus-ring-width', type: 'dimension' },
		'color.action.danger.background': {
			property: '--violet-color-action-danger-background',
			type: 'color',
		},
	},
} as const;
