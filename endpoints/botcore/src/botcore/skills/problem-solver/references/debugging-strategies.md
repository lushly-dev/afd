# Debugging Strategies

Systematic approaches to investigating and isolating issues.

## Strategy Selection

| Situation | Recommended Strategy |
|---|---|
| Know roughly where the bug is | Console logging, breakpoints |
| No idea where the bug is | Binary search, git bisect |
| Bug only in production/CI | Minimal reproduction |
| Intermittent failure | Add instrumentation, increase logging |
| State-related bug | Component state inspection, watch expressions |
| Network-related bug | Network tab inspection |
| Performance issue | Profiler, console.time |

## The Scientific Method for Debugging

1. **Observe**: What exactly is happening? Collect all symptoms without jumping to conclusions.
2. **Hypothesize**: Why might this happen? Form a specific, testable theory.
3. **Test**: Can you reproduce it? Does the theory hold when you check?
4. **Conclude**: Root cause identified? If not, form a new hypothesis.
5. **Fix**: Apply the minimal change that addresses the root cause.

Key discipline: Do not skip straight from Observe to Fix. Untested hypotheses lead to speculative fixes.

## Isolation Techniques

### Binary Search

When you do not know where the bug is:

1. Comment out or disable half the suspect code
2. Does the bug still occur?
   - **Yes**: Bug is in the remaining active code
   - **No**: Bug is in the code you disabled
3. Repeat on the half that contains the bug
4. Continue until isolated to a small section

Best for: Large codebases, unfamiliar code, build errors with unclear sources.

### Git Bisect

When you know the bug was introduced recently:

```bash
git bisect start
git bisect bad                  # current commit is broken
git bisect good <known-good>    # last known working commit
# Git checks out a middle commit -- test it
git bisect good  # or  git bisect bad
# Repeat until the first bad commit is found
git bisect reset                # return to original state
```

### Minimal Reproduction

When the bug is hard to isolate in the full codebase:

1. Create a new empty project
2. Add the minimal code needed to reproduce the bug
3. If you cannot reproduce it, the difference between the full project and the minimal setup is the clue
4. If you can reproduce it, you now have a small, focused test case

## Console Debugging

```typescript
// Log object state (structured)
console.log('State:', JSON.stringify(this, null, 2));

// Log with labels for filtering
console.log('[Component]', 'connectedCallback', this.id);

// Table format for arrays/objects
console.table(this.items);

// Trace the call stack to see how you got here
console.trace('How did we get here?');

// Measure timing
console.time('render');
this.render();
console.timeEnd('render'); // outputs: render: 12.34ms
```

**Cleanup rule**: Remove all debug logging before committing the fix.

## Breakpoint Debugging

### Programmatic Breakpoints

```typescript
// Add a breakpoint in code (remove before committing)
debugger;
```

### Conditional Breakpoints (DevTools)

In the browser DevTools Sources panel:
- Right-click a line number and select "Add conditional breakpoint"
- Enter an expression: `this.value === 'specific'`
- Execution pauses only when the condition is true

### DOM Breakpoints

In the Elements panel:
- Right-click an element and select "Break on..."
  - **Subtree modifications**: Pauses when children change
  - **Attribute modifications**: Pauses when attributes change
  - **Node removal**: Pauses when the element is removed

## Network Debugging

1. Open DevTools, go to the Network tab
2. Reproduce the issue
3. Check each request:
   - Was the request sent? (look for it in the list)
   - Correct URL and method?
   - Correct request headers (auth, content-type)?
   - What was the response status and body?
4. Look for failed requests (red entries), unexpected redirects, or missing requests

## Component State Debugging

```typescript
// Temporarily expose a component for console inspection
connectedCallback() {
  super.connectedCallback();
  (window as any).debugComponent = this;
}

// Then in the browser console:
// > debugComponent.myState
// > debugComponent.someMethod()
```

**Cleanup rule**: Remove debug exposure before committing.

## Common Investigation Paths

| Symptom | First Steps |
|---|---|
| Nothing renders | Is the component registered? Check imports. Check the DOM for the element. |
| State not updating | Is the property reactive (`@observable`, `@attr`)? |
| Event not firing | Check event binding syntax. Check that the handler name matches. |
| Styles not applying | Check shadow DOM boundaries. Check `:host` selector. Check specificity. |
| Build fails | Check imports for typos. Check for circular dependencies. Check lock file. |
| Tests pass locally, fail in CI | Check environment differences: OS, Node version, env vars, timing. |
| Works in dev, breaks in prod | Check build optimizations: tree-shaking, minification, env-specific code paths. |

## When You Are Stuck

1. **Step away**: A 5-minute break often surfaces new ideas
2. **Explain the problem**: Describe it out loud or in writing (rubber duck debugging)
3. **Search for the exact error message**: Others have likely encountered it
4. **Check upstream issues**: The bug might be a known issue in a dependency
5. **Add more instrumentation**: Log intermediate values at each step of the failing path
6. **Ask for a second pair of eyes**: Fresh perspective often spots what you are too close to see
