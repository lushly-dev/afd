/** @fileoverview `dev.loam/tokens`: a view's theme (phase 1 specification, 6.2). Shell ids are not sent. */

import contract from '@lushly-dev/loam-theme/contract.json';

const PROPERTIES = Object.values(contract.tokens)
	.filter((token) => token.kind === 'component')
	.map((token) => token.property);

/** Each of the contract's component ids' custom property, as the document resolves it now. */
export function readTokens(document: Document): Record<string, string> {
	const computed = (document.defaultView ?? window).getComputedStyle(document.documentElement);
	return Object.fromEntries(
		PROPERTIES.map((property) => [property, computed.getPropertyValue(property).trim()])
	);
}
