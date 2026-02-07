import inquirer from 'inquirer';
import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import { configManager, isKimiLikePlan } from './utils/config.js';
import type { Plan } from './utils/config.js';
import { i18n } from './utils/i18n.js';
import { toolManager } from './lib/tool-manager.js';
import { logger } from './utils/logger.js';
import { BUILTIN_MCP_SERVICES } from './mcp-services.js';
import { commandExists, runInteractive, runInteractiveWithEnv } from './utils/exec.js';
import { testOpenAIChatCompletionsApi, testOpenAICompatibleApi } from './utils/api-test.js';
import { 
  printSplash, 
  printHeader, 
  printStatusBar, 
  printNavigationHints,
  printConfigPathHint,
  planLabel, 
  planLabelColored, 
  maskApiKey, 
  toolLabel, 
  statusIndicator,
  truncateForTerminal,
} from './utils/brand.js';
import { keyboardHandler } from './utils/keyboard.js';
import { printError, printSuccess, printWarning, printInfo } from './utils/output.js';

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
    process.stdin.once('data', (data) => {
      const str = data.toString().trim();
      if (str === 'q' || str === 'Q') {
        console.log(chalk.gray('\n  Goodbye!\n'));
        process.exit(0);
      }
      resolve();
    });
  });
}

// Safe spinner that doesn't overflow terminal width
function createSafeSpinner(text: string): Ora {
  const safeText = truncateForTerminal(text, (process.stdout.columns || 80) - 10);
  return ora({ text: safeText, spinner: 'dots' });
}

// ── Provider Menu ──────────────────────────────────────────────────────
const PROVIDER_CHOICES: Array<{ name: string; value: Plan }> = [
  { name: 'GLM Coding Plan (Global)', value: 'glm_coding_plan_global' },
  { name: 'GLM Coding Plan (China)', value: 'glm_coding_plan_china' },
  { name: 'Kimi (Moonshot)', value: 'kimi' },
  { name: 'OpenRouter', value: 'openrouter' },
  { name: 'NVIDIA NIM', value: 'nvidia' },
];

/**
 * Unified provider configuration flow:
 * 1. Select provider
 * 2. Set endpoint + model (for kimi-like providers)
 * 3. Set API key
 * All in one guided sequence — no separate "Set API key" action.
 */
