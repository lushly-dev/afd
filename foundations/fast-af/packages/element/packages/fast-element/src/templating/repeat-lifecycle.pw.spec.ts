import { expect, test } from "@playwright/test";

test("repeat ignores queued notifications after unbind and observes again on rebind", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/");

    const result = await page.evaluate(async () => {
        // @ts-expect-error: Client module.
        const { html, repeat, Observable, SourceLifetime, Updates } = await import("/main.js");
        const model = { items: [] as string[] };
        Observable.defineProperty(model, "items");
        model.items = ["first"];
        const host = document.createElement("div");
        document.body.append(host);
        const template = html`${repeat((x: typeof model) => x.items, html`${(x: string) => x}`)}`;
        const view = template.create();
        view.sourceLifetime = SourceLifetime.coupled;
        view.bind(model);
        view.appendTo(host);

        model.items.push("queued");
        model.items = ["replacement"];
        view.unbind();
        await Updates.next();
        const unboundText = host.textContent;

        view.bind(model);
        await Updates.next();
        model.items.push("live");
        await Updates.next();
        const reboundText = host.textContent;
        view.dispose();
        host.remove();
        return { unboundText, reboundText };
    });

    expect(result).toEqual({ unboundText: "first", reboundText: "replacementlive" });
    expect(errors).toEqual([]);
});
