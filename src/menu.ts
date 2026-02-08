import inquirer from 'inquirer';
import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { configManager, isKimiLikePlan, CONFIG_DIR } from './utils/config.js';
import type { Plan } from './utils/config.js';
import { i18n } from './utils/i18n.js';
import { toolManager } from './lib/tool-manager.js';
import { logger } from './utils/logger.js';
import { BUILTIN_MCP_SERVICES } from './mcp-services.js';
import { commandExists, runInteractive, runInteractiveWithEnv, runInNewTerminal } from './utils/exec.js';
import { testOpenAIChatCompletionsApi, testOpenAICompatibleApi, fetchOpenRouterModelInfo } from './utils/api-test.js';
import { printSplash, printHeader, printStatusBar, printNavigationHints, printConfigPathHint, planLabel, planLabelColored, maskApiKey, toolLabel, statusIndicator, truncateForTerminal, } from './utils/brand.js';
import { printError, printSuccess, printWarning, printInfo } from './utils/output.js';

function disableMouseTracking(): void {
  if (!process.stdout.isTTY) return;
  // Disable common mouse tracking modes.
  // See xterm mouse tracking: 9, 1000, 1002, 1003, 1005, 1006, 1015.
  process.stdout.write(
    '\x1b[?9l' +
      '\x1b[?1000l' +
      '\x1b[?1002l' +
      '\x1b[?1003l' +
      '\x1b[?1005l' +
      '\x1b[?1006l' +
      '\x1b[?1015l'
  );
}

/**
 * Some UI libs can enable terminal mouse tracking via ANSI (DECSET).
 * When enabled, mouse movement/clicks become input and can:
 * - move list selection
 * - inject junk like "35;47;...M" into text inputs
 *
 * We prevent this by stripping *mouse-enable* escape sequences from stdout
 * so mouse mode never turns on, while leaving stdin untouched (arrow keys work).
 */
function installStdoutMouseGuard(): void {
  if (!process.stdout.isTTY) return;
  const originalWrite = process.stdout.write.bind(process.stdout);
  const enableRe = /\x1b\[\?(?:9|1000|1002|1003|1005|1006|1015)h/g;
  (process.stdout as any).write = (chunk: any, encoding?: any, cb?: any) => {
    if (chunk == null) return originalWrite(chunk as any, encoding as any, cb as any);
    if (Buffer.isBuffer(chunk) || chunk instanceof Uint8Array) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const s = buf.toString('latin1');
      const cleaned = s.replace(enableRe, '');
      return originalWrite(Buffer.from(cleaned, 'latin1'), encoding as any, cb as any);
    }
    const s = String(chunk);
    const cleaned = s.replace(enableRe, '');
    return originalWrite(cleaned as any, encoding as any, cb as any);
  };
}

installStdoutMouseGuard();
disableMouseTracking();

// ── Helpers ────────────────────────────────────────────────────────────
function providerSummary(plan: Plan | undefined): string {
  if (!plan) return '';
  if (!isKimiLikePlan(plan)) return '';
  const s = configManager.getProviderSettings(plan);
  const parts: string[] = [];
  if (s.baseUrl) parts.push(s.baseUrl);
  if (s.model) parts.push(s.model);
  return parts.length ? chalk.gray(` (${parts.join(' · ')})`) : '';
}

function startCommand(tool: string): { cmd: string; args: string[] } {
  switch (tool) {
    case 'claude-code':
      return { cmd: 'claude', args: [] };
    case 'opencode':
      return { cmd: 'opencode', args: [] };
    case 'crush':
      return { cmd: 'crush', args: [] };
    case 'factory-droid':
      return commandExists('droid') ? { cmd: 'droid', args: [] } : { cmd: 'factory', args: [] };
    case 'kimi':
      return { cmd: 'kimi', args: [] };
    case 'amp':
      return { cmd: 'amp', args: [] };
    case 'pi':
      return { cmd: 'pi', args: [] };
    default:
      return { cmd: tool, args: [] };
  }
}

function openUrlCommand(url: string): string {
  if (process.platform === 'win32') return `start ${url}`;
  if (process.platform === 'darwin') return `open ${url}`;
  return `xdg-open ${url}`;
}

function installHint(tool: string): { label: string; command?: string } {
  switch (tool) {
    case 'amp':
      return { label: 'Install AMP Code', command: 'powershell -c "irm https://ampcode.com/install.ps1 | iex"' };
    case 'pi':
      return { label: 'Install Pi CLI', command: 'bun add -g @mariozechner/pi-coding-agent' };
    case 'opencode':
      return { label: 'Install OpenCode', command: 'bun add -g opencode-ai' };
    case 'kimi':
      return { label: 'Open Kimi CLI install page', command: openUrlCommand('https://kimi.moonshot.cn/') };
    case 'claude-code':
      return { label: 'Open Claude Code install page', command: openUrlCommand('https://docs.anthropic.com/claude-code') };
    case 'crush':
      return { label: 'Open Crush install page', command: openUrlCommand('https://crush.ai/') };
    case 'factory-droid':
      return { label: 'Open Factory Droid install page', command: openUrlCommand('https://factory.ai/') };
    default:
      return { label: 'Install instructions', command: undefined };
  }
}

async function pause(message = 'Press Enter to continue... (or q to quit)'): Promise<void> {
  return new Promise((resolve) => {
    console.log(chalk.gray(`  ${message}`));

    // Inquirer/readline can leave stdin paused after a prompt.
    // If stdin is paused, a pending `once('data')` listener does not keep the
    // event loop alive and the process may exit immediately.
    if (process.stdin.isTTY) process.stdin.resume();

    const onData = (data: Buffer | string) => {
      cleanup();
      const str = data.toString().trim();
      if (str === 'q' || str === 'Q') {
        console.log(chalk.gray('\n  Goodbye!\n'));
        process.exit(0);
      }
      resolve();
    };

    const onEnd = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      resolve();
    };

    const cleanup = () => {
      process.stdin.removeListener('data', onData as any);
      process.stdin.removeListener('end', onEnd);
      process.stdin.removeListener('error', onError);
    };

    process.stdin.on('data', onData as any);
    process.stdin.once('end', onEnd);
    process.stdin.once('error', onError);
  });
}

