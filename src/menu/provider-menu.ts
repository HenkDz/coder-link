import inquirer from 'inquirer';
import chalk from 'chalk';

import { configManager } from '../utils/config.js';
import type { Plan } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { testAnthropicMessagesApi, testOpenAIChatCompletionsApi, testOpenAICompatibleApi, fetchOpenRouterModelInfo } from '../utils/api-test.js';
import { printHeader, printStatusBar, printNavigationHints, printConfigPathHint, planLabel, maskApiKey } from '../utils/brand.js';
import { printError, printSuccess, printWarning, printInfo } from '../utils/output.js';
import {
  PROVIDER_CHOICES,
  getDefaultAnthropicModel,
  providerProtocolSummary,
  resolveAnthropicBaseUrl,
  suggestedContextSize,
  supportsAnthropicProtocol,
  supportsOpenAIProtocol,
} from '../utils/providers.js';
import { createSafeSpinner, pause, providerSummary, selectModelId } from './shared.js';
import {
  checkProviderHealth,
  checkLMStudioStatus,
  requiresHealthCheck,
  getConfigurableDefaults,
  getLMStudioDefaultPorts,
} from '../lib/provider-registry.js';

function getPlanApiKey(plan: Plan): string {
  const key = configManager.getApiKeyFor(plan)?.trim() || '';
  if (key) return key;
  // Local providers can run without real auth.
  if (plan === 'lmstudio') return 'lmstudio';
  return '';
}

function formatProviderChoiceName(plan: Plan, options: { includeCurrent?: boolean; currentPlan?: Plan }): string {
  const provider = PROVIDER_CHOICES.find((p) => p.value === plan)!;
  const currentSuffix = options.includeCurrent && options.currentPlan === plan ? ` ${chalk.green('● current')}` : '';
  const protocolHint = chalk.gray(` [${providerProtocolSummary(plan)}]`);
  return `${provider.name}${protocolHint}${currentSuffix}`;
}

function getVisibleProviders(currentPlan?: Plan): Array<{ name: string; value: Plan }> {
  const enabled = new Set(configManager.getEnabledProviders());
  const visible = PROVIDER_CHOICES.filter((c) => enabled.has(c.value));

  if (currentPlan && !visible.some((c) => c.value === currentPlan)) {
    const currentChoice = PROVIDER_CHOICES.find((c) => c.value === currentPlan);
    if (currentChoice) visible.unshift(currentChoice);
  }

  const fallback = visible.length ? visible : PROVIDER_CHOICES;
  return fallback.map((c) => ({ name: c.name, value: c.value }));
}

async function manageProviderAvailability(): Promise<void> {
  const enabled = new Set(configManager.getEnabledProviders());
  const currentPlan = configManager.getAuth().plan as Plan | undefined;

  const { selected } = await inquirer.prompt<{ selected: Plan[] }>([
    {
      type: 'checkbox',
      name: 'selected',
      message: 'Choose which providers are visible in menus:',
      choices: PROVIDER_CHOICES.map((c) => ({
        name: `${c.name} ${chalk.gray(`[${providerProtocolSummary(c.value)}]`)}`,
        value: c.value,
        checked: enabled.has(c.value),
      })),
      validate: (values: Plan[]) => values.length > 0 || 'Select at least one provider',
    },
  ]);

  configManager.setEnabledProviders(selected);

  if (currentPlan && !selected.includes(currentPlan)) {
    const fallback = selected[0];
    const fallbackKey = getPlanApiKey(fallback);
    configManager.setAuth(fallback, fallbackKey || '');
    printInfo(`Default provider switched to ${planLabel(fallback)} because the previous provider was hidden.`);
  }

  printSuccess(`Visible providers updated (${selected.length}/${PROVIDER_CHOICES.length}).`);
}

