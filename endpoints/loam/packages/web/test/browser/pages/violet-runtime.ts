/**
 * E7's page: computed values of the component tokens for `loam/dark` from the stylesheet, and
 * from `VioletRuntime` with `loam-theme.json`'s preloaded source.
 */
import themeJson from '@lushly-dev/loam-theme/loam-theme.json';
import { VioletRuntime } from '@lushly-dev/violet-runtime';

const nodes = (themeJson as { nodes: Record<string, { id: string; value: string | number }[]> })
	.nodes;

function read(properties: readonly string[]): Record<string, string> {
	const style = getComputedStyle(document.documentElement);
	return Object.fromEntries(
		properties.map((property) => [property, style.getPropertyValue(property).trim()])
	);
}

async function compare(properties: readonly string[]) {
	const root = document.documentElement;
	root.dataset.loamTheme = 'dark';
	const stylesheet = read(properties);
	root.dataset.loamTheme = 'light';
	const light = read(properties);
	const runtime = new VioletRuntime({
		nodeId: 'loam/dark',
		source: { tokens: nodes['loam/dark'] ?? [] },
	});
	await runtime.load();
	const applied = read(properties);
	runtime.removeFromDocument();
	return { stylesheet, light, applied };
}

(window as unknown as { loamVioletRuntime: typeof compare }).loamVioletRuntime = compare;
