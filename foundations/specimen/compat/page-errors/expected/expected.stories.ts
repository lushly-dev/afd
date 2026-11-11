import type { Meta, StoryObj } from '@storybook/web-components-vite';

// What Vitest does not count as an unhandled error, so this project passes as a whole.
const meta = {
	title: 'Fixtures/Page Errors/Expected',
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

/** The page listens for the error itself, so it is the page's to handle. */
export const OwnListener: Story = {
	play: async () => {
		let seen = '';
		const listener = (event: ErrorEvent) => {
			seen = event.message;
		};
		window.addEventListener('error', listener);
		setTimeout(() => {
			throw new Error('planted and expected');
		}, 0);
		await frames(5);
		window.removeEventListener('error', listener);
		if (!seen.includes('planted and expected')) throw new Error(`The listener saw '${seen}'.`);
	},
};

export const OwnRejectionListener: Story = {
	play: async () => {
		const listener = (event: PromiseRejectionEvent) => event.preventDefault();
		window.addEventListener('unhandledrejection', listener);
		void Promise.reject(new Error('planted and expected'));
		await frames(5);
		window.removeEventListener('unhandledrejection', listener);
	},
};

/** As a ResizeObserver's loop notice arrives: a message, and no error value. */
export const NoErrorValue: Story = {
	play: async () => {
		window.dispatchEvent(new ErrorEvent('error', { message: 'ResizeObserver loop completed' }));
		await frames(2);
	},
};

export const NullRejection: Story = {
	play: async () => {
		void Promise.reject(null);
		await frames(5);
	},
};
