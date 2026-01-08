/**
 * CSS variable constants and status type mappings.
 */

/**
 * Status types for semantic styling.
 */
export const StatusType = {
  SUCCESS: 'success',
  FAILURE: 'failure',
  WARNING: 'warning',
  INFO: 'info',
  MUTED: 'muted',
  NEUTRAL: 'neutral',
} as const;

export type StatusTypeValue = (typeof StatusType)[keyof typeof StatusType];

/**
 * CSS variable names for theming.
 * These should be defined in your stylesheet.
 */
export const AFD_CSS_VARIABLES = {
  success: '--afd-success',
  error: '--afd-error',
  warning: '--afd-warning',
  info: '--afd-info',
  muted: '--afd-muted',
  text: '--afd-text',
} as const;

/**
 * CSS variable mappings with fallback colors.
 */
export const STATUS_COLORS: Record<StatusTypeValue, string> = {
  [StatusType.SUCCESS]: 'var(--afd-success, #22c55e)',
  [StatusType.FAILURE]: 'var(--afd-error, #ef4444)',
  [StatusType.WARNING]: 'var(--afd-warning, #f59e0b)',
  [StatusType.INFO]: 'var(--afd-info, #3b82f6)',
  [StatusType.MUTED]: 'var(--afd-muted, #6b7280)',
  [StatusType.NEUTRAL]: 'inherit',
};
