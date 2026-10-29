/* Direct checks of the collector's ownership and kernel-atomic signaling paths. */
#define main collector_main
#include "darwin.c"
#undef main

static int ancestry_check(void) {
	process_count = 1;
	processes[0] = (Process){
		.pid = 100, .owned = true, .verified = true, .unique = {.p_uniqueid = 555}
	};
	Process candidate = {
		.pid = 101, .verified = true,
		.bsd = {.pbi_ppid = 100, .pbi_start_tvsec = 1},
		.unique = {.p_uniqueid = 777, .p_puniqueid = 999, .p_idversion = 1}
	};
	if (enroll_descendant(&candidate) || candidate.owned || identity_count) return 1;
	candidate.unique.p_puniqueid = 555;
	processes[0].verified = false;
	if (enroll_descendant(&candidate) || candidate.owned || identity_count) return 2;
	processes[0].verified = true;
	candidate.verified = false;
	if (enroll_descendant(&candidate) || candidate.owned || identity_count) return 3;
	candidate.verified = true;
	if (!enroll_descendant(&candidate) || !candidate.owned || identity_count != 1) return 4;
	identity_count = 0;
	process_count = 0;
	return 0;
}

static int atomic_signal_check(void) {
	int held[2];
	if (pipe(held) != 0) return 1;
	(void)signal(SIGCHLD, SIG_DFL);
	(void)signal(SIGTERM, SIG_DFL);
	pid_t child = fork();
	if (child < 0) { close(held[0]); close(held[1]); return 2; }
	if (child == 0) {
		close(held[1]);
		char byte;
		(void)read(held[0], &byte, 1);
		close(held[0]);
		_exit(0);
	}
	close(held[0]);
	/* This direct child cannot have its PID reused until this process reaps it. */
	Process process = {.pid = child};
	int result = 0;
	if (!bsd_read(child, &process.bsd) || !verify(&process)) result = 3;
	Identity exact = {
		.pid = child, .idversion = process.unique.p_idversion
	};
	if (!result) {
		Identity stale = exact;
		stale.idversion = (int32_t)((uint32_t)exact.idversion + 1);
		errno = 0;
		if (signal_identity(&stale, SIGTERM) == 0 || errno != ESRCH) result = 4;
	}
	int status = 0;
	if (!result && waitpid(child, &status, WNOHANG) != 0) result = 5;
	if (!result && signal_identity(&exact, SIGTERM) != 0) result = 6;
	/* EOF also releases the held child on a failed check; no PID-only signal fallback. */
	close(held[1]);
	pid_t waited;
	do { waited = waitpid(child, &status, 0); } while (waited < 0 && errno == EINTR);
	if (!result && (waited != child || !WIFSIGNALED(status) || WTERMSIG(status) != SIGTERM)) result = 7;
	return result;
}

int main(void) {
	int ancestry = ancestry_check();
	int atomic = ancestry ? 0 : atomic_signal_check();
	if (ancestry || atomic) {
		printf("{\"status\":\"failed\",\"ancestryFailure\":%d,\"atomicSignalFailure\":%d}\n", ancestry, atomic);
		return 1;
	}
	puts("{\"status\":\"passed\",\"checks\":[\"parent-unique-id-mismatch-rejected\",\"unverified-parent-rejected\",\"unverified-child-rejected\",\"verified-ancestry-enrolled\",\"stale-idversion-rejected-with-ESRCH\",\"stale-token-keeps-child-alive\",\"exact-token-SIGTERM-terminates-and-reaps-child\"]}");
	return 0;
}