// Safe spinner that doesn't overflow terminal width
function createSafeSpinner(text: string): Ora {
  const safeText = truncateForTerminal(text, (process.stdout.columns || 80) - 10);
  return ora({ text: safeText, spinner: 'dots' });
}

// ── Tool/Provider Compatibility ────────────────────────────────────────
/**
 * Check if a provider is compatible with a tool.
 * Returns null if compatible, or an error message if incompatible.
 */
function getProviderIncompatibility(tool: string, plan: Plan): string | null {
  // Claude Code requires Anthropic-compatible API (/v1/messages)
  // Kimi and NVIDIA only provide OpenAI-compatible API (/v1/chat/completions)
  // LM Studio supports both OpenAI and Anthropic endpoints
  if (tool === 'claude-code' && (plan === 'kimi' || plan === 'nvidia')) {
    return 'Requires Anthropic API';
  }
  return null;
}

// ── Provider Menu ──────────────────────────────────────────────────────
const PROVIDER_CHOICES: Array<{ name: string; value: Plan }> = [
  { name: 'GLM Coding Plan (Global)', value: 'glm_coding_plan_global' },
  { name: 'GLM Coding Plan (China)', value: 'glm_coding_plan_china' },
  { name: 'Kimi (Moonshot)', value: 'kimi' },
  { name: 'OpenRouter', value: 'openrouter' },
  { name: 'NVIDIA NIM', value: 'nvidia' },
  { name: 'LM Studio (Local)', value: 'lmstudio' },
];

const COMMON_MODELS: Record<string, string[]> = {
  kimi: ['moonshot-ai/kimi-k2.5', 'moonshot-ai/kimi-k2-thinking'],
  openrouter: ['moonshotai/kimi-k2.5', 'anthropic/claude-opus-4.6','poney-alpha', 'qwen/qwen3-coder-next'],
  nvidia: ['moonshotai/kimi-k2.5', 'deepseek-ai/deepseek-v3.2', 'meta/llama-3.3-70b-instruct', 'meta/llama-4-maverick-17b-128e-instruct', 'qwen/qwen3-coder-480b-a35b-instruct', 'z-ai/glm4.7', 'nvidia/llama-3.3-nemotron-super-49b-v1.5'],
  lmstudio: ['lmstudio-community', 'deepseek-coder-v3', 'codellama/13b', 'mistral-7b-instruct', 'qwen2.5-coder-7b'],
  glm_coding_plan_global: ['glm-4.7', 'glm-4-coder', 'glm-4-plus', 'glm-4-air', 'glm-4-flash'],
  glm_coding_plan_china: ['glm-4.7', 'glm-4-coder', 'glm-4-plus', 'glm-4-air', 'glm-4-flash'],
};

/**
 * Enhanced prompt for model selection.
 * Offers common models + custom input + back.
 */
async function selectModelId(plan: Plan, currentModel?: string): Promise<string | '__back'> {
  const common = COMMON_MODELS[plan] || [];
  const choices = [
    ...(currentModel ? [{ name: `${currentModel} ${chalk.green('(current)')}`, value: currentModel }] : []),
    ...common.filter(m => m !== currentModel).map(m => ({ name: m, value: m })),
    { name: '✍️  Enter custom model ID...', value: '__custom' },
    new inquirer.Separator(),
    { name: chalk.gray('← Back'), value: '__back' },
  ];

  const { selection } = await inquirer.prompt<{ selection: string }>([{
    type: 'list',
    name: 'selection',
    message: 'Select Model ID:',
    choices,
  }]);

  if (selection === '__back') return '__back';
  if (selection === '__custom') {
    const { custom } = await inquirer.prompt<{ custom: string }>([{
      type: 'input',
      name: 'custom',
      message: `Enter model ID (or 'b' to go back):`,
      validate: (v: string) => v.trim().length > 0 || 'Model ID cannot be empty',
    }]);
    if (custom.trim().toLowerCase() === 'b') return selectModelId(plan, currentModel);
    return custom.trim();
  }
  return selection;
}

async function configureProfilesMenu(): Promise<void> {
  while (true) {
    console.clear();
    printHeader('Configure Profiles');
    printNavigationHints();

    const { plan } = await inquirer.prompt<{ plan: Plan | '__back' }>([{
      type: 'list',
      name: 'plan',
      message: 'Select profile to configure:',
      choices: [
        ...PROVIDER_CHOICES.map(c => {
          const key = configManager.getApiKeyFor(c.value);
          const status = key ? chalk.green(' (Configured)') : chalk.gray(' (Not set)');
          return { name: `${c.name}${status}`, value: c.value };
        }),
        new inquirer.Separator(),
        { name: chalk.gray('← Back'), value: '__back' as any },
      ],
    }]);

    if (plan === '__back') return;

    await providerSetupFlow(plan);
    console.log();
    await pause();
  }
}

/**
 * Unified provider configuration flow:
 * 1. Set endpoint + model (for kimi-like providers)
 * 2. Set API key
 */
