import inquirer from 'inquirer';
import chalk from 'chalk';

import { configManager, isKimiLikePlan } from '../utils/config.js';
import type { Plan } from '../utils/config.js';
import { toolManager } from '../lib/tool-manager.js';
import type { ToolName } from '../lib/tool-manager.js';
import { logger } from '../utils/logger.js';
import { PROVIDER_CHOICES, providerProtocolSummary, supportsOpenAIProtocol } from '../utils/providers.js';
import { commandExists, runInteractive, runInteractiveWithEnv, runInNewTerminal } from '../utils/exec.js';
import { printHeader, printStatusBar, printNavigationHints, printConfigPathHint, planLabel, maskApiKey, toolLabel, statusIndicator } from '../utils/brand.js';
import { printError, printSuccess, printWarning, printInfo } from '../utils/output.js';
import { startCommand, installHint, createSafeSpinner, pause, getProviderIncompatibility, selectModelId } from './shared.js';
import { providerSetupFlow } from './provider-menu.js';
import { mcpMenu } from './mcp-menu.js';

async function chooseToolProviderPlan(tool: string): Promise<Plan | '__back'> {
  const enabled = new Set(configManager.getEnabledProviders());
  const visibleProviders = PROVIDER_CHOICES.filter((c) => enabled.has(c.value));
  const providerChoices = visibleProviders.length ? visibleProviders : PROVIDER_CHOICES;

  const { selectedPlan } = await inquirer.prompt<{ selectedPlan: Plan | '__back' }>([
    {
      type: 'list',
      name: 'selectedPlan',
      message: `Select provider for ${toolLabel(tool)}:`,
      choices: [
        ...providerChoices.map((c) => {
          const key = configManager.getApiKeyFor(c.value);
          const status = key ? chalk.green(' ●') : chalk.gray(' (not configured)');
          const incompat = getProviderIncompatibility(tool, c.value);
          const protocolHint = chalk.gray(` [${providerProtocolSummary(c.value)}]`);

          if (incompat) {
            return new inquirer.Separator(`  ${chalk.gray.strikethrough(c.name)}${protocolHint} ${chalk.red(`(${incompat})`)}`);
          }
          return { name: `${c.name}${protocolHint}${status}`, value: c.value };
        }),
        new inquirer.Separator(),
        { name: chalk.gray('← Back'), value: '__back' as const },
      ],
    },
  ]);

  return selectedPlan;
}

async function ensureProviderApiKey(plan: Plan): Promise<string | null> {
  let key = configManager.getApiKeyFor(plan);
  if (key) return key;

  const { setupNow } = await inquirer.prompt<{ setupNow: boolean }>([
    {
      type: 'confirm',
      name: 'setupNow',
      message: `No credentials for ${planLabel(plan)}. Configure now?`,
      default: true,
    },
  ]);
  if (!setupNow) return null;

  await providerSetupFlow(plan);
  key = configManager.getApiKeyFor(plan);
  return key || null;
}

async function applyProviderToTool(tool: string, plan: Plan): Promise<boolean> {
  const capabilities = toolManager.getCapabilities(tool);
  if (!capabilities.supportsProviderConfig) {
    printWarning(`${toolLabel(tool)} does not support managed provider configuration.`);
    return false;
  }

  const key = await ensureProviderApiKey(plan);
  if (!key) return false;

  let modelOverride: string | undefined;
  if (capabilities.supportsModelSelection) {
    const defaultModel = configManager.getProviderSettings(plan).model;
    printInfo(`Select model for ${toolLabel(tool)} (default: ${defaultModel}):`);
    const model = await selectModelId(plan, defaultModel);
    if (model === '__back') return false;

    // OB1 requires a model to be explicitly set
    if (tool === 'ob1' && !model) {
      printWarning('OB1 requires a model to be selected. Please select a model.');
      await pause();
      return false;
    }
    modelOverride = model;
  }

  const spinner = createSafeSpinner(`Applying ${planLabel(plan)} to ${toolLabel(tool)}...`).start();
  try {
    await toolManager.loadConfig(tool, plan, key, modelOverride ? { model: modelOverride } : undefined);
    spinner.succeed(
      modelOverride
        ? `Connected ${toolLabel(tool)} to ${planLabel(plan)} (${modelOverride})`
        : `Connected ${toolLabel(tool)} to ${planLabel(plan)}`
    );
    if (tool === 'factory-droid' && !configManager.getFactoryApiKey() && !process.env.FACTORY_API_KEY) {
      printInfo('Provider is connected. Factory Droid also needs your Factory account API key before launch.');
    }
    return true;
  } catch (err) {
    spinner.fail('Failed to apply configuration');
    throw err;
  }
}

