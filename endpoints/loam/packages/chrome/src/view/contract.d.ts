/** Declared here, so `tsc` reads a built file of another unit without taking it as a source. */
declare module '@lushly-dev/loam-theme/contract.json' {
	const contract: {
		tokens: Record<string, { property: string; kind: 'component' | 'shell' }>;
	};
	export default contract;
}