async function providerSetupFlow(plan: Plan): Promise<void> {
  printInfo(`Configuring ${planLabel(plan)} profile...`);
  console.log(chalk.gray(`  (Enter 'b' at any text prompt to go back)\n`));

  // Step 1 — Endpoint
  const current = configManager.getProviderSettings(plan);
  const { base_url } = await inquirer.prompt<{ base_url: string }>([{
    type: 'input',
    name: 'base_url',
    message: `${planLabel(plan)} Base URL:`,
    default: current.baseUrl,
    validate: (v: string) => v.trim().length > 0 || 'Base URL cannot be empty',
  }]);

  if (base_url.trim().toLowerCase() === 'b') {
     printInfo('Configuration cancelled');
     return;
  }

  // Step 2 — Model
  const model = await selectModelId(plan, current.model);
  if (model === '__back') return providerSetupFlow(plan);

  // Try to fetch context size from OpenRouter API if applicable
  let suggestedCtx = current.maxContextSize || (plan === 'nvidia' ? 4096 : plan === 'openrouter' ? 16384 : plan.includes('glm') ? 128000 : 262144);
  let fetchedContextInfo = '';
  
  if (plan === 'openrouter') {
    // We need an API key to fetch model info - check if one exists already
    const existingKey = configManager.getApiKeyFor(plan);
    if (existingKey) {
      const spinner = createSafeSpinner(`Fetching model info from OpenRouter...`).start();
      try {
        const modelInfo = await fetchOpenRouterModelInfo({
          apiKey: existingKey,
          modelId: model.trim(),
          timeoutMs: 8000,
        });
        if (modelInfo?.contextLength) {
          suggestedCtx = modelInfo.contextLength;
          fetchedContextInfo = chalk.green(` (fetched from API: ${modelInfo.contextLength.toLocaleString()})`);
          spinner.succeed(`Found model: ${modelInfo.name || modelInfo.id} (context: ${modelInfo.contextLength.toLocaleString()})`);
        } else {
          spinner.fail('Could not fetch context size from OpenRouter, using default');
        }
      } catch {
        spinner.fail('Failed to fetch model info from OpenRouter');
      }
    }
  }

  const { max_context_size_input } = await inquirer.prompt<{ max_context_size_input: string }>([{
    type: 'input',
    name: 'max_context_size_input',
    message: `Max context size:${fetchedContextInfo} (or 'b')`,
    default: String(suggestedCtx),
    validate: (v: string) => {
      if (v.trim().toLowerCase() === 'b') return true;
      const n = Number(v);
      return Number.isInteger(n) && n > 0 || 'Enter a positive integer';
    },
  }]);

  if (max_context_size_input.toLowerCase() === 'b') return providerSetupFlow(plan);

  configManager.setProviderProfile(plan, {
    base_url: base_url.trim(),
    model: model.trim(),
    max_context_size: Number(max_context_size_input),
  });

  // Step 3 — API key
  const existingKey = configManager.getApiKeyFor(plan);
  const isLocalProvider = plan === 'lmstudio';
  const keyMsg = existingKey
    ? `API key for ${planLabel(plan)} [current: ${maskApiKey(existingKey)}] (or 'b')${isLocalProvider ? ' [optional for local]' : ''}:`
    : `API key for ${planLabel(plan)} (or 'b')${isLocalProvider ? ' [optional for local]' : ''}:`;

  const { apiKey } = await inquirer.prompt<{ apiKey: string }>([{
    type: 'password',
    name: 'apiKey',
    message: keyMsg,
    mask: '*',
    validate: (v: string) => {
      if (v.trim().toLowerCase() === 'b') return true;
      // Allow empty to keep existing key
      if (existingKey && v.trim().length === 0) return true;
      // Allow empty for local providers
      if (isLocalProvider && v.trim().length === 0) return true;
      return v.trim().length > 0 || 'API key cannot be empty';
    },
  }]);

  if (apiKey.trim().toLowerCase() === 'b') return providerSetupFlow(plan);

  const finalKey = apiKey.trim() || (existingKey ?? (isLocalProvider ? 'lmstudio' : ''));
  configManager.setApiKeyFor(plan, finalKey);

  printSuccess(`${planLabel(plan)} profile updated`);
  const s = configManager.getProviderSettings(plan);
  console.log(chalk.gray(`  Endpoint : ${s.baseUrl}`));
  console.log(chalk.gray(`  Model    : ${s.model}`));
  console.log(chalk.gray(`  API Key  : ${maskApiKey(finalKey)}`));
}


async function providerMenu(): Promise<void> {
  while (true) {
    console.clear();
    printHeader('Provider Configuration');
    const auth = configManager.getAuth();
    const plan = auth.plan as Plan | undefined;
    printStatusBar(plan, auth.apiKey, plan ? providerSummary(plan).trim() : undefined);
    printConfigPathHint(configManager.configPath);
    printNavigationHints();

    type Action = 'set_global' | 'configure' | 'test' | 'revoke' | 'back';
    const choices: Array<{ name: string; value: Action }> = [
      { name: '🌐 Select Global Default Provider', value: 'set_global' },
      { name: '⚙️  Configure Provider Profiles (keys, endpoints, models)', value: 'configure' },
    ];

    if (plan && auth.apiKey) {
      choices.push({ name: '🔬 Test API Connection', value: 'test' });
      choices.push({ name: '🗑  Revoke API Keys', value: 'revoke' });
    }

    const { action } = await inquirer.prompt<{ action: Action | '__back' }>([{
      type: 'list',
      name: 'action',
      message: 'Action:',
      choices: [
        ...choices,
        new inquirer.Separator(),
        { name: chalk.gray('← Back'), value: '__back' as any },
      ],
    }]);

    if (action === '__back') return;

    try {
      if (action === 'set_global') {
        const { newPlan } = await inquirer.prompt<{ newPlan: Plan | '__back' }>([{
          type: 'list',
          name: 'newPlan',
          message: 'Select Global Default Provider:',
          choices: [
            ...PROVIDER_CHOICES.map(c => ({
              ...c,
              name: c.value === plan ? `${c.name} ${chalk.green('●')}` : c.name,
            })),
            new inquirer.Separator(),
            { name: chalk.gray('← Back'), value: '__back' as any },
          ],
          default: plan,
        }]);
        if (newPlan !== '__back') {
          const key = configManager.getApiKeyFor(newPlan);
          configManager.setAuth(newPlan, key || '');
          printSuccess(`Global provider set to ${planLabel(newPlan)}`);
          await pause();
        }
      } else if (action === 'configure') {
        await configureProfilesMenu();
      } else if (action === 'revoke') {
        const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
          type: 'confirm',
          name: 'confirm',
          message: chalk.yellow('Revoke all saved API keys?'),
          default: false,
        }]);
        if (!confirm) {
          printInfo('Cancelled');
          await pause();
          continue;
        }
        configManager.revokeAuth();
        printSuccess('API keys revoked');
        await pause();
      } else if (action === 'test') {
        await testApiConnection();
        await pause();
      }
    } catch (error) {
      logger.logError('menu.provider', error);
      printError(
        error instanceof Error ? error.message : String(error),
        'Run "coder-link auth" to configure API keys'
      );
      await pause();
    }
  }
}

