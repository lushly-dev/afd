/** Observe HTML construction without coercing or rewriting native inputs. */
export function observeHtmlConstruction(): readonly string[] {
	const reasons: string[] = [];
	const observed = new Set<string>();

	function incomplete(api: string, detail: string): void {
		const key = `${api}:${detail}`;
		if (observed.has(key)) return;
		observed.add(key);
		reasons.push(
			`Possible declarative shadow content, including closed roots, is excluded from the complete-DOM claim after ${api}: ${detail}.`
		);
	}

	function inspect(value: unknown, api: string): void {
		if (typeof value === 'string') {
			if (/shadowrootmode/i.test(value)) incomplete(api, 'input contains shadowrootmode');
		} else {
			// TrustedHTML and other objects retain their native conversion behavior.
			// Calling String(value) here could invoke user code a second time.
			incomplete(api, 'non-string HTML input cannot be inspected without coercion');
		}
	}

	function method(target: object, name: string, api: string, inputIndex = 0): void {
		const descriptor = Object.getOwnPropertyDescriptor(target, name);
		const original: unknown = Reflect.get(target, name);
		if (typeof original !== 'function') return;
		const replacement = function (this: unknown, ...args: unknown[]): unknown {
			if (name.startsWith('stream')) incomplete(api, 'streamed HTML input cannot be inspected');
			else if (name === 'write' || name === 'writeln') {
				if (args.length) {
					if (args.every((value) => typeof value === 'string')) inspect(args.join(''), api);
					else incomplete(api, 'non-string HTML input cannot be inspected without coercion');
				}
			} else inspect(args[inputIndex], api);
			return Reflect.apply(original, this, args);
		};
		try {
			Object.defineProperty(target, name, {
				...(descriptor ?? { configurable: true, enumerable: false, writable: true }),
				value: replacement,
			});
		} catch {
			incomplete(api, 'native HTML construction method cannot be observed');
		}
	}

	function setter(target: object, name: string, api: string): void {
		const descriptor = Object.getOwnPropertyDescriptor(target, name);
		const original = descriptor?.set;
		if (!original) return;
		try {
			Object.defineProperty(target, name, {
				...descriptor,
				set(this: unknown, value: unknown) {
					inspect(value, api);
					Reflect.apply(original, this, [value]);
				},
			});
		} catch {
			incomplete(api, 'native HTML construction setter cannot be observed');
		}
	}

	for (const [target, prefix] of [
		[Element.prototype, 'Element'],
		[ShadowRoot.prototype, 'ShadowRoot'],
	] as const) {
		for (const name of [
			'setHTML',
			'setHTMLUnsafe',
			'appendHTML',
			'appendHTMLUnsafe',
			'prependHTML',
			'prependHTMLUnsafe',
			'streamHTML',
			'streamHTMLUnsafe',
		])
			method(target, name, `${prefix}.${name}`);
		setter(target, 'innerHTML', `${prefix}.innerHTML`);
	}
	setter(Element.prototype, 'outerHTML', 'Element.outerHTML');
	method(Element.prototype, 'insertAdjacentHTML', 'Element.insertAdjacentHTML', 1);
	for (const name of ['parseHTML', 'parseHTMLUnsafe']) method(Document, name, `Document.${name}`);
	for (const name of ['write', 'writeln']) method(Document.prototype, name, `Document.${name}`);
	method(DOMParser.prototype, 'parseFromString', 'DOMParser.parseFromString');
	method(Range.prototype, 'createContextualFragment', 'Range.createContextualFragment');

	// This is deliberately document-global and is not reset on disposal: parsed
	// documents and detached nodes can be adopted or cloned into a later mount.
	return reasons;
}
