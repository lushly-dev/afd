import type { Meta, StoryObj } from '@storybook/web-components-vite';

// Each raises what no one catches. Vitest reports them against the run, so this project fails
// as a whole, and Specimen fails the stories that raised them.
const meta = {
	title: 'Fixtures/Page Errors/Raised',
	render: () => {
		const paragraph = document.createElement('p');
		paragraph.textContent = 'Planted';
		return paragraph;
	},
} satisfies Meta;

export default meta;
type Story = StoryObj;

const frames = async (count: number) => {
	for (let frame = 0; frame < count; frame++)
		await new Promise((resolve) => requestAnimationFrame(resolve));
};

/** The control: the same render, raising nothing. */
export const Clean: Story = {};

export const ThrowsLater: Story = {
	play: async () => {
		setTimeout(() => {
			throw new Error('planted uncaught error');
		}, 0);
		await frames(5);
	},
};

export const RejectsUnawaited: Story = {
	parameters: { a11y: { test: 'off' } },
	play: async () => {
		void Promise.reject(new Error('planted unhandled rejection'));
	},
};

/** Reported in a task after the frame, which can be the last thing a run waits for. */
export const RejectsOnNextFrame: Story = {
	parameters: { a11y: { test: 'off' } },
	play: async () => {
		requestAnimationFrame(() => {
			void Promise.reject(new Error('planted next frame rejection'));
		});
	},
};

/** A listener the page has removed no longer says the page expects the error. */
export const ThrowsAfterItsListenerLeft: Story = {
	play: async () => {
		const listener = () => {};
		window.addEventListener('error', listener);
		window.removeEventListener('error', listener);
		setTimeout(() => {
			throw new Error('planted after the listener left');
		}, 0);
		await frames(5);
	},
};

export const RejectsAnObject: Story = {
	play: async () => {
		void Promise.reject({ message: 'planted object rejection' });
		await frames(5);
	},
};

export const FailsAndThrows: Story = {
	play: async () => {
		setTimeout(() => {
			throw new Error('planted uncaught error');
		}, 0);
		await frames(5);
		throw new Error('planted play failure');
	},
};