async function testApiConnection(): Promise<void> {
  const auth = configManager.getAuth();
  const plan = auth.plan as Plan | undefined;
  const apiKey = auth.apiKey;

  if (!plan || !apiKey) {
    printWarning('No provider configured. Set one up first.');
    return;
  }

  let baseUrl: string;
  let model: string | undefined;
  if (isKimiLikePlan(plan)) {
    const s = configManager.getProviderSettings(plan);
    baseUrl = s.baseUrl;
    model = s.model;
  } else if (plan === 'glm_coding_plan_global') {
    baseUrl = 'https://api.z.ai/api/coding/paas/v4';
  } else {
    baseUrl = 'https://open.bigmodel.cn/api/coding/paas/v4';
  }

  const spinner = createSafeSpinner(`Testing: ${baseUrl}`).start();
  const timeoutMs = 12000;
  const isNvidia = plan === 'nvidia' || baseUrl.includes('integrate.api.nvidia.com');

  const result = await (async () => {
    if (isNvidia) {
      return await testOpenAIChatCompletionsApi({
        baseUrl,
        apiKey,
        model: model || 'moonshotai/kimi-k2.5',
        timeoutMs,
      });
    }
    const modelsProbe = await testOpenAICompatibleApi({ baseUrl, apiKey, timeoutMs });
    if (modelsProbe.ok) return modelsProbe;
    if (isKimiLikePlan(plan) && model && (modelsProbe.status === 404 || /not found/i.test(modelsProbe.detail))) {
      return await testOpenAIChatCompletionsApi({ baseUrl, apiKey, model, timeoutMs });
    }
    return modelsProbe;
  })();

  if (result.ok) {
    spinner.succeed(result.detail);
  } else {
    spinner.fail(result.detail);
    if (result.status) console.log(chalk.gray(`  HTTP ${result.status}`));
  }
  console.log(chalk.gray(`  URL: ${result.url}`));
}

// ── MCP Menu ───────────────────────────────────────────────────────────
async function mcpMenu(tool: string): Promise<void> {
  while (true) {
    console.clear();
    printHeader(`MCP · ${toolLabel(tool)}`);
    const auth = configManager.getAuth();
    if (!auth.plan || !auth.apiKey) {
      printWarning('No provider configured. Set one up from the main menu first.');
      await pause();
      return;
    }
    const installed = await toolManager.getInstalledMCPs(tool);
    console.log(`  ${chalk.gray('Installed:')} ${installed.length ? installed.join(', ') : chalk.yellow('None')}`);
    console.log();
    printNavigationHints();

    const { action } = await inquirer.prompt<{ action: string }>([{
      type: 'list',
      name: 'action',
      message: 'Action:',
      choices: [
        { name: '📦 Install built-in MCP', value: 'install' },
        ...(installed.length ? [{ name: '🗑 Uninstall MCP', value: 'uninstall' }] : []),
        new inquirer.Separator(),
        { name: chalk.gray('← Back (Esc)'), value: '__back' },
      ],
    }]);

    if (action === '__back') return;

    try {
      if (action === 'install') {
        const { id } = await inquirer.prompt<{ id: string | '__back' }>([{
          type: 'list',
          name: 'id',
          message: 'Select MCP:',
          choices: [
            ...BUILTIN_MCP_SERVICES.map(s => ({
              name: `${installed.includes(s.id) ? '✓' : ' '} ${s.name} (${s.id})`,
              value: s.id,
            })),
            new inquirer.Separator(),
            { name: chalk.gray('← Back'), value: '__back' },
          ],
        }]);
        if (id === '__back') continue;

        const { target } = await inquirer.prompt<{ target: 'this' | 'all' }>([{
          type: 'list',
          name: 'target',
          message: 'Install to:',
          choices: [
            { name: `Only ${toolLabel(tool)}`, value: 'this' },
            { name: 'Apply to ALL supported tools', value: 'all' },
          ],
        }]);

        const service = BUILTIN_MCP_SERVICES.find(s => s.id === id)!;
        if (target === 'all') {
          const tools = toolManager.getSupportedTools();
          const spinner = createSafeSpinner(`Installing ${id} to all tools...`).start();
          let success = 0;
          for (const t of tools) {
            try {
              await toolManager.installMCP(t, service, auth.apiKey, auth.plan!);
              success++;
            } catch (e) {
              // skip errors for individual tools
            }
          }
          spinner.succeed(`Installed ${id} to ${success}/${tools.length} tools`);
        } else {
          await toolManager.installMCP(tool, service, auth.apiKey, auth.plan!);
          printSuccess(`Installed ${id} to ${toolLabel(tool)}`);
        }
        await pause();
      } else if (action === 'uninstall') {
        const { id } = await inquirer.prompt<{ id: string | '__back' }>([{
          type: 'list',
          name: 'id',
          message: 'Select MCP to uninstall:',
          choices: [
            ...installed.map(x => ({ name: x, value: x })),
            new inquirer.Separator(),
            { name: chalk.gray('← Back'), value: '__back' },
          ],
        }]);
        if (id === '__back') continue;
        await toolManager.uninstallMCP(tool, id);
        printSuccess(`Uninstalled ${id}`);
        await pause();
      }
    } catch (error) {
      logger.logError('menu.mcp', error);
      printError(
        error instanceof Error ? error.message : String(error),
        'Check tool-specific documentation for MCP requirements'
      );
      await pause();
    }
  }
}

