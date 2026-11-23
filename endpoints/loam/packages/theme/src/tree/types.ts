/**
 * Shared shapes for Loam's Violet tree (phase 0 specification, sections 2.1 and 2.2).
 */

/** The token types of the contract (2.1). */
export const CONTRACT_TYPES = [
	'color',
	'dimension',
	'duration',
	'cubicBezier',
	'fontWeight',
	'fontFamily',
	'number',
	'typography',
	'shadow',
] as const;

export type ContractType = (typeof CONTRACT_TYPES)[number];

/**
 * Whether an id is shared (the components' interface and Loam's other shared ids, exported to
 * `violet-elements`) or read only by `@lushly-dev/loam-chrome`.
 */
export type ContractKind = 'component' | 'shell';

/** Primitives live under `ref.*`; semantic tokens reference them and nothing exports them. */
export const isPrimitive = (id: string): boolean => id.startsWith('ref.');
