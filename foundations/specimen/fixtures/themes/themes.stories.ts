// Theme support declared on retained stories: a tag, and a story that settles its own theme.

function panel(content: string, light: boolean): HTMLParagraphElement {
	const element = document.createElement('p');
	element.textContent = content;
	if (light)
		element.style.cssText =
			'position:fixed;inset:0;margin:0;padding:1rem;background:#fff;color:#111;color-scheme:light';
	return element;
}

export default { title: 'Themes/Stories' };

export const LightOnly = {
	tags: ['light-only'],
	render: () => panel('Always light', true),
};

/** Its own theme global: every requested theme renders dark. */
export const Pinned = {
	globals: { theme: 'dark' },
	render: () => panel('Always dark', false),
};