// ── Tool Menu ──────────────────────────────────────────────────────────
async function toolMenu(tool: string): Promise<void> {
  while (true) {
    console.clear();
    printHeader(toolLabel(tool));

    // Current chelper provider state
    const auth = configManager.getAuth();
    const chelperPlan = auth.plan;
    const chelperKey = auth.apiKey;

    // Get chelper model for kimi-like plans
    let chelperModel: string | undefined;
    if (chelperPlan && isKimiLikePlan(chelperPlan)) {
      const settings = configManager.getProviderSettings(chelperPlan);
      chelperModel = settings.model;
    }

    // Detect what's actually written in the tool's own config
    let toolPlan: string | null = null;
    let toolKey: string | null = null;
    let toolModel: string | undefined;
    try {
      const detected = await toolManager.detectCurrentConfig(tool);
      toolPlan = detected.plan;
      toolKey = detected.apiKey;
      toolModel = detected.model;
    } catch {
      // ignore
    }

    // Sync state
    const hasProvider = !!(chelperPlan && chelperKey);
    const isConfigured = !!(toolPlan && toolKey);
    const matchesGlobal = hasProvider && isConfigured && (toolPlan ?? '') === chelperPlan;

    // Status display
    console.log(chalk.gray('  Coder Link'));
    printStatusBar(chelperPlan, chelperKey, chelperModel ? chalk.gray(`Model: ${chelperModel}`) : undefined);
    console.log(chalk.gray(`  ${toolLabel(tool)}`));
    printStatusBar(toolPlan ?? undefined, toolKey ?? undefined, toolModel ? chalk.gray(`Model: ${toolModel}`) : undefined);

    if (tool === 'factory-droid') {
      const factoryKey = configManager.getFactoryApiKey();
      console.log(`  ${chalk.gray('Factory API Key:')} ${factoryKey ? chalk.green(maskApiKey(factoryKey)) : chalk.yellow('Not set')}`);
      console.log();
    }

    // Status indicator - show if configured, not sync state
    if (isConfigured) {
      if (matchesGlobal) {
        printSuccess(`Using global default provider`);
      } else {
        printInfo(`Using tool-specific provider (different from global)`);
      }
      console.log();
    } else if (hasProvider) {
      printInfo('Not configured — sync with global or select a provider');
      console.log();
    }

    // Warning
    printInfo('Changes modify the tool\'s global configuration.');
    console.log();
    printNavigationHints();

    // Build dynamic choices
    type ToolAction = 'switch_profile' | 'sync_global' | 'change_model' | 'unload' | 'mcp' | 'start' | 'start_new' | 'start_same' | '__back';
    const choices: Array<{ name: string; value: ToolAction } | inquirer.Separator> = [];

    choices.push({ name: '🔌 Connect to Provider (Switch Profile)', value: 'switch_profile' });

    if (hasProvider) {
      const globalIncompat = getProviderIncompatibility(tool, chelperPlan as Plan);
      
      if (globalIncompat) {
        // Global provider is incompatible with this tool
        choices.push({ 
          name: chalk.gray(`🌐 Use Global Default (${planLabel(chelperPlan as Plan)}) ${chalk.red(`— ${globalIncompat}`)}`), 
          value: 'sync_global' 
        });
      } else if (matchesGlobal) {
        choices.push({ 
          name: chalk.gray(`🌐 Sync with Global (already using ${planLabel(chelperPlan as Plan)})`), 
          value: 'sync_global' 
        });
      } else {
        choices.push({ 
          name: `🌐 Use Global Default (${planLabel(chelperPlan as Plan)})`, 
          value: 'sync_global' 
        });
      }
    }

    if (isConfigured && toolPlan) {
      choices.push({ name: '🧪 Change Model ID (Override)', value: 'change_model' });
    }

    if (isConfigured) {
      choices.push({ name: '🗑  Unload Configuration (remove from tool)', value: 'unload' });
    }

    choices.push(new inquirer.Separator());
    choices.push({ name: '🔌 MCP Servers', value: 'mcp' });

    // Start
    const { cmd } = startCommand(tool);
    const installed = commandExists(cmd);
    
    // Show detection status inline
    if (!installed) {
      printWarning(`${toolLabel(tool)} was not detected on PATH`, installHint(tool).command ? `Install: ${installHint(tool).command}` : 'Please install it using the vendor instructions.');
    }
    
    if (process.platform === 'win32') {
      choices.push({ 
        name: installed ? `🚀 Launch ${toolLabel(tool)} (New Window)` : chalk.yellow(`🚀 Launch ${toolLabel(tool)} (New Window - not detected)`), 
        value: 'start_new',
      });
      choices.push({ 
        name: installed ? `🚀 Launch ${toolLabel(tool)} (This Terminal)` : chalk.yellow(`🚀 Launch ${toolLabel(tool)} (This Terminal - not detected)`), 
        value: 'start_same',
      });
    } else {
      choices.push({ 
        name: installed ? `🚀 Launch ${toolLabel(tool)}` : chalk.yellow(`🚀 Launch ${toolLabel(tool)} (not detected)`), 
        value: 'start',
      });
    }
    
    choices.push(new inquirer.Separator());
    choices.push({ name: chalk.gray('← Back'), value: '__back' });

    const { action } = await inquirer.prompt<{ action: ToolAction }>([{
      type: 'list',
      name: 'action',
      message: 'Action:',
      choices,
    }]);

    if (action === '__back') return;

    try {
      if (action === 'switch_profile') {
        const { selectedPlan } = await inquirer.prompt<{ selectedPlan: Plan | '__back' }>([{
          type: 'list',
          name: 'selectedPlan',
          message: `Select provider for ${toolLabel(tool)}:`,
          choices: [
            ...PROVIDER_CHOICES.map(c => {
              const key = configManager.getApiKeyFor(c.value);
              const status = key ? chalk.green(' ●') : chalk.gray(' (not configured)');
              const incompat = getProviderIncompatibility(tool, c.value);
              
              if (incompat) {
                // Show incompatible providers as disabled
                return new inquirer.Separator(`  ${chalk.gray.strikethrough(c.name)} ${chalk.red(`(${incompat})`)}`);
              }
              return { name: `${c.name}${status}`, value: c.value };
            }),
            new inquirer.Separator(),
            { name: chalk.gray('← Back'), value: '__back' as any },
          ],
        }]);

        if (selectedPlan === '__back') continue;
        
        let key = configManager.getApiKeyFor(selectedPlan);
        if (!key) {
          const { setupNow } = await inquirer.prompt<{ setupNow: boolean }>([{
            type: 'confirm',
            name: 'setupNow',
            message: `No credentials for ${planLabel(selectedPlan)}. Configure now?`,
            default: true,
          }]);
          if (!setupNow) continue;
          await providerSetupFlow(selectedPlan);
          key = configManager.getApiKeyFor(selectedPlan);
          if (!key) continue;
        }

        // After selecting provider, offer to select model for this tool
        printInfo(`Select model for ${toolLabel(tool)} (current profile default: ${configManager.getProviderSettings(selectedPlan).model}):`);
        const model = await selectModelId(selectedPlan, configManager.getProviderSettings(selectedPlan).model);
        if (model === '__back') continue;

        const spinner = createSafeSpinner(`Applying ${planLabel(selectedPlan)} to ${toolLabel(tool)}...`).start();
        try {
          await toolManager.loadConfig(tool, selectedPlan, key, { model });
          spinner.succeed(`Connected ${toolLabel(tool)} to ${planLabel(selectedPlan)} (${model})`);
        } catch (err) {
          spinner.fail('Failed to apply configuration');
          throw err;
        }
        await pause();
      } else if (action === 'sync_global') {
        if (!hasProvider) {
          printWarning('Configure a global provider first from the main menu.');
          await pause();
          continue;
        }
        const spinner = createSafeSpinner(`Applying ${planLabel(chelperPlan!)} to ${toolLabel(tool)}...`).start();
        try {
          await toolManager.loadConfig(tool, chelperPlan!, chelperKey!);
          spinner.succeed(`Now using ${planLabel(chelperPlan!)}`);
        } catch (err) {
          spinner.fail('Failed to apply configuration');
          throw err;
        }
        await pause();
      } else if (action === 'change_model') {
        if (!toolPlan) continue;
        const key = toolKey || configManager.getApiKeyFor(toolPlan as Plan);
        if (!key) {
          printWarning('Provider exists but no API key found. Configure it first.');
          await pause();
          continue;
        }

        const newModel = await selectModelId(toolPlan as Plan, toolModel || configManager.getProviderSettings(toolPlan as Plan).model);
        if (newModel === '__back') continue;

        const spinner = createSafeSpinner(`Updating model to ${newModel}...`).start();
        try {
          await toolManager.loadConfig(tool, toolPlan, key, { model: newModel });
          spinner.succeed('Model updated');
        } catch (err) {
          spinner.fail('Failed to update model');
          throw err;
        }
        await pause();
      } else if (action === 'unload') {

        const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
          type: 'confirm',
          name: 'confirm',
          message: chalk.yellow(`Unload configuration from ${toolLabel(tool)}?`),
          default: false,
        }]);
        if (!confirm) {
          printInfo('Cancelled');
          await pause();
          continue;
        }
        const spinner = createSafeSpinner('Unloading configuration...').start();
        await toolManager.unloadConfig(tool);
        spinner.succeed('Configuration unloaded');
        await pause();
      } else if (action === 'mcp') {
        await mcpMenu(tool);
      } else if (action === 'start') {
        await launchTool(tool);
      } else if (action === 'start_new') {
        await launchTool(tool, 'new');
      } else if (action === 'start_same') {
        await launchTool(tool, 'same');
      }
    } catch (error) {
      logger.logError('menu.toolAction', error);
      printError(
        error instanceof Error ? error.message : String(error),
        'Check "coder-link doctor" for configuration status'
      );
      await pause();
    }
  }
}

