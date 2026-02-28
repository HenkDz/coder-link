# CoderLink - AI Agent Instructions

## Architecture Overview

CoderLink is a TypeScript CLI that bridges coding tools (Claude Code, OpenCode, etc.) with multiple AI providers (GLM, Kimi, OpenRouter, NVIDIA, LM Studio, Alibaba, ZenMux). Key patterns:

- **Manager Pattern**: Each tool has a dedicated manager (`src/lib/*-manager.ts`) implementing `ToolAdapter` interface. Managers handle config detection, injection, and MCP management.
- **Provider Registry**: Centralized provider configurations in `src/lib/provider-registry.ts`. All base URLs, models, and protocol mappings live here. Use `getProviderConfig(plan)` and `resolveProviderBaseUrl(plan, protocol)`.
- **Config System**: Singleton `ConfigManager` (`src/utils/config.ts`) stores YAML at `~/.coder-link/config.yaml`. Supports provider profiles (`config.providers.*`) with per-provider overrides (base_url, model, etc.).
- **Lazy Loading**: Managers are loaded on-demand via `toolManager.getManager(tool)`. Don't import manager modules directly in CLI code; use `toolManager` facade.
- **MCP Services**: Built-in MCPs defined in `src/mcp-services.ts` (`BUILTIN_MCP_SERVICES`). Installation flows in `src/cli.ts` handle env var injection and tool targeting.

## Critical Workflows

```bash
# Build
bun run build          # tsc + copy locales
bun run dev            # tsx watch src/cli.ts
bun run lint           # eslint
bun run lint:fix       # eslint --fix

# Run
npx coder-link         # or bun start after build
coder-link init        # wizard (interactive)
coder-link doctor      # diagnostics + config path
coder-link status      # concise status
coder-link auth <plan> <token>  # set provider API key
coder-link tools list  # show tools
coder-link mcp install <service> -t <tool>  # install MCP
```

## Project Conventions

- **TypeScript**: ES2022, NodeNext module resolution, strict mode. Output to `dist/`.
- **i18n**: Use `i18n.t(key)` from `src/utils/i18n.ts`. Locales in `src/locales/*.json`. Run `bun scripts/copy-locales.mjs` during build.
- **Branding**: Colors and labels in `src/utils/brand.ts`. Use `planLabelColored()`, `toolLabel()`, `statusIndicator()` for consistent UI.
- **Config Access**: Always use `configManager` singleton. For provider settings, prefer `configManager.getProviderSettings(plan)` over direct config object access.
- **Provider Protocols**: OpenAI-compatible uses `/v1/chat/completions`; Anthropic-compatible uses `/v1/messages`. Use `supportsProtocol(plan, 'anthropic')` to check.
- **Health Checks**: Local providers (LM Studio) require health checks. Use `checkLMStudioStatus()` from `provider-registry.ts`. Respect `requiresHealthCheck(plan)`.
- **URL Normalization**: Never concatenate URLs manually. Use `resolveProviderBaseUrl(plan, protocol, options?)` which handles provider-specific quirks (GLM, OpenRouter, Alibaba, ZenMux, LM Studio).
- **Error Handling**: Log with `logger.logError(context, error)`. Show user-friendly messages with `printError(msg, hint?)`. Exit with `process.exit(1)` on CLI failures.
- **Interactive Flows**: Use `inquirer` prompts. Include "Back" options where appropriate (see `mcpInteractiveMenu` pattern in `cli.ts`). Use `BACK_SIGNAL` to return to previous menu.

## Key Files

- `src/cli.ts` - Commander setup, all subcommands, MCP interactive flows
- `src/lib/provider-registry.ts` - Provider configurations, URL resolution, LM Studio health check
- `src/utils/config.ts` - ConfigManager, migrations, provider settings
- `src/lib/tool-manager.ts` - ToolAdapter facade, capabilities registry, lazy loading
- `src/menu/` - Interactive menus (main, provider, tool, system)
- `src/wizard.ts` - First-time setup flow
- `src/utils/brand.ts` - UI helpers (colors, labels, status indicators)

## Integration Points

- **Adding a Provider**: Add to `PROVIDER_CONFIGS` in `provider-registry.ts`. Implement URL normalization in `normalizeProviderUrl()` if needed. Update `PROVIDER_CHOICES` in `src/utils/providers.ts`.
- **Adding a Tool**: Create `*-manager.ts` implementing `ToolAdapter`. Register in `ToolManager.CAPABILITIES` and `managerLoaders`. Add to `ALL_TOOL_IDS` in `config.ts`.
- **Adding an MCP**: Define in `BUILTIN_MCP_SERVICES` with `envTemplate` for credential injection. Update managers to handle installation in `installMCP()`.

## Testing & Debugging

- Use `coder-link doctor` to verify config path, provider auth, tool status, and MCP installations.
- Check logs at `~/.coder-link/logs/` (if configured via `logger`).
- For LM Studio issues: `checkLMStudioStatus()` returns `{ reachable, modelLoaded, actualUrl }`. Default ports: `[1234, 1235]`.
- Config migrations run automatically on `ConfigManager` construction. Legacy paths: `~/.chelper/config.yaml`.

## Notes

- GLM providers use Anthropic endpoints for Claude Code, OpenAI endpoints for others.
- Kimi "native" uses Moonshot API; OpenRouter/NVIDIA use their gateways with model IDs like `moonshotai/kimi-k2.5`.
- Alibaba has two profiles: `alibaba` (Coding Plan) and `alibaba_api` (Model Studio Singapore). Migration handles this automatically.
- MCP auth injection: For stdio services, provider API key is written to `authEnvVar` (default `Z_AI_API_KEY`). For HTTP/SSE, added to `authHeader` (default `Authorization: Bearer`).
