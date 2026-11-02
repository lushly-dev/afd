/**
 * Shared shapes for Loam's Violet tree (phase 0 specification, sections 2.1 and 2.2).
 */

/** A literal CSS value, or a reference to another token in the same node. */
export type TreeValue = string | { ref: string };

/** One token an `add` or `override` operation writes. */
export interface TreeToken {
	id: string;
	value: TreeValue;
}

/** The token types of the contract (2.1). */
export const CONTRACT_TYPES = [
	'color',
	'dimension',
	'duration',
	'cubicBezier',
	'fontWeight',
	'number',
	'typography',
	'shadow',
] as const;

export type ContractType = (typeof CONTRACT_TYPES)[number];

/** Whether the shared components or only `@lushly-dev/loam-chrome` read an id. */
export type ContractKind = 'component' | 'shell';

/** A reference to another token. */
export const ref = (id: string): { ref: string } => ({ ref: id });

/** Primitives live under `ref.*`; semantic tokens reference them and nothing exports them. */
export const isPrimitive = (id: string): boolean => id.startsWith('ref.');
