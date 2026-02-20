/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentSessions from '../agentSessions.js';
import type * as auth from '../auth.js';
import type * as http from '../http.js';
import type * as lists from '../lists.js';
import type * as noteFolders from '../noteFolders.js';
import type * as notes from '../notes.js';
import type * as todos from '../todos.js';

import type { ApiFromModules, FilterApi, FunctionReference } from 'convex/server';

declare const fullApi: ApiFromModules<{
	agentSessions: typeof agentSessions;
	auth: typeof auth;
	http: typeof http;
	lists: typeof lists;
	noteFolders: typeof noteFolders;
	notes: typeof notes;
	todos: typeof todos;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<typeof fullApi, FunctionReference<any, 'public'>>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, 'internal'>>;

export declare const components: {};
