// The declared baseline: randomness, and what a capture records of a page's resources.

function element(text: string): HTMLElement {
	const paragraph = document.createElement('p');
	paragraph.textContent = text;
	return paragraph;
}

/** A framework's marker: drawn from `Math.random` once, and written into the DOM. */
export const RandomMarker = {
	render: () => ({
		element: element(`${Math.random().toString(36).slice(2, 8)} ${Math.random()}`),
	}),
};

/** A remote request, which fails, and a font face, which the page knows of but does not load. */
export const WithResources = {
	render: () => {
		document.fonts.add(new FontFace('Fixture Face', 'local("Fixture Face")'));
		return {
			element: element('Resources'),
			ready: fetch('http://127.0.0.1:9/unreachable.json').then(
				() => undefined,
				() => undefined
			),
		};
	},
};
