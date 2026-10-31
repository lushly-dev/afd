import type { ResolvedToken } from '../../types/token.js';
import type { TransformOptions, Transformer } from '../transformer.js';
import { groupByCategory, tokensToStyleDictionary } from '../transformer.js';

/**
 * JSON Transformer
 *
 * Exports tokens to Style Dictionary compatible JSON format.
 */
export const jsonTransformer: Transformer = {
	format: 'json',
	fileExtension: 'json',
	name: 'Style Dictionary JSON',

	transform(tokens: ResolvedToken[], options: TransformOptions = {}): string {
		const { pretty = true, includeComments = false, prefix = '' } = options;

		// Apply prefix to token IDs if provided
		const prefixedTokens = prefix ? tokens.map((t) => ({ ...t, id: `${prefix}.${t.id}` })) : tokens;

		const output = tokensToStyleDictionary(prefixedTokens, includeComments);

		return pretty ? JSON.stringify(output, null, 2) : JSON.stringify(output);
	},

	transformMulti(tokens: ResolvedToken[], options: TransformOptions = {}): Map<string, string> {
		const { pretty = true, includeComments = false, groupByCategory: group } = options;
		const files = new Map<string, string>();

		if (!group) {
			files.set('tokens.json', this.transform(tokens, options));
			return files;
		}

		// Group by category and create separate files
		const groups = groupByCategory(tokens);

		for (const [category, categoryTokens] of groups) {
			const output = tokensToStyleDictionary(categoryTokens, includeComments);
			const content = pretty ? JSON.stringify(output, null, 2) : JSON.stringify(output);
			files.set(`${category}.json`, content);
		}

		return files;
	},
};
