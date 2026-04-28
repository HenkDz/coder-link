/**
 * Direct tool launcher - applies provider config and runs a tool
 * Used by both the interactive menu and the CLI `run` command.
 */

import chalk from 'chalk';
import { configManager, isKimiLikePlan } from '../utils/config.js';
import type { Plan } from '../utils/config.js';
import { toolManager } from './tool-manager.js';
import { commandExists, runInteractive, runInteractiveWithEnv, runInNewTerminal } from '../utils/exec.js';
import { startCommand } from '../menu/shared.js';
import { printError, printWarning, printInfo, printSuccess } from '../utils/output.js';
import { planLabel } from '../utils/brand.js';
import { supportsOpenAIProtocol } from '../utils/providers.js';
import { getProviderIncompatibility } from '../menu/shared.js';

export interface RunToolOptions {
  /** Launch in a new terminal window (Windows only for now) */
  newWindow?: boolean;
  /** Launch in the same terminal (Windows default behavior) */
  sameWindow?: boolean;
  /** Skip config sync, just launch the tool */
  skipConfig?: boolean;
  /** Override the model to use */
  model?: string;
  /** Provider plan to use (overrides default) */
  plan?: Plan;
  /** API key to use (overrides stored key) */
  apiKey?: string;
  /** Don't prompt for missing credentials, fail instead */
  nonInteractive?: boolean;
}

export interface RunToolResult {
  success: boolean;
  exitCode?: number;
  error?: string;
}

/**
 * Launch a coding tool with the appropriate configuration and env vars.
 * 
 * This function:
 * 1. Detects if the tool needs configuration
 * 2. Applies the default provider config if needed
 * 3. Sets up env vars for tools that require them
 * 4. Launches the tool
 */
