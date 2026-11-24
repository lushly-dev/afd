// What every FAST-AF page needs to run the components: the library, the pack
// and a theme. vendor/fast-af.js is every component in
// @lushly-dev/violet-elements on @lushly-dev/fast-element, bundled by
// scripts/build-site-fast-af.mjs, and fast-af/library.json is the component
// pack as Specimen wrote it.

async function json(file) {
	const response = await fetch(new URL(`../fast-af/${file}`, import.meta.url));
	if (!response.ok) throw new Error(`${file}: ${response.status}`);
	return response.json();
}

// `?bundle=name` loads another build of the components (fast-af.name.js and
// library.name.json), written by the bundle script from another checkout.
const bundleAsked = new URLSearchParams(location.search).get('bundle');
const bundle = bundleAsked && /^[a-z0-9-]+$/.test(bundleAsked) ? `.${bundleAsked}` : '';
export const library = await json(`library${bundle}.json`);
export const fa = await import(`./vendor/fast-af${bundle}.js`);

// The components take a theme as data. These pages give them AFD's: a set
// built from this site's own colours by scripts/build-site-afd-theme.mjs.
// Without it they would draw in the package's built-in default.
// `?theme=name` loads a candidate, afd-theme.name.json, for review.
const asked = new URLSearchParams(location.search).get('theme');
export const themeName = asked && /^[a-z0-9-]+$/.test(asked) ? asked : null;
// Without one, the approved Refined set (lushly-dev/afd#1430), for components that carry Refined's styles.
export const theme = await json(`afd-theme.${themeName ?? 'refined-ported'}.json`);
fa.installVioletThemeSet(theme.set);

// A candidate may carry a patch: CSS for the components' own shadow roots, to
// try a change before anyone edits the package. Each stage adds the patch to
// every component in it, and again whenever the stage changes, since a
// component can replace its style sheets or draw a new part.
const patchSheets = new Map(
	Object.entries(theme.patch ?? {}).map(([tag, css]) => {
		const sheet = new CSSStyleSheet();
		sheet.replaceSync(css);
		return [tag, sheet];
	})
);

function patch(root) {
	for (const node of root.querySelectorAll('*')) {
		const inner = node.shadowRoot;
		if (!inner) continue;
		const sheet = patchSheets.get(node.localName);
		if (sheet && !inner.adoptedStyleSheets.includes(sheet)) {
			inner.adoptedStyleSheets = [...inner.adoptedStyleSheets, sheet];
		}
		patch(inner);
	}
}

function keepPatched(shadow) {
	if (patchSheets.size === 0) return;
	let waiting = false;
	const soon = () => {
		if (waiting) return;
		waiting = true;
		requestAnimationFrame(() => {
			waiting = false;
			patch(shadow);
		});
	};
	new MutationObserver(soon).observe(shadow, { attributes: true, childList: true, subtree: true });
	for (const type of ['click', 'keydown', 'focusin', 'pointerover']) shadow.addEventListener(type, soon, true);
	soon();
}

// ── A stage: a shadow root with the theme in it ─────────────────────────
// The components draw from their own theme, so each stage is a shadow root:
// the site's styles stay out and the theme stays in.

const STAGE_CSS = `
	.root {
		box-sizing: border-box;
		min-width: 0;
		min-height: 100%;
		padding: var(--space-5);
		background: var(--violet-color-surface-page);
		color: var(--violet-color-text-primary);
		font-family: var(--violet-font-family-body);
		line-height: 1.5;
	}
`;

/** Make `host` a stage and return its root, where markup is mounted. */
export function stage(host, extraCss = '') {
	host.replaceChildren();
	const shadow = host.attachShadow({ mode: 'open' });
	fa.installVioletTheme(shadow);
	const root = document.createElement('div');
	root.className = 'root';
	fa.applyVioletThemeRoot(root, theme.set.defaultPreset);
	const style = document.createElement('style');
	style.textContent = STAGE_CSS + extraCss;
	shadow.append(style, root);
	keepPatched(shadow);
	return root;
}

/**
 * Mount markup with every element already a component. Importing the parsed
 * nodes upgrades them before they are connected, so a parent that reads its
 * children when it connects finds components, as it does in a template.
 */
export function mount(root, html) {
	const template = document.createElement('template');
	template.innerHTML = html;
	root.replaceChildren(document.importNode(template.content, true));
	if (patchSheets.size > 0) patch(root.getRootNode());
}

// A story named Overview is the component as it is usually met, so it goes first.
for (const record of library.records) {
	record.examples.sort((a, b) => b.from.endsWith('--overview') - a.from.endsWith('--overview'));
}

/** A record's example by story name, or its first. */
export function example(tag, story = 'overview') {
	const record = library.records.find((candidate) => candidate.tag === tag);
	return (record.examples.find((item) => item.from.endsWith(`--${story}`)) ?? record.examples[0]).html;
}