async function configureProfilesMenu(): Promise<void> {
  while (true) {
    console.clear();
    printHeader('Configure Profiles');
    printNavigationHints();

    const { plan } = await inquirer.prompt<{ plan: Plan | '__back' }>([
      {
        type: 'list',
        name: 'plan',
        message: 'Choose provider profile:',
        choices: [
          ...getVisibleProviders().map((c) => {
            const key = configManager.getApiKeyFor(c.value);
            const status = key ? chalk.green(' (Configured)') : chalk.gray(' (Not set)');
            return { name: `${formatProviderChoiceName(c.value, {})}${status}`, value: c.value };
          }),
          new inquirer.Separator(),
          { name: chalk.gray('← Back'), value: '__back' as const },
        ],
      },
    ]);

    if (plan === '__back') return;
    await providerSetupFlow(plan);
    console.log();
    await pause();
  }
}

/**
 * Perform health check for providers that require it (Recommendation #1)
 * Returns true if the provider is healthy or doesn't require health check
 */
async function performProviderHealthCheck(
  plan: Plan,
  baseUrl?: string
): Promise<{ healthy: boolean; url?: string; message?: string }> {
  if (!requiresHealthCheck(plan)) {
    return { healthy: true };
  }

  const spinner = createSafeSpinner(`Checking ${planLabel(plan)} server availability...`).start();

  try {
    // For LM Studio, use the detailed status check
    if (plan === 'lmstudio') {
      const status = await checkLMStudioStatus(baseUrl, { timeoutMs: 5000 });
      
      if (!status.reachable) {
        const defaultPorts = getLMStudioDefaultPorts();
        spinner.fail(`${planLabel(plan)} server is not reachable`);
        return {
          healthy: false,
          message: `Could not connect to LM Studio. Make sure it's running on port ${defaultPorts.join(' or ')}.`,
        };
      }

      if (!status.modelLoaded) {
        spinner.warn(`${planLabel(plan)} server is running but no model is loaded`);
        console.log(chalk.gray(`  Connected to: ${status.actualUrl}`));
        return {
          healthy: true,
          url: status.actualUrl,
          message: 'LM Studio is running but no model is loaded. Load a model in LM Studio before making API calls.',
        };
      }

      spinner.succeed(`${planLabel(plan)} server is running with model: ${status.modelId}`);
      console.log(chalk.gray(`  Connected to: ${status.actualUrl}`));
      return { healthy: true, url: status.actualUrl };
    }

    // Generic health check for other providers
    const result = await checkProviderHealth(plan, { baseUrl, timeoutMs: 5000 });
    
    if (!result.reachable) {
      spinner.fail(`${planLabel(plan)} server is not reachable`);
      return { healthy: false, message: result.error || 'Could not connect to server.' };
    }

    spinner.succeed(`${planLabel(plan)} server is reachable`);
    return { healthy: true, url: result.url };
  } catch (error) {
    spinner.fail(`Health check failed for ${planLabel(plan)}`);
    const message = error instanceof Error ? error.message : 'Unknown error during health check';
    return { healthy: false, message };
  }
}

