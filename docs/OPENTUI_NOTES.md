# OpenTUI Integration Notes

> ⚠️ **Read this before considering OpenTUI** | Last updated: 2026-02-07
> Repository: https://github.com/HenkDz/coder-link

## Problem Summary

When we first tried to use OpenTUI (@opentui/core + @opentui/solid) with Bun on Windows:
- Keyboard input (arrows, ESC, q, etc.) **did not work at all** — except `q` for quitting
- Signal-driven UI updates `setCount()`, `setMessage()` **did not visually update the screen**
- `onMount` and `createEffect` callbacks **never fired** — only ran once on initial render

## Root Cause

The official `@opentui/solid/preload` plugin uses forward-slash-only regex patterns:
```ts
// From @opentui/solid/scripts/solid-plugin.ts
build.onLoad({ filter: /\/node_modules\/solid-js\/dist\/server\.js$/ }, ...)
```

On Windows, Bun resolves module paths with **backslashes**:
```
E:\Projects\AI\coding-helper\node_modules\solid-js\dist\server.js
```

The regex never matches, so Bun loads `solid-js/dist/server.js` (SSR build) instead of `solid.js` (client runtime):
- `server.js` = **SSR build** — no reactivity, no effect tracking, signals are non-reactive
- `solid.js` = **client build** — full reactivity (effects, memos, onMount, etc.)

Result: SolidJS reactivity was completely broken without any error messages.

## Solution

Created a cross-platform preload that handles both `/` and `\` in paths:

```ts
// preload.ts
import { plugin } from "bun"

plugin({
  name: "opentui-solid-cross-platform",
  setup(build) {
    // Cross-platform regex: [\/\\] matches both forward and backslashes
    build.onLoad(
      { filter: /[\/\\]node_modules[\/\\]solid-js[\/\\]dist[\/\\]server\.js$/ },
      async (args) => {
        // Redirect solid-js/dist/server.js → solid.js
        return { contents: await Bun.file(args.path.replace("server.js", "solid.js")).text(), loader: "js" }
      },
    );

    // Same for solid-js/store
    build.onLoad(
      { filter: /[\/\\]node_modules[\/\\]solid-js[\/\\]store[\/\\]dist[\/\\]server\.js$/ },
      async (args) => {
        return { contents: await Bun.file(args.path.replace("server.js", "store.js")).text(), loader: "js" }
      },
    );

    // Compile .tsx/.jsx with babel-preset-solid
    // ... rest of plugin
  },
});
```

Then configured `bunfig.toml`:
```toml
preload = ["./preload.ts"]
```

## Current Status

- ✅ SolidJS reactivity works (effects, memos, onMount all fire correctly)
- ✅ `useKeyboard` hook works (keyboard input fully functional)
- ✅ Signal-driven UI updates render instantly
- ✅ Ctrl+C handled gracefully with `exitOnCtrlC: false` + manual handler

## Should You Use OpenTUI?

**Good reasons to use it:**
- You truly need a rich, screenful TUI (panes, live updating layout, selectable lists, mouse support, fast rendering)
- You want a component-based, reactive DX (SolidJS signals + JSX)
- You're already committed to Bun as the runtime
- Performance matters (fast redraws, lots of content)

**Reasons to skip it forCoder-link:**
- Your CLI is primarily: run commands, show logs/diffs, ask a few questions, pick from a list
- A simpler interactive CLI (inquirer/prompts + streaming output) could meet 95% of needs
- OpenTUI adds complexity: preload workaround, framework upgrade risks, cross-platform testing overhead
- You want maximum reliability Windows/macOS/Linux across different terminals (PowerShell, Windows Terminal, SSH, CI)
- Locking your CLI to Bun as a hard requirement may limit users

## If Proceeding with OpenTUI

**Do this checklist first:**
1. Decide if coder-link's differentiation IS a rich TUI (or if a simple prompt mode is sufficient)
2. If yes, create a test matrix: Windows (PowerShell, Windows Terminal), macOS, Linux
3. Pin OpenTUI versions in package.json to avoid breakage from updates
4. Provide a "prompt mode" fallback (`--no-tui` flag) for broken environments
5. Consider reporting the Windows path issue to `@opentui/solid` upstream

**Example package.json pins (if you proceed):**
```json
{
  "dependencies": {
    "@opentui/core": "0.1.77",
    "@opentui/solid": "0.1.77",
    "solid-js": "1.9.11"
  }
}
```

**Example CLI flag:**
```ts
program
  .option("--no-tui", "Use simple prompts instead of full TUI")
  .action((options) => {
    if (options.noTui) {
      runPromptMode();
    } else {
      runTuiMode();
    }
  });
```

## References

- OpenTUI issue: The `@opentui/solid/preload` plugin relies on forward-slash paths
- SolidJS versions: `solid-js/dist/server.js` (SSR, no reactivity) vs `solid.js` (client, full reactivity)
- Debug log location: `opentui-debug.tsx` (if re-testing in future)
- Fix location: `preload.ts` (cross-platform regex patterns)

---
**Decision log:** 2026-02-07 - Investigated OpenTUI, found Windows path issue, fixed via custom preload, but deferred decision on using it in production.
