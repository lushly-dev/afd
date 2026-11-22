import { type CssValueMetadata, checkCssTokenValue } from '@lushly-dev/violet-core/css';
import type { FlatToken } from './import/flatten.js';

/**
 * The value checks the writing commands share (#1325). Internal: not exported
 * from the package's entry points.
 */

/** What to do about a value refused as unsafe */
export const unsafeValueSuggestion =
	"Give a plain value of the token's type (a colour, a length, a font list…) with no ';', braces, comments, '\\', '!' or url()";

/** What an import already knows of a token id on the node it writes to */
export interface KnownToken {
	/** The metadata the node resolves the token with */
	metadata?: CssValueMetadata;
	/** The import writes an override, so the resolver keeps `metadata`, not the file's */
	becomesOverride: boolean;
}

/** The metadata a value is held to: the token's own, unless the write keeps another */
export function importedTokenType(
	token: FlatToken,
	known: KnownToken | undefined,
): CssValueMetadata | undefined {
	if (known?.becomesOverride) return known.metadata ?? token.metadata;
	return token.metadata?.type ? token.metadata : (known?.metadata ?? token.metadata);
}

/** Each token whose value cannot reach CSS safely for the type it will have, as `'id' problem` */
export function unsafeImportValues(
	tokens: readonly FlatToken[],
	known: (tokenId: string) => KnownToken | undefined = () => undefined,
): string[] {
	return tokens.flatMap((token) => {
		const problem = checkCssTokenValue(token.value, importedTokenType(token, known(token.id)));
		return problem ? [`'${token.id}' ${problem}`] : [];
	});
}
