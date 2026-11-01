export interface MediaEmulation {
	colorScheme: 'light' | 'dark' | null;
	contrast: 'more' | 'no-preference' | null;
	reducedMotion: 'reduce' | 'no-preference' | null;
}

/** The provider's context media, which every story sees unless a driver switches it. */
export const providerMedia: {
	colorScheme: 'light' | 'dark';
	contrast: 'more' | 'no-preference';
	reducedMotion: 'reduce' | 'no-preference';
} = { colorScheme: 'light', contrast: 'no-preference', reducedMotion: 'no-preference' };
