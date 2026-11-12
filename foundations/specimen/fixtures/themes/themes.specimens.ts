// Theme support: one specimen follows the page's theme, one paints its own light frame.

function text(content: string): HTMLParagraphElement {
	const element = document.createElement('p');
	element.textContent = content;
	return element;
}

/** Text in the page's colors, on the page's canvas: both change with the theme. */
export const Follows = {
	render: () => text('Follows the theme'),
};

/** A light panel over the whole viewport, as a page that stays light to match a marketing site. */
export const Light = {
	render: () => {
		const panel = text('Always light');
		panel.style.cssText =
			'position:fixed;inset:0;margin:0;padding:1rem;background:#fff;color:#111;color-scheme:light';
		return panel;
	},
};