export async function providerSetupFlow(plan: Plan): Promise<void> {
  printInfo(`Configuring ${planLabel(plan)} profile...`);
  printInfo(`Protocols: ${providerProtocolSummary(plan)}`);
  
  // Display provider-specific hints
  if (plan === 'lmstudio') {
    const defaults = getConfigurableDefaults(plan);
    if (defaults?.defaultPorts) {
      printInfo(`Default ports: ${defaults.defaultPorts.join(', ')}`);
    }
    printInfo('Make sure LM Studio is running with a model loaded before testing.');
  } else if (plan === 'alibaba') {
    printInfo('Alibaba Coding Plan uses plan-specific key (sk-sp-*) and coding-intl endpoints.');
  } else if (plan === 'alibaba_api') {
    printInfo('Alibaba API (Singapore) supports OpenAI + Anthropic protocols.');
    printInfo('Defaults: /compatible-mode/v1 (OpenAI) and /apps/anthropic (Anthropic).');
  }
  
  console.log(chalk.gray("  (Tip: choose Quick Setup for most users)"));
  console.log(chalk.gray("  (Enter 'b' at text prompts to go back)\n"));

  // Perform health check for local providers (Recommendation #1)
  if (requiresHealthCheck(plan)) {
    const currentSettings = configManager.getProviderSettings(plan);
    const healthResult = await performProviderHealthCheck(plan, currentSettings.baseUrl);
    
    if (!healthResult.healthy) {
      printWarning(
        `Cannot proceed with ${planLabel(plan)} setup.`,
        healthResult.message || 'Server is not reachable.'
      );
      
      const { continueAnyway } = await inquirer.prompt<{ continueAnyway: boolean }>([
        {
          type: 'confirm',
          name: 'continueAnyway',
          message: 'Continue with configuration anyway?',
          default: false,
        },
      ]);
      
      if (!continueAnyway) {
        printInfo('Configuration cancelled. Please start the server and try again.');
        return;
      }
    } else if (healthResult.message) {
      // Health check passed with a warning
      printWarning(healthResult.message);
    }
    
    console.log();
  }

  const current = configManager.getProviderSettings(plan);
  const { setupMode } = await inquirer.prompt<{ setupMode: 'quick' | 'advanced' | '__back' }>([
    {
      type: 'list',
      name: 'setupMode',
      message: 'Setup mode:',
      choices: [
        { name: 'Quick Setup (use current recommended endpoint/model)', value: 'quick' },
        { name: 'Advanced Setup (edit endpoint/model/context)', value: 'advanced' },
        new inquirer.Separator(),
        { name: chalk.gray('← Back'), value: '__back' as const },
      ],
    },
  ]);

  if (setupMode === '__back') return;

  let openAiBaseUrl = current.baseUrl;
  let openAiModel = current.model || '';
  let maxContextSize = current.maxContextSize || suggestedContextSize(plan);

  let anthropicBaseUrl = current.anthropicBaseUrl || resolveAnthropicBaseUrl(plan, openAiBaseUrl) || '';
  let anthropicModel = current.anthropicModel || current.model || getDefaultAnthropicModel(plan) || '';

  if (setupMode === 'advanced') {
    const { base_url } = await inquirer.prompt<{ base_url: string }>([
      {
        type: 'input',
        name: 'base_url',
        message: `${planLabel(plan)} OpenAI-compatible Base URL:`,
        default: openAiBaseUrl,
        validate: (v: string) => v.trim().length > 0 || 'Base URL cannot be empty',
      },
    ]);

    if (base_url.trim().toLowerCase() === 'b') {
      printInfo('Configuration cancelled');
      return;
    }
    openAiBaseUrl = base_url.trim();

    const selectedModel = await selectModelId(plan, openAiModel);
    if (selectedModel === '__back') return providerSetupFlow(plan);
    openAiModel = selectedModel.trim();

    let fetchedContextInfo = '';
    if (plan === 'openrouter') {
      const existingKey = configManager.getApiKeyFor(plan);
      if (existingKey) {
        const spinner = createSafeSpinner('Fetching model info from OpenRouter...').start();
        try {
          const modelInfo = await fetchOpenRouterModelInfo({
            apiKey: existingKey,
            modelId: openAiModel,
            timeoutMs: 8000,
          });
          if (modelInfo?.contextLength) {
            maxContextSize = modelInfo.contextLength;
            fetchedContextInfo = chalk.green(` (fetched: ${modelInfo.contextLength.toLocaleString()})`);
            spinner.succeed(`Found model: ${modelInfo.name || modelInfo.id}`);
          } else {
            spinner.fail('Could not fetch context size from OpenRouter');
          }
        } catch {
          spinner.fail('Failed to fetch model info from OpenRouter');
        }
      }
    }

    const { max_context_size_input } = await inquirer.prompt<{ max_context_size_input: string }>([
      {
        type: 'input',
        name: 'max_context_size_input',
        message: `Max context size${fetchedContextInfo}:`,
        default: String(maxContextSize),
        validate: (v: string) => {
          if (v.trim().toLowerCase() === 'b') return true;
          const n = Number(v);
          return (Number.isInteger(n) && n > 0) || 'Enter a positive integer';
        },
      },
    ]);

    if (max_context_size_input.trim().toLowerCase() === 'b') return providerSetupFlow(plan);
    maxContextSize = Number(max_context_size_input);
  } else {
    printInfo(`Using OpenAI-compatible endpoint: ${openAiBaseUrl}`);
    printInfo(`Using OpenAI-compatible model: ${openAiModel}`);
  }

  if (supportsAnthropicProtocol(plan)) {
    const inferredAnthropicBase = resolveAnthropicBaseUrl(plan, openAiBaseUrl) || anthropicBaseUrl;

    if (setupMode === 'advanced') {
      printInfo('Anthropic-compatible settings are used by Claude Code.');
      const { anthropic_base_url } = await inquirer.prompt<{ anthropic_base_url: string }>([
        {
          type: 'input',
          name: 'anthropic_base_url',
          message: `${planLabel(plan)} Anthropic-compatible Base URL (Claude Code):`,
          default: anthropicBaseUrl || inferredAnthropicBase,
          validate: (v: string) => v.trim().length > 0 || 'Base URL cannot be empty',
        },
      ]);
      if (anthropic_base_url.trim().toLowerCase() === 'b') return providerSetupFlow(plan);
      anthropicBaseUrl = anthropic_base_url.trim();

      const selectedAnthropicModel = await selectModelId(
        plan,
        anthropicModel || openAiModel || getDefaultAnthropicModel(plan)
      );
      if (selectedAnthropicModel === '__back') return providerSetupFlow(plan);
      anthropicModel = selectedAnthropicModel.trim();
    } else {
      anthropicBaseUrl = anthropicBaseUrl || inferredAnthropicBase;
      anthropicModel = anthropicModel || openAiModel || getDefaultAnthropicModel(plan) || '';
      if (anthropicBaseUrl) printInfo(`Auto-derived Claude Code endpoint: ${anthropicBaseUrl}`);
      if (anthropicModel) printInfo(`Claude Code model: ${anthropicModel}`);
    }
  }

  const profile: {
    base_url?: string;
    model?: string;
    max_context_size?: number;
    anthropic_base_url?: string;
    anthropic_model?: string;
  } = {
    base_url: openAiBaseUrl,
    model: openAiModel,
    max_context_size: maxContextSize,
  };

  if (supportsAnthropicProtocol(plan)) {
    if (anthropicBaseUrl) profile.anthropic_base_url = anthropicBaseUrl;
    if (anthropicModel) profile.anthropic_model = anthropicModel;
  }

  configManager.setProviderProfile(plan, profile);

  const existingKey = configManager.getApiKeyFor(plan);
  const isLocalProvider = plan === 'lmstudio';
  const keyMsg = existingKey
    ? `API key for ${planLabel(plan)} [current: ${maskApiKey(existingKey)}]${isLocalProvider ? ' [optional]' : ''}:`
    : `API key for ${planLabel(plan)}${isLocalProvider ? ' [optional]' : ''}:`;

  const { apiKey } = await inquirer.prompt<{ apiKey: string }>([
    {
      type: 'password',
      name: 'apiKey',
      message: keyMsg,
      mask: '*',
      validate: (v: string) => {
        if (v.trim().toLowerCase() === 'b') return true;
        if (existingKey && v.trim().length === 0) return true;
        if (isLocalProvider && v.trim().length === 0) return true;
        return v.trim().length > 0 || 'API key cannot be empty';
      },
    },
  ]);

  if (apiKey.trim().toLowerCase() === 'b') return providerSetupFlow(plan);
  const finalKey = apiKey.trim() || (existingKey ?? (isLocalProvider ? 'lmstudio' : ''));

  if (plan === 'alibaba' && finalKey.startsWith('sk-sp-')) {
    openAiBaseUrl = 'https://coding-intl.dashscope.aliyuncs.com/v1';
    openAiModel = 'qwen3-coder-plus';
    anthropicBaseUrl = 'https://coding-intl.dashscope.aliyuncs.com/apps/anthropic';
    anthropicModel = 'qwen3-coder-plus';
    configManager.setProviderProfile(plan, {
      base_url: openAiBaseUrl,
      model: openAiModel,
      max_context_size: maxContextSize,
      anthropic_base_url: anthropicBaseUrl,
      anthropic_model: anthropicModel,
    });
    printInfo('Detected Alibaba Coding Plan key (sk-sp-*). Applied Coding Plan endpoints automatically.');
  }
  if (plan === 'alibaba_api') {
    if (finalKey.startsWith('sk-sp-')) {
      printWarning(
        'Detected a Coding Plan key (sk-sp-*) under Alibaba API profile.',
        'Use "Alibaba Coding Plan (Monthly)" profile for best compatibility.'
      );
    }
    if (!openAiBaseUrl || !openAiBaseUrl.includes('dashscope-intl.aliyuncs.com')) {
      openAiBaseUrl = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
      configManager.setProviderProfile(plan, {
        base_url: openAiBaseUrl,
        model: openAiModel || 'qwen3-max-2026-01-23',
        max_context_size: maxContextSize,
      });
      printInfo('Applied Alibaba API Singapore endpoint as default.');
    }
  }

  configManager.setApiKeyFor(plan, finalKey);

  printSuccess(`${planLabel(plan)} profile updated`);
  const s = configManager.getProviderSettings(plan);
  console.log(chalk.gray(`  OpenAI Endpoint   : ${s.baseUrl}`));
  console.log(chalk.gray(`  OpenAI Model      : ${s.model}`));
  if (supportsAnthropicProtocol(plan)) {
    if (s.anthropicBaseUrl) console.log(chalk.gray(`  Anthropic Endpoint: ${s.anthropicBaseUrl}`));
    if (s.anthropicModel) console.log(chalk.gray(`  Anthropic Model   : ${s.anthropicModel}`));
  }
  console.log(chalk.gray(`  API Key           : ${maskApiKey(finalKey)}`));
}

