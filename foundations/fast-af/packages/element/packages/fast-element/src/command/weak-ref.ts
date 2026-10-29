/**
 * Minimal WeakRef surface used by command entries without requiring the
 * ES2021.WeakRef TypeScript library in FAST Element's compilation target.
 * @internal
 */
interface WeakReference<T extends object> {
    deref(): T | undefined;
}

type WeakReferenceConstructor = new <T extends object>(target: T) => WeakReference<T>;

const WeakRefConstructor = (
    globalThis as unknown as { WeakRef: WeakReferenceConstructor }
).WeakRef;

/** @internal */
export function createWeakReference<T extends object>(target: T): WeakReference<T> {
    return new WeakRefConstructor(target);
}
