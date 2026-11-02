import { expect } from 'storybook/test';
import '../elements.js';

const render =
	(attributes = '') =>
	() => {
		const box = document.createElement('div');
		box.innerHTML = `<x-state-cleared ${attributes}></x-state-cleared>`;
		return box;
	};
const meta = {
	title: 'Contract/x-state-cleared',
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
	render: render(),
	play: async ({ canvasElement }) => {
		const element = canvasElement.querySelector('x-state-cleared') as Element;
		element.setAttribute('disabled', '');
		await expect(element.hasAttribute('disabled')).toBe(true);
		element.removeAttribute('disabled');
	},
};
