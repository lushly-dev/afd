import { expect } from 'storybook/test';
import '../elements.js';

const render =
	(attributes = '') =>
	() => {
		const box = document.createElement('div');
		box.innerHTML = `<x-a11y-off ${attributes}></x-a11y-off>`;
		return box;
	};
const meta = {
	title: 'Contract/x-a11y-off',
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
	render: render('disabled'),
	parameters: { a11y: { test: 'off' } },
	play: async ({ canvasElement }) => {
		await expect(canvasElement.children.length).toBe(1);
	},
};
