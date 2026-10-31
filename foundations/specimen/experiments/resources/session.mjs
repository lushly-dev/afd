/** Identities a measurement session records about its host and the code it measured. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { cpus, release, totalmem } from 'node:os';
import { join, relative } from 'node:path';

export const sha256File = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** Every file under `directory`: an entry point alone (dist/index.js re-exports) proves little. */
export function directoryDigest(directory) {
	const files = readdirSync(directory, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => join(entry.parentPath, entry.name))
		.sort();
	const hash = createHash('sha256');
	for (const file of files) hash.update(`${relative(directory, file)}\0${sha256File(file)}\n`);
	return { files: files.length, sha256: hash.digest('hex') };
}

const readback = (command, args) => {
	try {
		return execFileSync(command, args, { encoding: 'utf8' }).trim();
	} catch {
		return null;
	}
};

export function hostDetails() {
	return {
		cpu: cpus()[0]?.model,
		logicalCores: cpus().length,
		totalBytes: totalmem(),
		kernel: release(),
		model: readback('/usr/sbin/sysctl', ['-n', 'hw.model']),
		performanceCores: readback('/usr/sbin/sysctl', ['-n', 'hw.perflevel0.physicalcpu']),
		efficiencyCores: readback('/usr/sbin/sysctl', ['-n', 'hw.perflevel1.physicalcpu']),
		os: readback('/usr/bin/sw_vers', ['-productVersion']),
		osBuild: readback('/usr/bin/sw_vers', ['-buildVersion']),
	};
}
