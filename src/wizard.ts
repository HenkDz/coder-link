import inquirer from 'inquirer';
import { configManager } from './utils/config.js';
import type { Plan } from './utils/config.js';
import { i18n } from './utils/i18n.js';
import { toolManager } from './lib/tool-manager.js';
import { logger } from './utils/logger.js';
import { BUILTIN_MCP_SERVICES } from './mcp-services.js';
import { PROVIDER_CHOICES, providerProtocolSummary } from './utils/providers.js';
import { toolLabel, planLabel } from './utils/brand.js';
import { printWarning, printInfo, printSuccess } from './utils/output.js';
import {
  checkLMStudioStatus,
  requiresHealthCheck,
  getLMStudioDefaultPorts,
} from './lib/provider-registry.js';

export async function runWizard() {
  console.log(`\n${i18n.t('wizard.welcome')}\n`);

  // Language selection
  const { lang } = await inquirer.prompt<{ lang: 'zh_CN' | 'en_US' }>([
    {
      type: 'list',
      name: 'lang',
      message: i18n.t('wizard.select_language'),
      choices: [
        { name: '简体中文', value: 'zh_CN' },
        { name: 'English', value: 'en_US' }
      ],
      default: configManager.getLang()
    }
  ]);

  configManager.setLang(lang);
  i18n.setLang(lang);

  // Plan selection
  const enabledProviders = new Set(configManager.getEnabledProviders());
  const visibleProviders = PROVIDER_CHOICES.filter((p) => enabledProviders.has(p.value));
  const providerChoices = visibleProviders.length ? visibleProviders : PROVIDER_CHOICES;

  const { plan } = await inquirer.prompt<{ plan: Plan }>([
    {
      type: 'list',
      name: 'plan',
      message: i18n.t('wizard.select_plan'),
      choices: providerChoices.map((p) => ({
        name: `${p.name} [${providerProtocolSummary(p.value)}]`,
        value: p.value,
      }))
    }
  ]);

  // Healthcheck for local providers (Recommendation #1)
  if (requiresHealthCheck(plan)) {
    console.log();
    printInfo(`Checking ${planLabel(plan)} server availability...`);
    
    if (plan === 'lmstudio') {
      const status = await checkLMStudioStatus(undefined, { timeoutMs: 5000 });
      
      if (!status.reachable) {
        const defaultPorts = getLMStudioDefaultPorts();
        printWarning(
          `LM Studio server is not reachable on ports ${defaultPorts.join('/')}.`,
          'Please start LM Studio and load a model before continuing.'
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
          printInfo('Wizard cancelled. Please start LM Studio and try again.');
          return;
        }
      } else if (!status.modelLoaded) {
        printWarning(
          `LM Studio is running but no model is loaded.`,
          'Please load a model in LM Studio before making API calls.'
        );
        
        if (status.actualUrl) {
          printInfo(`Connected to: ${status.actualUrl}`);
        }
      } else {
        printSuccess(`LM Studio is running with model: ${status.modelId}`);
        if (status.actualUrl) {
          printInfo(`Connected to: ${status.actualUrl}`);
        }
      }
    }
    console.log();
  }

  // API key input
  const isLocalProvider = plan === 'lmstudio';
  const { apiKey } = await inquirer.prompt<{ apiKey: string }>([
    {
      type: 'password',
      name: 'apiKey',
      message: i18n.t('wizard.enter_api_key'),
      validate: (input: string) => {
        if (isLocalProvider) return true;
        return input.trim().length > 0 || i18n.t('cli.error_general', { error: 'API key cannot be empty' });
      }
    }
  ]);

  const trimmed = apiKey.trim() || (isLocalProvider ? 'lmstudio' : '');
  if (!trimmed && !isLocalProvider) {
    throw new Error('API key cannot be empty');
  }
  configManager.setAuth(plan, trimmed);

  // Tool selection
  const enabledTools = new Set(configManager.getEnabledTools());
  const allTools = toolManager.getSupportedTools();
  const tools = allTools.filter((tool) => enabledTools.has(tool));
  const visibleTools = tools.length ? tools : allTools;
  const { selectedTools } = await inquirer.prompt<{ selectedTools: string[] }>([
    {
      type: 'checkbox',
      name: 'selectedTools',
      message: i18n.t('wizard.select_tools'),
      choices: visibleTools.map((tool) => {
        const caps = toolManager.getCapabilities(tool);
        const mode = caps.supportsProviderConfig ? '' : ' (launch only)';
        const mcp = caps.supportsMcp ? '' : ' [no MCP]';
        return { name: `${toolLabel(tool)}${mode}${mcp}`, value: tool };
      })
    }
  ]);

  // Load config into selected tools
  console.log(`\n${i18n.t('wizard.loading_plan')}`);
  for (const tool of selectedTools) {
    try {
      const caps = toolManager.getCapabilities(tool);
      if (!caps.supportsProviderConfig) {
        console.log(`  ○ ${toolLabel(tool)} (launch-only, skipped provider sync)`);
        continue;
      }
      if (!toolManager.isPlanSupported(tool, plan)) {
        console.log(`  ✗ ${toolLabel(tool)}: ${planLabel(plan)} is not supported`);
        continue;
      }
      await toolManager.loadConfig(tool, plan, trimmed);
      console.log(`  ✓ ${toolLabel(tool)}`);
    } catch (error) {
      logger.logError('wizard.loadConfig', error);
      console.log(`  ✗ ${toolLabel(tool)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // MCP management
  const { manageMCP } = await inquirer.prompt<{ manageMCP: boolean }>([
    {
      type: 'confirm',
      name: 'manageMCP',
      message: i18n.t('wizard.manage_mcp'),
      default: false
    }
  ]);

  if (manageMCP) {
    const mcpCapableTools = selectedTools.filter((tool) => toolManager.getCapabilities(tool).supportsMcp);
    if (mcpCapableTools.length === 0) {
      console.log('\nNo selected tools support MCP management. Skipping MCP setup.');
    } else {
      const { target } = await inquirer.prompt<{ target: string }>([
        {
          type: 'list',
          name: 'target',
          message: 'Apply MCP changes to:',
          choices: [
            ...mcpCapableTools.map((tool) => ({ name: toolLabel(tool), value: tool })),
            ...(mcpCapableTools.length > 1
              ? [{ name: 'All MCP-capable selected tools', value: '__all' }]
              : []),
          ],
        },
      ]);

      const targetTools = target === '__all' ? mcpCapableTools : [target];

      for (const targetTool of targetTools) {
        console.log(`\n${i18n.t('mcp.list_header')} (${toolLabel(targetTool)})`);
        for (const service of BUILTIN_MCP_SERVICES) {
          const installed = await toolManager.isMCPInstalled(targetTool, service.id);
          console.log(`  ${installed ? '✓' : ' '} ${service.id}: ${service.name}`);
        }
      }

      const { installMCPs } = await inquirer.prompt<{ installMCPs: string[] }>([
        {
          type: 'checkbox',
          name: 'installMCPs',
          message: 'Select MCP services to install:',
          choices: BUILTIN_MCP_SERVICES.map(s => ({ name: `${s.name} (${s.id})`, value: s.id }))
        }
      ]);

      for (const targetTool of targetTools) {
        console.log(`\nInstalling on ${toolLabel(targetTool)}:`);
        for (const mcpId of installMCPs) {
          const mcp = BUILTIN_MCP_SERVICES.find(s => s.id === mcpId)!;
          try {
            await toolManager.installMCP(targetTool, mcp, trimmed, plan);
            console.log(`  ✓ ${mcpId} installed`);
          } catch (error) {
            logger.logError('wizard.installMCP', error);
            console.log(`  ✗ ${mcpId}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
    }
  }

  console.log(`\n${i18n.t('wizard.complete')}\n`);
  const auth = configManager.getAuth();
  console.log(i18n.t('doctor.config_path', { path: auth.plan ? configManager.configPath : 'N/A' }));
}
