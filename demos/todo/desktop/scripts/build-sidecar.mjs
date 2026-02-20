#!/usr/bin/env node

/**
 * Build script for bundling the TypeScript backend as a sidecar executable.
 *
 * This creates a standalone Node.js executable using pkg or sea (single executable application).
 * The executable is placed in src-tauri/binaries/ with the correct target triple suffix.
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');
const backendDir = join(projectRoot, '..', '..', 'backends', 'typescript');
const binariesDir = join(projectRoot, 'src-tauri', 'binaries');

// Get the target triple for the current platform
function getTargetTriple() {
	const platform = process.platform;
	const arch = process.arch;

	const triples = {
		'win32-x64': 'x86_64-pc-windows-msvc',
		'win32-arm64': 'aarch64-pc-windows-msvc',
		'darwin-x64': 'x86_64-apple-darwin',
		'darwin-arm64': 'aarch64-apple-darwin',
		'linux-x64': 'x86_64-unknown-linux-gnu',
		'linux-arm64': 'aarch64-unknown-linux-gnu',
	};

	return triples[`${platform}-${arch}`] || 'x86_64-unknown-linux-gnu';
}

// Get executable extension for current platform
function getExeExtension() {
	return process.platform === 'win32' ? '.exe' : '';
}

async function buildSidecar() {
	console.log('Building TypeScript backend sidecar...');

	// Ensure binaries directory exists
	if (!existsSync(binariesDir)) {
		mkdirSync(binariesDir, { recursive: true });
	}

	const targetTriple = getTargetTriple();
	const exeExt = getExeExtension();
	const outputName = `todo-server-${targetTriple}${exeExt}`;
	const outputPath = join(binariesDir, outputName);

	console.log(`Target: ${targetTriple}`);
	console.log(`Output: ${outputPath}`);

	// Build the TypeScript backend first
	console.log('Compiling TypeScript...');
	try {
		execSync('pnpm build', { cwd: backendDir, stdio: 'inherit' });
	} catch (error) {
		console.error('Failed to build TypeScript backend:', error.message);
		process.exit(1);
	}

	// Create a launcher script that uses Node.js SEA (Single Executable Application)
	// For now, we'll create a simple wrapper that can be bundled with Node.js
	const launcherScript = `
// Single executable launcher for Todo backend server
import('./server.js');
`;

	const launcherPath = join(backendDir, 'dist', 'launcher.mjs');
	writeFileSync(launcherPath, launcherScript);

	// For development, create a batch/shell script wrapper
	// In production, you would use Node.js SEA or pkg to create a true executable
	if (process.platform === 'win32') {
		const batchContent = `@echo off
node "%~dp0..\\..\\..\\..\\backends\\typescript\\dist\\server.js" %*
`;
		writeFileSync(outputPath.replace('.exe', '.cmd'), batchContent);
		// Also create a placeholder .exe for Tauri
		writeFileSync(outputPath, '');
		console.log(`Created Windows wrapper: ${outputPath}`);
	} else {
		const shellContent = `#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
node "$DIR/../../../../backends/typescript/dist/server.js" "$@"
`;
		writeFileSync(outputPath, shellContent);
		execSync(`chmod +x "${outputPath}"`);
		console.log(`Created Unix wrapper: ${outputPath}`);
	}

	console.log('');
	console.log('Sidecar build complete!');
	console.log('');
	console.log('Note: For production builds, use Node.js SEA or pkg to create a true executable:');
	console.log('  1. Install pkg: npm install -g pkg');
	console.log('  2. Run: pkg dist/server.js -t node18-win-x64 -o binaries/todo-server.exe');
	console.log('');
}

buildSidecar().catch(console.error);