async function providerSetupFlow(currentPlan?: Plan): Promise<void> {
  // Step 1 — Select provider
  const { plan } = await inquirer.prompt<{ plan: Plan | '__back' }>([{
    type: 'list',
    name: 'plan',
    message: 'Select provider:',
    choices: [
      ...PROVIDER_CHOICES.map(c => ({
        ...c,
        name: c.value === currentPlan ? `${c.name} ${chalk.green('●')}` : c.name,
      })),
      new inquirer.Separator(),
      { name: chalk.gray('← Back (Esc)'), value: '__back' as any },
    ],
    default: currentPlan,
  }]);

  if (plan === '__back') return;

  // Step 2 — Endpoint + Model (kimi-like only)
  if (isKimiLikePlan(plan)) {
    const current = configManager.getProviderSettings(plan);
    const { base_url } = await inquirer.prompt<{ base_url: string }>([{
      type: 'input',
      name: 'base_url',
      message: `${planLabel(plan)} Base URL:`,
      default: current.baseUrl,
      validate: (v: string) => v.trim().length > 0 || 'Base URL cannot be empty',
    }]);

    const { model } = await inquirer.prompt<{ model: string }>([{
      type: 'input',
      name: 'model',
      message: 'Default model ID:',
      default: current.model || '',
      validate: (v: string) => v.trim().length > 0 || 'Model ID cannot be empty',
    }]);

    const defaultCtx = current.maxContextSize || (plan === 'nvidia' ? 4096 : plan === 'openrouter' ? 16384 : 262144);
    const { max_context_size } = await inquirer.prompt<{ max_context_size: number }>([{
      type: 'input',
      name: 'max_context_size',
      message: 'Max context size:',
      default: defaultCtx,
      validate: (v: string) => {
        const n = Number(v);
        return Number.isInteger(n) && n > 0 || 'Enter a positive integer';
      },
      filter: (v: string) => Number(v),
    }]);

    configManager.setProviderProfile(plan, {
      base_url: base_url.trim(),
      model: model.trim(),
      max_context_size: max_context_size,
    });
  }

  // Step 3 — API key
  const existingKey = configManager.getApiKeyFor(plan);
  const keyMsg = existingKey ? `API key for ${planLabel(plan)} [current: ${maskApiKey(existingKey)}]:` : `API key for ${planLabel(plan)}:`;
  const { apiKey } = await inquirer.prompt<{ apiKey: string }>([{
    type: 'password',
    name: 'apiKey',
    message: keyMsg,
    mask: '*',
    validate: (v: string) => {
      // Allow empty to keep existing key
      if (existingKey && v.trim().length === 0) return true;
      return v.trim().length > 0 || 'API key cannot be empty';
    },
  }]);

  const finalKey = apiKey.trim() || (existingKey ?? '');
  configManager.setAuth(plan, finalKey);

  printSuccess(`Provider set to ${planLabel(plan)}`);
  if (isKimiLikePlan(plan)) {
    const s = configManager.getProviderSettings(plan);
    console.log(chalk.gray(`  Endpoint : ${s.baseUrl}`));
    console.log(chalk.gray(`  Model    : ${s.model}`));
  }
  console.log(chalk.gray(`  API Key  : ${maskApiKey(finalKey)}`));
  console.log();
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

    type Action = 'setup' | 'test' | 'revoke' | 'back';
    const choices: Array<{ name: string; value: Action }> = [
      { name: '⚡ Configure Provider (select, endpoint, API key)', value: 'setup' },
    ];

    if (plan && auth.apiKey) {
      choices.push({ name: '🔬 Test API Connection', value: 'test' });
      choices.push({ name: '🗑 Revoke API Key', value: 'revoke' });
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
      if (action === 'setup') {
        await providerSetupFlow(plan);
        await pause();
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
        const service = BUILTIN_MCP_SERVICES.find(s => s.id === id)!;
        await toolManager.installMCP(tool, service, auth.apiKey, auth.plan);
        printSuccess(`Installed ${id}`);
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
    const isInSync = hasProvider && (toolPlan ?? '') === chelperPlan && (toolKey ?? '') === chelperKey;
    const isConfigured = !!(toolPlan && toolKey);

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

    // Sync indicator
    if (hasProvider && !isInSync) {
      printWarning('Tool config is out of sync — refresh recommended', 'Select "Refresh Configuration" to sync');
      console.log();
    } else if (isInSync) {
      printSuccess('Config in sync');
      console.log();
    }

    // Warning
    printInfo('Changes modify the tool\'s global configuration.');
    console.log();
    printNavigationHints();

    // Build dynamic choices
    type ToolAction = 'refresh' | 'unload' | 'mcp' | 'start' | '__back';
    const choices: Array<{ name: string; value: ToolAction } | inquirer.Separator> = [];

    if (hasProvider && !isInSync) {
      choices.push({ name: '🔄 Refresh Configuration (push coder-link → tool)', value: 'refresh' });
    } else if (hasProvider && isInSync) {
      choices.push({ name: chalk.gray('🔄 Refresh Configuration (already in sync)'), value: 'refresh' });
    } else {
      choices.push({ name: chalk.yellow('🔄 Refresh Configuration (set provider first)'), value: 'refresh' });
    }

    if (isConfigured) {
      choices.push({ name: '🗑 Unload Configuration (remove from tool)', value: 'unload' });
    }

    choices.push({ name: '🔌 MCP Servers', value: 'mcp' });

    // Start
    const { cmd } = startCommand(tool);
    const installed = commandExists(cmd);
    
    // Show detection status inline
    if (!installed) {
      printWarning(`${toolLabel(tool)} was not detected on PATH`, installHint(tool).command ? `Install: ${installHint(tool).command}` : 'Please install it using the vendor instructions.');
    }
    
    choices.push({ 
      name: installed ? `🚀 Launch ${toolLabel(tool)}` : chalk.yellow(`🚀 Launch ${toolLabel(tool)} (not detected)`), 
      value: 'start',
    });
    
    choices.push(new inquirer.Separator());
    choices.push({ name: chalk.gray('← Back (Esc)'), value: '__back' });

    const { action } = await inquirer.prompt<{ action: ToolAction }>([{
      type: 'list',
      name: 'action',
      message: 'Action:',
      choices,
    }]);

    if (action === '__back') return;

    try {
      if (action === 'refresh') {
        if (!hasProvider) {
          printWarning('Configure a provider first from the main menu.', 'Run "coder-link init" and select "Provider & API Key"');
          await pause();
          continue;
        }
        const spinner = createSafeSpinner('Refreshing configuration...').start();
        try {
          await toolManager.loadConfig(tool, chelperPlan!, chelperKey!);
          spinner.succeed('Configuration refreshed');
        } catch (err) {
          spinner.fail('Failed to refresh configuration');
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

async function launchTool(tool: string): Promise<void> {
  const start = startCommand(tool);

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

  const isInSync = hasProvider && (toolPlan ?? '') === chelperPlan && (toolKey ?? '') === chelperKey;
  const isConfigured = !!(toolPlan && toolKey);

  // Warn if out of sync
  if (hasProvider && !isInSync) {
    console.log();
    printWarning('Configuration is out of sync!');
    console.log(chalk.gray(`  Coder Link: ${chelperPlan || 'Not set'}${chelperModel ? ` (${chelperModel})` : ''}`));
    console.log(chalk.gray(`  ${toolLabel(tool)}: ${toolPlan || 'Not configured'}${toolModel ? ` (${toolModel})` : ''}`));
    console.log();

    const { action } = await inquirer.prompt<{ action: 'launch' | 'refresh' | 'cancel' }>([{
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: '🔄 Refresh config, then launch', value: 'refresh' },
        { name: '🚀 Launch anyway (current tool config)', value: 'launch' },
        { name: chalk.gray('← Cancel'), value: 'cancel' },
      ],
    }]);

    if (action === 'cancel') return;
    if (action === 'refresh') {
      const spinner = createSafeSpinner('Refreshing configuration...').start();
      try {
        await toolManager.loadConfig(tool, chelperPlan!, chelperKey!);
        spinner.succeed('Configuration refreshed');
      } catch (err) {
        spinner.fail('Failed to refresh configuration');
        throw err;
      }
    }
  }

  if (!commandExists(start.cmd)) {
    console.log();
    printWarning(`${toolLabel(tool)} was not detected on PATH.`);
    const { runAnyway } = await inquirer.prompt<{ runAnyway: boolean }>([
      {
        type: 'confirm',
        name: 'runAnyway',
        message: 'Try launching anyway?',
        default: true,
      },
    ]);
    if (!runAnyway) {
      const hint = installHint(tool);
      if (hint.command) {
        console.log(`  Install: ${chalk.cyan(hint.command)}`);
        const { run } = await inquirer.prompt<{ run: boolean }>([
          {
            type: 'confirm',
            name: 'run',
            message: 'Run install command now?',
            default: false,
          },
        ]);
        if (run) await runInteractive(hint.command, []);
      } else {
        console.log('  Please install it using the vendor instructions.');
      }
      await pause();
      return;
    }
  }

  console.log(chalk.gray('\n  Launching... (exit the tool to return here)\n'));

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
    await runInteractiveWithEnv(start.cmd, start.args, { FACTORY_API_KEY: factoryKey });
  } else {
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
        { name: chalk.gray('← Back (Esc)'), value: '__back' },
      ],
    }]);

    if (tool === '__back') return;
    await toolMenu(tool);
  }
}

// ── Main Menu ──────────────────────────────────────────────────────────
export async function runMenu(): Promise<void> {
  i18n.setLang(configManager.getLang());

  // Enable keyboard shortcuts
  keyboardHandler.enable(
    () => {
      console.log(chalk.gray('\n  Goodbye!\n'));
      keyboardHandler.disable();
      process.exit(0);
    },
    () => {
      // Back navigation handled by '__back' choices
    }
  );

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

    const { op } = await inquirer.prompt<{ op: string }>([{
      type: 'list',
      name: 'op',
      message: 'Main Menu:',
      choices: [
        { name: '⚡ Provider & API Key', value: 'provider' },
        { name: '🛠 Coding Tools', value: 'tools' },
        { name: '🌐 Language', value: 'lang' },
        new inquirer.Separator(),
        { name: chalk.gray('Exit (q)'), value: 'exit' },
      ],
    }]);

    if (op === 'exit') {
      console.log(chalk.gray('\n  Goodbye!\n'));
      keyboardHandler.disable();
      return;
    }

    try {
      if (op === 'provider') {
        await providerMenu();
      } else if (op === 'tools') {
        await toolSelectMenu();
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
