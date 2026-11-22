/**
 * @fileoverview The commands that move a person's active scope, what main shows or the session: a person's or an
 * agent's in process, never a server's, which holds no active scope (phase 2 specification, 3.3). Its own module, so
 * `/testing` can name it without loading `late/` (phase 6 specification, 7's unit).
 */

export const PERSON_SESSION: readonly string[] = Object.freeze([
	'scope-set',
	'section-open',
	'app-open',
	'app-close',
	'app-route-set',
	'auth-sign-in',
	'auth-sign-out',
]);
