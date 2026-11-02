/**
 * @fileoverview The properties the shell sets through CSSOM from layout state (phase 0
 * specification, section 7). They are the only place pixel values from state enter CSS, and the
 * token-only lint allows them as private aliases because `package.json`'s
 * `loamLintTokens.stateProperties` lists the same three.
 */

export const STATE_PROPERTIES = Object.freeze([
	'--_sidebar-width',
	'--_inspector-width',
	'--_panel-height',
] as const);

export type StateProperty = (typeof STATE_PROPERTIES)[number];
