import type { Plugin } from 'vite';

export function narrowFromJsonSchema(source: string, directory: string): string;
export function narrowZodFromJsonSchema(): Plugin;
export function jitlessByDefault(source: string): string;
export function zodJitlessByDefault(): Plugin;