export async function runTool(toolName: string, options: RunToolOptions = {}): Promise<RunToolResult> {
  const capabilities = toolManager.getCapabilities(toolName);
  const start = startCommand(toolName);
  configManager.setLastUsedTool(toolName);

  const auth = options.plan
    ? { plan: options.plan, apiKey: options.apiKey || configManager.getApiKeyFor(options.plan) }
    : configManager.getAuth();

  const globalPlan = auth.plan;
  const globalKey = auth.apiKey;
  const hasGlobalProvider = !!(globalPlan && globalKey);

  let globalModel: string | undefined;
  if (globalPlan && isKimiLikePlan(globalPlan)) {
    globalModel = configManager.getProviderSettings(globalPlan).model;
  }
  // Allow model override from options
  if (options.model) {
    globalModel = options.model;
  }

  let toolPlan: string | null = null;
  let toolKey: string | null = null;
  if (capabilities.supportsProviderConfig) {
    try {
      const detected = await toolManager.detectCurrentConfig(toolName);
      toolPlan = detected.plan;
      toolKey = detected.apiKey;
    } catch {
      // ignore
    }
  }

  const isConfigured = capabilities.supportsProviderConfig && !!(toolPlan && toolKey);

  // Determine if we need to configure the tool before launching
  if (!options.skipConfig && capabilities.supportsProviderConfig && !isConfigured) {
    if (!hasGlobalProvider) {
      const msg = `${toolName} is not configured and no default provider is set.`;
      if (options.nonInteractive) {
        return { success: false, error: msg + ' Run "coder-link auth <provider>" first.' };
      }
      printError(msg, 'Run "coder-link auth <provider>" to set up a provider.');
      return { success: false, error: 'No provider configured' };
    }

    // Check compatibility
    const incompat = getProviderIncompatibility(toolName, globalPlan as Plan);
    if (incompat) {
      const msg = `${toolName} cannot use ${planLabel(globalPlan as Plan)}: ${incompat}`;
      if (options.nonInteractive) {
        return { success: false, error: msg };
      }
      printError(msg);
      return { success: false, error: 'Provider incompatible' };
    }

    // OB1 requires a model to be specified
    if (toolName === 'ob1' && !globalModel) {
      const msg = 'OB1 requires a model to be configured.';
      if (options.nonInteractive) {
        return { success: false, error: msg + ' Set a model in provider settings.' };
      }
      printError(msg, 'Set a model in provider settings or use --model.');
      return { success: false, error: 'Model required' };
    }

    // Apply configuration
    if (!options.nonInteractive) {
      printInfo(`Configuring ${toolName} with ${planLabel(globalPlan as Plan)}...`);
    }
    try {
      await toolManager.loadConfig(toolName, globalPlan!, globalKey!, globalModel ? { model: globalModel } : undefined);
      if (!options.nonInteractive) {
        printSuccess('Configuration applied');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (options.nonInteractive) {
        return { success: false, error: `Failed to configure tool: ${msg}` };
      }
      printError('Failed to apply configuration', msg);
      return { success: false, error: msg };
    }
  }

  // Check if tool is installed
  if (!commandExists(start.cmd)) {
    const msg = `${toolName} was not found on PATH.`;
    if (options.nonInteractive) {
      return { success: false, error: msg + ' Install the tool first.' };
    }
    printError(msg, `Install ${toolName} or verify it's in your PATH.`);
    return { success: false, error: 'Tool not found' };
  }

  // Determine launch mode
  let launchMode: 'same' | 'new' = 'same';
  if (options.newWindow) {
    launchMode = 'new';
  } else if (options.sameWindow) {
    launchMode = 'same';
  }

  if (!options.nonInteractive) {
    console.log(chalk.gray(`\n  Launching ${toolName}...\n`));
  }

  // Tool-specific launch handling
  if (toolName === 'codex') {
    return await launchCodex(toolName, start, toolPlan, globalPlan, globalKey, launchMode, options);
  }

  if (toolName === 'factory-droid') {
    return await launchFactoryDroid(toolName, start, launchMode, options);
  }

  if (toolName === 'ob1') {
    return await launchOb1(toolName, start, launchMode, options);
  }

  // Generic launch
  if (launchMode === 'new') {
    const ok = runInNewTerminal(start.cmd, start.args);
    if (!ok) {
      if (options.nonInteractive) {
        return { success: false, error: 'Failed to open new terminal window' };
      }
      printWarning('Failed to open a new terminal window. Launching here instead.');
      const exitCode = await runInteractive(start.cmd, start.args);
      return { success: true, exitCode };
    }
    return { success: true };
  }

  const exitCode = await runInteractive(start.cmd, start.args);
  return { success: true, exitCode };
}

async function launchCodex(
  toolName: string,
  start: { cmd: string; args: string[] },
  toolPlan: string | null,
  globalPlan: string | undefined,
  globalKey: string | undefined,
  launchMode: 'same' | 'new',
  options: RunToolOptions
): Promise<RunToolResult> {
  const plan = (toolPlan as Plan | null) || (globalPlan as Plan | undefined);
  if (!plan) {
    const msg = 'Codex requires a configured provider.';
    if (options.nonInteractive) {
      return { success: false, error: msg };
    }
    printError(msg);
    return { success: false, error: 'No provider' };
  }
  if (!supportsOpenAIProtocol(plan)) {
    const msg = `${planLabel(plan)} is not OpenAI-compatible, cannot be used with Codex.`;
    if (options.nonInteractive) {
      return { success: false, error: msg };
    }
    printError(msg);
    return { success: false, error: 'Protocol incompatible' };
  }

  let apiKey = globalKey || configManager.getApiKeyFor(plan) || process.env.OPENAI_API_KEY?.trim() || '';
  if (options.apiKey) {
    apiKey = options.apiKey;
  }
  if (!apiKey && plan === 'lmstudio') {
    apiKey = 'lmstudio';
  }
  if (!apiKey) {
    const msg = `No API key for ${planLabel(plan)}.`;
    if (options.nonInteractive) {
      return { success: false, error: msg };
    }
    printError(msg);
    return { success: false, error: 'No API key' };
  }

  return launchWithEnv(start, launchMode, { OPENAI_API_KEY: apiKey }, options);
}

async function launchFactoryDroid(
  toolName: string,
  start: { cmd: string; args: string[] },
  launchMode: 'same' | 'new',
  options: RunToolOptions
): Promise<RunToolResult> {
  const factoryKey = configManager.getFactoryApiKey() || process.env.FACTORY_API_KEY;
  if (!factoryKey) {
    if (options.nonInteractive) {
      return { success: false, error: 'Factory API key required. Set FACTORY_API_KEY env var or configure in coder-link.' };
    }
    printError('Factory API key required.', 'Set FACTORY_API_KEY env var or run "coder-link init" to configure.');
    return { success: false, error: 'Factory API key required' };
  }

  return launchWithEnv(start, launchMode, { FACTORY_API_KEY: factoryKey }, options);
}

async function launchOb1(
  toolName: string,
  start: { cmd: string; args: string[] },
  launchMode: 'same' | 'new',
  options: RunToolOptions
): Promise<RunToolResult> {
  const ob1ApiUrl = configManager.getOb1ApiUrl() || process.env.OPENROUTER_API_URL;
  const ob1ApiKey = configManager.getOb1ApiKey() || process.env.OPENROUTER_API_KEY;

  if (!ob1ApiUrl || !ob1ApiKey) {
    const msg = 'OB1 requires OPENROUTER_API_URL and OPENROUTER_API_KEY.';
    if (options.nonInteractive) {
      return { success: false, error: msg + ' Configure via env vars or coder-link.' };
    }
    printError(msg, 'Set via env vars or run "coder-link init" to configure.');
    return { success: false, error: 'OB1 credentials required' };
  }

  const ob1Env: Record<string, string> = {};
  if (ob1ApiUrl) ob1Env.OPENROUTER_API_URL = ob1ApiUrl;
  if (ob1ApiKey) ob1Env.OPENROUTER_API_KEY = ob1ApiKey;

  return launchWithEnv(start, launchMode, ob1Env, options);
}

async function launchWithEnv(
  start: { cmd: string; args: string[] },
  launchMode: 'same' | 'new',
  env: Record<string, string>,
  options: RunToolOptions
): Promise<RunToolResult> {
  if (launchMode === 'new') {
    const ok = runInNewTerminal(start.cmd, start.args, env);
    if (!ok) {
      if (options.nonInteractive) {
        return { success: false, error: 'Failed to open new terminal window' };
      }
      const exitCode = await runInteractiveWithEnv(start.cmd, start.args, env);
      return { success: true, exitCode };
    }
    return { success: true };
  }
  const exitCode = await runInteractiveWithEnv(start.cmd, start.args, env);
  return { success: true, exitCode };
}

