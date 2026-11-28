// A waste plant for the static build (#2633): project annotations import a play's helpers
// themselves, so every case would load interaction support, whether or not it runs a play.
import { expect } from '../../src/test.js';

export default { parameters: { matcher: typeof expect } };
