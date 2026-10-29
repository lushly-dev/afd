import { expect, test } from "./coverage-fixture.spec.js";

const commandModuleUrl = `/@fs${new URL("./index.ts", import.meta.url).pathname}`;
const schemaValidationModuleUrl = `/@fs${
    new URL("./schema-validation.ts", import.meta.url).pathname
}`;
const definitionSchemaModuleUrl = `/@fs${
    new URL("../definition-schema/index.ts", import.meta.url).pathname
}`;

test.describe("FAST-AF commands", () => {
    test("discovers decorated commands and follows the v3 element lifecycle", async ({
        page,
    }) => {
        await page.goto("/");

        const result = await page.evaluate(async commandUrl => {
            // @ts-expect-error: Client module.
            const { FASTElement, uniqueElementName } = await import("/main.js");
            const { CommandRegistry, command, success } = await import(commandUrl);
            CommandRegistry.clear();

            class EditorElement extends FASTElement {
                saveCanExecute = true;
                calls = 0;

                save(value: string) {
                    this.calls++;
                    return success({ value, calls: this.calls });
                }
            }

            const descriptor = Object.getOwnPropertyDescriptor(
                EditorElement.prototype,
                "save",
            )!;
            command("editor.save", {
                label: "Save",
                expose: { mcp: true, cli: false },
            })(EditorElement.prototype, "save", descriptor);

            const name = uniqueElementName();
            await FASTElement.define(EditorElement, { name });

            const first = document.createElement(name) as EditorElement;
            const second = document.createElement(name) as EditorElement;
            document.body.append(first, second);

            const entryAfterSecondConnect = CommandRegistry.get("editor.save");
            first.remove();
            const entryAfterFirstDisconnect = CommandRegistry.get("editor.save");
            const execution = await CommandRegistry.execute("editor.save", "draft");

            second.saveCanExecute = false;
            const disabled = await CommandRegistry.execute("editor.save", "blocked");
            const mcpActions = CommandRegistry.getActions({ interface: "mcp" });
            const cliActions = CommandRegistry.getActions({ interface: "cli" });

            second.remove();
            const entryAfterLastDisconnect = CommandRegistry.get("editor.save");
            CommandRegistry.clear();

            return {
                secondRegistrationWon: entryAfterSecondConnect?.source.deref() === second,
                staleDisconnectPreservedCurrent:
                    entryAfterFirstDisconnect?.source.deref() === second,
                execution,
                disabled,
                mcpActionIds: mcpActions.map(action => action.id),
                cliActionIds: cliActions.map(action => action.id),
                removedAfterLastDisconnect: entryAfterLastDisconnect === undefined,
            };
        }, commandModuleUrl);

        expect(result.secondRegistrationWon).toBe(true);
        expect(result.staleDisconnectPreservedCurrent).toBe(true);
        expect(result.execution).toMatchObject({
            success: true,
            data: { value: "draft", calls: 1 },
        });
        expect(result.disabled).toMatchObject({
            success: false,
            error: { code: "COMMAND_DISABLED" },
        });
        expect(result.mcpActionIds).toEqual(["editor.save"]);
        expect(result.cliActionIds).toEqual([]);
        expect(result.removedAfterLastDisconnect).toBe(true);
    });

    test("executes interceptors in priority order and observes structured results", async ({
        page,
    }) => {
        await page.goto("/");

        const result = await page.evaluate(async commandUrl => {
            const { CommandRegistry, success } = await import(commandUrl);
            CommandRegistry.clear();
            const source = document.createElement("div");
            const order: string[] = [];
            const telemetry: string[] = [];

            CommandRegistry.setTelemetryHandler(event => telemetry.push(event));
            CommandRegistry.addInterceptor({
                name: "late",
                priority: 20,
                async intercept(_command, _args, next) {
                    order.push("late:before");
                    const value = await next();
                    order.push("late:after");
                    return value;
                },
            });
            CommandRegistry.addInterceptor({
                name: "early",
                priority: 10,
                async intercept(_command, _args, next) {
                    order.push("early:before");
                    const value = await next();
                    order.push("early:after");
                    return value;
                },
            });
            CommandRegistry.addPostHook({
                name: "test-observer",
                afterExecute(_command, args, commandResult) {
                    order.push(`post:${String(args[0])}:${commandResult.success}`);
                },
            });
            CommandRegistry.register("test.run", {
                id: "test.run",
                label: "Run",
                execute(value: unknown) {
                    order.push("handler");
                    return success({ value });
                },
                canExecute: true,
                when: true,
                source: new WeakRef(source),
            });

            const execution = await CommandRegistry.execute("test.run", 42);
            const missing = await CommandRegistry.execute("test.missing");

            CommandRegistry.removeInterceptor("early");
            CommandRegistry.removeInterceptor("late");
            CommandRegistry.removePostHook("test-observer");
            CommandRegistry.setTelemetryHandler(() => {});
            CommandRegistry.clear();

            return { execution, missing, order, telemetry };
        }, commandModuleUrl);

        expect(result.execution).toMatchObject({
            success: true,
            data: { value: 42 },
        });
        expect(result.missing).toMatchObject({
            success: false,
            error: { code: "COMMAND_NOT_FOUND", retryable: false },
        });
        expect(result.order).toEqual([
            "early:before",
            "late:before",
            "handler",
            "late:after",
            "early:after",
            "post:42:true",
        ]);
        expect(result.telemetry).toContain("command.registered");
        expect(result.telemetry).toContain("command.executed");
    });

    test("normalizes thrown and malformed command results", async ({ page }) => {
        await page.goto("/");

        const result = await page.evaluate(async commandUrl => {
            const { CommandRegistry } = await import(commandUrl);
            CommandRegistry.clear();
            const source = document.createElement("div");

            const unsubscribe = CommandRegistry.onChange(() => {
                throw new Error("listener failure");
            });
            CommandRegistry.setTelemetryHandler(() => {
                throw new Error("telemetry failure");
            });
            CommandRegistry.addPostHook({
                name: "throwing-post-hook",
                afterExecute() {
                    throw new Error("post-hook failure");
                },
            });

            CommandRegistry.register("test.throws", {
                id: "test.throws",
                label: "Throws",
                execute() {
                    throw new TypeError("implementation failed");
                },
                canExecute: true,
                when: true,
                source: new WeakRef(source),
            });
            CommandRegistry.register("test.invalid-result", {
                id: "test.invalid-result",
                label: "Invalid result",
                execute: (() => undefined) as any,
                canExecute: true,
                when: true,
                source: new WeakRef(source),
            });

            const thrown = await CommandRegistry.execute("test.throws");
            const invalid = await CommandRegistry.execute("test.invalid-result");

            unsubscribe();
            CommandRegistry.removePostHook("throwing-post-hook");
            CommandRegistry.setTelemetryHandler(() => {});
            CommandRegistry.clear();

            return { invalid, thrown };
        }, commandModuleUrl);

        expect(result.thrown).toMatchObject({
            success: false,
            error: {
                code: "EXECUTION_FAILED",
                details: {
                    cause: {
                        message: "implementation failed",
                        name: "TypeError",
                    },
                },
            },
        });
        expect(result.invalid).toMatchObject({
            success: false,
            error: { code: "INTERNAL_ERROR" },
        });
    });

    test("confirms destructive commands and captures undo operations", async ({
        page,
    }) => {
        await page.goto("/");

        const result = await page.evaluate(async commandUrl => {
            const { CommandRegistry, ConfirmBehavior, UndoBehavior, success } =
                await import(commandUrl);
            CommandRegistry.clear();

            const source = document.createElement("div") as HTMLElement & {
                count: number;
                changeUndo(): () => void;
            };
            source.count = 0;
            source.changeUndo = () => () => {
                source.count--;
            };
            const controller = { source } as any;

            const confirm = new ConfirmBehavior();
            const undo = new UndoBehavior({
                limit: 2,
                enableKeyboardShortcut: false,
            });
            confirm.connectedCallback(controller);
            undo.connectedCallback(controller);

            CommandRegistry.register("counter.change", {
                id: "counter.change",
                label: "Change counter",
                destructive: true,
                confirmPrompt: "Apply the change?",
                execute() {
                    source.count++;
                    return success({ count: source.count });
                },
                canExecute: true,
                when: true,
                source: new WeakRef(source),
            });

            const cancelledPromise = CommandRegistry.execute("counter.change");
            await Promise.resolve();
            const pendingPrompt = confirm.pendingConfirmation?.prompt;
            confirm.cancelPending();
            const cancelled = await cancelledPromise;

            const confirmedPromise = CommandRegistry.execute("counter.change");
            await Promise.resolve();
            confirm.executeConfirmed();
            const confirmed = await confirmedPromise;
            const stackAfterExecute = undo.getStack().map(entry => ({
                id: entry.commandId,
                label: entry.label,
            }));
            const undone = await undo.undo();

            confirm.disconnectedCallback(controller);
            undo.disconnectedCallback(controller);
            CommandRegistry.clear();

            return {
                pendingPrompt,
                cancelled,
                confirmed,
                stackAfterExecute,
                undone,
                count: source.count,
            };
        }, commandModuleUrl);

        expect(result.pendingPrompt).toBe("Apply the change?");
        expect(result.cancelled).toMatchObject({
            success: false,
            error: { code: "USER_CANCELLED" },
        });
        expect(result.confirmed).toMatchObject({
            success: true,
            data: { count: 1 },
        });
        expect(result.stackAfterExecute).toEqual([
            { id: "counter.change", label: "Change counter" },
        ]);
        expect(result.undone).toBe(true);
        expect(result.count).toBe(0);
    });

    test("cmd-exec bridge is opt-in and honours expose, parameters and confirmation", async ({
        page,
    }) => {
        await page.goto("/");

        const result = await page.evaluate(async commandUrl => {
            const { CommandRegistry, success } = await import(commandUrl);
            CommandRegistry.clear();
            const source = document.createElement("div");
            const calls: string[] = [];
            const telemetry: Array<{ event: string; data: any }> = [];
            CommandRegistry.setTelemetryHandler((event, data) =>
                telemetry.push({ event, data }),
            );

            const register = (id: string, extra: Record<string, unknown> = {}) =>
                CommandRegistry.register(id, {
                    id,
                    label: id,
                    execute() {
                        calls.push(id);
                        return success({ id });
                    },
                    canExecute: true,
                    when: true,
                    source: new WeakRef(source),
                    ...extra,
                });
            const fire = async (id: string, args?: unknown[]) => {
                document.dispatchEvent(
                    new CustomEvent("cmd-exec", { detail: { id, args } }),
                );
                await new Promise(resolve => setTimeout(resolve, 20));
            };

            register("bridge.open");
            register("bridge.hidden-destructive", {
                destructive: true,
                expose: { agent: false },
            });
            register("bridge.destructive", { destructive: true });
            register("bridge.params", {
                parameters: {
                    type: "object",
                    required: ["name"],
                    properties: { name: { type: "string" } },
                },
            });

            // 1. Nothing listens until the bridge is enabled.
            await fire("bridge.open");
            const callsBeforeEnable = [...calls];

            const disable = CommandRegistry.enableEventBridge();
            const disableAgain = CommandRegistry.enableEventBridge();

            // 2. Exposed command runs; no confirm interceptor is installed.
            await fire("bridge.open");
            // 3. Non-exposed destructive command is rejected.
            await fire("bridge.hidden-destructive");
            // 4. Exposed destructive command fails closed without a confirm interceptor.
            await fire("bridge.destructive");
            // 5. Parameter violations never reach the command.
            await fire("bridge.params", [{ name: 42 }]);
            await fire("bridge.params", [{ name: "ok" }]);
            // 6. Malformed events are ignored.
            document.dispatchEvent(new CustomEvent("cmd-exec", { detail: null }));
            document.dispatchEvent(new CustomEvent("cmd-exec", { detail: { id: 7 } }));

            const rejected = telemetry
                .filter(t => t.event === "command.rejected")
                .map(t => `${t.data.id}:${t.data.origin}:${t.data.code}`);
            const callsWhileEnabled = [...calls];

            // The bridge stays on until every caller has disposed.
            disable();
            await fire("bridge.open");
            const callsAfterFirstDispose = calls.length;
            disableAgain();
            await fire("bridge.open");
            const callsAfterLastDispose = calls.length;

            CommandRegistry.setTelemetryHandler(() => {});
            CommandRegistry.clear();

            return {
                callsBeforeEnable,
                callsWhileEnabled,
                rejected,
                callsAfterFirstDispose,
                callsAfterLastDispose,
            };
        }, commandModuleUrl);

        expect(result.callsBeforeEnable).toEqual([]);
        expect(result.callsWhileEnabled).toEqual(["bridge.open", "bridge.params"]);
        expect(result.rejected).toEqual([
            "bridge.hidden-destructive:agent:COMMAND_NOT_EXPOSED",
            "bridge.destructive:agent:CONFIRMATION_REQUIRED",
            "bridge.params:agent:INVALID_PARAMETERS",
        ]);
        expect(result.callsAfterFirstDispose).toBe(3);
        expect(result.callsAfterLastDispose).toBe(3);
    });

    test("invoke enforces expose, validates parameters and fails closed for destructive commands", async ({
        page,
    }) => {
        await page.goto("/");

        const result = await page.evaluate(async commandUrl => {
            const { CommandRegistry, success } = await import(commandUrl);
            CommandRegistry.clear();
            const source = document.createElement("div");
            let executed = 0;

            const register = (id: string, extra: Record<string, unknown> = {}) =>
                CommandRegistry.register(id, {
                    id,
                    label: id,
                    execute() {
                        executed++;
                        return success({ id });
                    },
                    canExecute: true,
                    when: true,
                    source: new WeakRef(source),
                    ...extra,
                });

            register("safe.params", {
                parameters: {
                    type: "object",
                    required: ["name", "count"],
                    additionalProperties: false,
                    properties: {
                        name: { type: "string", minLength: 2, maxLength: 5 },
                        count: { type: "integer", minimum: 1, maximum: 3 },
                        mode: { enum: ["a", "b"] },
                        tags: {
                            type: "array",
                            maxItems: 1,
                            items: { type: "string" },
                        },
                    },
                },
            });
            register("safe.mcp-only", { expose: { agent: false, mcp: true } });
            register("safe.cli-default");
            register("safe.destructive", { destructive: true });

            const invoke = (id: string, args: unknown[], origin: string = "agent") =>
                CommandRegistry.invoke(id, args, { origin });

            const valid = await invoke("safe.params", [{ name: "abc", count: 2 }]);
            const missing = await invoke("safe.params", []);
            const wrongType = await invoke("safe.params", [{ name: 5, count: 2 }]);
            const tooShort = await invoke("safe.params", [{ name: "a", count: 2 }]);
            const outOfRange = await invoke("safe.params", [{ name: "abc", count: 9 }]);
            const notInteger = await invoke("safe.params", [{ name: "abc", count: 1.5 }]);
            const badEnum = await invoke("safe.params", [
                { name: "abc", count: 1, mode: "z" },
            ]);
            const badItems = await invoke("safe.params", [
                { name: "abc", count: 1, tags: ["x", 2] },
            ]);
            const extra = await invoke("safe.params", [
                { name: "abc", count: 1, other: true },
            ]);
            const notObject = await invoke("safe.params", ["abc"]);
            const executedAfterValidation = executed;

            const mcpOnlyAsAgent = await invoke("safe.mcp-only", []);
            const mcpOnlyAsMcp = await invoke("safe.mcp-only", [], "mcp");
            const cliDefault = await invoke("safe.cli-default", [], "cli");
            const unknownOrigin = await invoke("safe.cli-default", [], "bogus");
            const missingCommand = await invoke("safe.nope", []);

            // Destructive: fail closed when nothing can confirm it...
            const destructiveClosed = await invoke("safe.destructive", []);
            const executedBeforeConfirmer = executed;
            // ...but programmatic execution keeps the existing behaviour...
            const destructiveProgrammatic =
                await CommandRegistry.execute("safe.destructive");
            // ...and an installed confirmer (any name, flagged) is honoured.
            let asked = 0;
            CommandRegistry.addInterceptor({
                name: "custom-confirmation",
                confirms: true,
                async intercept(command: any, _args: unknown[], next: any) {
                    asked++;
                    return command.destructive ? next() : next();
                },
            });
            const destructiveConfirmed = await invoke("safe.destructive", []);
            CommandRegistry.removeInterceptor("custom-confirmation");

            CommandRegistry.clear();

            return {
                valid,
                issues: [
                    missing,
                    wrongType,
                    tooShort,
                    outOfRange,
                    notInteger,
                    badEnum,
                    badItems,
                    extra,
                    notObject,
                ].map(r => ({
                    code: r.error?.code,
                    paths: r.error?.details?.issues.map((i: any) => i.path),
                })),
                executedAfterValidation,
                mcpOnlyAsAgent,
                mcpOnlyAsMcp,
                cliDefault,
                unknownOrigin,
                missingCommand,
                destructiveClosed,
                executedBeforeConfirmer,
                destructiveProgrammatic,
                destructiveConfirmed,
                asked,
            };
        }, commandModuleUrl);

        expect(result.valid).toMatchObject({ success: true });
        expect(result.issues).toEqual([
            { code: "INVALID_PARAMETERS", paths: ["$.name", "$.count"] },
            { code: "INVALID_PARAMETERS", paths: ["$.name"] },
            { code: "INVALID_PARAMETERS", paths: ["$.name"] },
            { code: "INVALID_PARAMETERS", paths: ["$.count"] },
            { code: "INVALID_PARAMETERS", paths: ["$.count"] },
            { code: "INVALID_PARAMETERS", paths: ["$.mode"] },
            { code: "INVALID_PARAMETERS", paths: ["$.tags", "$.tags[1]"] },
            { code: "INVALID_PARAMETERS", paths: ["$.other"] },
            { code: "INVALID_PARAMETERS", paths: ["$"] },
        ]);
        expect(result.executedAfterValidation).toBe(1);
        expect(result.mcpOnlyAsAgent).toMatchObject({
            success: false,
            error: { code: "COMMAND_NOT_EXPOSED" },
        });
        expect(result.mcpOnlyAsMcp).toMatchObject({ success: true });
        expect(result.cliDefault).toMatchObject({
            success: false,
            error: { code: "COMMAND_NOT_EXPOSED" },
        });
        expect(result.unknownOrigin).toMatchObject({
            success: false,
            error: { code: "COMMAND_NOT_EXPOSED" },
        });
        expect(result.missingCommand).toMatchObject({
            success: false,
            error: { code: "COMMAND_NOT_FOUND" },
        });
        expect(result.destructiveClosed).toMatchObject({
            success: false,
            error: { code: "CONFIRMATION_REQUIRED", retryable: false },
        });
        expect(result.executedBeforeConfirmer).toBe(2);
        expect(result.destructiveProgrammatic).toMatchObject({ success: true });
        expect(result.destructiveConfirmed).toMatchObject({ success: true });
        expect(result.asked).toBe(1);
    });

    test("hidden commands stay executable but are omitted from getActions", async ({
        page,
    }) => {
        await page.goto("/");

        const result = await page.evaluate(async commandUrl => {
            // @ts-expect-error: Client module.
            const { FASTElement, uniqueElementName } = await import("/main.js");
            const { CommandRegistry, command, success } = await import(commandUrl);
            CommandRegistry.clear();

            class HostElement extends FASTElement {
                shown() {
                    return success({ ran: "shown" });
                }
                secret() {
                    return success({ ran: "secret" });
                }
                gated() {
                    return success({ ran: "gated" });
                }
                gatedWhen = false;
            }
            const decorate = (method: string, id: string, options: object) =>
                command(id, options)(
                    HostElement.prototype,
                    method,
                    Object.getOwnPropertyDescriptor(HostElement.prototype, method)!,
                );
            decorate("shown", "probe.shown", {});
            decorate("secret", "probe.hidden", { hidden: true });
            decorate("gated", "probe.gated", {});

            const name = uniqueElementName();
            await FASTElement.define(HostElement, { name });
            const host = document.createElement(name) as HostElement;
            document.body.append(host);

            const ids = (filter?: object) =>
                CommandRegistry.getActions(filter)
                    .map((a: { id: string }) => a.id)
                    .sort();
            const all = ids();
            const palette = ids({ interface: "palette" });
            const registered = CommandRegistry.get("probe.hidden") !== undefined;
            const executed = await CommandRegistry.execute("probe.hidden");
            host.gatedWhen = true;
            const afterWhen = ids();

            host.remove();
            CommandRegistry.clear();
            return { all, palette, registered, executed, afterWhen };
        }, commandModuleUrl);

        expect(result.all).toEqual(["probe.shown"]);
        expect(result.palette).toEqual(["probe.shown"]);
        expect(result.registered).toBe(true);
        expect(result.executed).toMatchObject({ success: true, data: { ran: "secret" } });
        expect(result.afterWhen).toEqual(["probe.gated", "probe.shown"]);
    });

    test("execute and getActions never throw when canExecute throws", async ({
        page,
    }) => {
        await page.goto("/");

        const result = await page.evaluate(async commandUrl => {
            const { CommandRegistry } = await import(commandUrl);
            CommandRegistry.clear();
            const source = document.createElement("div");

            CommandRegistry.register("flaky.command", {
                id: "flaky.command",
                label: "Flaky",
                execute() {
                    throw new Error("must not run");
                },
                get canExecute(): boolean {
                    throw new RangeError("canExecute exploded");
                },
                when: true,
                source: new WeakRef(source),
            });

            let threw = false;
            let execution: any;
            let invocation: any;
            let actions: any[] = [];

            try {
                execution = await CommandRegistry.execute("flaky.command");
                invocation = await CommandRegistry.invoke("flaky.command", [], {
                    origin: "agent",
                });
                actions = CommandRegistry.getActions();
            } catch {
                threw = true;
            }

            CommandRegistry.clear();

            return {
                threw,
                execution,
                invocation,
                actions: actions.map(a => ({ id: a.id, disabled: a.disabled })),
            };
        }, commandModuleUrl);

        expect(result.threw).toBe(false);
        for (const outcome of [result.execution, result.invocation]) {
            expect(outcome).toMatchObject({
                success: false,
                error: {
                    code: "EXECUTION_FAILED",
                    details: {
                        cause: { message: "canExecute exploded", name: "RangeError" },
                    },
                },
            });
        }
        expect(result.actions).toEqual([{ id: "flaky.command", disabled: true }]);
    });

    test("shares one confirm interceptor between ConfirmBehavior instances", async ({
        page,
    }) => {
        await page.goto("/");

        const result = await page.evaluate(async commandUrl => {
            const { CommandRegistry, ConfirmBehavior, success } = await import(
                commandUrl
            );
            CommandRegistry.clear();
            const source = document.createElement("div");
            const controller = { source } as any;
            let runs = 0;
            CommandRegistry.register("shared.delete", {
                id: "shared.delete",
                label: "Delete",
                destructive: true,
                confirmPrompt: "Really?",
                execute() {
                    runs++;
                    return success({ runs });
                },
                canExecute: true,
                when: true,
                source: new WeakRef(source),
            });

            const interceptorNames: string[] = [];
            CommandRegistry.setTelemetryHandler((event: string, data: any) => {
                if (event === "interceptor.added") interceptorNames.push(`+${data.name}`);
                if (event === "interceptor.removed")
                    interceptorNames.push(`-${data.name}`);
            });

            const first = new ConfirmBehavior();
            const second = new ConfirmBehavior();
            first.connectedCallback(controller);
            second.connectedCallback(controller);
            // Connecting twice must not double count.
            second.connectedCallback(controller);

            // The most recently connected instance handles confirmations.
            const viaSecond = CommandRegistry.execute("shared.delete");
            await Promise.resolve();
            const secondPrompt = second.pendingConfirmation?.prompt;
            const firstIdle = first.pendingConfirmation === null;
            second.executeConfirmed();
            const confirmedViaSecond = await viaSecond;

            // Disconnecting the first-connected instance must not strip the interceptor.
            first.disconnectedCallback(controller);
            const stillIntercepted = CommandRegistry.execute("shared.delete");
            await Promise.resolve();
            const promptAfterFirstLeft = second.pendingConfirmation?.prompt;
            const runsBeforeConfirm = runs;
            second.cancelPending();
            const cancelled = await stillIntercepted;

            // Reverse order: the older instance takes over when the newer one leaves.
            first.connectedCallback(controller);
            second.disconnectedCallback(controller);
            const viaFirst = CommandRegistry.execute("shared.delete");
            await Promise.resolve();
            const firstPrompt = first.pendingConfirmation?.prompt;
            first.executeConfirmed();
            const confirmedViaFirst = await viaFirst;

            first.disconnectedCallback(controller);
            // With no instance connected the interceptor is gone.
            const unguarded = await CommandRegistry.execute("shared.delete");

            CommandRegistry.setTelemetryHandler(() => {});
            CommandRegistry.clear();

            return {
                interceptorNames,
                secondPrompt,
                firstIdle,
                confirmedViaSecond,
                promptAfterFirstLeft,
                runsBeforeConfirm,
                cancelled,
                firstPrompt,
                confirmedViaFirst,
                unguarded,
            };
        }, commandModuleUrl);

        expect(result.interceptorNames).toEqual(["+confirm", "-confirm"]);
        expect(result.secondPrompt).toBe("Really?");
        expect(result.firstIdle).toBe(true);
        expect(result.confirmedViaSecond).toMatchObject({ success: true });
        expect(result.promptAfterFirstLeft).toBe("Really?");
        expect(result.runsBeforeConfirm).toBe(1);
        expect(result.cancelled).toMatchObject({
            success: false,
            error: { code: "USER_CANCELLED" },
        });
        expect(result.firstPrompt).toBe("Really?");
        expect(result.confirmedViaFirst).toMatchObject({ success: true });
        expect(result.unguarded).toMatchObject({ success: true });
    });

    test("queues concurrent confirmations and exposes them observably", async ({
        page,
    }) => {
        await page.goto("/");

        const result = await page.evaluate(async commandUrl => {
            const { CommandRegistry, ConfirmBehavior, success } = await import(
                commandUrl
            );
            CommandRegistry.clear();
            const source = document.createElement("div");
            const controller = { source } as any;
            const ran: string[] = [];

            for (const id of ["queue.one", "queue.two", "queue.three"]) {
                CommandRegistry.register(id, {
                    id,
                    label: id,
                    destructive: true,
                    confirmPrompt: `Run ${id}?`,
                    execute() {
                        ran.push(id);
                        return success({ id });
                    },
                    canExecute: true,
                    when: true,
                    source: new WeakRef(source),
                });
            }

            const confirm = new ConfirmBehavior();
            const notifications: Array<string | null> = [];
            // @ts-expect-error: Client module.
            const { Observable } = await import("/main.js");
            Observable.getNotifier(confirm).subscribe(
                {
                    handleChange() {
                        notifications.push(
                            confirm.pendingConfirmation?.commandId ?? null,
                        );
                    },
                },
                "pendingConfirmation",
            );
            confirm.connectedCallback(controller);

            const one = CommandRegistry.execute("queue.one");
            const two = CommandRegistry.execute("queue.two");
            const three = CommandRegistry.execute("queue.three");
            await new Promise(resolve => setTimeout(resolve, 0));

            const initial = {
                id: confirm.pendingConfirmation?.commandId,
                count: confirm.pendingCount,
            };
            confirm.executeConfirmed(); // one
            const afterFirst = {
                id: confirm.pendingConfirmation?.commandId,
                count: confirm.pendingCount,
            };
            confirm.cancelPending(); // two
            const afterSecond = confirm.pendingConfirmation?.commandId;

            const first = await one;
            const second = await two;

            // Disconnecting settles whatever is still queued.
            confirm.disconnectedCallback(controller);
            const third = await three;
            const afterDisconnect = confirm.pendingConfirmation;

            CommandRegistry.clear();

            return {
                initial,
                afterFirst,
                afterSecond,
                first,
                second,
                third,
                afterDisconnect,
                ran,
                notifications,
            };
        }, commandModuleUrl);

        expect(result.initial).toEqual({ id: "queue.one", count: 3 });
        expect(result.afterFirst).toEqual({ id: "queue.two", count: 2 });
        expect(result.afterSecond).toBe("queue.three");
        expect(result.first).toMatchObject({ success: true });
        expect(result.second).toMatchObject({
            success: false,
            error: { code: "USER_CANCELLED" },
        });
        expect(result.third).toMatchObject({
            success: false,
            error: { code: "USER_CANCELLED" },
        });
        expect(result.afterDisconnect).toBeNull();
        expect(result.ran).toEqual(["queue.one"]);
        // queued x3, settled one, settled two, cleared on disconnect
        expect(result.notifications).toEqual([
            "queue.one",
            "queue.one",
            "queue.one",
            "queue.two",
            "queue.three",
            null,
        ]);
    });

    test("keeps a command registered until its last source is removed", async ({
        page,
    }) => {
        await page.goto("/");

        const result = await page.evaluate(async commandUrl => {
            const { CommandRegistry, success } = await import(commandUrl);
            CommandRegistry.clear();
            const changes: string[] = [];
            CommandRegistry.onChange((added: string[], removed: string[]) =>
                changes.push(`+${added.join(",")}|-${removed.join(",")}`),
            );

            const entry = (name: string) => {
                const source = document.createElement("div");
                source.id = name;
                return {
                    id: "multi.run",
                    label: name,
                    execute: () => success({ name }),
                    canExecute: true,
                    when: true,
                    source: new WeakRef(source),
                };
            };
            const activeLabel = () => CommandRegistry.get("multi.run")?.label ?? null;

            const a = entry("a");
            const b = entry("b");
            const c = entry("c");
            CommandRegistry.register("multi.run", a);
            CommandRegistry.register("multi.run", b);
            CommandRegistry.register("multi.run", c);
            const winner = activeLabel();

            // Remove the active source: fall back to the previous one.
            CommandRegistry.unregister("multi.run", c);
            const afterRemovingActive = activeLabel();
            // Remove a shadowed source: the active one is unaffected.
            CommandRegistry.unregister("multi.run", a);
            const afterRemovingShadowed = activeLabel();
            const executed = await CommandRegistry.execute("multi.run");
            CommandRegistry.unregister("multi.run", b);
            const afterLast = activeLabel();

            // Removal in registration order.
            CommandRegistry.register("multi.run", a);
            CommandRegistry.register("multi.run", b);
            CommandRegistry.unregister("multi.run", a);
            const stillB = activeLabel();
            CommandRegistry.unregister("multi.run", b);
            const goneAgain = activeLabel();

            // Unconditional removal drops every source.
            CommandRegistry.register("multi.run", a);
            CommandRegistry.register("multi.run", b);
            CommandRegistry.unregister("multi.run");
            const clearedAll = activeLabel();

            CommandRegistry.clear();

            return {
                winner,
                afterRemovingActive,
                afterRemovingShadowed,
                executed,
                afterLast,
                stillB,
                goneAgain,
                clearedAll,
                changes,
            };
        }, commandModuleUrl);

        expect(result.winner).toBe("c");
        expect(result.afterRemovingActive).toBe("b");
        expect(result.afterRemovingShadowed).toBe("b");
        expect(result.executed).toMatchObject({ success: true, data: { name: "b" } });
        expect(result.afterLast).toBeNull();
        expect(result.stillB).toBe("b");
        expect(result.goneAgain).toBeNull();
        expect(result.clearedAll).toBeNull();
        expect(result.changes).toEqual([
            "+multi.run|-",
            "+multi.run|-",
            "+multi.run|-",
            "+multi.run|-", // fall back to b
            "+|-multi.run", // last source removed
            "+multi.run|-",
            "+multi.run|-",
            "+|-multi.run",
            "+multi.run|-",
            "+multi.run|-",
            "+|-multi.run",
        ]);
    });

    test("falls back across elements with the real CommandBehavior lifecycle", async ({
        page,
    }) => {
        await page.goto("/");

        const result = await page.evaluate(async commandUrl => {
            // @ts-expect-error: Client module.
            const { FASTElement, uniqueElementName } = await import("/main.js");
            const { CommandRegistry, command, success } = await import(commandUrl);
            CommandRegistry.clear();

            class PanelElement extends FASTElement {
                ping() {
                    return success({ source: this.id });
                }
            }
            command("panel.ping")(
                PanelElement.prototype,
                "ping",
                Object.getOwnPropertyDescriptor(PanelElement.prototype, "ping")!,
            );
            const name = uniqueElementName();
            await FASTElement.define(PanelElement, { name });

            const make = (id: string) => {
                const el = document.createElement(name);
                el.id = id;
                return el;
            };
            const first = make("first");
            const second = make("second");
            document.body.append(first, second);

            const sourceOf = async () => {
                const r = await CommandRegistry.execute("panel.ping");
                return r.success ? r.data.source : null;
            };
            const initial = await sourceOf();
            second.remove();
            const afterNewestRemoved = await sourceOf();
            second.id = "second";
            document.body.append(second); // reconnect: newest wins again
            const afterReconnect = await sourceOf();
            first.remove();
            const afterOldestRemoved = await sourceOf();
            second.remove();
            const afterAll = CommandRegistry.get("panel.ping") === undefined;

            CommandRegistry.clear();
            return {
                initial,
                afterNewestRemoved,
                afterReconnect,
                afterOldestRemoved,
                afterAll,
            };
        }, commandModuleUrl);

        expect(result).toEqual({
            initial: "second",
            afterNewestRemoved: "first",
            afterReconnect: "second",
            afterOldestRemoved: "second",
            afterAll: true,
        });
    });

    test("UndoBehavior leaves editable targets alone and resolves methodName", async ({
        page,
    }) => {
        await page.goto("/");

        const result = await page.evaluate(async commandUrl => {
            const { CommandRegistry, UndoBehavior, success } = await import(commandUrl);
            CommandRegistry.clear();

            const source = document.createElement("div") as HTMLElement & {
                value: number;
                removeItemUndo(): () => void;
            };
            source.value = 0;
            source.removeItemUndo = () => () => {
                source.value--;
            };
            const controller = { source } as any;

            // The command ID's last segment ("remove-item") differs from the method
            // name, which is what the Undo convention is keyed on.
            CommandRegistry.register("editor.remove-item", {
                id: "editor.remove-item",
                methodName: "removeItem",
                label: "Remove item",
                execute() {
                    source.value++;
                    return success({});
                },
                canExecute: true,
                when: true,
                source: new WeakRef(source),
            });

            const older = new UndoBehavior();
            const undo = new UndoBehavior();
            older.connectedCallback(controller);
            undo.connectedCallback(controller);

            await CommandRegistry.execute("editor.remove-item");
            await CommandRegistry.execute("editor.remove-item");
            // Only the active (most recently connected) instance records entries.
            const sizes = { active: undo.stackSize, older: older.stackSize };

            const press = (target: EventTarget) => {
                const event = new KeyboardEvent("keydown", {
                    key: "z",
                    ctrlKey: true,
                    bubbles: true,
                    cancelable: true,
                    composed: true,
                });
                target.dispatchEvent(event);
                return event.defaultPrevented;
            };
            const settle = () => new Promise(resolve => setTimeout(resolve, 0));

            const input = document.createElement("input");
            const textarea = document.createElement("textarea");
            const editable = document.createElement("div");
            editable.setAttribute("contenteditable", "true");
            const host = document.createElement("div");
            const shadowInput = document.createElement("input");
            host.attachShadow({ mode: "open" }).append(shadowInput);
            const plain = document.createElement("button");
            document.body.append(input, textarea, editable, host, plain);

            const editableResults = [input, textarea, editable, shadowInput].map(el => {
                const prevented = press(el);
                return { prevented, size: undo.stackSize };
            });
            await settle();
            const afterEditable = { value: source.value, size: undo.stackSize };

            const plainPrevented = press(plain);
            await settle();
            const afterPlain = { value: source.value, size: undo.stackSize };

            // Disconnecting the older instance keeps the shared hook and handler.
            older.disconnectedCallback(controller);
            await CommandRegistry.execute("editor.remove-item");
            const afterOlderLeft = undo.stackSize;
            undo.disconnectedCallback(controller);
            // The shared hook is gone once the last instance leaves, so its name is
            // free for a new hook.
            let replacementCalls = 0;
            CommandRegistry.addPostHook({
                name: "undo",
                afterExecute() {
                    replacementCalls++;
                },
            });
            await CommandRegistry.execute("editor.remove-item");
            CommandRegistry.removePostHook("undo");
            const hookRemoved = replacementCalls === 1;

            for (const el of [input, textarea, editable, host, plain]) el.remove();
            CommandRegistry.clear();

            return {
                sizes,
                editableResults,
                afterEditable,
                plainPrevented,
                afterPlain,
                afterOlderLeft,
                hookRemoved,
            };
        }, commandModuleUrl);

        expect(result.sizes).toEqual({ active: 2, older: 0 });
        expect(result.editableResults).toEqual([
            { prevented: false, size: 2 },
            { prevented: false, size: 2 },
            { prevented: false, size: 2 },
            { prevented: false, size: 2 },
        ]);
        expect(result.afterEditable).toEqual({ value: 2, size: 2 });
        expect(result.plainPrevented).toBe(true);
        expect(result.afterPlain).toEqual({ value: 1, size: 1 });
        expect(result.afterOlderLeft).toBe(2);
        expect(result.hookRemoved).toBe(true);
    });

    test("emits development warnings when the debug build is enabled", async ({
        page,
    }) => {
        await page.goto("/");

        const warnings = await page.evaluate(async commandUrl => {
            // The test entry point calls enableDebug(), like the debug bundle.
            const { CommandRegistry, success } = await import(commandUrl);
            CommandRegistry.clear();
            const source = document.createElement("div");
            const messages: string[] = [];
            const original = console.warn;
            console.warn = (...args: unknown[]) => {
                messages.push(String(args[0]));
            };

            const entry = () => ({
                id: "dev.twice",
                label: "Twice",
                execute: () => success(null),
                canExecute: true,
                when: true,
                source: new WeakRef(source),
            });
            CommandRegistry.register("dev.twice", entry());
            CommandRegistry.register("dev.twice", entry());

            console.warn = original;
            CommandRegistry.clear();
            return messages;
        }, commandModuleUrl);

        expect(warnings).toEqual([
            '[fast-af] Command "dev.twice" already registered. Overwriting.',
        ]);
    });

    test("registers validation and component-introspection commands", async ({
        page,
    }) => {
        await page.goto("/");

        const result = await page.evaluate(
            async ({ commandUrl, schemaUrl }) => {
                // @ts-expect-error: Client module.
                const { FASTElement, uniqueElementName } = await import("/main.js");
                const {
                    CommandRegistry,
                    registerComponentCommands,
                    registerValidationCommands,
                } = await import(commandUrl);
                const { enableDefinitionSchema } = await import(schemaUrl);
                CommandRegistry.clear();

                const disableSchema = enableDefinitionSchema();
                class IntrospectionElement extends FASTElement {}
                const name = uniqueElementName();
                await FASTElement.define(IntrospectionElement, { name });

                registerValidationCommands();
                registerComponentCommands();
                const lint = await CommandRegistry.execute("fast.lint.check", {
                    code: '<div style="color: #ff0000">Example</div>',
                });
                const auditTarget = document.createElement("div");
                auditTarget.id = uniqueElementName();
                auditTarget.innerHTML = "<button></button>";
                document.body.append(auditTarget);
                const audit = await CommandRegistry.execute("fast.a11y.audit", {
                    element: `#${auditTarget.id}`,
                    level: "AA",
                });
                const list = await CommandRegistry.execute("fast.component.list");
                const api = await CommandRegistry.execute("fast.component.getAPI", {
                    name,
                });
                const missingAPI = await CommandRegistry.execute(
                    "fast.component.getAPI",
                    { name: "missing-element" },
                );

                disableSchema();
                CommandRegistry.clear();
                auditTarget.remove();
                return { name, lint, audit, list, api, missingAPI };
            },
            {
                commandUrl: commandModuleUrl,
                schemaUrl: definitionSchemaModuleUrl,
            },
        );

        expect(result.lint).toMatchObject({
            success: true,
            data: {
                counts: { error: 0, warning: 1, info: 1 },
            },
        });
        expect(result.audit).toMatchObject({
            success: false,
            error: {
                code: "A11Y_VIOLATIONS",
                details: {
                    violations: [
                        expect.objectContaining({
                            rule: "button-name",
                            impact: "critical",
                        }),
                    ],
                },
            },
        });
        expect(result.list.success).toBe(true);
        expect(result.list.data).toContainEqual(
            expect.objectContaining({ name: result.name, isDefined: true }),
        );
        expect(result.api).toMatchObject({
            success: true,
            data: { name: result.name, properties: [], events: [] },
        });
        expect(result.missingAPI).toMatchObject({
            success: false,
            error: { code: "NOT_FOUND" },
        });
    });

    test("validates arguments against JSON schema keywords", async ({ page }) => {
        await page.goto("/");

        const result = await page.evaluate(async schemaUrl => {
            const { validateSchema, validateCommandArguments } = await import(schemaUrl);
            const messages = (value: unknown, schema: Record<string, unknown>) =>
                validateSchema(value, schema).map(
                    (issue: { path: string; message: string }) =>
                        `${issue.path} ${issue.message}`,
                );

            const many = validateSchema(
                Array.from({ length: 60 }, () => 1),
                { type: "array", items: { type: "string" } },
            );

            return {
                typeMismatch: messages("x", { type: "number" }),
                integerVsNumber: [
                    messages(1.5, { type: "integer" }),
                    messages(1.5, { type: "number" }),
                    messages(Number.NaN, { type: "number" }),
                ],
                union: [
                    messages(null, { type: ["string", "null"] }),
                    messages(true, { type: ["string", "null"] }),
                    messages([], { type: "object" }),
                    messages({}, { type: "array" }),
                    messages(undefined, { type: "undefined" }),
                    messages(1, { type: "mystery" }),
                ],
                enumConst: [
                    messages({ a: [1] }, { enum: [{ a: [1] }] }),
                    messages({ a: [2] }, { enum: [{ a: [1] }] }),
                    messages([1], { enum: [{ 0: 1 }] }),
                    messages({ a: 1 }, { enum: [{ a: 1, b: 2 }] }),
                    messages(2, { const: 3 }),
                    messages(3, { const: 3 }),
                ],
                numeric: messages(5, {
                    minimum: 6,
                    maximum: 4,
                    exclusiveMinimum: 5,
                    exclusiveMaximum: 5,
                }),
                strings: [
                    messages("ab", { minLength: 3 }),
                    messages("abcd", { maxLength: 3 }),
                ],
                arrays: [
                    messages([1], { minItems: 2 }),
                    messages([1, 2, 3], { maxItems: 2 }),
                    messages(["a", 2, "c", 4], { items: { type: "string" } }),
                    messages([1], { items: [{ type: "string" }] }),
                ],
                objects: [
                    messages({}, { type: "object", required: ["id"] }),
                    messages({ id: undefined }, { required: ["id"] }),
                    messages(
                        { user: { age: "x" } },
                        {
                            properties: {
                                user: { properties: { age: { type: "number" } } },
                                skipped: { type: "string" },
                                bogus: null,
                            },
                        },
                    ),
                    messages(
                        { a: 1, b: 2 },
                        { properties: { a: {} }, additionalProperties: false },
                    ),
                    messages(
                        { a: 1, b: "x" },
                        {
                            properties: { a: {} },
                            additionalProperties: { type: "number" },
                        },
                    ),
                    messages({ a: 1 }, { required: ["a"], properties: null }),
                ],
                issueCap: many.length,
                commandArgs: [
                    validateCommandArguments([], { type: "object", required: ["id"] }),
                    validateCommandArguments([], { required: ["id"] }),
                    validateCommandArguments([], { properties: {} }),
                    validateCommandArguments([], { type: "string" }),
                    validateCommandArguments([{ id: 1 }], {
                        type: "object",
                        required: ["id"],
                    }),
                ],
            };
        }, schemaValidationModuleUrl);

        expect(result.typeMismatch).toEqual(["$ expected number but received string"]);
        expect(result.integerVsNumber).toEqual([
            ["$ expected integer but received number"],
            [],
            ["$ expected number but received number"],
        ]);
        expect(result.union).toEqual([
            [],
            ["$ expected string or null but received boolean"],
            ["$ expected object but received array"],
            ["$ expected array but received object"],
            [],
            [],
        ]);
        expect(result.enumConst).toEqual([
            [],
            ['$ must be one of [{"a":[1]}]'],
            ['$ must be one of [{"0":1}]'],
            ['$ must be one of [{"a":1,"b":2}]'],
            ["$ must equal 3"],
            [],
        ]);
        expect(result.numeric).toEqual([
            "$ must be >= 6",
            "$ must be <= 4",
            "$ must be > 5",
            "$ must be < 5",
        ]);
        expect(result.strings).toEqual([
            ["$ must be at least 3 character(s)"],
            ["$ must be at most 3 character(s)"],
        ]);
        expect(result.arrays).toEqual([
            ["$ must contain at least 2 item(s)"],
            ["$ must contain at most 2 item(s)"],
            [
                "$[1] expected string but received integer",
                "$[3] expected string but received integer",
            ],
            [],
        ]);
        expect(result.objects).toEqual([
            ["$.id is required"],
            ["$.id is required"],
            ["$.user.age expected number but received string"],
            ["$.b is not an allowed property"],
            ["$.b expected number but received string"],
            [],
        ]);
        expect(result.issueCap).toBe(20);
        expect(result.commandArgs).toEqual([
            [{ path: "$.id", message: "is required" }],
            [{ path: "$.id", message: "is required" }],
            [],
            [{ path: "$", message: "a value is required" }],
            [],
        ]);
    });

    test("fast.lint.check applies each rule and reports bad input", async ({ page }) => {
        await page.goto("/");

        const result = await page.evaluate(async commandUrl => {
            const { CommandRegistry, registerValidationCommands } = await import(
                commandUrl
            );
            CommandRegistry.clear();
            registerValidationCommands();

            const lint = (args?: unknown) =>
                CommandRegistry.execute("fast.lint.check", args);
            const code = [
                "customElements.define('thing-one', X);",
                "customElements.define('fast-ok', X);",
                "<section>native</section>",
                "<div>native div</div>",
                "<slot></slot>",
                "@attr count = 0;",
                "@attr() other = 1;",
                "@attr({ mode: 'reflect' }) fine = 2;",
                "color: #abc;",
            ].join("\n");

            const output = {
                missingCode: await lint({}),
                noArgs: await lint(),
                allRules: await lint({ code }),
                onlyTokens: await lint({
                    code,
                    rules: ["fast/prefer-design-tokens"],
                }),
                noRules: await lint({ code, rules: [] }),
                brokenRules: await lint({ code, rules: 42 }),
            };
            CommandRegistry.clear();
            return output;
        }, commandModuleUrl);

        expect(result.missingCode).toMatchObject({
            success: false,
            error: { code: "VALIDATION_ERROR", retryable: false },
        });
        expect(result.noArgs).toMatchObject({
            success: false,
            error: { code: "VALIDATION_ERROR" },
        });

        expect(result.allRules.success).toBe(true);
        const issues = result.allRules.data.issues as Array<{
            rule: string;
            line: number;
            severity: string;
        }>;
        const byRule = (rule: string) => issues.filter(i => i.rule === rule);
        expect(byRule("fast/proper-element-naming").map(i => i.line)).toEqual([1]);
        expect(byRule("fast/require-slot-names").map(i => i.line)).toEqual([5]);
        expect(byRule("fast/attribute-reflection").map(i => i.line)).toEqual([6, 7]);
        expect(byRule("fast/prefer-design-tokens").map(i => i.line)).toEqual([9]);
        expect(result.allRules.data.counts).toEqual({
            error: 0,
            warning: 1,
            info: issues.length - 1,
        });
        expect(result.allRules.plan).toHaveLength(issues.length);
        expect(result.allRules.confidence).toBe(0.95);

        expect(
            result.onlyTokens.data.issues.map((i: { rule: string }) => i.rule),
        ).toEqual(["fast/prefer-design-tokens"]);
        expect(result.noRules.data.issues).toEqual([]);
        expect(result.brokenRules).toMatchObject({
            success: false,
            error: { code: "VALIDATION_ERROR", retryable: true },
        });
    });

    test("fast.a11y.audit checks WCAG rules by conformance level", async ({ page }) => {
        await page.goto("/");

        const result = await page.evaluate(async commandUrl => {
            const { CommandRegistry, registerValidationCommands } = await import(
                commandUrl
            );
            CommandRegistry.clear();
            registerValidationCommands();

            const root = document.createElement("div");
            root.id = "a11y-fixture";
            root.innerHTML = `
                <img src="x.png">
                <button></button>
                <button aria-label="ok">ok</button>
                <a href="/x"></a>
                <a href="/y">named</a>
                <input id="unlabelled">
                <input id="labelled"><label for="labelled">Label</label>
                <input type="hidden">
                <select aria-label="named"></select>
                <div tabindex="3">positive</div>
                <div tabindex="0">fine</div>
                <div aria-hidden="true" tabindex="0">hidden but focusable</div>
                <div role="checkbox"></div>
                <h1>One</h1><h3>Skipped</h3><h2>Back</h2>
            `;
            document.body.append(root);

            const audit = (args?: unknown) =>
                CommandRegistry.execute("fast.a11y.audit", args);
            const rulesOf = (r: any) =>
                r.success ? [] : r.error.details.violations.map((v: any) => v.rule);

            const output = {
                levelA: rulesOf(await audit({ element: "#a11y-fixture", level: "A" })),
                levelAA: rulesOf(await audit({ element: "#a11y-fixture" })),
                levelAAA: rulesOf(
                    await audit({ element: "#a11y-fixture", level: "AAA" }),
                ),
                invalidLevel: await audit({ element: "#a11y-fixture", level: "Z" }),
                missingElement: await audit({ element: "#does-not-exist" }),
                defaultBody: await audit(),
                badSelector: await audit({ element: "[[" }),
            };
            root.remove();
            CommandRegistry.clear();
            return output;
        }, commandModuleUrl);

        const levelA = [
            "image-alt",
            "button-name",
            "link-name",
            "input-label",
            "tabindex",
            "aria-valid-attr",
            "aria-required-attr",
        ];
        expect(result.levelA).toEqual(levelA);
        expect(result.levelAA).toEqual([...levelA, "heading-order"]);
        expect(result.levelAAA).toEqual([...levelA, "heading-order"]);
        expect(result.invalidLevel).toMatchObject({
            success: false,
            error: { code: "INVALID_LEVEL" },
        });
        expect(result.missingElement).toMatchObject({
            success: true,
            data: { violations: [], target: "#does-not-exist" },
        });
        // With no arguments the audit targets <body> at level AA (and sees the fixture).
        expect(result.defaultBody).toMatchObject({
            success: false,
            error: { details: { target: "body", level: "AA" } },
        });
        expect(result.badSelector).toMatchObject({
            success: false,
            error: { code: "AUDIT_ERROR", retryable: true },
        });
    });

    test("component introspection validates names and handles undefined elements", async ({
        page,
    }) => {
        await page.goto("/");

        const result = await page.evaluate(
            async ({ commandUrl, schemaUrl }) => {
                const { CommandRegistry, registerComponentCommands } = await import(
                    commandUrl
                );
                const { enableDefinitionSchema } = await import(schemaUrl);
                CommandRegistry.clear();
                const disableSchema = enableDefinitionSchema();
                registerComponentCommands();

                const noArgs = await CommandRegistry.execute("fast.component.getAPI");
                const blank = await CommandRegistry.execute("fast.component.getAPI", {
                    name: "",
                });
                disableSchema();
                CommandRegistry.clear();
                return { noArgs, blank };
            },
            { commandUrl: commandModuleUrl, schemaUrl: definitionSchemaModuleUrl },
        );

        for (const failed of [result.noArgs, result.blank]) {
            expect(failed).toMatchObject({
                success: false,
                error: { code: "INVALID_PARAMETERS", retryable: false },
            });
        }
    });

    test("registry guards duplicates, scoped lookups, palette handlers and non-Error throws", async ({
        page,
    }) => {
        await page.goto("/");

        const result = await page.evaluate(async commandUrl => {
            const { CommandRegistry, success, isSuccess, isFailure, createError } =
                await import(commandUrl);
            CommandRegistry.clear();
            const warnings: string[] = [];
            const original = console.warn;
            console.warn = (...args: unknown[]) => {
                warnings.push(String(args[0]));
            };

            const source = document.createElement("div");
            const events: string[] = [];
            CommandRegistry.setTelemetryHandler((event: string) => events.push(event));

            const interceptor = {
                name: "dup-interceptor",
                async intercept(_c: unknown, _a: unknown, next: () => Promise<unknown>) {
                    return next();
                },
            };
            CommandRegistry.addInterceptor(interceptor);
            CommandRegistry.addInterceptor(interceptor);

            let hookCalls = 0;
            const hook = {
                name: "dup-hook",
                afterExecute() {
                    hookCalls++;
                },
            };
            CommandRegistry.addPostHook(hook);
            CommandRegistry.addPostHook(hook);

            const scoped = CommandRegistry.forScope(
                document.createElement("div").attachShadow({ mode: "open" }),
            );

            let paletteRuns = 0;
            CommandRegistry.register("palette.run", {
                id: "palette.run",
                label: "Run",
                category: "Palette",
                icon: "play",
                keybinding: "Mod+R",
                execute: () => {
                    paletteRuns++;
                    return success(paletteRuns);
                },
                canExecute: true,
                when: true,
                source: new WeakRef(source),
            });
            CommandRegistry.register("palette.string-throw", {
                id: "palette.string-throw",
                label: "String throw",
                execute: () => {
                    throw "plain string";
                },
                canExecute: true,
                when: true,
                source: new WeakRef(source),
            });
            CommandRegistry.register("palette.flag-throw", {
                id: "palette.flag-throw",
                label: "Flag throw",
                execute: () => success(null),
                get canExecute(): boolean {
                    throw "flag string";
                },
                when: true,
                source: new WeakRef(source),
            });

            const action = CommandRegistry.getActions().find(
                (a: { id: string }) => a.id === "palette.run",
            );
            action.handler();
            await new Promise(resolve => setTimeout(resolve, 0));

            const stringThrow = await CommandRegistry.execute("palette.string-throw");
            const flagThrow = await CommandRegistry.execute("palette.flag-throw");
            const ok = success(1);
            const bad = {
                success: false,
                error: createError("X", "nope", { retryable: true }),
            };

            console.warn = original;
            CommandRegistry.setTelemetryHandler(() => {});
            CommandRegistry.removeInterceptor("dup-interceptor");
            CommandRegistry.removePostHook("dup-hook");
            CommandRegistry.clear();

            return {
                warnings,
                events: events.filter(e => e.endsWith(".added")),
                scopedIsGlobal: scoped === CommandRegistry,
                action: {
                    section: action.section,
                    icon: action.icon,
                    hotkey: action.hotkey,
                    disabled: action.disabled,
                },
                paletteRuns,
                hookCalls,
                stringThrow,
                flagThrow,
                guards: [isSuccess(ok), isFailure(ok), isSuccess(bad), isFailure(bad)],
                error: bad.error,
            };
        }, commandModuleUrl);

        expect(result.warnings).toEqual([
            '[fast-af] Interceptor "dup-interceptor" already registered. Skipping.',
            '[fast-af] PostHook "dup-hook" already registered. Skipping.',
            "[fast-af] Scoped registries are Phase 2. Returning global registry.",
        ]);
        expect(result.events).toEqual(
            expect.arrayContaining(["interceptor.added", "posthook.added"]),
        );
        expect(
            result.events.filter((e: string) => e === "interceptor.added"),
        ).toHaveLength(1);
        expect(result.events.filter((e: string) => e === "posthook.added")).toHaveLength(
            1,
        );
        expect(result.scopedIsGlobal).toBe(true);
        expect(result.action).toEqual({
            section: "Palette",
            icon: "play",
            hotkey: "Mod+R",
            disabled: false,
        });
        expect(result.paletteRuns).toBe(1);
        expect(result.hookCalls).toBeGreaterThan(0);
        expect(result.stringThrow).toMatchObject({
            success: false,
            error: {
                code: "EXECUTION_FAILED",
                details: { cause: { value: "plain string" } },
            },
        });
        expect(result.flagThrow).toMatchObject({
            success: false,
            error: {
                code: "EXECUTION_FAILED",
                details: { cause: { value: "flag string" } },
            },
        });
        expect(result.guards).toEqual([true, false, false, true]);
        expect(result.error).toEqual({ code: "X", message: "nope", retryable: true });
    });

    test("command decorator warns when the ID has no namespace", async ({ page }) => {
        await page.goto("/");

        const result = await page.evaluate(async commandUrl => {
            const { command, getCommandMetadata } = await import(commandUrl);
            const warnings: string[] = [];
            const original = console.warn;
            console.warn = (...args: unknown[]) => {
                warnings.push(String(args[0]));
            };

            class Host {
                run() {}
            }
            const descriptor = Object.getOwnPropertyDescriptor(Host.prototype, "run")!;
            command("plain")(Host.prototype, "run", descriptor);
            command("ns.ok", { label: "Fine" })(Host.prototype, "run", descriptor);
            console.warn = original;

            return {
                warnings,
                ids: getCommandMetadata(Host).map((m: { id: string }) => m.id),
            };
        }, commandModuleUrl);

        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0]).toContain('Command "plain" missing namespace prefix');
        expect(result.ids).toEqual(["plain", "ns.ok"]);
    });

    test("UndoBehavior stacks, trims, retries failed undos and handles Ctrl+Z", async ({
        page,
    }) => {
        await page.goto("/");

        const result = await page.evaluate(async commandUrl => {
            const { CommandRegistry, UndoBehavior, success, failure } = await import(
                commandUrl
            );
            CommandRegistry.clear();

            const log: string[] = [];
            let failUndo = true;
            const source = document.createElement("div") as any;
            const controller = { source } as any;
            source.addUndo = () => () => log.push("undo:add");
            source.flakyUndo = () => () => {
                if (failUndo) throw new Error("undo exploded");
                log.push("undo:flaky");
            };
            source.notFnUndo = () => "not a function";

            const register = (id: string, execute: () => unknown, extra: object = {}) =>
                CommandRegistry.register(id, {
                    id,
                    label: id,
                    execute,
                    canExecute: true,
                    when: true,
                    source: new WeakRef(source),
                    ...extra,
                });
            register("stack.add", () => success(null));
            register("stack.flaky", () => success(null));
            register("stack.notFn", () => success(null));
            register("stack.noUndo", () => success(null));
            register("stack.failing", () => failure({ code: "X", message: "fail" }));
            register("nodot", () => success(null));
            register("stack.gone", () => success(null), {
                // A source that has already been garbage collected.
                source: { deref: () => undefined },
            });

            const undo = new UndoBehavior({ limit: 2 });
            const output: Record<string, unknown> = {};
            output.undoWhenEmpty = await undo.undo();
            output.emptyPeek = undo.peek();

            undo.connectedCallback(controller);
            undo.connectedCallback(controller);

            await CommandRegistry.execute("stack.failing");
            await CommandRegistry.execute("stack.noUndo");
            await CommandRegistry.execute("stack.notFn");
            await CommandRegistry.execute("nodot");
            await CommandRegistry.execute("stack.gone");
            output.ignored = undo.stackSize;

            await CommandRegistry.execute("stack.add", "a");
            await CommandRegistry.execute("stack.add", "b");
            await CommandRegistry.execute("stack.flaky");
            output.afterTrim = undo.getStack().map(e => e.commandId);
            output.canUndo = undo.canUndo;
            output.peek = undo.peek()?.commandId;
            output.timestamped = typeof undo.peek()?.timestamp === "number";

            // Failed undo is re-pushed so the user can retry.
            try {
                await undo.undo();
                output.threw = false;
            } catch (error) {
                output.threw = (error as Error).message;
            }
            output.sizeAfterFailure = undo.stackSize;
            failUndo = false;
            output.retry = await undo.undo();

            // Keyboard handling.
            const press = (
                init: KeyboardEventInit,
                target: EventTarget = document.body,
            ) => {
                const event = new KeyboardEvent("keydown", {
                    bubbles: true,
                    cancelable: true,
                    composed: true,
                    ...init,
                });
                target.dispatchEvent(event);
                return event.defaultPrevented;
            };
            await CommandRegistry.execute("stack.add", "c");
            const sizeBeforeKeys = undo.stackSize;
            output.shiftZ = press({ key: "z", ctrlKey: true, shiftKey: true });
            output.plainZ = press({ key: "z" });
            output.otherKey = press({ key: "y", ctrlKey: true });
            output.sizeAfterIgnoredKeys = undo.stackSize;

            const input = document.createElement("input");
            document.body.append(input);
            output.inInput = press({ key: "z", ctrlKey: true }, input);
            input.remove();
            output.sizeAfterInput = undo.stackSize;

            output.ctrlZ = press({ key: "z", ctrlKey: true });
            await new Promise(resolve => setTimeout(resolve, 0));
            output.sizeAfterCtrlZ = undo.stackSize;
            output.sizeBeforeKeys = sizeBeforeKeys;
            output.metaZ = press({ key: "z", metaKey: true });
            await new Promise(resolve => setTimeout(resolve, 0));
            output.emptyCtrlZ = press({ key: "z", ctrlKey: true });

            // A throwing undo triggered by the shortcut is logged, not thrown.
            const errors: string[] = [];
            const originalError = console.error;
            console.error = (...args: unknown[]) => {
                errors.push(String(args[0]));
            };
            failUndo = true;
            await CommandRegistry.execute("stack.flaky");
            press({ key: "z", ctrlKey: true });
            await new Promise(resolve => setTimeout(resolve, 0));
            console.error = originalError;
            output.loggedErrors = errors;

            undo.clear();
            output.afterClear = undo.stackSize;
            await CommandRegistry.execute("stack.add", "d");
            undo.disconnectedCallback(controller);
            undo.disconnectedCallback(controller);
            output.afterDisconnect = undo.stackSize;
            await CommandRegistry.execute("stack.add", "e");
            output.recordedAfterDisconnect = undo.stackSize;

            const noShortcut = new UndoBehavior({ enableKeyboardShortcut: false });
            noShortcut.connectedCallback(controller);
            await CommandRegistry.execute("stack.add", "f");
            output.noShortcutSize = noShortcut.stackSize;
            output.noShortcutPrevented = press({ key: "z", ctrlKey: true });
            noShortcut.disconnectedCallback(controller);

            CommandRegistry.clear();
            return output;
        }, commandModuleUrl);

        expect(result.undoWhenEmpty).toBe(false);
        expect(result.emptyPeek).toBeUndefined();
        expect(result.ignored).toBe(0);
        expect(result.afterTrim).toEqual(["stack.add", "stack.flaky"]);
        expect(result.canUndo).toBe(true);
        expect(result.peek).toBe("stack.flaky");
        expect(result.timestamped).toBe(true);
        expect(result.threw).toBe("undo exploded");
        expect(result.sizeAfterFailure).toBe(2);
        expect(result.retry).toBe(true);
        expect(result.shiftZ).toBe(false);
        expect(result.plainZ).toBe(false);
        expect(result.otherKey).toBe(false);
        expect(result.sizeAfterIgnoredKeys).toBe(result.sizeBeforeKeys);
        expect(result.inInput).toBe(false);
        expect(result.sizeAfterInput).toBe(result.sizeBeforeKeys);
        expect(result.ctrlZ).toBe(true);
        expect(result.sizeAfterCtrlZ).toBe(1);
        expect(result.metaZ).toBe(true);
        expect(result.emptyCtrlZ).toBe(false);
        expect(result.loggedErrors).toEqual(["[fast-af] Undo failed:"]);
        expect(result.afterClear).toBe(0);
        expect(result.afterDisconnect).toBe(0);
        expect(result.recordedAfterDisconnect).toBe(0);
        expect(result.noShortcutSize).toBe(1);
        expect(result.noShortcutPrevented).toBe(false);
    });

    test("ConfirmBehavior passes non-destructive commands through and cleans up", async ({
        page,
    }) => {
        await page.goto("/");

        const result = await page.evaluate(async commandUrl => {
            const { CommandRegistry, ConfirmBehavior, success } = await import(
                commandUrl
            );
            CommandRegistry.clear();
            const source = document.createElement("div");
            const controller = { source } as any;
            const entry = (id: string, extra: object = {}) =>
                CommandRegistry.register(id, {
                    id,
                    label: id,
                    execute: () => success(id),
                    canExecute: true,
                    when: true,
                    source: new WeakRef(source),
                    ...extra,
                });
            entry("safe.read");
            entry("safe.wipe", { destructive: true });

            const confirm = new ConfirmBehavior();
            confirm.connectedCallback(controller);

            const safe = await CommandRegistry.execute("safe.read");
            const pending = CommandRegistry.execute("safe.wipe");
            await Promise.resolve();
            const prompt = confirm.pendingConfirmation?.prompt;
            // Disconnecting settles the pending confirmation as cancelled.
            confirm.disconnectedCallback(controller);
            confirm.disconnectedCallback(controller);
            const cancelled = await pending;
            const idle = confirm.pendingConfirmation;
            // cancelPending/executeConfirmed with nothing queued are no-ops.
            confirm.cancelPending();
            confirm.executeConfirmed();

            CommandRegistry.clear();
            return { safe, prompt, cancelled, idle };
        }, commandModuleUrl);

        expect(result.safe).toMatchObject({ success: true, data: "safe.read" });
        expect(result.prompt).toBe("Are you sure you want to proceed?");
        expect(result.cancelled).toMatchObject({
            success: false,
            error: { code: "USER_CANCELLED" },
        });
        expect(result.idle).toBeNull();
    });

    test("confirm dialog handles Escape, overlay clicks and focus wrapping", async ({
        page,
    }) => {
        await page.goto("/");

        const result = await page.evaluate(async commandUrl => {
            const { confirmDialogTagName, defineConfirmDialog } = await import(
                commandUrl
            );
            await defineConfirmDialog();
            await defineConfirmDialog();

            const opener = document.createElement("button");
            document.body.append(opener);
            opener.focus();

            const dialog = document.createElement(confirmDialogTagName) as any;
            dialog.prompt = "Proceed?";
            document.body.append(dialog);
            const events: string[] = [];
            dialog.addEventListener("cancel", () => events.push("cancel"));
            dialog.addEventListener("confirm", () => events.push("confirm"));
            const frame = () => new Promise(resolve => requestAnimationFrame(resolve));

            dialog.open = true;
            await frame();
            await frame();
            const root = dialog.shadowRoot as ShadowRoot;
            const buttons = Array.from(root.querySelectorAll("button")) as HTMLElement[];
            const first = buttons[0];
            const last = buttons[buttons.length - 1];
            const bodyOverflowOpen = document.body.style.overflow;
            const focusedOnOpen = root.activeElement?.className ?? null;

            const key = (init: KeyboardEventInit) => {
                const event = new KeyboardEvent("keydown", {
                    bubbles: true,
                    cancelable: true,
                    ...init,
                });
                dialog.handleKeydown(event);
                return event.defaultPrevented;
            };

            first.focus();
            const shiftTabOnFirst = key({ key: "Tab", shiftKey: true });
            const wrappedToLast = root.activeElement === last;
            const shiftTabMiddle = key({ key: "Tab", shiftKey: true });
            last.focus();
            const tabOnLast = key({ key: "Tab" });
            const wrappedToFirst = root.activeElement === first;
            const tabMiddle = key({ key: "Tab" });
            const otherKey = key({ key: "a" });

            // Click inside the dialog does nothing; the overlay closes it.
            const inner = root.querySelector(".dialog") as HTMLElement;
            inner.dispatchEvent(
                new MouseEvent("click", { bubbles: true, composed: true }),
            );
            const stillOpenAfterInnerClick = dialog.open;
            (root.querySelector(".overlay") as HTMLElement).dispatchEvent(
                new MouseEvent("click", { bubbles: true, composed: true }),
            );
            await frame();
            const closedByOverlay = !dialog.open;
            const bodyOverflowClosed = document.body.style.overflow;
            const refocused = document.activeElement === opener;

            dialog.open = true;
            await frame();
            key({ key: "Escape" });

            dialog.remove();
            opener.remove();
            return {
                events,
                bodyOverflowOpen,
                focusedOnOpen,
                buttonCount: buttons.length,
                shiftTabOnFirst,
                wrappedToLast,
                shiftTabMiddle,
                tabOnLast,
                wrappedToFirst,
                tabMiddle,
                otherKey,
                stillOpenAfterInnerClick,
                closedByOverlay,
                bodyOverflowClosed,
                refocused,
                closedByEscape: !dialog.open,
            };
        }, commandModuleUrl);

        expect(result.buttonCount).toBe(2);
        expect(result.bodyOverflowOpen).toBe("hidden");
        expect(result.focusedOnOpen).toContain("cancel-button");
        expect(result.shiftTabOnFirst).toBe(true);
        expect(result.wrappedToLast).toBe(true);
        expect(result.shiftTabMiddle).toBe(false);
        expect(result.tabOnLast).toBe(true);
        expect(result.wrappedToFirst).toBe(true);
        expect(result.tabMiddle).toBe(false);
        expect(result.otherKey).toBe(false);
        expect(result.stillOpenAfterInnerClick).toBe(true);
        expect(result.closedByOverlay).toBe(true);
        expect(result.bodyOverflowClosed).toBe("");
        expect(result.refocused).toBe(true);
        expect(result.closedByEscape).toBe(true);
        expect(result.events).toEqual(["cancel", "cancel"]);
    });

    test("defines an accessible confirmation dialog under async v3 registration", async ({
        page,
    }) => {
        await page.goto("/");

        const result = await page.evaluate(async commandUrl => {
            const { confirmDialogTagName, defineConfirmDialog } = await import(
                commandUrl
            );
            const definedByImport =
                customElements.get(confirmDialogTagName) !== undefined;
            await defineConfirmDialog();
            await customElements.whenDefined(confirmDialogTagName);

            const dialog = document.createElement(confirmDialogTagName) as any;
            dialog.prompt = "Delete the item?";
            document.body.append(dialog);
            dialog.open = true;
            await new Promise(resolve => requestAnimationFrame(resolve));

            const inner = dialog.shadowRoot?.querySelector(".dialog");
            let confirmCount = 0;
            dialog.addEventListener("confirm", () => confirmCount++);
            dialog.handleConfirm();

            const output = {
                definedByImport,
                role: inner?.getAttribute("role"),
                ariaModal: inner?.getAttribute("aria-modal"),
                confirmCount,
                open: dialog.open,
            };
            dialog.remove();
            return output;
        }, commandModuleUrl);

        expect(result).toEqual({
            definedByImport: false,
            role: "alertdialog",
            ariaModal: "true",
            confirmCount: 1,
            open: false,
        });
    });
});
