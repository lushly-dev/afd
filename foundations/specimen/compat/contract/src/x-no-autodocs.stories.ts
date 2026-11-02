import { expect } from 'storybook/test';
import '../elements.js';

const render =
	(attributes = '') =>
	() => {
		const box = document.createElement('div');
		box.innerHTML = `<x-no-autodocs ${attributes}></x-no-autodocs>`;
		return box;
	};
const meta = {
	title: 'Contract/x-no-autodocs',

	parameters: { docs: { description: { component: 'A fixture.' } } },
};
export default meta;
export const Default = {
	render: render(),
	play: async ({ canvasElement }) => {
		await expect(canvasElement.children.length).toBe(1);
	},
};
export const Disabled = {
	render: render('disabled'),
	play: async ({ canvasElement }) => {
		await expect(canvasElement.children.length).toBe(1);
	},
};
