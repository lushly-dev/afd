# The builder's workspace, for the Loam OS host (Loam OS M1 step 2)

- Date: 2026-11-27
- Area: every other area
- Pull request: [#2974](https://github.com/lushly-dev/afd/pull/2974), on `lush/loam-os-records-harness-2914` ([#2914](https://github.com/lushly-dev/afd/issues/2914))

`HostBuilder::workspace` returns the workspace the builder opened, before `seal`. The Loam OS
host's `install` reads it twice: for the state directory, where it keeps its records of machines
and runs (`state/loamos/records/`), and for `plugins.instances`, so it sets its journal policies
only when its plugin is enabled, since `seal` refuses a policy for a command it does not register
(D224). A compiled plugin's `Cx` has no path, and `cli::run` seals inside, so the builder is the
one place the embedder can see the workspace first. Nothing else changes, and no decision was
needed: it reads what `Host::workspace` reads after `seal`. Checked on Hero on 2026-11-27 by the
Loam OS host's tests (`cargo test` in `endpoints/loam-os`), which build every host through it.
