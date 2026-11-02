#!/usr/bin/env node
// Committed, unlike dist/: pnpm links a dependent's bin at install, and only to a file that exists then.
import { runCli } from '../dist/cli.js';

process.exitCode = await runCli(process.argv.slice(2));