async function launchTool(tool: string, mode?: 'same' | 'new'): Promise<void> {
  const start = startCommand(tool);
  configManager.setLastUsedTool(tool);

  // Check sync status before launching
  const auth = configManager.getAuth();
  const chelperPlan = auth.plan;
  const chelperKey = auth.apiKey;
  const hasProvider = !!(chelperPlan && chelperKey);

  // Get chelper model for kimi-like plans
  let chelperModel: string | undefined;
  if (chelperPlan && isKimiLikePlan(chelperPlan)) {
    const settings = configManager.getProviderSettings(chelperPlan);
    chelperModel = settings.model;
  }

  let toolPlan: string | null = null;
  let toolKey: string | null = null;
  let toolModel: string | undefined;
  try {
    const detected = await toolManager.detectCurrentConfig(tool);
    toolPlan = detected.plan;
    toolKey = detected.apiKey;
    toolModel = detected.model;
  } catch {
    // ignore
  }

  const isConfigured = !!(toolPlan && toolKey);

  // Only prompt if tool is NOT configured but we have a global provider to offer
  if (!isConfigured && hasProvider) {
    console.log();
    printInfo(`${toolLabel(tool)} is not configured.`);
    console.log(chalk.gray(`  Global default: ${chelperPlan}${chelperModel ? ` (${chelperModel})` : ''}`));
    console.log();

    const { action } = await inquirer.prompt<{ action: 'sync' | 'select' | 'cancel' }>([{
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: `🔄 Configure with ${planLabel(chelperPlan!)} (global default)`, value: 'sync' },
        { name: '📋 Select a different provider...', value: 'select' },
        { name: chalk.gray('← Cancel'), value: 'cancel' },
      ],
    }]);

    if (action === 'cancel') return;
    if (action === 'select') {
      // Fall through to tool menu for provider selection - just return and let user configure
      printInfo('Use the tool menu to configure a provider first.');
      return;
    }
    // action === 'sync'
    const spinner = createSafeSpinner(`Configuring with ${planLabel(chelperPlan!)}...`).start();
    try {
      await toolManager.loadConfig(tool, chelperPlan!, chelperKey!);
      spinner.succeed('Configuration applied');
    } catch (err) {
      spinner.fail('Failed to apply configuration');
      throw err;
    }
  }

  if (!commandExists(start.cmd)) {
    console.log();
    printWarning(`${toolLabel(tool)} was not detected on PATH.`);
    const hint = installHint(tool);
    
    const choices = [
      { name: '🚀 Try launching anyway', value: 'anyway' },
    ];
    
    if (hint.command) {
      choices.push({ name: `🛠 Attempt to Install (${hint.label})`, value: 'install' });
    }
    
    choices.push({ name: chalk.gray('← Cancel'), value: 'cancel' });

    const { failAction } = await inquirer.prompt<{ failAction: 'anyway' | 'install' | 'cancel' }>([
      {
        type: 'list',
        name: 'failAction',
        message: 'What would you like to do?',
        choices,
      },
    ]);

    if (failAction === 'cancel') return;
    
    if (failAction === 'install') {
      console.log(`\n  Running: ${chalk.cyan(hint.command!)}\n`);
      try {
        await runInteractive(hint.command!, []);
        printSuccess('Installation command completed.');
      } catch (err) {
        printError('Installation failed', err instanceof Error ? err.message : String(err));
      }
      await pause();
      return;
    }
  }

  console.log(chalk.gray('\n  Launching... (exit the tool to return here)\n'));

  // Some interactive CLIs can freeze when launched inside the same terminal
  // that is used for Inquirer prompts (especially on Windows).
  // Offer launching in a new terminal window/tab.
  let launchMode: 'same' | 'new' = mode || 'same';
  if (!mode && process.platform === 'win32') {
    const { mode: selectedMode } = await inquirer.prompt<{ mode: 'same' | 'new' }>([
      {
        type: 'list',
        name: 'mode',
        message: 'Launch in:',
        choices: [
          { name: 'New terminal window/tab', value: 'new' },
          { name: 'This terminal', value: 'same' },
        ],
        default: 'new',
      },
    ]);
    launchMode = selectedMode;
  }

  if (tool === 'factory-droid') {
    let factoryKey = configManager.getFactoryApiKey() || process.env.FACTORY_API_KEY;
    if (!factoryKey) {
      const { key } = await inquirer.prompt<{ key: string }>([
        {
          type: 'password',
          name: 'key',
          message: 'Factory API Key (FACTORY_API_KEY):',
          mask: '*',
        },
      ]);
      const trimmed = key?.trim();
      if (trimmed) {
        const { save } = await inquirer.prompt<{ save: boolean }>([
          {
            type: 'confirm',
            name: 'save',
            message: 'Save to coder-link config?',
            default: true,
          },
        ]);
        if (save) configManager.setFactoryApiKey(trimmed);
        factoryKey = trimmed;
      }
    }
    if (launchMode === 'new') {
      const ok = runInNewTerminal(start.cmd, start.args, { FACTORY_API_KEY: factoryKey });
      if (!ok) {
        printWarning('Failed to open a new terminal window. Launching here instead.');
        await runInteractiveWithEnv(start.cmd, start.args, { FACTORY_API_KEY: factoryKey });
      }
      return;
    }
    await runInteractiveWithEnv(start.cmd, start.args, { FACTORY_API_KEY: factoryKey });
  } else {
    if (launchMode === 'new') {
      const ok = runInNewTerminal(start.cmd, start.args);
      if (!ok) {
        printWarning('Failed to open a new terminal window. Launching here instead.');
        await runInteractive(start.cmd, start.args);
      }
      return;
    }
    await runInteractive(start.cmd, start.args);
  }
}

