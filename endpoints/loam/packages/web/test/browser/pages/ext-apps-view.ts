/**
 * E2's conformance fixture: a view built on `@modelcontextprotocol/ext-apps`' `App`, which knows nothing
 * of Loam. `connect` refuses a `ui/initialize` result that fails that package's schema.
 */
import { App } from '@modelcontextprotocol/ext-apps';

const app = new App({ name: 'conformance', version: '1.0.0' }, {});
const state: Record<string, unknown> = {};
(window as unknown as { conformance: unknown }).conformance = state;

app.onteardown = async () => {
	console.log('conformance: teardown');
	return {};
};
app.ontoolresult = (result) => {
	state.toolResult = result;
};

app
	.connect()
	.then(async () => {
		state.hostContext = app.getHostContext();
		state.hostCapabilities = app.getHostCapabilities();
		state.called = await app.callServerTool({ name: 'fixture-echo', arguments: {} });
		state.connected = true;
	})
	.catch((cause: unknown) => {
		state.failed = String(cause);
	});
