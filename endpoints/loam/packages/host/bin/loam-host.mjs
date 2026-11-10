#!/usr/bin/env node
// Committed, unlike dist/: pnpm links a dependent's bin at install, and only to a file that exists then.
import { runHostCli } from '../dist/cli.js';

process.exitCode = await runHostCli(process.argv.slice(2));
