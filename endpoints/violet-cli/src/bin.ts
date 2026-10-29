#!/usr/bin/env node

/**
 * Violet Design CLI Entry Point
 */

import { createCLI } from './cli.js';

const cli = createCLI();
cli.parse(process.argv);
