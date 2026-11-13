// Deprecated: no case renders it, so its record holds only what the manifest declares.
class ExampleDropdown extends HTMLElement {}
if (!customElements.get('example-dropdown'))
	customElements.define('example-dropdown', ExampleDropdown);
