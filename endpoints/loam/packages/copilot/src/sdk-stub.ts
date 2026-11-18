/**
 * Stands in for a vendor SDK in the runtime chunks (4.3): TanStack's adapters reach `@anthropic-ai/sdk` and `openai`
 * only by a dynamic import for options Loam does not use, so the build aliases both here (16).
 */
export default class VendorSdkNotLoaded {
	constructor() {
		throw new Error('The vendor SDK is not part of the copilot runtime');
	}
}