// ── Tool Select ────────────────────────────────────────────────────────
async function toolSelectMenu(): Promise<void> {
  while (true) {
    console.clear();
    printHeader('Coding Tools');
    const auth = configManager.getAuth();
    printStatusBar(auth.plan, auth.apiKey);
    printConfigPathHint(configManager.configPath);
    printNavigationHints();

    const tools = toolManager.getSupportedTools();

    // Detect config state for each tool (in parallel)
    const toolStates = await Promise.all(
      tools.map(async (t) => {
        try {
          const d = await toolManager.detectCurrentConfig(t);
          const configured = !!(d.plan && d.apiKey);
          const { cmd } = startCommand(t);
          const installed = commandExists(cmd);
          return { tool: t, configured, installed };
        } catch {
          return { tool: t, configured: false, installed: false };
        }
      })
    );

    const { tool } = await inquirer.prompt<{ tool: string }>([{
      type: 'list',
      name: 'tool',
      message: 'Select tool:',
      choices: [
        ...toolStates.map(s => {
          const status = statusIndicator(s.configured);
          const inst = s.installed ? '' : chalk.yellow(' (not detected)');
          return {
            name: `${status} ${toolLabel(s.tool)}${inst}`,
            value: s.tool,
          };
        }),
        new inquirer.Separator(),
        { name: chalk.gray('← Back'), value: '__back' },
      ],
    }]);

    if (tool === '__back') return;
    await toolMenu(tool);
  }
}

