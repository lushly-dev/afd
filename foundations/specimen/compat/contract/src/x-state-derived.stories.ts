import { expect } from 'storybook/test';
import '../elements.js';

const render =
	(attributes = '') =>
	() => {
		const box = document.createElement('div');
		box.innerHTML = `<x-state-derived ${attributes}></x-state-derived>`;
		return box;
	};
const meta = {
	title: 'Contract/x-state-derived',
	tags: ['autodocs'],
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
	render: render('data-disabled'),
	play: async ({ canvasElement }) => {
		await expect(canvasElement.children.length).toBe(1);
	},
};
