# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

- **Package manager**: Always use `bun`, never npm. `package-lock.json` is legacy.
- `bun run build` — compile TypeScript + copy locales to `dist/`
- `bun run dev` — hot-reload dev mode (`tsx watch src/cli.ts`)
- `bun run clean` — delete `dist/`
- `bun run lint` / `bun run lint:fix` — ESLint (note: config file is currently missing, lint may fail)
- No test suite exists — `bun run test` is not implemented

## TypeScript Conventions

- ES2022, NodeNext module resolution, strict mode
- All relative imports must use `.js` extension (e.g., `import from './utils/config.js'`)
- Output compiles to `dist/` — this directory is committed intentionally for npm publishing, do not remove

## Code Patterns

- **i18n**: All user-facing strings go through `i18n.t('key')` from `src/utils/i18n.ts`. Locales live in `src/locales/*.json`.
- **Branding**: Use `planLabelColored()`, `toolLabel()`, `statusIndicator()` from `src/utils/brand.ts` — never hardcode provider/tool names in UI output.
- **Config access**: Always use `configManager.getProviderSettings(plan)` — never access `config.providers.*` directly.
- **URL construction**: Always use `resolveProviderBaseUrl(plan, protocol, options?)` from `provider-registry.ts` — never concatenate URLs manually.
- **Lazy loading**: Use `toolManager.getManager(tool)` — never import `*-manager.ts` files directly in CLI code.
- **Interactive flows**: Use `inquirer` prompts with a "Back" option via `BACK_SIGNAL` pattern.
- **Error handling**: `logger.logError(context, error)` + `printError(msg, hint?)` + `process.exit(1)`.

## Adding Providers, Tools, and MCPs

See `@.github/copilot-instructions.md` for detailed integration guides covering:
- Adding a provider to `PROVIDER_CONFIGS` in `provider-registry.ts`
- Adding a tool by creating a `*-manager.ts` implementing `ToolAdapter`
- Adding an MCP to `BUILTIN_MCP_SERVICES` in `mcp-services.ts`

## Git Conventions

- Use conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, etc.

## Known Issues

- ESLint config file is missing — `bun run lint` may not work until one is added
- `src/cli.ts` hardcodes `.version('0.0.9')` — keep this in sync with `package.json` version