async function diagnosticsMenu(): Promise<void> {
  console.clear();
  printHeader('System Diagnostics');
  const auth = configManager.getAuth();
  const plan = auth.plan as Plan | undefined;
  const apiKey = auth.apiKey;

  console.log(`  ${i18n.t('doctor.config_path', { path: configManager.configPath })}`);
  console.log(`  ${i18n.t('doctor.current_auth')}`);
  if (plan && apiKey) {
    console.log(`    ${i18n.t('doctor.plan')}: ${planLabelColored(plan)}`);
    console.log(`    ${i18n.t('doctor.api_key')}: ${maskApiKey(apiKey)}`);
  } else {
    console.log(`    ${chalk.yellow(i18n.t('doctor.not_set'))}`);
  }

  console.log('\n  ' + i18n.t('doctor.tools_header'));
  const tools = toolManager.getSupportedTools();
  for (const tool of tools) {
     const status = await toolManager.isConfigured(tool);
     console.log(`    ${statusIndicator(status)} ${toolLabel(tool)}`);
  }

  // MCP status
  const { kimiManager } = await import('./lib/kimi-manager.js');
  const mcpInstalled = kimiManager.getInstalledMCPs();
  console.log('\n  ' + i18n.t('doctor.mcp_header'));
  if (mcpInstalled.length === 0) {
    console.log(`    ${chalk.gray(i18n.t('doctor.none'))}`);
  } else {
    for (const id of mcpInstalled) {
      console.log(`    ${chalk.green('●')} ${id}`);
    }
  }

  console.log();
  await pause();
}

async function logsMenu(): Promise<void> {
  const LOG_DIR = join(CONFIG_DIR, 'logs');
  const LOG_FILE = join(LOG_DIR, 'error.log');
  
  while (true) {
    console.clear();
    printHeader('Error Logs');
    
    if (!existsSync(LOG_FILE)) {
      printInfo('No logs found.');
    } else {
      try {
        const logs = readFileSync(LOG_FILE, 'utf-8');
        const lines = logs.split('\n').filter(l => l.trim()).slice(-15);
        if (lines.length === 0) {
          printInfo('Log file is empty.');
        } else {
          console.log(chalk.gray('  Last 15 log entries:\n'));
          lines.forEach(line => {
            if (line.includes('[ERROR]')) {
              console.log(`  ${chalk.red(line)}`);
            } else if (line.includes('[WARN]')) {
              console.log(`  ${chalk.yellow(line)}`);
            } else {
              console.log(`  ${chalk.gray(line)}`);
            }
          });
        }
      } catch (e) {
        printError('Failed to read log file');
      }
    }
    
    console.log();
    const { action } = await inquirer.prompt<{ action: 'clear' | 'back' }>([{
      type: 'list',
      name: 'action',
      message: 'Action:',
      choices: [
        { name: '🗑 Clear Logs', value: 'clear' },
        new inquirer.Separator(),
        { name: chalk.gray('← Back'), value: 'back' }
      ]
    }]);

    if (action === 'back') return;
    
    if (action === 'clear' && existsSync(LOG_FILE)) {
      writeFileSync(LOG_FILE, '', 'utf-8');
      printSuccess('Logs cleared');
      await pause();
    }
  }
}

// ── Main Menu ──────────────────────────────────────────────────────────
export async function runMenu(): Promise<void> {
  i18n.setLang(configManager.getLang());

  // Show splash only on first launch
  console.clear();
  printSplash();
  printConfigPathHint(configManager.configPath);
  await new Promise(r => setTimeout(r, 400)); // brief pause to appreciate it

  while (true) {
    console.clear();
    printSplash();
    const auth = configManager.getAuth();
    printStatusBar(auth.plan, auth.apiKey, auth.plan ? providerSummary(auth.plan as Plan).trim() : undefined);
    printNavigationHints();

    const lastTool = configManager.getLastUsedTool();
    const mainChoices: any[] = [];

    if (lastTool) {
      const { cmd } = startCommand(lastTool);
      const installed = commandExists(cmd);
      if (installed) {
        if (process.platform === 'win32') {
          mainChoices.push({ name: `🚀 Quick Launch: ${toolLabel(lastTool)} (New)`, value: 'quick_new' });
          mainChoices.push({ name: `🚀 Quick Launch: ${toolLabel(lastTool)} (Same)`, value: 'quick_same' });
        } else {
          mainChoices.push({ name: `🚀 Quick Launch: ${toolLabel(lastTool)}`, value: 'quick' });
        }
        mainChoices.push(new inquirer.Separator());
      }
    }

    mainChoices.push(
      { name: '⚡ Provider & API Key', value: 'provider' },
      { name: '🛠 Coding Tools', value: 'tools' },
      { name: '🌐 Language', value: 'lang' },
      new inquirer.Separator(),
      { name: '🔬 System Diagnostics (Doctor)', value: 'doctor' },
      { name: '📋 View Logs', value: 'logs' },
      new inquirer.Separator(),
      { name: chalk.gray('Exit'), value: 'exit' },
    );

    const { op } = await inquirer.prompt<{ op: string }>([{
      type: 'list',
      name: 'op',
      message: 'Main Menu:',
      choices: mainChoices,
    }]);

    if (op === 'exit') {
      console.log(chalk.gray('\n  Goodbye!\n'));
      return;
    }

    try {
      if (op === 'quick') {
        await launchTool(lastTool!);
      } else if (op === 'quick_new') {
        await launchTool(lastTool!, 'new');
      } else if (op === 'quick_same') {
        await launchTool(lastTool!, 'same');
      } else if (op === 'provider') {
        await providerMenu();
      } else if (op === 'tools') {
        await toolSelectMenu();
      } else if (op === 'doctor') {
        await diagnosticsMenu();
      } else if (op === 'logs') {
        await logsMenu();
      } else if (op === 'lang') {
        const { lang } = await inquirer.prompt<{ lang: 'zh_CN' | 'en_US' }>([{
          type: 'list',
          name: 'lang',
          message: 'Select language:',
          choices: [
            { name: '简体中文', value: 'zh_CN' },
            { name: 'English', value: 'en_US' },
          ],
          default: configManager.getLang(),
        }]);
        configManager.setLang(lang);
        i18n.setLang(lang);
        printSuccess(`Language set to ${lang === 'zh_CN' ? '简体中文' : 'English'}`);
        await pause();
      }
    } catch (error) {
      logger.logError('menu.main', error);
      printError(
        error instanceof Error ? error.message : String(error),
        'Run "coder-link doctor" to check system configuration'
      );
      await pause();
    }
  }
}
