export interface MediaEmulation {
	colorScheme: 'light' | 'dark' | null;
	reducedMotion: 'reduce' | 'no-preference' | null;
}

/** The provider's context media, which every story sees unless a driver switches it. */
export const providerMedia: {
	colorScheme: 'light' | 'dark';
	reducedMotion: 'reduce' | 'no-preference';
} = { colorScheme: 'light', reducedMotion: 'no-preference' };
