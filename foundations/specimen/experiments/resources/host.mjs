import { execFile as execFileCallback } from 'node:child_process';
import { cpus, loadavg, totalmem } from 'node:os';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function command(file, args) {
	try {
		return {
			status: 'available',
			value: (await execFile(file, args, { timeout: 5_000 })).stdout.trim(),
		};
	} catch (error) {
		return { status: 'unavailable', reason: error.message };
	}
}
const times = () =>
	cpus().reduce(
		(sum, cpu) => ({
			idle: sum.idle + cpu.times.idle,
			total: sum.total + Object.values(cpu.times).reduce((a, b) => a + b, 0),
		}),
		{ idle: 0, total: 0 }
	);

export async function hostSnapshot() {
	const before = times();
	await pause(200);
	const after = times();
	const logicalCores = cpus().length;
	const totalDelta = after.total - before.total;
	const usedCores =
		totalDelta > 0 ? logicalCores * (1 - (after.idle - before.idle) / totalDelta) : null;
	const [memoryPressure, swap, vmStats] = await Promise.all([
		command('/usr/bin/memory_pressure', ['-Q']),
		command('/usr/sbin/sysctl', ['vm.swapusage']),
		command('/usr/bin/vm_stat', []),
	]);
	const percent = memoryPressure.value?.match(/free percentage:\s*([\d.]+)%/i)?.[1];
	const swapMatch = swap.value?.match(/used\s*=\s*([\d.]+)([KMGT])/i);
	const swapUsedBytes = swapMatch
		? Number(swapMatch[1]) * 1024 ** { K: 1, M: 2, G: 3, T: 4 }[swapMatch[2].toUpperCase()]
		: null;
	const compressorMatch = vmStats.value?.match(/Pages occupied by compressor:\s*(\d+)/);
	const pageSizeMatch = vmStats.value?.match(/page size of (\d+) bytes/);
	return {
		timestampUtc: new Date().toISOString(),
		totalBytes: totalmem(),
		logicalCores,
		loadAverage: loadavg(),
		cpuWindowMs: 200,
		usedCores,
		freeMemoryPercent: percent === undefined ? null : Number(percent),
		swapUsedBytes,
		compressorBytes:
			compressorMatch && pageSizeMatch
				? Number(compressorMatch[1]) * Number(pageSizeMatch[1])
				: null,
		memoryPressure,
		swap,
		vmStats,
	};
}

export function admission(snapshot, { minFreeMemoryPercent = 25, reservedCores = 2 } = {}) {
	const reasons = [];
	if (snapshot.freeMemoryPercent === null) reasons.push('HOST_MEMORY_HEADROOM_UNAVAILABLE');
	else if (snapshot.freeMemoryPercent < minFreeMemoryPercent)
		reasons.push('HOST_MEMORY_HEADROOM_BELOW_RESERVE');
	if (snapshot.usedCores === null) reasons.push('HOST_CPU_HEADROOM_UNAVAILABLE');
	else if (snapshot.usedCores > snapshot.logicalCores - reservedCores)
		reasons.push('HOST_CPU_HEADROOM_BELOW_RESERVE');
	return { admitted: reasons.length === 0, reasons, minFreeMemoryPercent, reservedCores };
}