export async function toolMenu(tool: string): Promise<void> {
  const capabilities = toolManager.getCapabilities(tool);

  let first=true;
  while (true) {
    if(first){console.clear();first=false;}
    printHeader(toolLabel(tool));

    const auth = configManager.getAuth();
    const globalPlan = auth.plan;
    const globalKey = auth.apiKey;

    let globalModel: string | undefined;
    if (globalPlan && isKimiLikePlan(globalPlan)) {
      globalModel = configManager.getProviderSettings(globalPlan).model;
    }

    let toolPlan: string | null = null;
    let toolKey: string | null = null;
    let toolModel: string | undefined;
    if (capabilities.supportsProviderConfig) {
      try {
        const detected = await toolManager.detectCurrentConfig(tool);
        toolPlan = detected.plan;
        toolKey = detected.apiKey;
        toolModel = detected.model;
      } catch {
        // ignore
      }
    }

    const hasGlobalProvider = !!(globalPlan && globalKey);
    const isConfigured = capabilities.supportsProviderConfig && !!(toolPlan && toolKey);
    const matchesGlobal = hasGlobalProvider && isConfigured && (toolPlan ?? '') === globalPlan;

    console.log(chalk.gray('  Coder Link'));
    printStatusBar(globalPlan, globalKey, globalModel ? chalk.gray(`Model: ${globalModel}`) : undefined);
    console.log(chalk.gray(`  ${toolLabel(tool)}`));

    if (capabilities.supportsProviderConfig) {
      printStatusBar(toolPlan ?? undefined, toolKey ?? undefined, toolModel ? chalk.gray(`Model: ${toolModel}`) : undefined);
    } else {
      printInfo('Launch-only integration (this tool manages provider settings itself).');
      console.log();
    }

    if (tool === 'factory-droid') {
      const factoryKey = configManager.getFactoryApiKey() || process.env.FACTORY_API_KEY;
      console.log(`  ${chalk.gray('Factory Account API Key:')} ${factoryKey ? chalk.green(maskApiKey(factoryKey)) : chalk.yellow('Not set')}`);
      console.log(chalk.gray('  Note: this is separate from your model provider key and is required to launch Droid.'));
      console.log();
    }

    if (tool === 'ob1') {
      const ob1Url = configManager.getOb1ApiUrl();
      const ob1Key = configManager.getOb1ApiKey();
      console.log(`  ${chalk.gray('OPENROUTER_API_URL:')} ${ob1Url ? chalk.green(ob1Url) : chalk.yellow('Not set')}`);
      console.log(`  ${chalk.gray('OPENROUTER_API_KEY:')} ${ob1Key ? chalk.green(maskApiKey(ob1Key)) : chalk.yellow('Not set')}`);
      console.log();
    }

    if (!capabilities.supportsProviderConfig) {
      printInfo('Use launch options below. Provider sync is unavailable for this tool.');
      console.log();
    } else if (isConfigured) {
      if (matchesGlobal) {
        printSuccess('Using default provider');
      } else {
        printInfo('Using tool-specific provider (different from default)');
      }
      if (tool === 'factory-droid' && !configManager.getFactoryApiKey() && !process.env.FACTORY_API_KEY) {
        printWarning('Droid launch still needs a Factory account API key.', 'Use “Configure Factory Account API Key” below.');
      }
      console.log();
    } else if (hasGlobalProvider) {
      printInfo('Tool is not configured yet. You can use default provider or set one manually.');
      console.log();
    }

    if (capabilities.supportsProviderConfig) {
      printInfo("These actions modify the tool's own config file.");
    } else {
      printInfo('No tool config changes will be written by coder-link for this tool.');
    }
    console.log();
    printNavigationHints();

    type ToolAction = 'sync_global' | 'switch_profile' | 'change_model' | 'factory_key' | 'unload' | 'mcp' | 'start' | 'start_new' | 'start_same' | '__back';
    const choices: Array<{ name: string; value: ToolAction } | inquirer.Separator> = [];

    const lastTool = configManager.getLastUsedTool();
    const { cmd } = startCommand(tool);
    const installed = commandExists(cmd);

    if (lastTool === tool && installed) {
      if (process.platform === 'win32') {
        choices.push({ name: `🚀 Quick Launch ${toolLabel(tool)} (This Terminal)`, value: 'start_same' });
      } else {
        choices.push({ name: `🚀 Quick Launch ${toolLabel(tool)}`, value: 'start' });
      }
      choices.push(new inquirer.Separator());
    }

    if (capabilities.supportsProviderConfig && hasGlobalProvider) {
      const globalIncompat = getProviderIncompatibility(tool, globalPlan as Plan);
      if (globalIncompat) {
        choices.push({
          name: chalk.gray(`🌐 Use Default Provider (${planLabel(globalPlan as Plan)}) ${chalk.red(`— ${globalIncompat}`)}`),
          value: 'sync_global',
        });
      } else if (matchesGlobal) {
        choices.push({
          name: chalk.gray(`🌐 Use Default Provider (${planLabel(globalPlan as Plan)}) ✓`),
          value: 'sync_global',
        });
      } else {
        choices.push({
          name: `🌐 Use Default Provider (${planLabel(globalPlan as Plan)})`,
          value: 'sync_global',
        });
      }
    }

    if (capabilities.supportsProviderConfig) {
      choices.push({ name: '🔌 Set Provider for This Tool', value: 'switch_profile' });
    }

    if (capabilities.supportsProviderConfig && capabilities.supportsModelSelection && isConfigured && toolPlan) {
      choices.push({ name: '🧪 Change Model ID', value: 'change_model' });
    }

    if (tool === 'factory-droid') {
      choices.push({ name: '🔑 Configure Factory Account API Key', value: 'factory_key' });
    }

    if (capabilities.supportsProviderConfig && isConfigured) {
      choices.push({ name: '🗑 Disconnect Provider from This Tool', value: 'unload' });
    }

    if (capabilities.supportsProviderConfig || capabilities.supportsMcp) {
      choices.push(new inquirer.Separator());
    }
    if (capabilities.supportsMcp) {
      choices.push({ name: '🔌 MCP Servers', value: 'mcp' });
    }

    if (!installed) {
      printWarning(
        `${toolLabel(tool)} was not detected on PATH`,
        installHint(tool).command ? `Install: ${installHint(tool).command}` : 'Please install it using vendor instructions.'
      );
    }

    if (lastTool !== tool || !installed) {
      choices.push(new inquirer.Separator());
      if (process.platform === 'win32') {
        choices.push({
          name: installed
            ? `🚀 Launch ${toolLabel(tool)} (New Window)`
            : chalk.yellow(`🚀 Launch ${toolLabel(tool)} (New Window - not detected)`),
          value: 'start_new',
        });
        choices.push({
          name: installed
            ? `🚀 Launch ${toolLabel(tool)} (This Terminal)`
            : chalk.yellow(`🚀 Launch ${toolLabel(tool)} (This Terminal - not detected)`),
          value: 'start_same',
        });
      } else {
        choices.push({
          name: installed ? `🚀 Launch ${toolLabel(tool)}` : chalk.yellow(`🚀 Launch ${toolLabel(tool)} (not detected)`),
          value: 'start',
        });
      }
    }

    choices.push(new inquirer.Separator());
    choices.push({ name: chalk.gray('← Back'), value: '__back' });

    const { action } = await inquirer.prompt<{ action: ToolAction }>([
      {
        type: 'list',
        name: 'action',
        message: 'Action:',
        choices,
      },
    ]);

    if (action === '__back') return;

    try {
      if (action === 'switch_profile') {
        const selectedPlan = await chooseToolProviderPlan(tool);
        if (selectedPlan === '__back') continue;
        const applied = await applyProviderToTool(tool, selectedPlan);
        if (applied) await pause();
      } else if (action === 'sync_global') {
        if (!hasGlobalProvider) {
          printWarning('Set a default provider first from Provider Setup.');
          await pause();
          continue;
        }
        const globalIncompat = getProviderIncompatibility(tool, globalPlan as Plan);
        if (globalIncompat) {
          printWarning(`${toolLabel(tool)} cannot use ${planLabel(globalPlan as Plan)}.`, globalIncompat);
          await pause();
          continue;
        }

        // OB1 requires a model to be specified
        if (tool === 'ob1' && !globalModel) {
          printWarning('OB1 requires a model to be configured in provider settings.');
          printInfo('Please set a default model in Provider Setup first.');
          await pause();
          continue;
        }

        const spinner = createSafeSpinner(`Applying ${planLabel(globalPlan!)} to ${toolLabel(tool)}...`).start();
        try {
          await toolManager.loadConfig(tool, globalPlan!, globalKey!, globalModel ? { model: globalModel } : undefined);
          spinner.succeed(`Now using ${planLabel(globalPlan!)}`);
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
      } else if (action === 'factory_key') {
        const existing = configManager.getFactoryApiKey() || process.env.FACTORY_API_KEY;
        const { key } = await inquirer.prompt<{ key: string }>([
          {
            type: 'password',
            name: 'key',
            message: existing ? `Factory Account API Key [current: ${maskApiKey(existing)}]:` : 'Factory Account API Key:',
            mask: '*',
          },
        ]);
        const trimmed = key.trim();
        if (trimmed) {
          configManager.setFactoryApiKey(trimmed);
          printSuccess('Factory account API key saved');
        } else if (existing) {
          printInfo('Kept existing Factory account API key');
        } else {
          printWarning('Factory account API key was not saved. Droid may not launch without it.');
        }
        await pause();
      } else if (action === 'unload') {
        const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
          {
            type: 'confirm',
            name: 'confirm',
            message: chalk.yellow(`Disconnect provider from ${toolLabel(tool)}?`),
            default: false,
          },
        ]);
        if (!confirm) {
          printInfo('Cancelled');
          await pause();
          continue;
        }
        const spinner = createSafeSpinner('Disconnecting provider...').start();
        await toolManager.unloadConfig(tool);
        spinner.succeed('Provider disconnected');
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
      printError(error instanceof Error ? error.message : String(error), 'Check "coder-link doctor" for configuration status');
      await pause();
    }
  }
}

