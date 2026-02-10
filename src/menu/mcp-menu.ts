import inquirer from 'inquirer';
import chalk from 'chalk';

import { configManager } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { toolManager } from '../lib/tool-manager.js';
import { BUILTIN_MCP_SERVICES } from '../mcp-services.js';
import { printHeader, printNavigationHints, planLabel, toolLabel } from '../utils/brand.js';
import { printError, printSuccess, printWarning, printInfo } from '../utils/output.js';
import { createSafeSpinner, pause } from './shared.js';

export async function mcpMenu(tool: string): Promise<void> {
  const capabilities = toolManager.getCapabilities(tool);
  if (!capabilities.supportsMcp) {
    printWarning(`${toolLabel(tool)} does not support MCP management.`);
    await pause();
    return;
  }

  while (true) {
    console.clear();
    printHeader(`MCP · ${toolLabel(tool)}`);
    const auth = configManager.getAuth();

    if (!auth.plan) {
      printWarning('Select a default provider first from Provider Setup.');
      await pause();
      return;
    }

    const installed = await toolManager.getInstalledMCPs(tool);
    console.log(`  ${chalk.gray('Provider:')} ${planLabel(auth.plan)}`);
    console.log(`  ${chalk.gray('Installed:')} ${installed.length ? installed.join(', ') : chalk.yellow('None')}`);
    console.log();
    printNavigationHints();

    const { action } = await inquirer.prompt<{ action: 'install' | 'uninstall' | '__back' }>([
      {
        type: 'list',
        name: 'action',
        message: 'Action:',
        choices: [
          { name: '📦 Install built-in MCP', value: 'install' },
          ...(installed.length ? [{ name: '🗑 Uninstall MCP', value: 'uninstall' as const }] : []),
          new inquirer.Separator(),
          { name: chalk.gray('← Back'), value: '__back' as const },
        ],
      },
    ]);

    if (action === '__back') return;

    try {
      if (action === 'install') {
        const { id } = await inquirer.prompt<{ id: string | '__back' }>([
          {
            type: 'list',
            name: 'id',
            message: 'Select MCP:',
            choices: [
              ...BUILTIN_MCP_SERVICES.map((s) => ({
                name: `${installed.includes(s.id) ? '✓' : ' '} ${s.name} (${s.id})`,
                value: s.id,
              })),
              new inquirer.Separator(),
              { name: chalk.gray('← Back'), value: '__back' as const },
            ],
          },
        ]);
        if (id === '__back') continue;

        const service = BUILTIN_MCP_SERVICES.find((s) => s.id === id)!;
        if (service.requiresAuth && !auth.apiKey) {
          printWarning(`${service.name} requires a provider API key. Configure your provider first.`);
          await pause();
          continue;
        }

        const mcpCapableTools = toolManager
          .getSupportedTools()
          .filter((t) => toolManager.getCapabilities(t).supportsMcp);

        const { target } = await inquirer.prompt<{ target: 'this' | 'all' }>([
          {
            type: 'list',
            name: 'target',
            message: 'Install to:',
            choices: [
              { name: `Only ${toolLabel(tool)}`, value: 'this' },
              { name: `All MCP-capable tools (${mcpCapableTools.length})`, value: 'all' },
            ],
          },
        ]);

        if (target === 'all') {
          const spinner = createSafeSpinner(`Installing ${id} to all MCP-capable tools...`).start();
          let success = 0;
          for (const t of mcpCapableTools) {
            try {
              await toolManager.installMCP(t, service, auth.apiKey || '', auth.plan);
              success++;
            } catch {
              // skip individual failures, summarize total below
            }
          }
          spinner.succeed(`Installed ${id} to ${success}/${mcpCapableTools.length} tools`);
          if (success < mcpCapableTools.length) {
            printInfo('Some tools skipped due to compatibility or tool-specific constraints.');
          }
        } else {
          await toolManager.installMCP(tool, service, auth.apiKey || '', auth.plan);
          printSuccess(`Installed ${id} to ${toolLabel(tool)}`);
        }
        await pause();
      } else if (action === 'uninstall') {
        const { id } = await inquirer.prompt<{ id: string | '__back' }>([
          {
            type: 'list',
            name: 'id',
            message: 'Select MCP to uninstall:',
            choices: [
              ...installed.map((x) => ({ name: x, value: x })),
              new inquirer.Separator(),
              { name: chalk.gray('← Back'), value: '__back' as const },
            ],
          },
        ]);
        if (id === '__back') continue;
        await toolManager.uninstallMCP(tool, id);
        printSuccess(`Uninstalled ${id}`);
        await pause();
      }
    } catch (error) {
      logger.logError('menu.mcp', error);
      printError(error instanceof Error ? error.message : String(error), 'Check tool-specific documentation for MCP requirements');
      await pause();
    }
  }
}

