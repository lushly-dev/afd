// What `specimen-profile` measures. These fixtures have no imports, so a test can copy them to a
// scratch directory and record baselines there.

function paragraph(text: string): HTMLElement {
	const element = document.createElement('p');
	element.textContent = text;
	return element;
}

customElements.define('fixture-host', class extends HTMLElement {});

export const Small = { render: () => paragraph('A small page.') };

/** Past the element-count flag's threshold, with shadow hosts and custom-named elements. */
export const Large = {
	render: () => {
		const wrapper = document.createElement('div');
		for (let index = 0; index < 500; index++) wrapper.append(paragraph(`Row ${index}`));
		const host = document.createElement('fixture-host');
		host.attachShadow({ mode: 'open' }).append(paragraph('Inside a shadow root'));
		wrapper.append(host);
		return wrapper;
	},
};

export const Noisy = {
	render: () => {
		console.warn('A warning a profile counts.');
		console.error('An error a profile counts.');
		return paragraph('A noisy page.');
	},
};

export const Broken = {
	render: () => {
		throw new Error('This fixture does not render.');
	},
};

/** The DOM grows at a scenario's step, so what a profile sees depends on its checkpoint. */
export const Stepped = {
	render: () => {
		const wrapper = document.createElement('div');
		const button = document.createElement('button');
		button.textContent = 'Add rows';
		button.addEventListener('click', () => {
			for (let index = 0; index < 20; index++) wrapper.append(paragraph(`Row ${index}`));
		});
		wrapper.append(button);
		return wrapper;
	},
	targets: { add: { role: 'button', name: 'Add rows' } },
	scenario: [{ action: { click: 'add' } }],
};
