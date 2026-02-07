import inquirer from 'inquirer';
import { configManager } from './utils/config.js';
import type { Plan } from './utils/config.js';
import { i18n } from './utils/i18n.js';
import { toolManager } from './lib/tool-manager.js';
import { logger } from './utils/logger.js';
import { BUILTIN_MCP_SERVICES } from './mcp-services.js';

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
  const { plan } = await inquirer.prompt<{ plan: Plan }>([
    {
      type: 'list',
      name: 'plan',
      message: i18n.t('wizard.select_plan'),
      choices: [
        { name: 'GLM Coding Plan (Global)', value: 'glm_coding_plan_global' },
        { name: 'GLM Coding Plan (China)', value: 'glm_coding_plan_china' },
        { name: 'Kimi', value: 'kimi' },
        { name: 'OpenRouter', value: 'openrouter' },
        { name: 'NVIDIA', value: 'nvidia' }
      ]
    }
  ]);

  // API key input
  const { apiKey } = await inquirer.prompt<{ apiKey: string }>([
    {
      type: 'password',
      name: 'apiKey',
      message: i18n.t('wizard.enter_api_key'),
      validate: (input: string) => input.trim().length > 0 || i18n.t('cli.error_general', { error: 'API key cannot be empty' })
    }
  ]);

  const trimmed = apiKey.trim();
  if (!trimmed) {
    throw new Error('API key cannot be empty');
  }
  configManager.setAuth(plan, trimmed);

  // Tool selection
  const tools = toolManager.getSupportedTools();
  const { selectedTools } = await inquirer.prompt<{ selectedTools: string[] }>([
    {
      type: 'checkbox',
      name: 'selectedTools',
      message: i18n.t('wizard.select_tools'),
      choices: tools.map(tool => ({ name: tool, value: tool }))
    }
  ]);

  // Load config into selected tools
  console.log(`\n${i18n.t('wizard.loading_plan')}`);
  for (const tool of selectedTools) {
    try {
      await toolManager.loadConfig(tool, plan, apiKey.trim());
      console.log(`  ✓ ${tool}`);
    } catch (error) {
      logger.logError('wizard.loadConfig', error);
      console.log(`  ✗ ${tool}: ${error instanceof Error ? error.message : String(error)}`);
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
    console.log(`\n${i18n.t('mcp.list_header')}`);
    for (const service of BUILTIN_MCP_SERVICES) {
      const installed = await toolManager.isMCPInstalled('kimi', service.id);
      console.log(`  ${installed ? '✓' : ' '} ${service.id}: ${service.name}`);
    }

    const { installMCPs } = await inquirer.prompt<{ installMCPs: string[] }>([
      {
        type: 'checkbox',
        name: 'installMCPs',
        message: 'Select MCP services to install:',
        choices: BUILTIN_MCP_SERVICES.map(s => ({ name: `${s.name} (${s.id})`, value: s.id }))
      }
    ]);

    for (const mcpId of installMCPs) {
      const mcp = BUILTIN_MCP_SERVICES.find(s => s.id === mcpId)!;
      try {
        await toolManager.installMCP('kimi', mcp, apiKey.trim(), plan);
        console.log(`  ✓ ${mcpId} installed`);
      } catch (error) {
        logger.logError('wizard.installMCP', error);
        console.log(`  ✗ ${mcpId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  console.log(`\n${i18n.t('wizard.complete')}\n`);
  const auth = configManager.getAuth();
  console.log(i18n.t('doctor.config_path', { path: auth.plan ? configManager.configPath : 'N/A' }));
}
