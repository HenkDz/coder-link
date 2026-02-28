import inquirer from 'inquirer';
import chalk from 'chalk';
import ora, { type Ora } from 'ora';

import { configManager, isKimiLikePlan } from '../utils/config.js';
import type { Plan } from '../utils/config.js';
import { toolManager } from '../lib/tool-manager.js';
import { commandExists } from '../utils/exec.js';
import { COMMON_MODELS } from '../utils/providers.js';
import { truncateForTerminal } from '../utils/brand.js';
import { fetchLMStudioModel } from '../lib/provider-registry.js';

let guardsInstalled = false;

function disableMouseTracking(): void {
  if (!process.stdout.isTTY) return;
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

function installStdoutMouseGuard(): void {
  if (!process.stdout.isTTY) return;
  const originalWrite = process.stdout.write.bind(process.stdout);
  const enableRe = /\x1b\[\?(?:9|1000|1002|1003|1005|1006|1015)h/g;

  (process.stdout as any).write = (chunk: any, encoding?: any, cb?: any) => {
    if (chunk == null) return originalWrite(chunk as any, encoding as any, cb as any);
    if (Buffer.isBuffer(chunk) || chunk instanceof Uint8Array) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const cleaned = buf.toString('latin1').replace(enableRe, '');
      return originalWrite(Buffer.from(cleaned, 'latin1'), encoding as any, cb as any);
    }
    const cleaned = String(chunk).replace(enableRe, '');
    return originalWrite(cleaned as any, encoding as any, cb as any);
  };
}

export function initMenuTerminalGuards(): void {
  if (guardsInstalled) return;
  installStdoutMouseGuard();
  disableMouseTracking();
  guardsInstalled = true;
}

export function providerSummary(plan: Plan | undefined): string {
  if (!plan) return '';
  if (!isKimiLikePlan(plan)) return '';
  const s = configManager.getProviderSettings(plan);
  const parts: string[] = [];
  if (s.baseUrl) parts.push(s.baseUrl);
  if (s.model) parts.push(s.model);
  return parts.length ? chalk.gray(` (${parts.join(' · ')})`) : '';
}

export function startCommand(tool: string): { cmd: string; args: string[] } {
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
    case 'codex':
      return { cmd: 'codex', args: [] };
    case 'mastra':
      return { cmd: 'mastracode', args: [] };
    default:
      return { cmd: tool, args: [] };
  }
}

function openUrlCommand(url: string): string {
  if (process.platform === 'win32') return `start ${url}`;
  if (process.platform === 'darwin') return `open ${url}`;
  return `xdg-open ${url}`;
}

export function installHint(tool: string): { label: string; command?: string } {
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
    case 'codex':
      return { label: 'Install Codex CLI', command: 'npm install -g @openai/codex' };
    case 'mastra':
      return { label: 'Install Mastra Code', command: 'npm install -g mastracode' };
    default:
      return { label: 'Install instructions', command: undefined };
  }
}

export async function pause(message = 'Press Enter to continue... (or q to quit)'): Promise<void> {
  return new Promise((resolve) => {
    console.log(chalk.gray(`  ${message}`));
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

export function createSafeSpinner(text: string): Ora {
  const safeText = truncateForTerminal(text, (process.stdout.columns || 80) - 10);
  return ora({ text: safeText, spinner: 'dots' });
}

export function getProviderIncompatibility(tool: string, plan: Plan): string | null {
  if (toolManager.isPlanSupported(tool, plan)) return null;
  if (tool === 'claude-code') return 'Requires Anthropic-compatible API';
  return 'Unsupported by this tool';
}

export async function selectModelId(plan: Plan, currentModel?: string): Promise<string | '__back'> {
  // Special handling for LM Studio - detect loaded model
  if (plan === 'lmstudio') {
    const spinner = createSafeSpinner('Checking LM Studio for loaded model...').start();
    const detectedModel = await fetchLMStudioModel();
    
    if (detectedModel) {
      spinner.succeed(`Found loaded model: ${detectedModel}`);
      
      const choices = [
        { name: `${detectedModel} ${chalk.green('(detected from LM Studio)')}`, value: detectedModel },
        { name: '✍️  Enter custom model ID...', value: '__custom' },
        new inquirer.Separator(),
        { name: chalk.gray('← Back'), value: '__back' },
      ];

      const { selection } = await inquirer.prompt<{ selection: string }>([
        {
          type: 'list',
          name: 'selection',
          message: 'Select Model ID:',
          choices,
        },
      ]);

      if (selection === '__back') return '__back';
      if (selection === '__custom') {
        const { custom } = await inquirer.prompt<{ custom: string }>([
          {
            type: 'input',
            name: 'custom',
            message: "Enter model ID (or 'b' to go back):",
            validate: (v: string) => v.trim().length > 0 || 'Model ID cannot be empty',
          },
        ]);
        if (custom.trim().toLowerCase() === 'b') return selectModelId(plan, currentModel);
        return custom.trim();
      }
      return selection;
    } else {
      spinner.fail('No model detected in LM Studio (is it running with a model loaded?)');
      
      const choices = [
        { name: '✍️  Enter model ID manually...', value: '__custom' },
        new inquirer.Separator(),
        { name: chalk.gray('← Back'), value: '__back' },
      ];

      const { selection } = await inquirer.prompt<{ selection: string }>([
        {
          type: 'list',
          name: 'selection',
          message: 'Select Model ID (LM Studio not responding):',
          choices,
        },
      ]);

      if (selection === '__back') return '__back';
      const { custom } = await inquirer.prompt<{ custom: string }>([
        {
          type: 'input',
          name: 'custom',
          message: "Enter model ID (or 'b' to go back):",
          validate: (v: string) => v.trim().length > 0 || 'Model ID cannot be empty',
        },
      ]);
      if (custom.trim().toLowerCase() === 'b') return selectModelId(plan, currentModel);
      return custom.trim();
    }
  }

  // Standard handling for other providers
  const common = COMMON_MODELS[plan] || [];
  const choices = [
    ...(currentModel ? [{ name: `${currentModel} ${chalk.green('(current)')}`, value: currentModel }] : []),
    ...common.filter((m) => m !== currentModel).map((m) => ({ name: m, value: m })),
    { name: '✍️  Enter custom model ID...', value: '__custom' },
    new inquirer.Separator(),
    { name: chalk.gray('← Back'), value: '__back' },
  ];

  const { selection } = await inquirer.prompt<{ selection: string }>([
    {
      type: 'list',
      name: 'selection',
      message: 'Select Model ID:',
      choices,
    },
  ]);

  if (selection === '__back') return '__back';
  if (selection === '__custom') {
    const { custom } = await inquirer.prompt<{ custom: string }>([
      {
        type: 'input',
        name: 'custom',
        message: "Enter model ID (or 'b' to go back):",
        validate: (v: string) => v.trim().length > 0 || 'Model ID cannot be empty',
      },
    ]);
    if (custom.trim().toLowerCase() === 'b') return selectModelId(plan, currentModel);
    return custom.trim();
  }
  return selection;
}

