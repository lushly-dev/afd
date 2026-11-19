/**
 * The states of <change-bar> that Specimen's host captured for these pages.
 *
 * `Ready` is the bar as designed. Each of the others changes one thing, the way
 * a pull request would. The captures are in ../captures/, and the pages compare
 * them with the real specimen-diff command.
 */
import './change-bar.js';

function bar(attributes = {}) {
	const element = document.createElement('change-bar');
	for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
	element.textContent = '3 changes to Atlas Dark';
	return element;
}

/** A design token set upstream of the component: a stylesheet on the document, not markup. */
function tokens(css) {
	const sheet = new CSSStyleSheet();
	sheet.replaceSync(`:root { ${css} }`);
	document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
	return () => {
		document.adoptedStyleSheets = document.adoptedStyleSheets.filter((item) => item !== sheet);
	};
}

/** The bar as designed. */
export const Ready = {
	render: () => bar(),
};

/** Someone raised a spacing token. No component file changed, and the markup is the same. */
export const TokenChanged = {
	render: () => {
		const dispose = tokens('--bar-pad: 20px;');
		return { element: bar(), dispose };
	},
};

/** The main button says more. */
export const Relabelled = {
	render: () => bar({ label: 'Save changes' }),
};

/** Nothing to save yet, as first written: `disabled` on the bar itself. */
export const Disabled = {
	render: () => bar({ disabled: '' }),
};

/** Nothing to save yet, after the capture above was read: an attribute of the bar's own. */
export const DisabledFixed = {
	render: () => bar({ 'save-disabled': '' }),
};

/** A refactor dropped the icon button's name. It looks the same. */
export const Unnamed = {
	render: () => bar({ 'dismiss-label': '' }),
};
