import { expect } from 'storybook/test';
import '../elements.js';

const render =
	(attributes = '') =>
	() => {
		const box = document.createElement('div');
		box.innerHTML = `<x-form-text-only ${attributes}></x-form-text-only>`;
		return box;
	};
const meta = {
	title: 'Contract/x-form-text-only',
	tags: ['autodocs'],
	parameters: { docs: { description: { component: 'A fixture.' } } },
};
export default meta;
// new FormData(form) and checkValidity() are for later.
export const Default = {
	render: render(),
	play: async ({ canvasElement }) => {
		await expect(canvasElement.children.length).toBe(1);
	},
};
