/* Experimental macOS job observer. Compile: clang -std=c11 -Wall -Wextra -Werror. */
#define _DARWIN_C_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <libproc.h>
#include <mach/mach_time.h>
#include <signal.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/proc.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#define MAX_PROCESSES 65536
/* API layout omitted from SDK: apple-oss-distributions/xnu, bsd/sys/proc_info_private.h. */
#ifndef PROC_PIDUNIQIDENTIFIERINFO
#define PROC_PIDUNIQIDENTIFIERINFO 17
struct proc_uniqidentifierinfo {
	uint8_t p_uuid[16];
	uint64_t p_uniqueid, p_puniqueid;
	int32_t p_idversion, p_orig_ppidversion;
	uint64_t p_reserve2, p_reserve3;
};
#endif
_Static_assert(sizeof(struct proc_uniqidentifierinfo) == 56, "XNU unique identity ABI");
typedef struct {
	pid_t pid;
	struct proc_bsdinfo bsd;
	struct proc_uniqidentifierinfo unique;
	struct rusage_info_v4 usage;
	bool owned, measured, verified;
} Process;
typedef struct {
	pid_t pid;
	uint64_t sec, usec, abstime, uniqueid;
	int32_t idversion;
	char name[256];
} Identity;
static Identity identities[MAX_PROCESSES];
static Process processes[MAX_PROCESSES];
static pid_t pids[MAX_PROCESSES];
static size_t identity_count, process_count;
static Identity survivors_before[MAX_PROCESSES];
static size_t survivors_before_count;
static uint64_t read_failures, scan_failures, sample_count, exited_during_sample, signal_failures;
static bool tracking_overflow, limit_exceeded, wait_failed;
static bool root_enrollment_failed;
static mach_timebase_info_data_t timebase;
static volatile sig_atomic_t interrupted_signal;
static FILE *output;
static pid_t root_pid;
static double started_ms;

