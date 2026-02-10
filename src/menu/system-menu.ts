import inquirer from 'inquirer';
import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { CONFIG_DIR, configManager } from '../utils/config.js';
import type { Plan } from '../utils/config.js';
import { i18n } from '../utils/i18n.js';
import { toolManager } from '../lib/tool-manager.js';
import { printHeader, planLabelColored, maskApiKey, statusIndicator, toolLabel } from '../utils/brand.js';
import { printError, printInfo, printSuccess } from '../utils/output.js';
import { pause } from './shared.js';

export async function diagnosticsMenu(): Promise<void> {
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
    const caps = toolManager.getCapabilities(tool);
    if (!caps.supportsProviderConfig) {
      console.log(`    ${chalk.gray('○')} ${toolLabel(tool)} ${chalk.gray('(launch only)')}`);
      continue;
    }
    const status = await toolManager.isConfigured(tool);
    console.log(`    ${statusIndicator(status)} ${toolLabel(tool)}`);
  }

  console.log('\n  ' + i18n.t('doctor.mcp_header'));
  const mcpCapableTools = tools.filter((tool) => toolManager.getCapabilities(tool).supportsMcp);
  if (mcpCapableTools.length === 0) {
    console.log(`    ${chalk.gray(i18n.t('doctor.none'))}`);
  } else {
    let hasAnyMcp = false;
    for (const tool of mcpCapableTools) {
      const installed = await toolManager.getInstalledMCPs(tool);
      if (installed.length === 0) continue;
      hasAnyMcp = true;
      console.log(`    ${chalk.cyan(toolLabel(tool))}: ${installed.join(', ')}`);
    }
    if (!hasAnyMcp) {
      console.log(`    ${chalk.gray(i18n.t('doctor.none'))}`);
    }
  }

  console.log();
  await pause();
}

export async function logsMenu(): Promise<void> {
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
        const lines = logs.split('\n').filter((l) => l.trim()).slice(-15);
        if (lines.length === 0) {
          printInfo('Log file is empty.');
        } else {
          console.log(chalk.gray('  Last 15 log entries:\n'));
          for (const line of lines) {
            if (line.includes('[ERROR]')) {
              console.log(`  ${chalk.red(line)}`);
            } else if (line.includes('[WARN]')) {
              console.log(`  ${chalk.yellow(line)}`);
            } else {
              console.log(`  ${chalk.gray(line)}`);
            }
          }
        }
      } catch {
        printError('Failed to read log file');
      }
    }

    console.log();
    const { action } = await inquirer.prompt<{ action: 'clear' | 'back' }>([
      {
        type: 'list',
        name: 'action',
        message: 'Action:',
        choices: [{ name: '🗑 Clear Logs', value: 'clear' }, new inquirer.Separator(), { name: chalk.gray('← Back'), value: 'back' }],
      },
    ]);

    if (action === 'back') return;

    if (action === 'clear' && existsSync(LOG_FILE)) {
      writeFileSync(LOG_FILE, '', 'utf-8');
      printSuccess('Logs cleared');
      await pause();
    }
  }
}