async function testOpenAiProtocol(plan: Plan): Promise<void> {
  if (!supportsOpenAIProtocol(plan)) {
    printWarning(`${planLabel(plan)} does not provide an OpenAI-compatible API.`);
    return;
  }

  const apiKey = getPlanApiKey(plan);
  if (!apiKey) {
    printWarning(`No API key saved for ${planLabel(plan)}. Configure it first.`);
    return;
  }

  const settings = configManager.getProviderSettings(plan);
  const baseUrl = settings.baseUrl;
  const model = settings.model || '';
  const timeoutMs = 12000;
  const isNvidia = plan === 'nvidia' || baseUrl.includes('integrate.api.nvidia.com');

  if (plan === 'alibaba' && apiKey.startsWith('sk-sp-') && !baseUrl.includes('coding-intl.dashscope.aliyuncs.com')) {
    printWarning(
      'Alibaba Coding Plan key detected, but OpenAI endpoint is not Coding Plan endpoint.',
      'Recommended: https://coding-intl.dashscope.aliyuncs.com/v1'
    );
  }
  if (plan === 'alibaba_api' && !baseUrl.includes('dashscope-intl.aliyuncs.com/compatible-mode/v1')) {
    printWarning(
      'Alibaba API profile is usually configured with Singapore endpoint.',
      'Recommended: https://dashscope-intl.aliyuncs.com/compatible-mode/v1'
    );
  }

  const spinner = createSafeSpinner(`Testing ${planLabel(plan)} (OpenAI-compatible)...`).start();
  const result = await (async () => {
    if (isNvidia) {
      return testOpenAIChatCompletionsApi({
        baseUrl,
        apiKey,
        model: model || 'moonshotai/kimi-k2.5',
        timeoutMs,
      });
    }

    const modelsProbe = await testOpenAICompatibleApi({ baseUrl, apiKey, timeoutMs });
    if (modelsProbe.ok) return modelsProbe;

    const shouldFallbackToChat =
      !!model &&
      (modelsProbe.status === 404 ||
        /not found|unsupported|unknown endpoint|method not allowed/i.test(modelsProbe.detail));

    if (shouldFallbackToChat) {
      return testOpenAIChatCompletionsApi({ baseUrl, apiKey, model, timeoutMs });
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

async function testAnthropicProtocol(plan: Plan): Promise<void> {
  if (!supportsAnthropicProtocol(plan)) {
    printWarning(`${planLabel(plan)} does not provide an Anthropic-compatible API.`);
    return;
  }

  const apiKey = getPlanApiKey(plan);
  if (!apiKey) {
    printWarning(`No API key saved for ${planLabel(plan)}. Configure it first.`);
    return;
  }

  const settings = configManager.getProviderSettings(plan);
  const baseUrl = settings.anthropicBaseUrl || resolveAnthropicBaseUrl(plan, settings.baseUrl);
  const model = settings.anthropicModel || settings.model || getDefaultAnthropicModel(plan) || '';

  if (
    plan === 'alibaba' &&
    apiKey.startsWith('sk-sp-') &&
    baseUrl &&
    !baseUrl.includes('coding-intl.dashscope.aliyuncs.com')
  ) {
    printWarning(
      'Alibaba Coding Plan key detected, but Anthropic endpoint is not Coding Plan endpoint.',
      'Recommended: https://coding-intl.dashscope.aliyuncs.com/apps/anthropic'
    );
  }
  if (plan === 'alibaba_api' && baseUrl && !baseUrl.includes('dashscope-intl.aliyuncs.com/apps/anthropic')) {
    printWarning(
      'Alibaba API profile is usually configured with Singapore Anthropic endpoint.',
      'Recommended: https://dashscope-intl.aliyuncs.com/apps/anthropic'
    );
  }

  if (!baseUrl) {
    printWarning(`Could not determine Anthropic endpoint for ${planLabel(plan)}. Configure provider profile first.`);
    return;
  }

  if (!model) {
    printWarning(`No model configured for ${planLabel(plan)}.`);
    return;
  }

  const spinner = createSafeSpinner(`Testing ${planLabel(plan)} (Anthropic-compatible)...`).start();
  const result = await testAnthropicMessagesApi({
    baseUrl,
    apiKey,
    model,
    timeoutMs: 12000,
  });

  if (result.ok) {
    spinner.succeed(result.detail);
  } else {
    spinner.fail(result.detail);
    if (result.status) console.log(chalk.gray(`  HTTP ${result.status}`));
  }
  console.log(chalk.gray(`  URL: ${result.url}`));
}

async function testProviderApisFlow(defaultPlan?: Plan): Promise<void> {
  const { plan } = await inquirer.prompt<{ plan: Plan | '__back' }>([
    {
      type: 'list',
      name: 'plan',
      message: 'Choose provider to test:',
      choices: [
        ...getVisibleProviders(defaultPlan).map((c) => {
          const key = configManager.getApiKeyFor(c.value);
          const keyStatus = key ? chalk.green(' ● key set') : chalk.gray(' (key not set)');
          return {
            name: `${formatProviderChoiceName(c.value, { includeCurrent: true, currentPlan: defaultPlan })}${keyStatus}`,
            value: c.value,
          };
        }),
        new inquirer.Separator(),
        { name: chalk.gray('← Back'), value: '__back' as const },
      ],
      default: defaultPlan,
    },
  ]);

  if (plan === '__back') return;

  const canOpenAI = supportsOpenAIProtocol(plan);
  const canAnthropic = supportsAnthropicProtocol(plan);

  const protocolChoices: Array<{ name: string; value: 'openai' | 'anthropic' | 'both' }> = [];
  if (canOpenAI) protocolChoices.push({ name: 'OpenAI-compatible API', value: 'openai' });
  if (canAnthropic) protocolChoices.push({ name: 'Anthropic-compatible API (Claude Code path)', value: 'anthropic' });
  if (canOpenAI && canAnthropic) protocolChoices.push({ name: 'Run both tests', value: 'both' });

  const { protocol } = await inquirer.prompt<{ protocol: 'openai' | 'anthropic' | 'both' | '__back' }>([
    {
      type: 'list',
      name: 'protocol',
      message: `Protocol test for ${planLabel(plan)}:`,
      choices: [...protocolChoices, new inquirer.Separator(), { name: chalk.gray('← Back'), value: '__back' as const }],
    },
  ]);

  if (protocol === '__back') return;

  if (protocol === 'openai' || protocol === 'both') {
    await testOpenAiProtocol(plan);
  }
  if (protocol === 'anthropic' || protocol === 'both') {
    await testAnthropicProtocol(plan);
  }
}

export async function providerMenu(): Promise<void> {
  while (true) {
    console.clear();
    printHeader('Provider Setup');
    const auth = configManager.getAuth();
    const plan = auth.plan as Plan | undefined;
    printStatusBar(plan, auth.apiKey, plan ? providerSummary(plan).trim() : undefined);
    printConfigPathHint(configManager.configPath);
    printNavigationHints();

    if (!plan || !auth.apiKey) {
      printInfo('Start here: choose default provider, then run Quick Setup.');
      console.log();
    } else {
      printInfo(`Default provider protocols: ${providerProtocolSummary(plan)}`);
      console.log();
    }

    type Action = 'set_global' | 'configure' | 'test' | 'availability' | 'revoke';
    const choices: Array<{ name: string; value: Action }> = [
      { name: '1) Choose Default Provider', value: 'set_global' },
      { name: '2) Configure Provider Profile (Quick/Advanced)', value: 'configure' },
      { name: '3) Test Provider APIs (OpenAI/Anthropic)', value: 'test' },
      { name: '4) Manage Visible Providers', value: 'availability' },
      { name: '5) Revoke Saved API Keys', value: 'revoke' },
    ];

    const { action } = await inquirer.prompt<{ action: Action | '__back' }>([
      {
        type: 'list',
        name: 'action',
        message: 'What do you want to do?',
        choices: [...choices, new inquirer.Separator(), { name: chalk.gray('← Back'), value: '__back' as const }],
      },
    ]);

    if (action === '__back') return;

    try {
      if (action === 'set_global') {
        const { newPlan } = await inquirer.prompt<{ newPlan: Plan | '__back' }>([
          {
            type: 'list',
            name: 'newPlan',
            message: 'Choose default provider:',
            choices: [
              ...getVisibleProviders(plan).map((c) => ({
                name: formatProviderChoiceName(c.value, { includeCurrent: true, currentPlan: plan }),
                value: c.value,
              })),
              new inquirer.Separator(),
              { name: chalk.gray('← Back'), value: '__back' as const },
            ],
            default: plan,
          },
        ]);

        if (newPlan !== '__back') {
          const key = getPlanApiKey(newPlan);
          configManager.setAuth(newPlan, key || '');
          printSuccess(`Default provider set to ${planLabel(newPlan)}`);
          await pause();
        }
      } else if (action === 'configure') {
        await configureProfilesMenu();
      } else if (action === 'availability') {
        await manageProviderAvailability();
        await pause();
      } else if (action === 'revoke') {
        const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
          {
            type: 'confirm',
            name: 'confirm',
            message: chalk.yellow('Revoke all saved API keys?'),
            default: false,
          },
        ]);
        if (!confirm) {
          printInfo('Cancelled');
          await pause();
          continue;
        }
        configManager.revokeAuth();
        printSuccess('API keys revoked');
        await pause();
      } else if (action === 'test') {
        await testProviderApisFlow(plan);
        await pause();
      }
    } catch (error) {
      logger.logError('menu.provider', error);
      printError(error instanceof Error ? error.message : String(error), 'Run "coder-link auth" to configure API keys');
      await pause();
    }
  }
}
