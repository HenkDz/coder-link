import inquirer from 'inquirer';
import chalk from 'chalk';

import { configManager } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { toolManager } from '../lib/tool-manager.js';
import type { ToolName } from '../lib/tool-manager.js';
import { BUILTIN_MCP_SERVICES } from '../mcp-services.js';
import { printHeader, printNavigationHints, planLabel, toolLabel } from '../utils/brand.js';
import { printError, printSuccess, printWarning, printInfo } from '../utils/output.js';
import { createSafeSpinner, pause } from './shared.js';

// Tools that support MCP
const MCP_CAPABLE_TOOLS: ToolName[] = ['claude-code', 'opencode', 'crush', 'factory-droid', 'kimi', 'ob1', 'mastra'];

/**
 * Per-tool MCP menu.
 */
export async function mcpMenu(tool: string): Promise<void> {
  const capabilities = toolManager.getCapabilities(tool);
  if (!capabilities.supportsMcp) {
    printWarning(`${toolLabel(tool)} does not support MCP management.`);
    await pause();
    return;
  }

  let first = true;
  while (true) {
    if (first) { console.clear(); first = false; }
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
        const compatibleServices = BUILTIN_MCP_SERVICES.filter((s) => {
          if (!s.supportedPlans || s.supportedPlans.length === 0) return true;
          return s.supportedPlans.includes(auth.plan as any);
        });

        if (!compatibleServices.length) {
          printWarning(`No built-in MCP services are compatible with ${planLabel(auth.plan)}.`);
          await pause();
          continue;
        }

        const { id } = await inquirer.prompt<{ id: string | '__back' }>([
          {
            type: 'list',
            name: 'id',
            message: 'Select MCP:',
            choices: [
              ...compatibleServices.map((s) => ({
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
        if (service.supportedPlans && service.supportedPlans.length > 0 && !service.supportedPlans.includes(auth.plan as any)) {
          printWarning(`${service.name} is not compatible with ${planLabel(auth.plan)}.`);
          await pause();
          continue;
        }

        // Resolve the API key: use authPlan-specific key if set, otherwise fall back to active provider
        const effectivePlan = service.authPlan || auth.plan;
        const effectiveApiKey = service.authPlan
          ? configManager.getApiKeyFor(service.authPlan)
          : auth.apiKey;

        if (service.requiresAuth && !effectiveApiKey) {
          printWarning(
            service.authPlan
              ? `${service.name} requires a ${planLabel(service.authPlan)} API key. Configure your GLM coding plan first.`
              : `${service.name} requires a provider API key. Configure your provider first.`
          );
          await pause();
          continue;
        }

        const mcpCapableTools = toolManager
          .getSupportedTools()
          .filter((t) => configManager.getEnabledTools().includes(t))
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
              await toolManager.installMCP(t, service, effectiveApiKey || '', effectivePlan || '');
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
          await toolManager.installMCP(tool, service, effectiveApiKey || '', effectivePlan || '');
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

/**
 * Global MCP menu — manage MCP servers across all tools.
 * Exported for use in main-menu.ts.
 */
export async function globalMcpMenu(): Promise<void> {
  const auth = configManager.getAuth();

  if (!auth.plan) {
    printWarning('Select a default provider first from Provider Setup.');
    await pause();
    return;
  }

  let first = true;
  while (true) {
    if (first) { console.clear(); first = false; }
    printHeader('MCP Servers');

    const mcpCapableTools = MCP_CAPABLE_TOOLS.filter(t => configManager.getEnabledTools().includes(t));

    // Build install status map
    const mcpStatus: Map<string, { installed: Set<string>; tools: string[] }> = new Map();
    for (const mcp of BUILTIN_MCP_SERVICES) {
      const installed = new Set<string>();
      const toolsWithMcp: string[] = [];
      for (const tool of mcpCapableTools) {
        const isInstalled = await toolManager.isMCPInstalled(tool, mcp.id);
        if (isInstalled) {
          installed.add(tool);
          toolsWithMcp.push(toolLabel(tool));
        }
      }
      mcpStatus.set(mcp.id, { installed, tools: toolsWithMcp });
    }

    let totalInstalled = 0;
    for (const [, status] of Array.from(mcpStatus)) {
      totalInstalled += status.tools.length;
    }

    console.log(`  ${chalk.gray('Provider:')} ${planLabel(auth.plan)}`);
    console.log(`  ${chalk.gray('MCP-capable tools:')} ${mcpCapableTools.map(t => toolLabel(t)).join(', ')}`);
    console.log(`  ${chalk.gray('Total installed:')} ${totalInstalled > 0 ? chalk.green(totalInstalled) : chalk.yellow('None')}`);
    console.log();
    printNavigationHints();

    const { action } = await inquirer.prompt<{ action: 'install' | 'uninstall' | 'install-all' | '__back' }>([
      {
        type: 'list',
        name: 'action',
        message: 'Action:',
        choices: [
          { name: '📦 Install MCP to All Tools', value: 'install-all' },
          { name: '🔧 Install to Specific Tools', value: 'install' },
          { name: '🗑 Uninstall MCP', value: 'uninstall' as const },
          new inquirer.Separator(),
          { name: chalk.gray('← Back'), value: '__back' as const },
        ],
      },
    ]);

    if (action === '__back') return;

    try {
      if (action === 'install-all' || action === 'install') {
        const compatibleServices = BUILTIN_MCP_SERVICES.filter((s) => {
          if (!s.supportedPlans || s.supportedPlans.length === 0) return true;
          return s.supportedPlans.includes(auth.plan as any);
        });

        if (!compatibleServices.length) {
          printWarning(`No built-in MCP services are compatible with ${planLabel(auth.plan)}.`);
          await pause();
          continue;
        }

        const { id } = await inquirer.prompt<{ id: string | '__back' }>([
          {
            type: 'list',
            name: 'id',
            message: 'Select MCP:',
            choices: [
              ...compatibleServices.map((s) => {
                const status = mcpStatus.get(s.id)!;
                const count = status.tools.length;
                const badge = count > 0 ? chalk.green(` \u2713 ${count} tool${count > 1 ? 's' : ''}`) : '';
                return {
                  name: `${s.name} (${s.id})${badge}`,
                  value: s.id,
                };
              }),
              new inquirer.Separator(),
              { name: chalk.gray('\u2190 Back'), value: '__back' as const },
            ],
          },
        ]);
        if (id === '__back') continue;

        const service = BUILTIN_MCP_SERVICES.find((s) => s.id === id)!;

        const effectivePlan = service.authPlan || auth.plan;
        const effectiveApiKey = service.authPlan
          ? configManager.getApiKeyFor(service.authPlan)
          : auth.apiKey;

        if (service.requiresAuth && !effectiveApiKey) {
          printWarning(
            service.authPlan
              ? `${service.name} requires a ${planLabel(service.authPlan)} API key. Configure your GLM coding plan first.`
              : `${service.name} requires a provider API key. Configure your provider first.`
          );
          await pause();
          continue;
        }

        const compatibleTools = mcpCapableTools.filter(t => {
          if (!service.supportedPlans || service.supportedPlans.length === 0) return true;
          const caps = toolManager.getCapabilities(t);
          return service.supportedPlans.some(p => caps.supportedPlans.includes(p as any));
        });

        if (action === 'install-all') {
          const spinner = createSafeSpinner(`Installing ${id} to all compatible tools...`).start();
          let success = 0;
          for (const t of compatibleTools) {
            try {
              await toolManager.installMCP(t, service, effectiveApiKey || '', effectivePlan || '');
              success++;
            } catch {
              // skip individual failures
            }
          }
          spinner.succeed(`Installed ${id} to ${success}/${compatibleTools.length} tools`);
          if (success < compatibleTools.length) {
            printInfo('Some tools may have been skipped due to compatibility issues.');
          }
          await pause();
        } else {
          const { targets } = await inquirer.prompt<{ targets: string[] }>([
            {
              type: 'checkbox',
              name: 'targets',
              message: 'Select tools to install to:',
              choices: [
                ...compatibleTools.map(t => ({
                  name: `${toolLabel(t)}${mcpStatus.get(id)!.installed.has(t) ? ' \u2713' : ''}`,
                  value: t,
                  checked: !mcpStatus.get(id)!.installed.has(t),
                })),
              ],
              validate: (input: string[]) => input.length > 0 || 'Select at least one tool',
            },
          ]);

          const spinner = createSafeSpinner(`Installing ${id}...`).start();
          let success = 0;
          for (const t of targets) {
            try {
              await toolManager.installMCP(t, service, effectiveApiKey || '', effectivePlan || '');
              success++;
            } catch {
              // skip individual failures
            }
          }
          spinner.succeed(`Installed ${id} to ${success}/${targets.length} tools`);
          await pause();
        }
      } else if (action === 'uninstall') {
        const installedMcps: Array<{ id: string; name: string; tools: string[] }> = [];
        for (const [id, status] of Array.from(mcpStatus)) {
          if (status.tools.length > 0) {
            const service = BUILTIN_MCP_SERVICES.find(s => s.id === id);
            installedMcps.push({ id, name: service?.name || id, tools: status.tools });
          }
        }

        if (installedMcps.length === 0) {
          printWarning('No MCPs are currently installed.');
          await pause();
          continue;
        }

        const { id, targets } = await inquirer.prompt<{ id: string; targets: string[] }>([
          {
            type: 'list',
            name: 'id',
            message: 'Select MCP to uninstall:',
            choices: [
              ...installedMcps.map(x => ({
                name: `${x.name} (${x.tools.length} tool${x.tools.length > 1 ? 's' : ''})`,
                value: x.id,
              })),
              new inquirer.Separator(),
              { name: chalk.gray('\u2190 Back'), value: '__back' as const },
            ],
          },
          {
            type: 'checkbox',
            name: 'targets',
            message: 'Select tools to uninstall from:',
            choices: (answers: { id: string }) => {
              const status = mcpStatus.get(answers.id)!;
              return status.tools.map(t => ({
                name: toolLabel(t),
                value: t,
                checked: true,
              }));
            },
            validate: (input: string[]) => input.length > 0 || 'Select at least one tool',
          },
        ]);

        if (id === '__back') continue;

        const spinner = createSafeSpinner(`Uninstalling ${id}...`).start();
        let success = 0;
        for (const t of targets) {
          try {
            await toolManager.uninstallMCP(t, id);
            success++;
          } catch {
            // skip individual failures
          }
        }
        spinner.succeed(`Uninstalled ${id} from ${success}/${targets.length} tools`);
        await pause();
      }
    } catch (error) {
      logger.logError('globalMcpMenu', error);
      printError(error instanceof Error ? error.message : String(error), 'Check tool-specific documentation for MCP requirements');
      await pause();
    }
  }
}

