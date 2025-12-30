#!/usr/bin/env node

/**
 * @fileoverview CLI entry point
 */

import { createCli } from './cli.js';

const program = createCli();

program.parse();
