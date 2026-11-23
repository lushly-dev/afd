/**
 * @fileoverview Bundled `@lushly-dev/violet-elements` token interface and config resolver (spec §6.3, F6, F16).
 */
import bundledInterfaceJson from '@lushly-dev/violet-elements/tokens/interface.json';

export interface TokenInterfaceSpec {
	contractVersion: number;
	package?: string;
	tokens: Record<string, { property: string; type: string; default?: unknown }>;
}

export const BUNDLED_INTERFACE: TokenInterfaceSpec =
	bundledInterfaceJson as unknown as TokenInterfaceSpec;

/** Resolve the interface to check: `config.interface` when set (e.g. pinned test interface), else bundled. */
export function resolveInterface(config: Readonly<Record<string, unknown>>): TokenInterfaceSpec {
	const configured = config.interface;
	if (
		configured &&
		typeof configured === 'object' &&
		'contractVersion' in configured &&
		'tokens' in configured
	) {
		return configured as TokenInterfaceSpec;
	}
	return BUNDLED_INTERFACE;
}
