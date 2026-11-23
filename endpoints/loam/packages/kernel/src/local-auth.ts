/**
 * @fileoverview `local` mode's identity adapter (phase 3 specification, 2.1 and 4.4; D85, renamed by D162): the person
 * who uses this Loam signs in on the page, with no provider, and every actor is a member and an owner.
 *
 * It is `MockAuthAdapter`'s behaviour under Loam's own name, so local mode no longer constructs an adapter named for a
 * test double on the path the owner uses every day, and nothing it does changes: a credentials sign-in makes the
 * person `mock-user-<email>`, the id every journal, store and replay already records; a session lasts an hour on the
 * kernel's clock; and the late commands attach the session, passkey and organization capabilities
 * (`withMockCapabilities`) as they did. `MockAuthAdapter` stays in `@lushly-dev/afd-auth` as the test double, which
 * the kernel's tests and replays construct. It is `@lushly-dev/loam-kernel/local-auth`, out of the kernel's root, so
 * the kernel-alone bundle stays without the Mock; the web host, which constructs it, carried the Mock before too.
 * Changing what local sign-in does needs a decision of its own. Since it
 * extends the Mock, a change to the Mock changes local mode too: `local-auth.test.ts` pins the person's id and the
 * session's hour on `LocalAuthAdapter` itself, so a Mock change that moves either fails there.
 */

import { MockAuthAdapter } from '@lushly-dev/afd-auth';

/** `local` mode's identity: one session per page, signed in on the page (D85, D162). */
export class LocalAuthAdapter extends MockAuthAdapter {}
