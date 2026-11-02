import { expect } from 'storybook/test';
import '../elements.js';

const render =
	(attributes = '') =>
	() => {
		const box = document.createElement('div');
		box.innerHTML = `<x-no-baseline ${attributes}></x-no-baseline>`;
		return box;
	};
const meta = {
	title: 'Contract/x-no-baseline',
	tags: ['autodocs'],
	parameters: { docs: { description: { component: 'A fixture.' } } },
};
export default meta;
export const Plain = {
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
