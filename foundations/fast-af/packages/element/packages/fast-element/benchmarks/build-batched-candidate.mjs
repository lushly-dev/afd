#!/usr/bin/env node
/**
 * Builds the deferred DocumentFragment repeat-batching experiment candidate (#1384)
 * into a target directory without modifying tracked source files.
 *
 * Usage:
 *   node benchmarks/build-batched-candidate.mjs <outDir>
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const pkgRoot = path.resolve(import.meta.dirname, "..");
const esmSrc = path.join(pkgRoot, "dist", "esm");
if (!fs.existsSync(esmSrc)) {
    console.error(`Missing built ESM output at ${esmSrc}. Run 'pnpm -F @lushly-dev/fast-element build:tsc' first.`);
    process.exit(1);
}

const outDir = process.argv[2];
let dest;
if (outDir) {
    dest = path.resolve(outDir);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try {
        // Claim the destination exclusively so concurrent runs cannot collide on the same directory.
        fs.mkdirSync(dest);
    } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
            console.error(`Destination already exists: ${dest}. Pass a new path or remove it first.`);
            process.exit(1);
        }
        throw error;
    }
} else {
    dest = fs.mkdtempSync(path.join(os.tmpdir(), "fast-element-batched-"));
}

fs.cpSync(esmSrc, dest, { recursive: true });

const repeatPath = path.join(dest, "templating", "repeat.js");
let repeatSrc = fs.readFileSync(repeatPath, "utf8").replace(/\r\n/g, "\n");

const createTarget = `        if (viewsLength === 0) {
            // all views need to be created
            this.views = views = new Array(itemsLength);
            for (let i = 0; i < itemsLength; ++i) {
                const view = createChildView(template, controller);
                bindView(view, items, i, controller);
                views[i] = view;
                view.insertBefore(location);
            }
        }`;

const createReplacement = `        if (viewsLength === 0) {
            // all views need to be created
            this.views = views = new Array(itemsLength);
            const parent = location.parentNode;
            if (itemsLength > 1 && parent !== null) {
                const batch = (location.ownerDocument ?? document).createDocumentFragment();
                for (let i = 0; i < itemsLength; ++i) {
                    const view = createChildView(template, controller);
                    bindView(view, items, i, controller);
                    views[i] = view;
                    if (view instanceof HTMLView) {
                        view.appendTo(batch);
                    } else {
                        if (batch.hasChildNodes()) parent.insertBefore(batch, location);
                        view.insertBefore(location);
                    }
                }
                if (batch.hasChildNodes()) parent.insertBefore(batch, location);
            } else {
                for (let i = 0; i < itemsLength; ++i) {
                    const view = createChildView(template, controller);
                    bindView(view, items, i, controller);
                    views[i] = view;
                    view.insertBefore(location);
                }
            }
        }`;

if (!repeatSrc.includes(createTarget)) {
    throw new Error("Expected refreshAllViews create loop not found in dist/esm/templating/repeat.js");
}
repeatSrc = repeatSrc.replace(createTarget, createReplacement);

const spliceTarget = `            for (; addIndex < end; ++addIndex) {
                const neighbor = views[addIndex];
                const location = neighbor ? neighbor.firstChild : this.location;
                let view;
                if (recycle && availableViews > 0) {
                    if (removeIndex <= totalAvailableViews && removedViews.length > 0) {
                        view = removedViews[removeIndex];
                        removeIndex++;
                    }
                    else {
                        view = leftoverViews[leftoverIndex];
                        leftoverIndex++;
                    }
                    availableViews--;
                }
                else {
                    view = createChildView(template, controller);
                }
                views.splice(addIndex, 0, view);
                bindView(view, items, addIndex, controller);
                view.insertBefore(location);
            }`;

const spliceReplacement = `            if ((!recycle || availableViews === 0) && end - addIndex > 1) {
                const neighbor = views[addIndex];
                const insertLoc = neighbor ? neighbor.firstChild : this.location;
                const parent = insertLoc.parentNode;
                if (parent !== null) {
                    const batch = (insertLoc.ownerDocument ?? document).createDocumentFragment();
                    const created = new Array(end - addIndex);
                    for (let idx = 0; addIndex < end; ++addIndex, ++idx) {
                        const view = createChildView(template, controller);
                        bindView(view, items, addIndex, controller);
                        created[idx] = view;
                        if (view instanceof HTMLView) {
                            view.appendTo(batch);
                        } else {
                            if (batch.hasChildNodes()) parent.insertBefore(batch, insertLoc);
                            view.insertBefore(insertLoc);
                        }
                    }
                    views.splice(splice.index, 0, ...created);
                    if (batch.hasChildNodes()) parent.insertBefore(batch, insertLoc);
                } else {
                    for (; addIndex < end; ++addIndex) {
                        const view = createChildView(template, controller);
                        views.splice(addIndex, 0, view);
                        bindView(view, items, addIndex, controller);
                        view.insertBefore(insertLoc);
                    }
                }
            } else {
                for (; addIndex < end; ++addIndex) {
                    const neighbor = views[addIndex];
                    const location = neighbor ? neighbor.firstChild : this.location;
                    let view;
                    if (recycle && availableViews > 0) {
                        if (removeIndex <= totalAvailableViews && removedViews.length > 0) {
                            view = removedViews[removeIndex];
                            removeIndex++;
                        }
                        else {
                            view = leftoverViews[leftoverIndex];
                            leftoverIndex++;
                        }
                        availableViews--;
                    }
                    else {
                        view = createChildView(template, controller);
                    }
                    views.splice(addIndex, 0, view);
                    bindView(view, items, addIndex, controller);
                    view.insertBefore(location);
                }
            }`;

if (!repeatSrc.includes(spliceTarget)) {
    throw new Error("Expected updateSplicedViews add loop not found in dist/esm/templating/repeat.js");
}
repeatSrc = repeatSrc.replace(spliceTarget, spliceReplacement);
fs.writeFileSync(repeatPath, repeatSrc);
console.log(`Built batched-repeat candidate in ${dest}`);
