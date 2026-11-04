import type { StorybookConfig } from '@storybook/web-components-vite';

// Stories that change one frame after they render, kept apart for the settled check.
const config: StorybookConfig = {
	stories: ['../*.stories.ts'],
	addons: ['@storybook/addon-a11y', '@storybook/addon-vitest'],
	framework: { name: '@storybook/web-components-vite', options: {} },
	core: { disableTelemetry: true },
};

export default config;
