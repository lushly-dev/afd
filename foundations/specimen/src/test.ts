// `@vitest/expect`'s declarations read chai's global namespace, which a strict layout hides.
/// <reference types="chai" preserve="true" />
/**
 * The helpers a play imports, with no Storybook installed: `expect`, `fn`, `spyOn`, `userEvent`,
 * `waitFor` and `within`. They are the libraries `storybook/test` bundles, at the versions it
 * bundles, assembled the way it assembles them, so a play means the same thing here.
 *
 *     import { expect, userEvent, within } from '@lushly-dev/specimen/test';
 */

import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';
import * as matchers from '@testing-library/jest-dom/matchers';
import type {
	AsymmetricMatchersContaining,
	ExpectStatic,
	JestAssertion,
	MatcherState,
	MatchersObject,
} from '@vitest/expect';
import {
	customMatchers,
	GLOBAL_EXPECT,
	getState,
	JestAsymmetricMatchers,
	JestChaiExpect,
	JestExtend,
	setState,
} from '@vitest/expect';
import * as chai from 'chai';

export { waitFor, within } from '@testing-library/dom';
export { userEvent } from '@testing-library/user-event';
export { fn, spyOn } from '@vitest/spy';

/** A matcher you can await, as a play does in Storybook, where each one is instrumented. */
type Promisify<Fn> = Fn extends (...args: infer Args) => infer Return
	? (...args: Args) => Return extends Promise<unknown> ? Return : Promise<Return>
	: Fn;
type Matchers<T> = {
	[K in keyof JestAssertion<T>]: Promisify<JestAssertion<T>[K]>;
} & TestingLibraryMatchers<ReturnType<ExpectStatic['stringContaining']>, Promise<void>>;
export interface Assertion<T> extends Matchers<T> {
	toHaveBeenCalledOnce(): Promise<void>;
	toSatisfy<E>(matcher: (value: E) => boolean, message?: string): Promise<void>;
	resolves: Assertion<T>;
	rejects: Assertion<T>;
	not: Assertion<T>;
}
export interface Expect extends AsymmetricMatchersContaining {
	<T>(actual: T, message?: string): Assertion<T>;
	unreachable(message?: string): Promise<never>;
	soft<T>(actual: T, message?: string): Assertion<T>;
	extend(expects: MatchersObject): void;
	assertions(expected: number): Promise<void>;
	hasAssertions(): Promise<void>;
	anything(): unknown;
	any(type: unknown): unknown;
	getState(): MatcherState;
	setState(state: Partial<MatcherState>): void;
	not: AsymmetricMatchersContaining;
}

function createExpect(): ExpectStatic {
	chai.use(JestExtend);
	chai.use(JestChaiExpect);
	chai.use(JestAsymmetricMatchers);
	const created = ((value: unknown, message?: string) => {
		const { assertionCalls } = getState(created);
		setState({ assertionCalls: assertionCalls + 1, soft: false }, created);
		return chai.expect(value, message);
	}) as ExpectStatic & Pick<Expect, 'soft' | 'unreachable'>;
	Object.assign(created, chai.expect);
	created.getState = () => getState(created);
	created.setState = (state) => setState(state, created);
	// `JestExtend` adds this to chai's own `expect`, which takes the expect to extend first.
	const base = chai.expect as unknown as { extend(...args: unknown[]): void };
	created.extend = (expects) => base.extend(created, expects);
	created.soft = (actual, message) => {
		const assertion = created(actual, message);
		created.setState({ soft: true });
		return assertion as unknown as Assertion<typeof actual>;
	};
	created.extend(customMatchers);
	created.unreachable = (message) =>
		chai.assert.fail(`expected${message ? ` "${message}" ` : ' '}not to be reached`);
	setState(
		{
			assertionCalls: 0,
			isExpectingAssertions: false,
			isExpectingAssertionsError: null,
			expectedAssertionsNumber: null,
			expectedAssertionsNumberErrorGen: null,
		},
		created
	);
	chai.util.addMethod(created, 'assertions', (expected: number) => {
		const error = () =>
			new Error(
				`expected number of assertions to be ${expected}, but got ${created.getState().assertionCalls}`
			);
		created.setState({
			expectedAssertionsNumber: expected,
			expectedAssertionsNumberErrorGen: error,
		});
	});
	chai.util.addMethod(created, 'hasAssertions', () => {
		created.setState({
			isExpectingAssertions: true,
			isExpectingAssertionsError: new Error('expected any number of assertion, but got none'),
		});
	});
	created.extend(matchers as unknown as MatchersObject);
	Object.defineProperty(globalThis, GLOBAL_EXPECT, {
		value: created,
		writable: true,
		configurable: true,
	});
	return created;
}

export const expect = createExpect() as unknown as Expect;