static double milliseconds(clockid_t clock) {
	struct timespec value;
	if (clock_gettime(clock, &value) != 0) { perror("clock_gettime"); exit(125); }
	return (double)value.tv_sec * 1000.0 + (double)value.tv_nsec / 1000000.0;
}
static double elapsed(void) { return milliseconds(CLOCK_MONOTONIC) - started_ms; }
static double seconds(struct timeval value) {
	return (double)value.tv_sec + (double)value.tv_usec / 1000000.0;
}
static uint64_t nanoseconds(uint64_t ticks) {
	__uint128_t converted = (__uint128_t)ticks * timebase.numer / timebase.denom;
	return converted > UINT64_MAX ? UINT64_MAX : (uint64_t)converted;
}
static void interrupted(int signal_number) { interrupted_signal = signal_number; }
static void pause_ms(unsigned duration) {
	struct timespec delay = { duration / 1000, (long)(duration % 1000) * 1000000 };
	(void)nanosleep(&delay, NULL);
}
static void json_string(const char *value) {
	fputc('"', output);
	for (const unsigned char *p = (const unsigned char *)value; *p; ++p) {
		if (*p == '"' || *p == '\\') { fputc('\\', output); fputc(*p, output); }
		else if (*p < 32 || *p >= 127) fprintf(output, "\\u%04x", *p);
		else fputc(*p, output);
	}
	fputc('"', output);
}
static Identity *known(const Process *process) {
	for (size_t i = 0; i < identity_count; ++i) {
		Identity *id = &identities[i];
		if (id->pid == process->pid && id->sec == process->bsd.pbi_start_tvsec &&
			id->usec == process->bsd.pbi_start_tvusec &&
			(!process->verified || id->uniqueid == process->unique.p_uniqueid)) return id;
	}
	return NULL;
}
static void remember(Process *process) {
	if (!process->verified) return;
	Identity *id = known(process);
	if (id) { id->idversion = process->unique.p_idversion; return; }
	if (identity_count == MAX_PROCESSES) { tracking_overflow = true; return; }
	id = &identities[identity_count++];
	id->pid = process->pid;
	id->sec = process->bsd.pbi_start_tvsec;
	id->usec = process->bsd.pbi_start_tvusec;
	id->abstime = process->measured ? process->usage.ri_proc_start_abstime : 0;
	id->uniqueid = process->unique.p_uniqueid;
	id->idversion = process->unique.p_idversion;
}
static void write_identity(const Identity *id);
static bool bsd_read(pid_t pid, struct proc_bsdinfo *bsd) {
	return proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, bsd, sizeof(*bsd)) == (int)sizeof(*bsd);
}
static bool same_identity(const Identity *id, const struct proc_bsdinfo *bsd) {
	return id->sec == bsd->pbi_start_tvsec && id->usec == bsd->pbi_start_tvusec;
}
static bool unique_read(pid_t pid, struct proc_uniqidentifierinfo *unique) {
	return proc_pidinfo(pid, PROC_PIDUNIQIDENTIFIERINFO, 0, unique, sizeof(*unique)) == (int)sizeof(*unique);
}
/* Enrollment is fail-closed and brackets unique-ID lookup with BSD start identity. */
static bool verify(Process *process) {
#ifdef SPECIMEN_TEST_ROOT_ENROLLMENT_FAILURE
	if (process->pid == root_pid) { ++read_failures; return false; }
#endif
	struct proc_bsdinfo checked;
	bool unique_ok = unique_read(process->pid, &process->unique);
	if (!bsd_read(process->pid, &checked)) {
		if (errno == ESRCH || errno == ENOENT) ++exited_during_sample;
		else ++read_failures;
		return false;
	}
	if (checked.pbi_status == SZOMB || checked.pbi_start_tvsec != process->bsd.pbi_start_tvsec ||
		checked.pbi_start_tvusec != process->bsd.pbi_start_tvusec) {
		++exited_during_sample; return false;
	}
	if (!unique_ok) {
		++read_failures;
		return false;
	}
	process->verified = true;
	return true;
}
static bool alive(const Identity *id) {
	struct proc_bsdinfo bsd;
	struct proc_uniqidentifierinfo unique;
	return bsd_read(id->pid, &bsd) && same_identity(id, &bsd) && bsd.pbi_status != SZOMB &&
		unique_read(id->pid, &unique) && unique.p_uniqueid == id->uniqueid;
}
static int signal_identity(const Identity *id, int signal_number) {
	audit_token_t token = {{0}};
	token.val[5] = (uint32_t)id->pid;
	token.val[7] = (uint32_t)id->idversion;
	return proc_signal_with_audittoken(&token, signal_number);
}
/* Kernel checks the execution identity and retains its ref atomically with signaling. */
static void signal_owned(int signal_number) {
	for (size_t i = 0; i < identity_count; ++i) {
		if (signal_identity(&identities[i], signal_number) != 0 && errno != ESRCH) ++signal_failures;
	}
}
static void start_id(const Identity *id) {
	if (id->abstime) fprintf(output, "\"%" PRIu64 "\"", id->abstime);
	else fprintf(output, "\"bsd:%" PRIu64 ":%" PRIu64 "\"", id->sec, id->usec);
}
static void write_identity(const Identity *id) {
	fprintf(output, "{\"pid\":%d,\"startId\":", id->pid);
	start_id(id); fprintf(output, ",\"uniqueId\":\"%" PRIu64 "\",\"idversion\":%u,\"name\":", id->uniqueid, (uint32_t)id->idversion);
	json_string(id->name); fputc('}', output);
}
static size_t survivor_list(bool write_json) {
	size_t count = 0;
	if (write_json) fputc('[', output);
	for (size_t i = 0; i < identity_count; ++i) {
		Identity *id = &identities[i];
		if (!alive(id)) continue;
		if (write_json) {
			if (count) fputc(',', output);
			write_identity(id);
		}
		++count;
	}
	if (write_json) fputc(']', output);
	return count;
}
static bool enroll_descendant(Process *process) {
	if (!process->verified) return false;
	for (size_t i = 0; i < process_count; ++i) {
		const Process *parent = &processes[i];
		if (!parent->owned || !parent->verified || parent->pid == process->pid ||
			process->bsd.pbi_ppid != (uint32_t)parent->pid ||
			process->unique.p_puniqueid != parent->unique.p_uniqueid) continue;
		remember(process);
		process->owned = known(process) != NULL;
		return process->owned;
	}
	return false;
}
static uint64_t sample(void) {
	int count = proc_listallpids(pids, sizeof(pids));
	process_count = 0;
	/* An empty/failed whole enumeration is incomplete collection, not a protected row. */
	if (count <= 0) { ++read_failures; count = 0; }
	if (count >= MAX_PROCESSES) { count = MAX_PROCESSES; tracking_overflow = true; }
	for (int i = 0; i < count; ++i) {
		if (pids[i] <= 0 || pids[i] == getpid()) continue;
		Process process = { .pid = pids[i] };
		if (!bsd_read(process.pid, &process.bsd)) { ++scan_failures; continue; }
		if (process.bsd.pbi_status == SZOMB) continue;
		Identity *id = known(&process);
		process.owned = id && verify(&process) && id->uniqueid == process.unique.p_uniqueid;
		if (process.owned) remember(&process);
		processes[process_count++] = process;
	}
	/* New ownership requires the child's kernel parent unique ID, never PPID/group alone. */
	bool changed;
	do {
		changed = false;
		for (size_t i = 0; i < process_count; ++i) {
			Process *process = &processes[i];
			if (process->owned) continue;
			bool candidate = false;
			for (size_t j = 0; !candidate && j < process_count; ++j)
				candidate = processes[j].owned && process->bsd.pbi_ppid == (uint32_t)processes[j].pid;
			if (candidate && verify(process) && enroll_descendant(process)) changed = true;
		}
	} while (changed);
	uint64_t footprint = 0;
	fprintf(output, "{\"type\":\"sample\",\"timestampMs\":%.3f,\"elapsedMs\":%.3f,\"processes\":[",
		milliseconds(CLOCK_REALTIME), elapsed());
	bool comma = false;
	/* Stable root-first order; observer resources never enter this array. */
	for (int pass = 0; pass < 2; ++pass) for (size_t i = 0; i < process_count; ++i) {
		Process *process = &processes[i];
		if (!process->owned || (process->pid == root_pid) != (pass == 0)) continue;
		process->measured = proc_pid_rusage(process->pid, RUSAGE_INFO_V4,
			(rusage_info_t *)&process->usage) == 0;
		char path[PROC_PIDPATHINFO_MAXSIZE] = {0};
		bool path_read = proc_pidpath(process->pid, path, sizeof(path)) > 0;
		uint64_t expected_uniqueid = process->unique.p_uniqueid;
		if (!verify(process)) continue;
		if (expected_uniqueid != process->unique.p_uniqueid) { ++exited_during_sample; continue; }
		remember(process);
		if (!process->measured) { ++read_failures; continue; }
		Identity *id = known(process);
		if (!id) continue;
		if (!id->abstime) id->abstime = process->usage.ri_proc_start_abstime;
		const char *name = process->bsd.pbi_name[0] ? process->bsd.pbi_name : process->bsd.pbi_comm;
		if (path_read) {
			const char *slash = strrchr(path, '/'); name = slash ? slash + 1 : path;
		}
		snprintf(id->name, sizeof(id->name), "%.*s", (int)sizeof(id->name) - 1, name);
		if (comma) fputc(',', output);
		comma = true;
		fprintf(output, "{\"pid\":%d,\"ppid\":%u,\"pgid\":%u,\"startId\":",
			process->pid, process->bsd.pbi_ppid, process->bsd.pbi_pgid);
		start_id(id); fprintf(output, ",\"uniqueId\":\"%" PRIu64 "\",\"idversion\":%u,\"name\":", id->uniqueid, (uint32_t)id->idversion); json_string(id->name);
		struct rusage_info_v4 *u = &process->usage;
		fprintf(output, ",\"userNs\":%" PRIu64 ",\"systemNs\":%" PRIu64
			",\"childUserNs\":%" PRIu64 ",\"childSystemNs\":%" PRIu64
			",\"rssBytes\":%" PRIu64 ",\"footprintBytes\":%" PRIu64 "}",
			nanoseconds(u->ri_user_time), nanoseconds(u->ri_system_time), nanoseconds(u->ri_child_user_time),
			nanoseconds(u->ri_child_system_time), u->ri_resident_size, u->ri_phys_footprint);
		if (UINT64_MAX - footprint < u->ri_phys_footprint) footprint = UINT64_MAX;
		else footprint += u->ri_phys_footprint;
	}
	fprintf(output, "],\"sampledFootprintBytes\":%" PRIu64 "}\n", footprint);
	fflush(output); ++sample_count;
	return footprint;
}
static bool reap(int *status, struct rusage *usage) {
	pid_t result = wait4(root_pid, status, WNOHANG, usage);
	if (result == root_pid) return true;
	if (result < 0 && errno != EINTR) { perror("wait4"); wait_failed = true; }
	return false;
}
static uint64_t number(const char *value) {
	char *end = NULL;
	errno = 0;
	unsigned long long parsed = strtoull(value, &end, 10);
	if (errno || !value[0] || value[0] == '-' || *end) {
		fprintf(stderr, "Invalid numeric argument: %s\n", value); exit(125);
	}
	return (uint64_t)parsed;
}
static int signal_mode(int argc, char **argv) {
	unsigned signaled = 0, stale = 0, errors = 0;
	char *end;
	errno = 0;
	long sig = argc > 2 ? strtol(argv[2], &end, 10) : 0;
	if (argc < 4 || errno || sig <= 0 || sig >= NSIG || *end) {
		puts("{\"signaled\":0,\"stale\":0,\"errors\":1}"); return 125;
	}
	for (int i = 3; i < argc; ++i) {
		char *version;
		errno = 0;
		long pid = strtol(argv[i], &version, 10);
		if (errno || pid <= 0 || pid > INT32_MAX || *version != ':') { ++errors; continue; }
		const char *digits = version + 1;
		errno = 0;
		unsigned long idversion = strtoul(digits, &end, 10);
		if (errno || !*digits || *digits == '-' || *end || idversion > UINT32_MAX) { ++errors; continue; }
		Identity id = { .pid = (pid_t)pid, .idversion = (int32_t)(uint32_t)idversion };
		if (signal_identity(&id, (int)sig) == 0) ++signaled;
		else if (errno == ESRCH) ++stale;
		else ++errors;
	}
	printf("{\"signaled\":%u,\"stale\":%u,\"errors\":%u}\n", signaled, stale, errors);
	return errors ? 125 : 0;
}
int main(int argc, char **argv) {
	if (argc > 1 && !strcmp(argv[1], "--signal-owned")) return signal_mode(argc, argv);
	const char *path = NULL;
	unsigned interval = 100, grace = 500;
	uint64_t maximum = UINT64_C(2147483648);
	int command = 0;
	for (int i = 1; i < argc; ++i) {
		if (!strcmp(argv[i], "--")) { command = i + 1; break; }
		if (i + 1 >= argc) break;
		if (!strcmp(argv[i], "--out")) path = argv[++i];
		else if (!strcmp(argv[i], "--interval-ms")) {
			uint64_t n = number(argv[++i]); if (n < 1 || n > 60000) return 125; interval = (unsigned)n;
		} else if (!strcmp(argv[i], "--grace-ms")) {
			uint64_t n = number(argv[++i]); if (n > 60000) return 125; grace = (unsigned)n;
		} else if (!strcmp(argv[i], "--max-footprint-bytes")) maximum = number(argv[++i]);
		else { fprintf(stderr, "Unknown option: %s\n", argv[i]); return 125; }
	}
	if (!path || !command || command >= argc) {
		fputs("Usage: collector --out PATH [--interval-ms N --grace-ms N --max-footprint-bytes N] -- COMMAND ARGS...\n", stderr);
		return 125;
	}
	output = fopen(path, "w");
	if (!output) { perror(path); return 125; }
	if (mach_timebase_info(&timebase) != KERN_SUCCESS || !timebase.denom) {
		fputs("{\"type\":\"error\",\"code\":\"TIMEBASE_UNAVAILABLE\"}\n", output);
		fclose(output); return 125;
	}
	(void)fcntl(fileno(output), F_SETFD, FD_CLOEXEC);
	started_ms = milliseconds(CLOCK_MONOTONIC);
	struct sigaction action = { .sa_handler = interrupted };
	sigemptyset(&action.sa_mask);
	(void)sigaction(SIGINT, &action, NULL); (void)sigaction(SIGTERM, &action, NULL);
	(void)signal(SIGPIPE, SIG_IGN);
	(void)signal(SIGCHLD, SIG_DFL);
	int ready[2];
	if (pipe(ready) != 0) { perror("pipe"); fclose(output); return 125; }
	root_pid = fork();
	if (root_pid < 0) { perror("fork"); fclose(output); return 125; }
	if (root_pid == 0) {
		close(ready[1]);
		if (setpgid(0, 0) != 0) _exit(125);
		char byte;
		if (read(ready[0], &byte, 1) != 1) _exit(125);
		close(ready[0]);
		(void)signal(SIGINT, SIG_DFL); (void)signal(SIGTERM, SIG_DFL);
		(void)signal(SIGPIPE, SIG_DFL);
		execvp(argv[command], &argv[command]); perror(argv[command]); _exit(127);
	}
	close(ready[0]); (void)setpgid(root_pid, root_pid);
	Process root = { .pid = root_pid };
	if (bsd_read(root_pid, &root.bsd) && verify(&root)) {
		root.measured = proc_pid_rusage(root_pid, RUSAGE_INFO_V4, (rusage_info_t *)&root.usage) == 0;
		remember(&root);
	} else root_enrollment_failed = true;
	fprintf(output, "{\"type\":\"start\",\"rootPid\":%d,\"pgid\":%d,\"timestampMs\":%.3f,\"elapsedMs\":%.3f,\"intervalMs\":%u,\"graceMs\":%u,\"maxFootprintBytes\":%" PRIu64 ",\"timebaseNumer\":%u,\"timebaseDenom\":%u,\"rootIdversion\":",
		root_pid, root_pid, milliseconds(CLOCK_REALTIME), elapsed(), interval, grace, maximum, timebase.numer, timebase.denom);
	Identity *root_identity = known(&root);
	if (root_identity) {
		fprintf(output, "%u,\"rootUniqueId\":\"%" PRIu64 "\",\"rootStartId\":", (uint32_t)root_identity->idversion, root_identity->uniqueid);
		start_id(root_identity);
	} else fputs("null,\"rootUniqueId\":null,\"rootStartId\":null", output);
	fputs("}\n", output);
	if (root_enrollment_failed) fputs("{\"type\":\"error\",\"code\":\"ROOT_IDENTITY_UNAVAILABLE\",\"commandReleased\":false}\n", output);
	fflush(output);
	if (!root_enrollment_failed) (void)write(ready[1], "x", 1);
	close(ready[1]);
	int status = 0;
	struct rusage waited = {0};
	bool exited = false;
	double exit_ms = 0;
	for (;;) {
		if (!exited && reap(&status, &waited)) { exited = true; exit_ms = elapsed(); }
		uint64_t footprint = sample();
		if (maximum && footprint > maximum) limit_exceeded = true;
		if (limit_exceeded || interrupted_signal || wait_failed || ferror(output)) break;
		if (exited && (root_enrollment_failed || elapsed() - exit_ms >= grace)) break;
		pause_ms(interval);
	}
	/* Capture pre-cleanup identities as a separate event so the final summary can retain them. */
	for (size_t i = 0; i < identity_count; ++i)
		if (alive(&identities[i])) survivors_before[survivors_before_count++] = identities[i];
	fputs("{\"type\":\"cleanup\",\"survivorsBeforeCleanup\":", output);
	(void)survivor_list(true); fputs("}\n", output); fflush(output);
	/* Re-scan during cleanup to discover forks from still-verified owned parents. */
	for (int stage = 0; stage < 2; ++stage) {
		double deadline = elapsed() + 500;
		do {
			signal_owned(stage == 0 ? SIGTERM : SIGKILL);
			if (!exited && reap(&status, &waited)) { exited = true; exit_ms = elapsed(); }
			if (!survivor_list(false)) break;
			pause_ms(20); (void)sample();
		} while (elapsed() < deadline);
	}
	if (!exited) exited = reap(&status, &waited);
	int exit_code = !exited ? 125 : WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
	int exit_signal = exited && WIFSIGNALED(status) ? WTERMSIG(status) : 0;
	fprintf(output, "{\"type\":\"exit\",\"exitCode\":%d,\"signal\":%d,\"userSeconds\":%.6f,\"systemSeconds\":%.6f,\"waitedDescendantCpuIncluded\":%s,\"waitAccounting\":\"root-and-descendants-reaped-through-root\",\"rootReaped\":%s,\"elapsedMs\":%.3f}\n",
		exit_code, exit_signal, seconds(waited.ru_utime), seconds(waited.ru_stime), exited ? "true" : "false", exited ? "true" : "false", elapsed());
	struct rusage sampler = {0}; (void)getrusage(RUSAGE_SELF, &sampler);
	struct rusage_info_v4 sampler_memory = {0};
	bool sampler_memory_read = proc_pid_rusage(getpid(), RUSAGE_INFO_V4,
		(rusage_info_t *)&sampler_memory) == 0;
	fprintf(output, "{\"type\":\"summary\",\"samplerUserSeconds\":%.6f,\"samplerSystemSeconds\":%.6f,\"samples\":%" PRIu64 ",\"readFailures\":%" PRIu64 ",\"processScanFailures\":%" PRIu64 ",\"limitExceeded\":%s,\"interruptedSignal\":%d,\"trackingOverflow\":%s,\"survivorsBeforeCleanup\":[",
		seconds(sampler.ru_utime), seconds(sampler.ru_stime), sample_count, read_failures, scan_failures,
		limit_exceeded ? "true" : "false", interrupted_signal, tracking_overflow ? "true" : "false");
	for (size_t i = 0; i < survivors_before_count; ++i) {
		if (i) fputc(',', output);
		write_identity(&survivors_before[i]);
	}
	fputs("],\"survivorsAfterCleanup\":", output);
	(void)survivor_list(true);
	if (sampler_memory_read) {
		fprintf(output, ",\"samplerFootprintBytes\":%" PRIu64 ",\"samplerRssBytes\":%" PRIu64
			",\"samplerLifetimeMaxFootprintBytes\":%" PRIu64,
			sampler_memory.ri_phys_footprint, sampler_memory.ri_resident_size,
			sampler_memory.ri_lifetime_max_phys_footprint);
	} else {
		fputs(",\"samplerFootprintBytes\":null,\"samplerRssBytes\":null,\"samplerLifetimeMaxFootprintBytes\":null", output);
	}
	fprintf(output, ",\"exitedDuringSample\":%" PRIu64 ",\"signalFailures\":%" PRIu64 ",\"rootEnrollmentFailed\":%s,\"timebaseNumer\":%u,\"timebaseDenom\":%u,\"memoryAccounting\":\"sampled-sum-of-process-physical-footprints-not-unique-system-bytes\",\"trackingLimitations\":[\"sampling-can-miss-short-lived-processes\",\"reparented-before-observation-processes-can-be-missed\",\"wait4-excludes-descendants-not-reaped-through-root\"],\"elapsedMs\":%.3f}\n", exited_during_sample, signal_failures, root_enrollment_failed ? "true" : "false", timebase.numer, timebase.denom, elapsed());
	bool output_failed = ferror(output) != 0;
	if (fclose(output) != 0) output_failed = true;
	if (output_failed) return 125;
	if (interrupted_signal) return 128 + interrupted_signal;
	if (limit_exceeded) return 124;
	return exit_code;
}