async function launchInTerminal(
  start: { cmd: string; args: string[] },
  launchMode: 'same' | 'new',
  env?: Record<string, string>
): Promise<void> {
  if (launchMode === 'new') {
    const ok = runInNewTerminal(start.cmd, start.args, env);
    if (!ok) {
      printWarning('Failed to open a new terminal window. Launching here instead.');
      env ? await runInteractiveWithEnv(start.cmd, start.args, env) : await runInteractive(start.cmd, start.args);
    }
    return;
  }
  env ? await runInteractiveWithEnv(start.cmd, start.args, env) : await runInteractive(start.cmd, start.args);
}

async function launchTool(tool: string, mode?: 'same' | 'new'): Promise<void> {
  const capabilities = toolManager.getCapabilities(tool);
  const start = startCommand(tool);
  configManager.setLastUsedTool(tool);

  const auth = configManager.getAuth();
  const globalPlan = auth.plan;
  const globalKey = auth.apiKey;
  const hasGlobalProvider = !!(globalPlan && globalKey);

  let globalModel: string | undefined;
  if (globalPlan && isKimiLikePlan(globalPlan)) {
    globalModel = configManager.getProviderSettings(globalPlan).model;
  }

  let toolPlan: string | null = null;
  let toolKey: string | null = null;
  if (capabilities.supportsProviderConfig) {
    try {
      const detected = await toolManager.detectCurrentConfig(tool);
      toolPlan = detected.plan;
      toolKey = detected.apiKey;
    } catch {
      // ignore
    }
  }

  const isConfigured = capabilities.supportsProviderConfig && !!(toolPlan && toolKey);

  if (capabilities.supportsProviderConfig && !isConfigured && hasGlobalProvider) {
    const globalIncompat = getProviderIncompatibility(tool, globalPlan as Plan);
    console.log();
    printInfo(`${toolLabel(tool)} is not configured yet.`);
    console.log(chalk.gray(`  Default provider: ${globalPlan}${globalModel ? ` (${globalModel})` : ''}`));
    if (globalIncompat) {
      console.log(chalk.yellow(`  Default provider cannot be applied: ${globalIncompat}`));
    }
    console.log();

    const launchChoices: Array<{ name: string; value: 'sync' | 'guided' | 'cancel' }> = [
      ...(!globalIncompat ? [{ name: `🔄 Use default provider (${planLabel(globalPlan!)})`, value: 'sync' as const }] : []),
      { name: '🧭 Set provider now (guided)', value: 'guided' as const },
      { name: chalk.gray('← Cancel launch'), value: 'cancel' as const },
    ];

    const { action } = await inquirer.prompt<{ action: 'sync' | 'guided' | 'cancel' }>([
      {
        type: 'list',
        name: 'action',
        message: 'Before launching:',
        choices: launchChoices,
      },
    ]);

    if (action === 'cancel') return;

    if (action === 'guided') {
      const selectedPlan = await chooseToolProviderPlan(tool);
      if (selectedPlan === '__back') return;
      const applied = await applyProviderToTool(tool, selectedPlan);
      if (!applied) return;
    } else {
      // OB1 requires a model to be specified
      if (tool === 'ob1' && !globalModel) {
        printWarning('OB1 requires a model to be configured in provider settings.');
        printInfo('Using guided setup instead...');
        const selectedPlan = await chooseToolProviderPlan(tool);
        if (selectedPlan === '__back') return;
        const applied = await applyProviderToTool(tool, selectedPlan);
        if (!applied) return;
      } else {
        const spinner = createSafeSpinner(`Configuring with ${planLabel(globalPlan!)}...`).start();
        try {
          await toolManager.loadConfig(tool, globalPlan!, globalKey!, globalModel ? { model: globalModel } : undefined);
          spinner.succeed('Configuration applied');
        } catch (err) {
          spinner.fail('Failed to apply configuration');
          throw err;
        }
      }
    }
  }

  if (!commandExists(start.cmd)) {
    console.log();
    printWarning(`${toolLabel(tool)} was not detected on PATH.`);
    const hint = installHint(tool);

    const choices: Array<{ name: string; value: 'anyway' | 'install' | 'cancel' }> = [{ name: '🚀 Try launching anyway', value: 'anyway' }];
    if (hint.command) choices.push({ name: `🛠 Attempt to Install (${hint.label})`, value: 'install' });
    choices.push({ name: chalk.gray('← Cancel'), value: 'cancel' });

    const { failAction } = await inquirer.prompt<{ failAction: 'anyway' | 'install' | 'cancel' }>([
      {
        type: 'list',
        name: 'failAction',
        message: 'Tool not found. What do you want to do?',
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

  if (tool === 'codex') {
    const plan = (toolPlan as Plan | null) || (globalPlan as Plan | undefined);
    if (!plan) {
      printWarning('Codex launch requires a configured provider first.');
      printInfo('Use "Set Provider for This Tool" or choose a default provider.');
      await pause();
      return;
    }
    if (!supportsOpenAIProtocol(plan)) {
      printWarning(`${planLabel(plan)} is not OpenAI-compatible, so it cannot be used with Codex.`);
      await pause();
      return;
    }

    let apiKey = (toolKey && toolKey.trim()) || configManager.getApiKeyFor(plan) || process.env.OPENAI_API_KEY?.trim() || '';
    if (!apiKey) {
      apiKey = (await ensureProviderApiKey(plan)) || '';
    }
    if (!apiKey && plan === 'lmstudio') {
      apiKey = 'lmstudio';
    }
    if (!apiKey) {
      printWarning(`No API key configured for ${planLabel(plan)}.`);
      await pause();
      return;
    }

    await launchInTerminal(start, launchMode, { OPENAI_API_KEY: apiKey });
    return;
  }

  if (tool === 'factory-droid') {
    let factoryKey = configManager.getFactoryApiKey() || process.env.FACTORY_API_KEY;
    if (!factoryKey) {
      printWarning(
        'Factory Droid needs a Factory account API key to launch.',
        'This is separate from your Xiaomi/provider API key, which is already used for model configuration.'
      );
      const { key } = await inquirer.prompt<{ key: string }>([
        {
          type: 'password',
          name: 'key',
          message: 'Factory Account API Key (FACTORY_API_KEY):',
          mask: '*',
        },
      ]);
      const trimmed = key?.trim();
      if (trimmed) {
        const { save } = await inquirer.prompt<{ save: boolean }>([
          { type: 'confirm', name: 'save', message: 'Save to coder-link config?', default: true },
        ]);
        if (save) configManager.setFactoryApiKey(trimmed);
        factoryKey = trimmed;
      }
    }

    if (factoryKey) {
      await launchInTerminal(start, launchMode, { FACTORY_API_KEY: factoryKey });
    }
    return;
  }

  if (tool === 'ob1') {
    let ob1ApiUrl = configManager.getOb1ApiUrl() || process.env.OPENROUTER_API_URL;
    let ob1ApiKey = configManager.getOb1ApiKey() || process.env.OPENROUTER_API_KEY;

    if (!ob1ApiUrl || !ob1ApiKey) {
      printInfo('OB1 requires OPENROUTER_API_URL and OPENROUTER_API_KEY.');
      if (!ob1ApiUrl) {
        const { url } = await inquirer.prompt<{ url: string }>([
          {
            type: 'input',
            name: 'url',
            message: 'OPENROUTER_API_URL:',
            default: 'https://api.z.ai/api/coding/paas/v4',
          },
        ]);
        ob1ApiUrl = url?.trim() || '';
      }
      if (!ob1ApiKey) {
        const { key } = await inquirer.prompt<{ key: string }>([
          {
            type: 'password',
            name: 'key',
            message: 'OPENROUTER_API_KEY:',
            mask: '*',
          },
        ]);
        ob1ApiKey = key?.trim() || '';
      }

      if (ob1ApiUrl || ob1ApiKey) {
        const { save } = await inquirer.prompt<{ save: boolean }>([
          { type: 'confirm', name: 'save', message: 'Save to coder-link config?', default: true },
        ]);
        if (save) configManager.setOb1Env(ob1ApiUrl, ob1ApiKey);
      }
    }

    const ob1Env: Record<string, string> = {};
    if (ob1ApiUrl) ob1Env.OPENROUTER_API_URL = ob1ApiUrl;
    if (ob1ApiKey) ob1Env.OPENROUTER_API_KEY = ob1ApiKey;

    await launchInTerminal(start, launchMode, ob1Env);
    return;
  }

  await launchInTerminal(start, launchMode);
}

async function manageToolAvailability(): Promise<void> {
  const allTools = toolManager.getSupportedTools();
  const enabled = new Set(configManager.getEnabledTools());

  const { selected } = await inquirer.prompt<{ selected: ToolName[] }>([
    {
      type: 'checkbox',
      name: 'selected',
      message: 'Choose which tools are visible in menus:',
      choices: allTools.map((tool) => ({
        name: toolLabel(tool),
        value: tool,
        checked: enabled.has(tool),
      })),
      validate: (values: ToolName[]) => values.length > 0 || 'Select at least one tool',
    },
  ]);

  configManager.setEnabledTools(selected);
  const lastUsed = configManager.getLastUsedTool();
  if (lastUsed && !selected.includes(lastUsed as ToolName)) {
    configManager.setLastUsedTool(selected[0]);
  }

  printSuccess(`Visible tools updated (${selected.length}/${allTools.length}).`);
  await pause();
}

export async function toolSelectMenu(): Promise<void> {
  let first=true;
  while (true) {
    if(first){console.clear();first=false;}
    printHeader('Coding Tools');
    const auth = configManager.getAuth();
    printStatusBar(auth.plan, auth.apiKey);
    printConfigPathHint(configManager.configPath);
    printNavigationHints();

    const allTools = toolManager.getSupportedTools();
    const enabledTools = new Set(configManager.getEnabledTools());
    const tools = allTools.filter((t) => enabledTools.has(t));
    const visibleTools = tools.length ? tools : allTools;

    const toolStates = await Promise.all(
      visibleTools.map(async (t) => {
        const capabilities = toolManager.getCapabilities(t);
        try {
          const d = capabilities.supportsProviderConfig
            ? await toolManager.detectCurrentConfig(t)
            : { plan: null, apiKey: null };
          const configured = capabilities.supportsProviderConfig && !!(d.plan && d.apiKey);
          const { cmd } = startCommand(t);
          const installed = commandExists(cmd);
          return { tool: t, configured, installed, capabilities };
        } catch {
          return { tool: t, configured: false, installed: false, capabilities };
        }
      })
    );

    const { tool } = await inquirer.prompt<{ tool: string }>([
      {
        type: 'list',
        name: 'tool',
        message: 'Select tool:',
        choices: [
          { name: '⚙ Manage Visible Tools', value: '__manage_tools' },
          new inquirer.Separator(),
          ...toolStates.map((s) => {
            const status = s.capabilities.supportsProviderConfig ? statusIndicator(s.configured) : chalk.gray('○');
            const installHintText = s.installed ? '' : chalk.yellow(' (not detected)');
            const modeHint = s.capabilities.supportsProviderConfig ? '' : chalk.gray(' (launch only)');
            return {
              name: `${status} ${toolLabel(s.tool)}${installHintText}${modeHint}`,
              value: s.tool,
            };
          }),
          new inquirer.Separator(),
          { name: chalk.gray('← Back'), value: '__back' },
        ],
      },
    ]);

    if (tool === '__back') return;
    if (tool === '__manage_tools') {
      await manageToolAvailability();
      continue;
    }
    await toolMenu(tool);
  }
}

