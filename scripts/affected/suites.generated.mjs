// Auto-generated from .github/workflows/*.yml by scripts/sync-ci.mjs (#1800).
// Do not edit by hand; run `pnpm ci:sync` after changing workflow steps or gates.

/** @type {{ workflow: string, tools: string[], steps: { run: string, cwd?: string, gate?: string, platform?: string, tools?: string[] }[], remote?: string }[]} */
export const SUITES = [
	{
		"workflow": "violet.yml",
		"tools": [
			"chromium"
		],
		"steps": [
			{
				"gate": "run",
				"run": "pnpm test:violet"
			},
			{
				"gate": "run",
				"run": "pnpm -F @lushly-dev/violet-core -F @lushly-dev/violet-runtime -F @lushly-dev/violet-afd -F @lushly-dev/violet-cli -F @lushly-dev/violet-server lint"
			},
			{
				"gate": "run",
				"run": "pnpm --no-bail -F @lushly-dev/violet-runtime -F @lushly-dev/violet-cli -F @lushly-dev/violet-server test"
			}
		]
	},
	{
		"workflow": "fast-af.yml",
		"tools": [
			"chromium"
		],
		"remote": "fast-element on Firefox and WebKit (daily) and its upstream test:ci documentation checks, and violet-elements on Firefox and WebKit (run locally with pnpm -F @lushly-dev/violet-elements test:browser:all)",
		"steps": [
			{
				"gate": "runtime",
				"run": "pnpm -F @lushly-dev/fast-element build"
			},
			{
				"gate": "runtime",
				"run": "pnpm -F @lushly-dev/fast-element test:chromium"
			},
			{
				"gate": "components",
				"run": "pnpm -F \"@lushly-dev/violet-elements...\" build"
			},
			{
				"gate": "components",
				"run": "pnpm -F @lushly-dev/violet-elements typecheck"
			},
			{
				"gate": "components",
				"run": "pnpm -F @lushly-dev/violet-elements verify:exports"
			},
			{
				"gate": "components",
				"run": "node scripts/fast-af-generated.mjs"
			},
			{
				"gate": "components",
				"run": "pnpm -F @lushly-dev/violet-elements taxonomy:check"
			},
			{
				"gate": "components",
				"run": "pnpm -F @lushly-dev/violet-elements lint"
			},
			{
				"gate": "components",
				"run": "pnpm -F @lushly-dev/violet-elements test:browser"
			},
			{
				"gate": "components",
				"run": "node tests/consumers/fast-af/verify-artifacts.mjs --browser chromium"
			}
		]
	},
	{
		"workflow": "specimen.yml",
		"tools": [
			"chromium",
			"cargo"
		],
		"remote": "the prebuilt hosts of the other platforms (host-packages); pnpm test:specimen packs this one's",
		"steps": [
			{
				"gate": "run",
				"run": "pnpm test:specimen"
			},
			{
				"gate": "stories",
				"run": "pnpm test:stories"
			},
			{
				"gate": "host",
				"cwd": "foundations/specimen/host",
				"run": "cargo fmt --check"
			},
			{
				"gate": "host",
				"cwd": "foundations/specimen/host",
				"run": "cargo clippy --locked --all-targets -- -D warnings"
			},
			{
				"gate": "host",
				"cwd": "foundations/specimen/host",
				"run": "cargo test --no-fail-fast --locked"
			},
			{
				"gate": "hosts",
				"run": "pnpm -F @lushly-dev/specimen build:host && pnpm -F @lushly-dev/specimen stage:host"
			}
		]
	},
	{
		"workflow": "health-dashboard.yml",
		"tools": [
			"chromium",
			"uv"
		],
		"steps": [
			{
				"gate": "run",
				"run": "pnpm -F \"@lushly-dev/health-dashboard...\" build"
			},
			{
				"gate": "run",
				"run": "pnpm -F @lushly-dev/health-dashboard fixtures:check"
			},
			{
				"gate": "run",
				"run": "node endpoints/health-dashboard/scripts/verify-health-isolation.mjs"
			},
			{
				"gate": "run",
				"run": "pnpm -F @lushly-dev/health-dashboard test:browser"
			}
		]
	},
	{
		"workflow": "loam.yml",
		"tools": [
			"chromium",
			"cargo",
			"openssl"
		],
		"steps": [
			{
				"gate": "mounted",
				"run": "pnpm -F \"@lushly-dev/loam-web...\" -F \"!@lushly-dev/loam-host\" build"
			},
			{
				"gate": "run",
				"run": "pnpm -F \"./endpoints/loam/packages/*\" -F \"./endpoints/loam/apps/*\" -F \"!@lushly-dev/loam-host\" typecheck"
			},
			{
				"gate": "run",
				"run": "pnpm --no-bail -F \"./endpoints/loam/packages/*\" -F \"./endpoints/loam/apps/*\" -F \"!@lushly-dev/loam-host\" test --coverage --reporter=verbose"
			},
			{
				"gate": "run",
				"run": "pnpm -F @lushly-dev/afd-server exec vitest run src/entry-points.test.ts --reporter=verbose"
			},
			{
				"gate": "run",
				"run": "node --test --test-reporter=spec scripts/plugin-manifest.test.mjs"
			},
			{
				"gate": "run",
				"run": "pnpm -F @lushly-dev/afd-server exec vitest run src/authorization-cases.test.ts src/mcp-auth.test.ts src/mcp-auth-verifier.test.ts src/mcp-auth-scopes.test.ts src/mcp-auth-host.test.ts src/verified-credentials.test.ts --reporter=verbose"
			},
			{
				"gate": "run",
				"run": "pnpm -F @lushly-dev/afd-auth exec vitest run --reporter=verbose"
			},
			{
				"gate": "run",
				"run": "pnpm -F @lushly-dev/loam-theme theme:check"
			},
			{
				"gate": "run",
				"run": "pnpm -F @lushly-dev/loam-theme -F @lushly-dev/loam-chrome -F @lushly-dev/loam-console -F @lushly-dev/loam-app-hello -F @lushly-dev/loam-app-tally -F @lushly-dev/loam-app-tasks -F @lushly-dev/loam-app-notes -F @lushly-dev/loam-app-checklist lint:tokens"
			},
			{
				"gate": "run",
				"run": "pnpm -F @lushly-dev/loam-web test:browser"
			},
			{
				"gate": "run",
				"run": "pnpm -F @lushly-dev/loam-web test:walk"
			},
			{
				"gate": "run",
				"run": "pnpm -F @lushly-dev/loam-web test:firefox"
			},
			{
				"gate": "run",
				"platform": "darwin",
				"run": "pnpm -F @lushly-dev/loam-web test:webkit"
			},
			{
				"gate": "run",
				"run": "pnpm -F @lushly-dev/loam-web budget"
			},
			{
				"gate": "mounted",
				"run": "pnpm -F @lushly-dev/loam-web test:mounted"
			},
			{
				"gate": "hosted",
				"run": "pnpm -F \"@lushly-dev/loam-web...\" -F \"@lushly-dev/loam-host...\" build"
			},
			{
				"gate": "hosted",
				"run": "pnpm -F @lushly-dev/loam-host typecheck"
			},
			{
				"gate": "hosted",
				"run": "pnpm -F @lushly-dev/loam-web typecheck:hosted"
			},
			{
				"gate": "hosted",
				"run": "pnpm -F @lushly-dev/loam-host test --coverage --reporter=verbose"
			},
			{
				"gate": "hosted",
				"run": "pnpm -F @lushly-dev/local-db exec vitest run src/sqlite-adapter.test.ts src/entry.test.ts --reporter=verbose"
			},
			{
				"gate": "hosted",
				"run": "pnpm -F @lushly-dev/loam-web test:hosted"
			}
		]
	},
	{
		"workflow": "auth-browser.yml",
		"tools": [
			"chromium"
		],
		"steps": [
			{
				"run": "pnpm -F \"@lushly-dev/afd-auth...\" build"
			},
			{
				"run": "pnpm -F @lushly-dev/afd-auth test:browser"
			}
		]
	},
	{
		"workflow": "hosted-fixtures.yml",
		"tools": [
			"chromium",
			"openssl"
		],
		"steps": [
			{
				"run": "pnpm test:hosted:local"
			}
		]
	},
	{
		"workflow": "python.yml",
		"tools": [
			"uv"
		],
		"remote": "Python 3.11 to 3.14, the wheel install smoke test per extra, and the Windows test job",
		"steps": [
			{
				"cwd": "python",
				"run": "uv lock --check"
			},
			{
				"cwd": "python",
				"run": "uv sync --frozen --all-extras"
			},
			{
				"cwd": "python",
				"run": "uv run ruff check src tests"
			},
			{
				"cwd": "python",
				"run": "uv run ruff format --check src tests"
			},
			{
				"cwd": "python",
				"run": "uv run mypy src"
			},
			{
				"cwd": "python",
				"run": "uv run pytest -q"
			}
		]
	},
	{
		"workflow": "alfred.yml",
		"tools": [
			"uv"
		],
		"remote": "Python 3.11 and the isolated wheel smoke test",
		"steps": [
			{
				"cwd": "alfred",
				"run": "uv lock --check"
			},
			{
				"cwd": "alfred",
				"run": "uv sync --all-extras --dev --frozen"
			},
			{
				"cwd": "alfred",
				"run": "uv run --locked ruff check ."
			},
			{
				"cwd": "alfred",
				"run": "uv run --locked ruff format --check ."
			},
			{
				"cwd": "alfred",
				"run": "uv run --locked mypy src"
			},
			{
				"cwd": "alfred",
				"run": "uv run --locked pytest tests/ -q"
			}
		]
	},
	{
		"workflow": "botcore.yml",
		"tools": [
			"uv"
		],
		"remote": "Python 3.11",
		"steps": [
			{
				"run": "pnpm -F \"@lushly-dev/afd-testing...\" build"
			},
			{
				"cwd": "endpoints/botcore",
				"run": "uv lock --check"
			},
			{
				"cwd": "endpoints/botcore",
				"run": "uv sync --frozen --extra dev --extra mcp --extra cdp --group packages"
			},
			{
				"cwd": "endpoints/botcore",
				"run": "uv run --frozen ruff check src/ tests/ scripts/ packages/ botcore-connectors/src/ botcore-connectors/tests/ plugins/botcore-teams/"
			},
			{
				"cwd": "endpoints/botcore",
				"run": "uv run --frozen ruff format --check src/ tests/ scripts/ packages/ botcore-connectors/src/ botcore-connectors/tests/ plugins/botcore-teams/"
			},
			{
				"cwd": "endpoints/botcore",
				"run": "uv run --frozen mypy src"
			},
			{
				"cwd": "endpoints/botcore",
				"run": "uv run --frozen pytest tests/ --ignore=tests/integration -q"
			},
			{
				"cwd": "endpoints/botcore",
				"run": "uv run --frozen python scripts/package_tests.py"
			},
			{
				"cwd": "endpoints/botcore",
				"run": "uv run --frozen python scripts/package_smoke.py"
			}
		]
	},
	{
		"workflow": "botcore-factory.yml",
		"tools": [
			"uv"
		],
		"remote": "Python 3.11, and the suite on Linux, macOS and Windows",
		"steps": [
			{
				"run": "pnpm -F \"@lushly-dev/afd-testing...\" build"
			},
			{
				"cwd": "endpoints/botcore/plugins/botcore-factory",
				"run": "uv lock --check"
			},
			{
				"cwd": "endpoints/botcore/plugins/botcore-factory",
				"run": "uv sync --frozen --extra dev"
			},
			{
				"cwd": "endpoints/botcore/plugins/botcore-factory",
				"run": "uv run --frozen ruff check src tests"
			},
			{
				"cwd": "endpoints/botcore/plugins/botcore-factory",
				"run": "uv run --frozen ruff format --check src tests"
			},
			{
				"cwd": "endpoints/botcore/plugins/botcore-factory",
				"run": "uv run --frozen mypy src"
			},
			{
				"cwd": "endpoints/botcore/plugins/botcore-factory",
				"run": "uv run --frozen pytest -q"
			}
		]
	},
	{
		"workflow": "health.yml",
		"tools": [
			"uv"
		],
		"remote": "Python 3.11",
		"steps": [
			{
				"cwd": "endpoints/health",
				"run": "uv lock --check"
			},
			{
				"cwd": "endpoints/health",
				"run": "uv sync --frozen --extra dev"
			},
			{
				"cwd": "endpoints/health",
				"run": "uv run --frozen ruff check src tests scripts"
			},
			{
				"cwd": "endpoints/health",
				"run": "uv run --frozen ruff format --check src tests scripts"
			},
			{
				"cwd": "endpoints/health",
				"run": "uv run --frozen mypy src"
			},
			{
				"cwd": "endpoints/health",
				"run": "uv run --frozen pytest -q"
			},
			{
				"cwd": "endpoints/health",
				"run": "uv run --frozen python scripts/package_smoke.py"
			}
		]
	},
	{
		"workflow": "rust.yml",
		"tools": [
			"cargo"
		],
		"remote": "the wasm32 checks and tests, the MSRV matrix, the docs.rs build, and the Windows test job",
		"steps": [
			{
				"cwd": "packages/rust",
				"run": "cargo fmt --check"
			},
			{
				"cwd": "packages/rust",
				"run": "cargo clippy --locked --all-targets -- -D warnings"
			},
			{
				"cwd": "packages/rust",
				"run": "cargo clippy --locked --all-targets --no-default-features -- -D warnings"
			},
			{
				"cwd": "packages/rust",
				"run": "cargo test --locked --no-fail-fast"
			},
			{
				"cwd": "packages/rust",
				"run": "cargo test --locked --no-fail-fast --no-default-features"
			},
			{
				"cwd": "packages/rust",
				"run": "cargo test --locked --no-fail-fast --all-features --lib --test batch_controls_vectors"
			},
			{
				"cwd": "packages/rust",
				"run": "cargo clippy --locked --all-targets --features server -- -D warnings"
			},
			{
				"cwd": "packages/rust",
				"run": "cargo test --locked --no-fail-fast --features server"
			},
			{
				"cwd": "packages/rust",
				"run": "cargo clippy --locked --all-targets --no-default-features --features server -- -D warnings"
			},
			{
				"cwd": "packages/rust",
				"run": "cargo test --locked --no-fail-fast --no-default-features --features server"
			},
			{
				"cwd": "packages/rust",
				"run": "cargo clippy --locked --all-targets --features server-auth -- -D warnings"
			},
			{
				"cwd": "packages/rust",
				"run": "cargo test --locked --no-fail-fast --features server-auth"
			},
			{
				"cwd": "packages/rust",
				"run": "cargo test --locked --no-fail-fast --features journal-file-shared"
			},
			{
				"cwd": "packages/rust",
				"run": "cargo clippy --locked --all-targets --no-default-features --features frontmatter -- -D warnings"
			},
			{
				"cwd": "packages/rust",
				"run": "cargo test --locked --no-fail-fast --no-default-features --features frontmatter"
			}
		]
	},
	{
		"workflow": "loam-plugins.yml",
		"tools": [
			"cargo",
			"chromium"
		],
		"remote": "Linux, the release-profile test-doubles check, and the Linux scenario run against loam-mail test-world",
		"steps": [
			{
				"gate": "mail",
				"cwd": "endpoints/loam/plugins/mail/engine",
				"run": "cargo fmt --check",
				"tools": [
					"cargo"
				]
			},
			{
				"gate": "mail",
				"cwd": "endpoints/loam/plugins/mail/engine",
				"run": "cargo clippy --locked --all-targets -- -D warnings",
				"tools": [
					"cargo"
				]
			},
			{
				"gate": "mail",
				"cwd": "endpoints/loam/plugins/mail/engine",
				"run": "cargo clippy --locked --all-targets --features test-doubles -- -D warnings",
				"tools": [
					"cargo"
				]
			},
			{
				"gate": "mail",
				"cwd": "endpoints/loam/plugins/mail/engine",
				"run": "cargo test --no-fail-fast --locked",
				"tools": [
					"cargo"
				]
			},
			{
				"gate": "mail",
				"cwd": "endpoints/loam/plugins/mail/engine",
				"run": "cargo test --no-fail-fast --locked --features test-doubles",
				"tools": [
					"cargo"
				]
			},
			{
				"gate": "mailapp",
				"tools": [],
				"run": "pnpm -F \"@lushly-dev/loam-app-mail...\" -F \"!@lushly-dev/loam-host\" build"
			},
			{
				"gate": "mailapp",
				"tools": [],
				"run": "pnpm -F @lushly-dev/loam-app-mail typecheck"
			},
			{
				"gate": "mailapp",
				"tools": [],
				"run": "pnpm -F @lushly-dev/loam-app-mail lint:tokens"
			},
			{
				"gate": "mailapp",
				"tools": [],
				"run": "pnpm -F @lushly-dev/loam-app-mail test"
			},
			{
				"gate": "mailapp",
				"tools": [],
				"run": "pnpm -F @lushly-dev/loam-app-mail run pack"
			},
			{
				"gate": "violet",
				"tools": [],
				"run": "pnpm -F \"@lushly-dev/loam-app-violet...\" -F \"!@lushly-dev/loam-host\" build"
			},
			{
				"gate": "violet",
				"tools": [],
				"run": "pnpm -F @lushly-dev/loam-app-violet typecheck"
			},
			{
				"gate": "violet",
				"tools": [],
				"run": "pnpm -F @lushly-dev/loam-app-violet lint:tokens"
			},
			{
				"gate": "violet",
				"tools": [],
				"run": "pnpm -F @lushly-dev/loam-app-violet test"
			},
			{
				"gate": "violet",
				"tools": [
					"cargo",
					"chromium"
				],
				"run": "pnpm -F @lushly-dev/loam-app-violet test:specimen"
			},
			{
				"gate": "violet",
				"tools": [],
				"run": "pnpm -F @lushly-dev/loam-app-violet run pack"
			}
		]
	},
	{
		"workflow": "loam-desktop.yml",
		"tools": [
			"cargo"
		],
		"remote": "the WebDriver suite (P6-D1 to P6-D4, P6-D6, P6-D7, P5-A1, P5-A2, P5-A6, P5-A8, P5-A9 with the mail engine's test build) under tauri-driver on Linux (PRs) and Windows (daily/manual), the macOS WKWebView checks (test:macos), and each OS's unsigned installers and P6-D5 HTTPS updater suite (Build the installers)",
		"steps": [
			{
				"gate": "run",
				"cwd": "endpoints/loam/packages/desktop/src-tauri",
				"run": "cargo fmt --check"
			},
			{
				"gate": "run",
				"cwd": "endpoints/loam/packages/desktop/src-tauri",
				"run": "cargo clippy --locked --all-targets -- -D warnings"
			},
			{
				"gate": "run",
				"cwd": "endpoints/loam/packages/desktop/src-tauri",
				"run": "cargo test --no-fail-fast --locked"
			},
			{
				"gate": "run",
				"cwd": "endpoints/loam/packages/desktop/src-tauri",
				"run": "cargo build --locked"
			}
		]
	},
	{
		"workflow": "umbel.yml",
		"tools": [
			"cargo"
		],
		"remote": "Linux, the per-feature and wasm32-wasip2 clippy legs, plugin isolation, and daily MSRV 1.97 and Windows store and clippy checks",
		"steps": [
			{
				"gate": "host",
				"cwd": "endpoints/umbel",
				"run": "cargo fmt --all --check"
			},
			{
				"gate": "host",
				"cwd": "endpoints/umbel",
				"run": "cargo clippy --locked --workspace --exclude umbel-store-embedded --all-targets -- -D warnings"
			},
			{
				"gate": "host",
				"cwd": "endpoints/umbel",
				"run": "cargo clippy --locked --target wasm32-wasip2 -p umbel-plugin-components --features component -- -D warnings"
			},
			{
				"gate": "host",
				"cwd": "endpoints/umbel",
				"run": "cargo build --locked --release --target wasm32-wasip2 -p umbel-fixture-behaviors -p umbel-fixture-imports -p umbel-fixture-sockets -p umbel-fixture-future -p umbel-fixture-budget -p umbel-plugin-hello -p umbel-plugin-components --features umbel-plugin-hello/component,umbel-plugin-components/component,umbel-fixture-budget/component"
			},
			{
				"gate": "host",
				"cwd": "endpoints/umbel",
				"run": "cargo build --locked -p umbel-plugin-hello --features mounted --bin hello-mcp"
			},
			{
				"gate": "host",
				"cwd": "endpoints/umbel",
				"run": "cargo test --no-fail-fast --locked --workspace --exclude umbel-store-embedded"
			},
			{
				"gate": "host",
				"cwd": "endpoints/umbel",
				"run": "cargo clippy --locked -p umbel-store -p umbel-store-embedded --all-targets -- -D warnings"
			},
			{
				"gate": "host",
				"cwd": "endpoints/umbel",
				"run": "cargo test --no-fail-fast --locked -p umbel-store -p umbel-store-embedded"
			},
			{
				"gate": "loamos",
				"cwd": "endpoints/loam-os",
				"run": "cargo fmt --all --check"
			},
			{
				"gate": "loamos",
				"cwd": "endpoints/loam-os",
				"run": "cargo clippy --locked --all-targets -- -D warnings"
			},
			{
				"gate": "loamos",
				"cwd": "endpoints/loam-os",
				"run": "cargo test --no-fail-fast --locked"
			},
			{
				"gate": "conformance",
				"run": "pnpm -F \"@lushly-dev/afd-cli...\" build"
			},
			{
				"gate": "conformance",
				"run": "pnpm --filter @afd/example-todo test:conformance:umbel"
			},
			{
				"gate": "conformance",
				"run": "pnpm --filter @afd/example-todo test:conformance:umbel --mode modern"
			},
			{
				"gate": "conformance",
				"run": "pnpm --filter @afd/example-todo test:conformance:umbel --suite confirmations --mode modern"
			},
			{
				"gate": "conformance",
				"run": "pnpm --filter @afd/example-todo test:conformance:umbel --suite approvals"
			},
			{
				"gate": "conformance",
				"run": "pnpm --filter @afd/example-todo test:conformance:umbel --suite approvals --mode modern"
			},
			{
				"gate": "conformance",
				"run": "pnpm --filter @afd/example-todo test:conformance:umbel-mounted"
			},
			{
				"gate": "conformance",
				"run": "pnpm --filter @afd/example-todo test:conformance:umbel-mounted --mode modern"
			},
			{
				"gate": "conformance",
				"run": "pnpm --filter @afd/example-todo test:conformance:umbel-mounted --suite confirmations --mode modern"
			},
			{
				"gate": "conformance",
				"run": "pnpm --filter @afd/example-todo test:conformance:umbel-mounted --suite approvals"
			},
			{
				"gate": "conformance",
				"run": "pnpm --filter @afd/example-todo test:conformance:umbel-mounted --suite approvals --mode modern"
			},
			{
				"gate": "conformance",
				"run": "bash endpoints/umbel/tests/scripts/external-clients.sh"
			}
		]
	},
	{
		"workflow": "cpp.yml",
		"tools": [
			"cmake"
		],
		"remote": "clang-format, the sanitizer and no-exceptions legs, and MSVC on the dev preset; daily: TSan, macOS, MSVC release, clang-cl, Emscripten, packaging, benchmarks and fuzz",
		"steps": [
			{
				"cwd": "packages/cpp",
				"run": "cmake --preset dev"
			},
			{
				"cwd": "packages/cpp",
				"run": "cmake --build --preset dev"
			},
			{
				"cwd": "packages/cpp",
				"run": "ctest --preset dev"
			}
		]
	},
	{
		"workflow": "conformance.yml",
		"tools": [
			"uv",
			"cargo",
			"cmake"
		],
		"remote": "every backend's MCP 2026-07-28 runs (--mode modern), the TypeScript and Python confirmation suites, the Rust backend's fmt and clippy, the C++ backend unit tests, and the C++ backend's MSVC build on Windows",
		"steps": [
			{
				"gate": "todo",
				"tools": [],
				"run": "pnpm build"
			},
			{
				"gate": "todo",
				"tools": [
					"uv"
				],
				"cwd": "packages/examples/todo/backends/python",
				"run": "uv sync --locked"
			},
			{
				"gate": "todo",
				"tools": [
					"uv"
				],
				"cwd": "packages/examples/todo/backends/python",
				"run": "uv run --locked ruff check src tests"
			},
			{
				"gate": "todo",
				"tools": [
					"uv"
				],
				"cwd": "packages/examples/todo/backends/python",
				"run": "uv run --locked ruff format --check src tests"
			},
			{
				"gate": "todo",
				"tools": [
					"uv"
				],
				"cwd": "packages/examples/todo/backends/python",
				"run": "uv run --locked pytest -q"
			},
			{
				"gate": "rust",
				"tools": [
					"cargo"
				],
				"cwd": "packages/examples/todo/backends/rust",
				"run": "cargo test --no-fail-fast --locked"
			},
			{
				"gate": "todo",
				"tools": [],
				"run": "pnpm --dir packages/examples/todo test:conformance:ts"
			},
			{
				"gate": "todo",
				"tools": [],
				"run": "pnpm --dir packages/examples/todo test:conformance:ts --suite protocol"
			},
			{
				"gate": "todo",
				"tools": [],
				"run": "node tests/consumers/afd/verify-artifacts.mjs"
			},
			{
				"gate": "todo",
				"tools": [],
				"run": "pnpm --dir packages/examples/todo test:conformance:ts --suite approvals"
			},
			{
				"gate": "todo",
				"tools": [],
				"run": "pnpm --dir packages/examples/todo test:conformance:ts --suite tasks --mode modern"
			},
			{
				"gate": "todo",
				"tools": [],
				"run": "pnpm --dir packages/examples/todo test:scenarios:ts"
			},
			{
				"gate": "todo",
				"tools": [],
				"run": "pnpm --dir packages/examples/todo test:page"
			},
			{
				"gate": "todo",
				"tools": [],
				"run": "pnpm -F @afd/example-todo-directclient-page test:browser"
			},
			{
				"gate": "todo",
				"tools": [
					"uv"
				],
				"run": "pnpm --dir packages/examples/todo test:conformance:py"
			},
			{
				"gate": "todo",
				"tools": [
					"uv"
				],
				"run": "pnpm --dir packages/examples/todo test:conformance:py --suite protocol"
			},
			{
				"gate": "todo",
				"tools": [
					"uv"
				],
				"run": "pnpm --dir packages/examples/todo test:conformance:py --suite approvals"
			},
			{
				"gate": "todo",
				"tools": [
					"uv"
				],
				"run": "pnpm --dir packages/examples/todo test:conformance:py --suite tasks --mode modern"
			},
			{
				"gate": "todo",
				"tools": [
					"uv"
				],
				"run": "pnpm --dir packages/examples/todo test:interop"
			},
			{
				"gate": "rust",
				"tools": [
					"cargo"
				],
				"run": "pnpm --dir packages/examples/todo test:conformance:rs"
			},
			{
				"gate": "rust",
				"tools": [
					"cargo"
				],
				"run": "pnpm --dir packages/examples/todo test:conformance:rs --suite protocol"
			},
			{
				"gate": "rust",
				"tools": [
					"cargo"
				],
				"run": "pnpm --dir packages/examples/todo test:conformance:rs --suite confirmations"
			},
			{
				"gate": "rust",
				"tools": [
					"cargo"
				],
				"run": "pnpm --dir packages/examples/todo test:conformance:rs --suite approvals"
			},
			{
				"gate": "rust",
				"tools": [
					"cargo"
				],
				"run": "pnpm --dir packages/examples/todo test:conformance:rs --suite tasks --mode modern"
			},
			{
				"gate": "cpp",
				"tools": [
					"cmake"
				],
				"run": "pnpm --dir packages/examples/todo test:conformance:cpp"
			},
			{
				"gate": "cpp",
				"tools": [
					"cmake"
				],
				"run": "pnpm --dir packages/examples/todo test:conformance:cpp --suite protocol"
			},
			{
				"gate": "cpp",
				"tools": [
					"cmake"
				],
				"run": "pnpm --dir packages/examples/todo test:conformance:cpp --suite confirmations"
			},
			{
				"gate": "cpp",
				"tools": [
					"cmake"
				],
				"run": "pnpm --dir packages/examples/todo test:conformance:cpp --suite approvals"
			}
		]
	}
];
