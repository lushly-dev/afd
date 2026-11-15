// Deprecated: no case renders it, so its record holds only what the manifest declares. Its control
// is a button in its shadow tree, as most components keep theirs; the variant configuration's
// `ShadowRole` renders it to show a role taken from there.
class ExampleDropdown extends HTMLElement {
	constructor() {
		super();
		this.attachShadow({ mode: 'open' }).innerHTML = '<button type="button">Choose</button>';
	}
}
if (!customElements.get('example-dropdown'))
	customElements.define('example-dropdown', ExampleDropdown);
