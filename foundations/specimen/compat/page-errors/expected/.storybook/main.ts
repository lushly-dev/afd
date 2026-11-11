import type { StorybookConfig } from '@storybook/web-components-vite';

// Stories whose page errors end a Vitest run, so each outcome is a project of its own.
const config: StorybookConfig = {
	stories: ['../*.stories.ts'],
	addons: ['@storybook/addon-a11y', '@storybook/addon-vitest'],
	framework: { name: '@storybook/web-components-vite', options: {} },
	core: { disableTelemetry: true },
};

export default config;
