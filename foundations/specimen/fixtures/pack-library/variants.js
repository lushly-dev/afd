// Cases a pack build must not take at their word: each is used by the variant configuration only.
import './field.js';

/** Its value is new on every render, so the two passes never agree. */
export const Unstable = {
	render: () => {
		const element = document.createElement('example-field');
		element.setAttribute('label', 'Token');
		element.setAttribute('value', crypto.randomUUID());
		return element;
	},
};

/** It fails to render, every time. */
export const Broken = {
	render: () => {
		throw new Error('This case always fails.');
	},
};

/** Named by a property, which its markup cannot carry: mounted again, it has another name. */
export const PropertyNamed = {
	render: () => {
		const element = document.createElement('example-field');
		element.setAttribute('label', 'Email');
		element.accessibleName = 'Work email';
		return element;
	},
};
