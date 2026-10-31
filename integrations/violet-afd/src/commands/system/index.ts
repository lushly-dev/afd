/**
 * System commands for Violet Design
 *
 * Health checks, validation, and documentation generation.
 */

export {
	doctorCommand,
	registerSystemCommands as registerDoctorCommand,
} from './doctor.js';
export { systemValidateCommand, registerValidateCommand } from './validate.js';

import { registerSystemCommands as registerDoctor } from './doctor.js';
import { registerValidateCommand } from './validate.js';

/**
 * Register all system commands
 */
export function registerSystemCommands(): void {
	registerDoctor();
	registerValidateCommand();
}
