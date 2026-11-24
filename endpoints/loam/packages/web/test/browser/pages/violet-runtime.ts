/**
 * E7's page: computed values of the component tokens for `loam/dark` from the stylesheet, and
 * from `VioletRuntime` with `loam-theme.json`'s preloaded source, adopted as a stylesheet
 * (`adopt()`, the one runtime theming path; lushly-dev/afd#1786).
 */
import themeJson from '@lushly-dev/loam-theme/loam-theme.json';
import { VIOLET_CSS_PREFIX, VioletRuntime } from '@lushly-dev/violet-runtime';

const nodes = (themeJson as { nodes: Record<string, { id: string; value: string | number }[]> })
	.nodes;

export interface TokenProbe {
	property: string;
	type: string;
}

/** The real CSS property each token type is read through, so equal values compare equal. */
const PROBES: Record<string, string> = {
	color: 'color',
	dimension: 'width',
	duration: 'transition-duration',
	cubicBezier: 'transition-timing-function',
	fontWeight: 'font-weight',
	fontFamily: 'font-family',
	number: 'z-index',
	shadow: 'box-shadow',
};

/**
 * Each token's value as the browser computes it when used: the build minifies the stylesheet
 * (`#FFFFFF` becomes `#fff`), so the custom properties' text differs while the values do not.
 */
function read(tokens: readonly TokenProbe[]): Record<string, string> {
	const probe = document.createElement('div');
	probe.style.setProperty('position', 'absolute');
	document.body.append(probe);
	const root = getComputedStyle(document.documentElement);
	const values = Object.fromEntries(
		tokens.map(({ property, type }) => {
			const css = PROBES[type] ?? 'content';
			probe.style.setProperty(css, `var(${property})`);
			const value = getComputedStyle(probe).getPropertyValue(css).trim();
			probe.style.removeProperty(css);
			return [property, value || root.getPropertyValue(property).trim()];
		})
	);
	probe.remove();
	return values;
}

async function compare(properties: readonly TokenProbe[]) {
	const root = document.documentElement;
	root.dataset.loamTheme = 'dark';
	const stylesheet = read(properties);
	root.dataset.loamTheme = 'light';
	const light = read(properties);
	const runtime = new VioletRuntime({
		nodeId: 'loam/dark',
		source: { tokens: nodes['loam/dark'] ?? [] },
		// Loam's contract names every property under the components' prefix (version 2).
		cssPrefix: VIOLET_CSS_PREFIX,
	});
	const sheet = runtime.adopt(document);
	await runtime.load();
	const applied = read(properties);
	// Applied through the adopted sheet alone: nothing inline.
	const inline = root.style.length;
	const adopted = document.adoptedStyleSheets.includes(sheet);
	runtime.unadopt(document);
	return { stylesheet, light, applied, inline, adopted };
}

(window as unknown as { loamVioletRuntime: typeof compare }).loamVioletRuntime = compare;
