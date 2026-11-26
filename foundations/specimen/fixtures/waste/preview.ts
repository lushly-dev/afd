// A waste plant for the static build (#1072): project annotations import the accessibility engine
// themselves, so every case would load axe-core, whether or not it checks accessibility.
import axe from 'axe-core';

export default { parameters: { engine: axe.version } };
