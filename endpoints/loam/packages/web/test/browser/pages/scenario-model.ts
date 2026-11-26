/**
 * The scenarios' model in the page (phase 5 specification, P5-A1): the test provider playing the kernel's scenario
 * scripts (`kernel/scenarios/model-scripts.ts`), with the `echo-unit` composer, as the kernel's seed plays them in its
 * units. `scenarios.test.ts` puts it behind the page's model transport, where `kind = "test"` is answered.
 */
export { createScenarioProvider } from '../../../../kernel/scenarios/model-scripts.ts';
