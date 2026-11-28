(() => {
	/** @type {{ mode: string, workspace?: { id: string, name: string }, platform?: string, osServiceMechanism?: string, allowsFileFallback?: boolean, failedClosedCode?: string | null, plugins: any[], pendingRevocations: any[], bundled: any[], models: any[], reloadPending: boolean, pendingProposal?: any | null } | null} */
	let state = null;
	let activeProposal = null;
	let editingModelId = null;
	let pendingUninstallId = null;
	let pendingModelRemoveId = null;
	let busy = false;

	const $ = (id) => document.getElementById(id);

	function el(tag, attrs, ...children) {
		const node = document.createElement(tag);
		if (attrs) {
			for (const [k, v] of Object.entries(attrs)) {
				if (v === undefined || v === null || v === false) continue;
				if (k === 'class') node.className = v;
				else if (k === 'text') node.textContent = String(v);
				else if (k.startsWith('on') && typeof v === 'function') {
					node.addEventListener(k.slice(2).toLowerCase(), v);
				} else {
					node.setAttribute(k, v === true ? '' : String(v));
				}
			}
		}
		for (const child of children) {
			if (child === null || child === undefined || child === false) continue;
			if (typeof child === 'string') node.appendChild(document.createTextNode(child));
			else node.appendChild(child);
		}
		return node;
	}

	function clearNode(node) {
		while (node.firstChild) node.removeChild(node.firstChild);
	}

	async function invoke(cmd, args) {
		const internals = window.__TAURI_INTERNALS__;
		if (!internals || typeof internals.invoke !== 'function') {
			throw {
				code: 'DESKTOP_HOST_SETUP_REFUSED',
				suggestion: 'Setup IPC is unavailable outside the Loam desktop host.',
			};
		}
		return await internals.invoke(cmd, args ?? {});
	}

	function formatError(err) {
		if (err && typeof err === 'object' && typeof err.code === 'string') {
			const suggestion =
				typeof err.suggestion === 'string' && err.suggestion ? ` — ${err.suggestion}` : '';
			return `${err.code}${suggestion}`;
		}
		return typeof err === 'string' ? err : 'An unexpected setup error occurred.';
	}

	function showStatus(kind, title, detail) {
		const banner = $('status-banner');
		banner.className = `banner ${kind === 'error' ? 'banner-error' : kind === 'warn' ? 'banner-warn' : 'banner-info'}`;
		clearNode(banner);
		const body = el(
			'div',
			{ class: 'banner-body' },
			el('strong', { class: 'banner-title', text: title }),
			detail ? el('p', { class: 'banner-text', text: detail }) : null
		);
		const closeBtn = el('button', {
			class: 'btn btn-ghost',
			type: 'button',
			text: 'Dismiss',
			onClick: () => {
				banner.hidden = true;
			},
		});
		banner.append(body, closeBtn);
		banner.hidden = false;
	}

	function clearStatus() {
		$('status-banner').hidden = true;
	}

	function selectSection(section) {
		const isModels = section === 'models';
		const tabModels = $('tab-models');
		const tabPlugins = $('tab-plugins');
		tabModels.setAttribute('aria-selected', String(isModels));
		tabModels.tabIndex = isModels ? 0 : -1;
		tabPlugins.setAttribute('aria-selected', String(!isModels));
		tabPlugins.tabIndex = isModels ? -1 : 0;
		$('panel-models').hidden = !isModels;
		$('panel-plugins').hidden = isModels;
		$('model-key').value = '';
	}

	function syncEndpointVisibility() {
		const kind = $('model-kind').value;
		const isCompat = kind === 'openai-compatible';
		$('model-endpoint-field').hidden = !isCompat;
		const nameInput = $('model-name');
		if (!editingModelId && !nameInput.value) {
			if (kind === 'anthropic') nameInput.placeholder = 'claude-sonnet-4-5';
			else if (kind === 'openai') nameInput.placeholder = 'gpt-4.1';
			else nameInput.placeholder = 'llama3.2';
		}
	}

	function clearModelRecovery() {
		const box = $('model-recovery-box');
		box.hidden = true;
		clearNode(box);
		$('btn-model-save-offline').hidden = true;
		$('btn-model-rebind').hidden = true;
		$('btn-model-file-fallback').hidden = true;
	}

	function resetModelForm() {
		editingModelId = null;
		$('model-form-heading').textContent =
			state?.mode === 'cli' ? 'Update Provider Key' : 'Add Model Provider';
		$('btn-model-reset').hidden = true;
		$('model-id').value = '';
		$('model-id').disabled = false;
		$('model-kind').value = 'anthropic';
		$('model-kind').disabled = false;
		$('model-name').value = '';
		$('model-name').disabled = false;
		$('model-endpoint').value = '';
		$('model-endpoint').disabled = false;
		$('model-key').value = '';
		$('model-default').checked = true;
		$('model-default-row').hidden = state?.mode === 'cli';
		if (state?.mode === 'cli') {
			$('model-form-card').hidden = true;
		}
		clearModelRecovery();
		syncEndpointVisibility();
	}

	function editModel(provider) {
		editingModelId = provider.id;
		const isCli = state?.mode === 'cli';
		$('model-form-card').hidden = false;
		$('model-form-heading').textContent = isCli
			? `Update API key for ${provider.id}`
			: `Edit provider: ${provider.id}`;
		$('btn-model-reset').hidden = false;
		$('model-id').value = provider.id;
		$('model-id').disabled = true;
		$('model-kind').value = provider.kind;
		$('model-kind').disabled = isCli;
		$('model-name').value = provider.model;
		$('model-name').disabled = isCli;
		$('model-endpoint').value = provider.endpoint || '';
		$('model-endpoint').disabled = isCli;
		$('model-key').value = '';
		$('model-default').checked = Boolean(provider.default);
		$('model-default-row').hidden = isCli;
		clearModelRecovery();
		syncEndpointVisibility();
		$('model-key').focus();
	}

	function renderModels() {
		const container = $('models-list');
		clearNode(container);
		const isCli = state?.mode === 'cli';
		const models = state?.models || [];
		if (models.length === 0) {
			container.appendChild(
				el(
					'div',
					{ class: 'card' },
					el('p', {
						class: 'muted',
						text: isCli
							? 'No providers are listed in models.json.'
							: 'No copilot model provider is configured yet.',
					})
				)
			);
		} else {
			for (const m of models) {
				const keyBadgeClass =
					m.keyStatus === 'configured' || m.keyStatus === 'file' || m.keyStatus === 'not-required'
						? 'badge badge-info'
						: 'badge badge-warn';
				const keyLabel =
					m.keyStatus === 'configured'
						? 'Key in keychain'
						: m.keyStatus === 'file'
							? 'Key in file (0600)'
							: m.keyStatus === 'not-required'
								? 'No key required'
								: 'Key missing';
				const actions = el('div', { class: 'item-actions' });
				if (!isCli && !m.default) {
					actions.appendChild(
						el('button', {
							class: 'btn btn-secondary',
							type: 'button',
							text: 'Set default',
							onClick: () => handleSetDefaultModel(m.id),
						})
					);
				}
				if (!isCli || m.keyStorage === 'keychain') {
					actions.appendChild(
						el('button', {
							class: 'btn btn-secondary',
							type: 'button',
							text: isCli ? 'Update key' : 'Edit / key',
							onClick: () => editModel(m),
						})
					);
				}
				if (!isCli || m.keyStorage === 'keychain') {
					actions.appendChild(
						el('button', {
							class: 'btn btn-danger',
							type: 'button',
							text: isCli ? 'Delete key' : 'Remove',
							onClick: () => {
								pendingModelRemoveId = pendingModelRemoveId === m.id ? null : m.id;
								renderModels();
							},
						})
					);
				}
				const meta = el(
					'div',
					{ class: 'item-meta' },
					el(
						'div',
						{ class: 'item-title-line' },
						el('strong', { text: m.id }),
						el('span', { class: 'badge', text: m.kind }),
						m.default ? el('span', { class: 'badge badge-info', text: 'Default' }) : null,
						el('span', { class: keyBadgeClass, text: keyLabel })
					),
					el('span', { class: 'muted', text: m.endpoint ? `${m.model} · ${m.endpoint}` : m.model })
				);
				const card = el('div', { class: 'card' }, el('div', { class: 'item-row' }, meta, actions));
				if (pendingModelRemoveId === m.id) {
					const delCheckId = `del-key-${m.id}`;
					const delCheck = el('input', { id: delCheckId, type: 'checkbox', checked: true });
					const confirmRow = el(
						'div',
						{ class: 'callout callout-warn' },
						el('strong', {
							text: isCli ? `Delete OS keychain key for ${m.id}?` : `Remove provider ${m.id}?`,
						}),
						isCli
							? null
							: el(
									'div',
									{ class: 'field-inline' },
									delCheck,
									el('label', { for: delCheckId, text: 'Also delete stored API key' })
								),
						el(
							'div',
							{ class: 'form-actions' },
							el('button', {
								class: 'btn btn-danger',
								type: 'button',
								text: isCli ? 'Confirm delete key' : 'Confirm remove',
								onClick: () => handleRemoveModel(m.id, isCli ? true : delCheck.checked),
							}),
							el('button', {
								class: 'btn btn-secondary',
								type: 'button',
								text: 'Cancel',
								onClick: () => {
									pendingModelRemoveId = null;
									renderModels();
								},
							})
						)
					);
					card.appendChild(confirmRow);
				}
				container.appendChild(card);
			}
		}
		const formCard = $('model-form-card');
		if (isCli && !editingModelId) {
			formCard.hidden = true;
		} else {
			formCard.hidden = false;
		}
	}

	function renderProposal() {
		const section = $('proposal-section');
		const body = $('proposal-body');
		const fallbackBox = $('proposal-fallback-box');
		clearNode(body);
		clearNode(fallbackBox);
		fallbackBox.hidden = true;
		$('btn-proposal-confirm-fallback').hidden = true;

		if (!activeProposal) {
			section.hidden = true;
			return;
		}
		const p = activeProposal;
		const isUpgrade = p.kind === 'upgrade';
		$('proposal-badge').textContent = isUpgrade ? 'Upgrade review' : 'Install review';
		$('proposal-badge').className = isUpgrade ? 'badge badge-warn' : 'badge badge-info';
		$('proposal-heading').textContent = isUpgrade
			? `Upgrade ${p.title} (${p.previous?.version || '?'} → ${p.version})`
			: `Install ${p.title} (${p.version})`;
		$('btn-proposal-confirm').textContent = isUpgrade ? 'Confirm & upgrade' : 'Confirm & install';

		const dl = el(
			'dl',
			{ class: 'kv-list' },
			el('dt', { text: 'Plugin ID' }),
			el('dd', {}, el('code', { text: p.pluginId })),
			el('dt', { text: 'Version' }),
			el('dd', {
				text: isUpgrade && p.previous ? `${p.previous.version} → ${p.version}` : p.version,
			}),
			el('dt', { text: 'Description' }),
			el('dd', { text: p.description }),
			p.license ? el('dt', { text: 'License' }) : null,
			p.license ? el('dd', { text: p.license }) : null,
			p.homepage ? el('dt', { text: 'Homepage (display only)' }) : null,
			p.homepage ? el('dd', {}, el('code', { text: p.homepage })) : null,
			el('dt', { text: 'Bundle SHA-256' }),
			el(
				'dd',
				{},
				isUpgrade && p.previous
					? el(
							'div',
							{},
							el(
								'div',
								{},
								'Previous: ',
								el('code', { class: 'hash-code', text: p.previous.bundleSha256 })
							),
							el('div', {}, 'New: ', el('code', { class: 'hash-code', text: p.bundleSha256 }))
						)
					: el('code', { class: 'hash-code', text: p.bundleSha256 })
			)
		);
		body.appendChild(dl);

		// Apps + prominent uncollapsed D54 native full-shell-trust disclosure
		const appsBox = el('div', {}, el('strong', { text: 'Bundled Apps' }));
		const appList = el('ul', { class: 'sub-list' });
		for (const app of p.apps || []) {
			const grantsText =
				app.grants && app.grants.length > 0 ? ` · grants: ${app.grants.join(', ')}` : '';
			const li = el(
				'li',
				{},
				el('strong', { text: `${app.title} ` }),
				el('code', { text: app.id }),
				` (${app.kind}${grantsText})`
			);
			if (app.isNative) {
				li.appendChild(
					el(
						'div',
						{
							class: 'callout callout-danger',
							'data-disclosure': 'd54-native-trust',
							role: 'note',
						},
						el('strong', { text: 'Full shell trust (native app — D54)' }),
						el('p', {
							text: `The native app "${app.title}" (${app.id}) runs with full shell trust — not sandboxed. It runs directly in main's JS realm and shares Loam's desktop IPC (mount_*, model_*, inbound_reply, setup_open) and loam:* DOM events, while remaining excluded from host-setup and raw model API keys or mount bearer tokens held by Rust and your OS keychain. Install only if you trust this plugin completely.`,
						})
					)
				);
			}
			appList.appendChild(li);
		}
		appsBox.appendChild(appList);
		body.appendChild(appsBox);

		if (p.engine) {
			const eng = p.engine;
			const mechanism = state?.osServiceMechanism || 'OS login service';
			const launchCmd = `${eng.artifactName} serve --port <assigned>`;
			const engineHashUnchanged = isUpgrade && p.previous?.engineSha256 === eng.engineSha256;
			const engDl = el(
				'dl',
				{ class: 'kv-list' },
				el('dt', { text: 'Engine ID' }),
				el('dd', {}, el('code', { text: eng.id }), ` (${eng.target})`),
				el('dt', { text: 'Engine SHA-256' }),
				el(
					'dd',
					{},
					isUpgrade && p.previous?.engineSha256
						? engineHashUnchanged
							? el(
									'div',
									{},
									el('code', { class: 'hash-code', text: eng.engineSha256 }),
									' (unchanged)'
								)
							: el(
									'div',
									{},
									el(
										'div',
										{},
										'Previous: ',
										el('code', { class: 'hash-code', text: p.previous.engineSha256 })
									),
									el('div', {}, 'New: ', el('code', { class: 'hash-code', text: eng.engineSha256 }))
								)
						: el('code', { class: 'hash-code', text: eng.engineSha256 })
				),
				el('dt', { text: 'Launch command' }),
				el('dd', {}, el('code', { text: launchCmd })),
				el('dt', { text: 'Background service' }),
				el('dd', {
					text: `Registers a local loopback login service via ${mechanism} (bound to 127.0.0.1 only).`,
				}),
				el('dt', { text: 'Auth & approvals' }),
				el('dd', {
					text: `auth: ${eng.authMode} · approvals: ${eng.approvals} · labels: ${eng.labels}`,
				})
			);
			body.appendChild(el('div', {}, el('strong', { text: 'Local Engine Service' }), engDl));

			if (eng.labels === 'per-part') {
				body.appendChild(
					el(
						'div',
						{ class: 'callout callout-warn', 'data-disclosure': 'per-part-labels' },
						el('strong', { text: 'Per-part content vouching (labels = per-part)' }),
						el('p', {
							text: 'Loam trusts this engine to mark untrusted content per part: its reads will run without asking, and its non-destructive edits keep its own policy under taint.',
						})
					)
				);
			}
			if (eng.authMode === 'approver' || (eng.previews && eng.previews.length > 0)) {
				const previewList = el('ul', { class: 'sub-list' });
				for (const pr of eng.previews || []) {
					previewList.appendChild(
						el(
							'li',
							{},
							el('code', { text: pr.command }),
							' → previewed by ',
							el('code', { text: pr.previewCommand }),
							` (${(pr.input || []).join(', ')})`
						)
					);
				}
				body.appendChild(
					el(
						'div',
						{ class: 'callout callout-info', 'data-disclosure': 'approver-previews' },
						el('strong', { text: 'Shell-approved commands (approver auth)' }),
						el('p', {
							text: "Loam pairs an approver token stored in your OS keychain and shows these read-only previews before releasing gated commands. Any program running as your user on this computer has the same boundary as the engine's terminal:",
						}),
						previewList
					)
				);
			}
			if (eng.exposedCommands && eng.exposedCommands.length > 0) {
				body.appendChild(
					el(
						'div',
						{},
						el('strong', { text: 'Exposed commands: ' }),
						el('code', { text: eng.exposedCommands.join(', ') })
					)
				);
			}
		}

		section.hidden = false;
	}

	function renderPlugins() {
		const isCli = state?.mode === 'cli';
		$('plugin-actions-bar').hidden = isCli;
		renderProposal();

		// Pending revocations
		const revs = state?.pendingRevocations || [];
		const revSection = $('revocations-section');
		const revList = $('revocations-list');
		clearNode(revList);
		if (revs.length > 0 && !isCli) {
			for (const r of revs) {
				revList.appendChild(
					el(
						'div',
						{ class: 'item-row' },
						el(
							'div',
							{ class: 'item-meta' },
							el('strong', { text: `${r.pluginId} — token ${r.tokenId}` }),
							el('span', { class: 'hint', text: `Failed at: ${r.failedAt}` })
						),
						el('button', {
							class: 'btn btn-secondary',
							type: 'button',
							text: 'Retry revocation',
							onClick: () => handleRetryRevocation(r.tokenId),
						})
					)
				);
			}
			revSection.hidden = false;
		} else {
			revSection.hidden = true;
		}

		// Bundled plugins
		const bundled = state?.bundled || [];
		const bundledSection = $('bundled-section');
		const bundledList = $('bundled-list');
		clearNode(bundledList);
		if (bundled.length > 0 && !isCli) {
			for (const b of bundled) {
				bundledList.appendChild(
					el(
						'div',
						{ class: 'card' },
						el(
							'div',
							{ class: 'item-row' },
							el(
								'div',
								{ class: 'item-meta' },
								el(
									'div',
									{ class: 'item-title-line' },
									el('strong', { text: b.title }),
									el('code', { text: b.id }),
									el('span', { class: 'badge', text: `v${b.version}` })
								),
								el('span', { class: 'muted', text: b.description })
							),
							el('button', {
								class: 'btn btn-secondary',
								type: 'button',
								text: 'Inspect & install…',
								onClick: () => handleInspectBundled(b.id),
							})
						)
					)
				);
			}
			bundledSection.hidden = false;
		} else {
			bundledSection.hidden = true;
		}

		// Installed plugins
		const installed = state?.plugins || [];
		const installedList = $('installed-list');
		clearNode(installedList);
		if (installed.length === 0) {
			installedList.appendChild(
				el(
					'div',
					{ class: 'card' },
					el('p', {
						class: 'muted',
						text: isCli
							? 'Plugins are managed by your CLI deployment.'
							: 'No plugins installed yet.',
					})
				)
			);
			return;
		}
		for (const p of installed) {
			const actions = el('div', { class: 'item-actions' });
			if (!isCli) {
				if (p.hasEngine) {
					for (const act of ['start', 'stop', 'restart', 'status']) {
						actions.appendChild(
							el('button', {
								class: 'btn btn-secondary',
								type: 'button',
								text: act[0].toUpperCase() + act.slice(1),
								onClick: () => handleServiceAction(p.id, act),
							})
						);
					}
					if (p.tokenId) {
						actions.appendChild(
							el('button', {
								class: 'btn btn-secondary',
								type: 'button',
								text: 'Rotate token',
								onClick: () => handleRotateToken(p.id),
							})
						);
					}
				}
				actions.appendChild(
					el('button', {
						class: 'btn btn-danger',
						type: 'button',
						text: 'Uninstall',
						onClick: () => {
							pendingUninstallId = pendingUninstallId === p.id ? null : p.id;
							renderPlugins();
						},
					})
				);
			}
			const details = [
				p.apps && p.apps.length ? `Apps: ${p.apps.join(', ')}` : null,
				p.enginePort ? `Port: 127.0.0.1:${p.enginePort}` : null,
				p.tokenId ? `Token ID: ${p.tokenId}` : null,
			]
				.filter(Boolean)
				.join(' · ');
			const card = el(
				'div',
				{ class: 'card' },
				el(
					'div',
					{ class: 'item-row' },
					el(
						'div',
						{ class: 'item-meta' },
						el(
							'div',
							{ class: 'item-title-line' },
							el('strong', { text: p.title || p.id }),
							el('code', { text: p.id }),
							p.version ? el('span', { class: 'badge', text: `v${p.version}` }) : null
						),
						details ? el('span', { class: 'muted', text: details }) : null,
						el(
							'span',
							{ class: 'hint' },
							'SHA-256: ',
							el('code', { class: 'hash-code', text: p.bundleSha256 })
						)
					),
					actions
				)
			);
			if (pendingUninstallId === p.id) {
				card.appendChild(
					el(
						'div',
						{ class: 'callout callout-warn' },
						el('strong', { text: `Uninstall ${p.title || p.id}?` }),
						el('p', {
							text: 'Loam will stop its login service, revoke its token, and remove the plugin bundle. Your personal plugin data is preserved on disk.',
						}),
						el(
							'div',
							{ class: 'form-actions' },
							el('button', {
								class: 'btn btn-danger',
								type: 'button',
								text: 'Confirm uninstall',
								onClick: () => handleUninstall(p.id),
							}),
							el('button', {
								class: 'btn btn-secondary',
								type: 'button',
								text: 'Cancel',
								onClick: () => {
									pendingUninstallId = null;
									renderPlugins();
								},
							})
						)
					)
				);
			}
			installedList.appendChild(card);
		}
	}

	function renderAll() {
		if (!state) return;
		$('mode-subtitle').textContent =
			state.mode === 'cli'
				? 'CLI-managed desktop profile (keychain keys only)'
				: state.failedClosedCode
					? `Managed desktop (failed closed: ${state.failedClosedCode})`
					: `Managed desktop · ${state.workspace?.name || 'Personal'}`;
		$('cli-banner').hidden = state.mode !== 'cli';
		$('reload-banner').hidden = !state.reloadPending;
		renderModels();
		renderPlugins();
	}

	let modelRecoveryFlags = {
		targetKey: null,
		skipVerify: false,
		confirmRebindKey: false,
		allowFileFallback: false,
	};

	function currentModelTargetKey() {
		return [
			$('model-id').value.trim(),
			$('model-kind').value,
			$('model-endpoint').value.trim(),
		].join('\0');
	}

	function resetModelRecoveryFlags() {
		modelRecoveryFlags = {
			targetKey: null,
			skipVerify: false,
			confirmRebindKey: false,
			allowFileFallback: false,
		};
	}

	async function refreshState() {
		try {
			state = await invoke('setup_state_get', {});
			if (state.pendingProposal && !activeProposal) {
				activeProposal = state.pendingProposal;
			}
			renderAll();
			if (state.pendingOpenError) {
				selectSection('plugins');
				showStatus('error', 'Could not inspect plugin', formatError(state.pendingOpenError));
			}
		} catch (err) {
			showStatus('error', 'Could not load setup state', formatError(err));
		}
	}

	async function submitModelSave(overrides) {
		if (busy) return;
		busy = true;
		clearStatus();
		clearModelRecovery();
		const isCli = state?.mode === 'cli';
		const id = $('model-id').value.trim();
		const targetKey = currentModelTargetKey();
		if (modelRecoveryFlags.targetKey !== targetKey) {
			resetModelRecoveryFlags();
			modelRecoveryFlags.targetKey = targetKey;
		}
		if (overrides) {
			if (overrides.skipVerify) modelRecoveryFlags.skipVerify = true;
			if (overrides.confirmRebindKey) modelRecoveryFlags.confirmRebindKey = true;
			if (overrides.allowFileFallback) modelRecoveryFlags.allowFileFallback = true;
		}
		const apiKeyRaw = $('model-key').value;
		const payload = { id };
		if (apiKeyRaw.trim()) payload.apiKey = apiKeyRaw.trim();
		if (!isCli) {
			payload.kind = $('model-kind').value;
			payload.model = $('model-name').value.trim();
			if (payload.kind === 'openai-compatible') {
				payload.endpoint = $('model-endpoint').value.trim();
			}
			payload.setDefault = $('model-default').checked;
		}
		if (modelRecoveryFlags.skipVerify) payload.skipVerify = true;
		if (!isCli && modelRecoveryFlags.confirmRebindKey) payload.confirmRebindKey = true;
		if (!isCli && modelRecoveryFlags.allowFileFallback) payload.allowFileFallback = true;

		try {
			const res = await invoke('setup_model_save', payload);
			$('model-key').value = '';
			resetModelRecoveryFlags();
			const verifiedMsg = res.checked
				? `Verified (HTTP ${res.answered}).`
				: res.answered
					? `Saved (provider answered HTTP ${res.answered}).`
					: 'Saved without network verification.';
			showStatus(
				'info',
				`Saved provider "${id}"`,
				res.reloadRequired
					? `${verifiedMsg} Reload Loam to use it in the main window.`
					: `${verifiedMsg} Key updated live with no reload required.`
			);
			resetModelForm();
			await refreshState();
		} catch (err) {
			const code = err?.code;
			showStatus('error', 'Could not save model provider', formatError(err));
			const box = $('model-recovery-box');
			if (code === 'MODEL_UNREACHABLE') {
				box.textContent =
					'The provider endpoint could not be reached. You can retry or save offline without verifying.';
				box.hidden = false;
				$('btn-model-save-offline').hidden = false;
			} else if (code === 'COPILOT_KEY_REBIND_REQUIRED') {
				box.textContent =
					'Changing the provider type or endpoint requires confirming that you want to reuse the stored key for the new destination, or entering a new API key.';
				box.hidden = false;
				$('btn-model-rebind').hidden = false;
			} else if (code === 'COPILOT_KEYCHAIN_UNAVAILABLE' && state?.allowsFileFallback && !isCli) {
				box.textContent =
					'No OS Secret Service keyring is available. You may opt in to store this API key in an owner-only file (mode 0600) inside your Loam data directory.';
				box.hidden = false;
				$('btn-model-file-fallback').hidden = false;
			}
		} finally {
			busy = false;
		}
	}

	async function handleSetDefaultModel(id) {
		if (busy) return;
		busy = true;
		try {
			await invoke('setup_model_set_default', { id });
			showStatus(
				'info',
				`Default provider set to "${id}"`,
				'Reload Loam to apply in the main window.'
			);
			await refreshState();
		} catch (err) {
			showStatus('error', 'Could not set default provider', formatError(err));
		} finally {
			busy = false;
		}
	}

	async function handleRemoveModel(id, deleteKey) {
		if (busy) return;
		busy = true;
		try {
			const res = await invoke('setup_model_remove', { id, deleteKey });
			pendingModelRemoveId = null;
			if (editingModelId === id) resetModelForm();
			showStatus(
				'info',
				res.reloadRequired ? `Removed provider "${id}"` : `Deleted keychain key for "${id}"`,
				res.reloadRequired
					? 'Reload Loam to apply in the main window.'
					: 'Key removed from OS keychain.'
			);
			await refreshState();
		} catch (err) {
			showStatus('error', 'Could not remove provider', formatError(err));
		} finally {
			busy = false;
		}
	}

	async function handlePick(kind) {
		if (busy) return;
		busy = true;
		clearStatus();
		try {
			const res = await invoke('setup_plugin_pick', { kind });
			if (!res.cancelled && res.proposal) {
				activeProposal = res.proposal;
				renderProposal();
			}
		} catch (err) {
			showStatus('error', 'Plugin inspection failed', formatError(err));
		} finally {
			busy = false;
		}
	}

	async function handleInspectBundled(id) {
		if (busy) return;
		busy = true;
		clearStatus();
		try {
			const res = await invoke('setup_plugin_inspect_bundled', { id });
			if (res.proposal) {
				activeProposal = res.proposal;
				renderProposal();
			}
		} catch (err) {
			showStatus('error', 'Bundled plugin inspection failed', formatError(err));
		} finally {
			busy = false;
		}
	}

	async function handleCancelProposal() {
		if (!activeProposal || busy) return;
		busy = true;
		try {
			await invoke('setup_plugin_cancel', { proposalId: activeProposal.proposalId });
			activeProposal = null;
			renderProposal();
		} catch (err) {
			activeProposal = null;
			renderProposal();
			showStatus('warn', 'Proposal cleared', formatError(err));
		} finally {
			busy = false;
		}
	}

	async function handleConfirmProposal(allowFileFallback) {
		if (!activeProposal || busy) return;
		busy = true;
		clearStatus();
		const payload = {
			proposalId: activeProposal.proposalId,
			expectedBundleSha256: activeProposal.bundleSha256,
		};
		if (allowFileFallback) payload.allowFileFallback = true;
		try {
			const res = await invoke('setup_plugin_confirm', payload);
			activeProposal = null;
			showStatus(
				'info',
				`Installed ${res.installed?.title || res.installed?.id || 'plugin'}`,
				'Reload Loam to load the updated plugin in the main window.'
			);
			await refreshState();
		} catch (err) {
			if (err?.code === 'PLUGIN_KEYCHAIN_UNAVAILABLE' && state?.allowsFileFallback) {
				const box = $('proposal-fallback-box');
				box.textContent =
					'No OS Secret Service keyring is available. Re-inspect or confirm with owner-only file fallback (mode 0600) to store the mount token on disk.';
				box.hidden = false;
				$('btn-proposal-confirm-fallback').hidden = false;
			} else {
				activeProposal = null;
				renderProposal();
			}
			showStatus('error', 'Plugin installation failed', formatError(err));
		} finally {
			busy = false;
		}
	}

	async function handleUninstall(pluginId) {
		if (busy) return;
		busy = true;
		try {
			const res = await invoke('setup_plugin_uninstall', { pluginId });
			pendingUninstallId = null;
			const revNote = res.tokenRevoked
				? 'Engine token revoked and personal data preserved.'
				: 'Personal data preserved. Token revocation failed and was queued for retry.';
			showStatus('info', `Uninstalled "${pluginId}"`, revNote);
			await refreshState();
		} catch (err) {
			showStatus('error', 'Uninstall failed', formatError(err));
		} finally {
			busy = false;
		}
	}

	async function handleRetryRevocation(tokenId) {
		if (busy) return;
		busy = true;
		try {
			await invoke('setup_plugin_retry_revocation', { tokenId });
			showStatus(
				'info',
				'Token revoked',
				`Revoked token ${tokenId} and cleaned up obsolete bundle files.`
			);
			await refreshState();
		} catch (err) {
			showStatus('error', 'Revocation retry failed', formatError(err));
		} finally {
			busy = false;
		}
	}

	async function handleRotateToken(pluginId) {
		if (busy) return;
		busy = true;
		try {
			const res = await invoke('setup_plugin_rotate_token', { pluginId });
			showStatus(
				'info',
				`Rotated token for "${pluginId}"`,
				`Active token ID is now ${res.tokenId}. Applied live with no reload required.`
			);
			await refreshState();
		} catch (err) {
			showStatus('error', 'Token rotation failed', formatError(err));
		} finally {
			busy = false;
		}
	}

	async function handleServiceAction(pluginId, action) {
		if (busy) return;
		busy = true;
		try {
			const res = await invoke('setup_plugin_service_action', { pluginId, action });
			showStatus(
				'info',
				`Service ${action}: ${pluginId}`,
				`State: ${res.state} (127.0.0.1:${res.port})`
			);
		} catch (err) {
			showStatus('error', `Service ${action} failed`, formatError(err));
		} finally {
			busy = false;
		}
	}

	async function handleApplyReload() {
		if (busy) return;
		busy = true;
		try {
			const res = await invoke('setup_apply_reload', {});
			if (res.action === 'reloaded') {
				showStatus(
					'info',
					'Loam reloaded',
					'The main window is loading your updated configuration.'
				);
				await refreshState();
			} else if (res.action === 'prompted') {
				showStatus(
					'warn',
					'Switched to Loam to finish reloading',
					'If you have unsaved edits in open tabs, save or discard them in the main window dialog to finish reloading.'
				);
			} else {
				showStatus(
					'warn',
					'Main window is busy',
					'Loam is currently loading. Try reloading again in a moment.'
				);
			}
		} catch (err) {
			showStatus('error', 'Reload failed', formatError(err));
		} finally {
			busy = false;
		}
	}

	function wireEvents() {
		$('tab-models').addEventListener('click', () => selectSection('models'));
		$('tab-plugins').addEventListener('click', () => selectSection('plugins'));
		const tablist = document.querySelector('[role="tablist"]');
		tablist.addEventListener('keydown', (e) => {
			if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Home' || e.key === 'End') {
				e.preventDefault();
				const next =
					$('tab-models').getAttribute('aria-selected') === 'true' ? 'plugins' : 'models';
				selectSection(next);
				$(next === 'models' ? 'tab-models' : 'tab-plugins').focus();
			}
		});

		$('theme-select').addEventListener('change', (e) => {
			document.documentElement.setAttribute('data-theme', e.target.value);
		});

		$('model-kind').addEventListener('change', () => {
			resetModelRecoveryFlags();
			clearModelRecovery();
			syncEndpointVisibility();
		});
		$('model-id').addEventListener('input', () => {
			resetModelRecoveryFlags();
			clearModelRecovery();
		});
		$('model-endpoint').addEventListener('input', () => {
			resetModelRecoveryFlags();
			clearModelRecovery();
		});
		$('btn-model-reset').addEventListener('click', () => {
			resetModelRecoveryFlags();
			resetModelForm();
		});
		$('model-form').addEventListener('submit', (e) => {
			e.preventDefault();
			submitModelSave();
		});
		$('btn-model-save-offline').addEventListener('click', () =>
			submitModelSave({ skipVerify: true })
		);
		$('btn-model-rebind').addEventListener('click', () =>
			submitModelSave({ confirmRebindKey: true })
		);
		$('btn-model-file-fallback').addEventListener('click', () =>
			submitModelSave({ allowFileFallback: true })
		);

		$('btn-pick-file').addEventListener('click', () => handlePick('file'));
		$('btn-pick-folder').addEventListener('click', () => handlePick('folder'));
		$('btn-proposal-cancel').addEventListener('click', handleCancelProposal);
		$('btn-proposal-cancel-top').addEventListener('click', handleCancelProposal);
		$('btn-proposal-confirm').addEventListener('click', () => handleConfirmProposal(false));
		$('btn-proposal-confirm-fallback').addEventListener('click', () => handleConfirmProposal(true));

		$('btn-reload-now').addEventListener('click', handleApplyReload);
		$('btn-reload-later').addEventListener('click', () => {
			$('reload-banner').hidden = true;
		});

		window.addEventListener('loam:setup-section', (e) => {
			if (!activeProposal && (e.detail === 'models' || e.detail === 'plugins')) {
				selectSection(e.detail);
			}
		});
		window.addEventListener('loam:setup-proposal', (e) => {
			const detail = e.detail;
			if (detail && detail.proposal) {
				activeProposal = detail.proposal;
				selectSection('plugins');
				renderProposal();
			} else if (detail && detail.error) {
				selectSection('plugins');
				showStatus('error', 'Could not inspect plugin', formatError(detail.error));
			} else if (detail && detail.busy) {
				selectSection('plugins');
				showStatus(
					'warn',
					'Finish active review first',
					'Complete or cancel the current plugin review before inspecting another plugin.'
				);
			}
		});
	}

	function init() {
		wireEvents();
		const hash = window.location.hash.replace(/^#/, '');
		const param = new URLSearchParams(window.location.search).get('section');
		selectSection(hash === 'models' || param === 'models' ? 'models' : 'plugins');
		syncEndpointVisibility();
		refreshState();
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
