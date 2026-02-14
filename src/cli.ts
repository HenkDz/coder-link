#!/usr/bin/env node
import { Command, Option } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { logger } from './utils/logger.js';
import { i18n } from './utils/i18n.js';
import { configManager } from './utils/config.js';
import { toolManager } from './lib/tool-manager.js';
import type { ToolName } from './lib/tool-manager.js';
import { runMenu } from './menu/main-menu.js';
import { runWizard } from './wizard.js';
import { statusIndicator, planLabel, planLabelColored, toolLabel } from './utils/brand.js';
import { setOutputFormat, getOutputFormat, printData, printError, printInfo } from './utils/output.js';
import { PROVIDER_PLAN_VALUES } from './utils/providers.js';
import { BUILTIN_MCP_SERVICES } from './mcp-services.js';
import type { MCPService } from './lib/tool-manager.js';

const program = new Command();

// Use persisted UI language for all commands
i18n.setLang(configManager.getLang());

// Global options
const jsonOption = new Option('-j, --json', 'Output as JSON for programmatic use');
const formatOption = new Option('-f, --format <format>', 'Output format').choices(['pretty', 'json']).default('pretty');

function getMcpCapableTools(): ToolName[] {
  return getVisibleTools().filter((tool) => toolManager.getCapabilities(tool).supportsMcp);
}

function getVisibleTools(): ToolName[] {
  const enabled = new Set(configManager.getEnabledTools());
  const visible = toolManager.getSupportedTools().filter((tool) => enabled.has(tool));
  return visible.length ? visible : toolManager.getSupportedTools();
}

function resolveMcpTool(explicitTool?: string): ToolName {
  const mcpTools = getMcpCapableTools();
  if (mcpTools.length === 0) {
    throw new Error('No tools support MCP management');
  }

  if (explicitTool) {
    if (!toolManager.isSupportedTool(explicitTool)) {
      throw new Error(`Unsupported tool: ${explicitTool}`);
    }
    if (!toolManager.getCapabilities(explicitTool).supportsMcp) {
      throw new Error(`${toolLabel(explicitTool)} does not support MCP management`);
    }
    return explicitTool;
  }

  const last = configManager.getLastUsedTool();
  if (last && toolManager.isSupportedTool(last) && toolManager.getCapabilities(last).supportsMcp) {
    return last;
  }

  return mcpTools[0];
}

program
  .name('coder-link')
  .description('Coder Link — Connect coding tools to any model/provider')
  .version('0.0.9')
  .addOption(formatOption)
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.format === 'json' || opts.json) {
      setOutputFormat('json');
    }
  });

// Shell completion command
program
  .command('completion')
  .description('Generate shell completion script')
  .option('-s, --shell <shell>', 'Shell type (bash, zsh, fish, pwsh)', 'bash')
  .action(async (options) => {
    const shell = options.shell;
    const providerValues = PROVIDER_PLAN_VALUES.join(' ');
    const providerValuesQuoted = PROVIDER_PLAN_VALUES.map((p) => `'${p}'`).join(', ');
    let script = '';
    
    switch (shell) {
      case 'bash':
        script = `#!/bin/bash
_coder_link_completion() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local commands="init auth lang tools mcp doctor status completion"
  local tools="claude-code opencode crush factory-droid kimi amp pi codex"
  local providers="${providerValues}"
  local services="filesystem github"
  
  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=($(compgen -W "$commands" -- "$cur"))
  elif [[ \${COMP_CWORD} -ge 2 ]]; then
    local subcommand="\${COMP_WORDS[1]}"
    case "$subcommand" in
      auth)
        COMPREPLY=($(compgen -W "${providerValues} revoke reload" -- "$cur"))
        ;;
      tools)
        if [[ "\${COMP_WORDS[2]}" == "install" || "\${COMP_WORDS[2]}" == "uninstall" ]]; then
          COMPREPLY=($(compgen -W "$tools" -- "$cur"))
        else
          COMPREPLY=($(compgen -W "list install uninstall" -- "$cur"))
        fi
        ;;
      mcp)
        if [[ "\${COMP_WORDS[2]}" == "install" || "\${COMP_WORDS[2]}" == "uninstall" ]]; then
          COMPREPLY=($(compgen -W "$services" -- "$cur"))
        else
          COMPREPLY=($(compgen -W "list installed install uninstall" -- "$cur"))
        fi
        ;;
      lang)
        COMPREPLY=($(compgen -W "show set" -- "$cur"))
        ;;
      *)
        COMPREPLY=()
        ;;
    esac
  fi
}
complete -F _coder_link_completion coder-link
`;
        break;
      case 'zsh':
  script = `#compdef coder-link

_coder_link() {
  local curcontext="$curcontext" state line
  typeset -A opt_args
  
  local commands=(init auth lang tools mcp doctor status completion)
  local tools=(claude-code opencode crush factory-droid kimi amp pi codex)
  local providers=(${PROVIDER_PLAN_VALUES.join(' ')})
  local services=(filesystem github)
  
  _arguments -C \
    '1: :->command' \
    '*: :->args'
  
  case "$state" in
    command)
      _describe -t commands "coder-link command" commands
      ;;
    args)
      case "$line[1]" in
        auth)
          _describe -t providers "provider" providers && _values "actions" revoke reload
          ;;
        tools)
          _values "subcommand" list install uninstall
          ;;
        mcp)
          _values "subcommand" list installed install uninstall
          ;;
        lang)
          _values "action" show set
          ;;
      esac
      ;;
  esac
}

_coder_link "$@"
`;
        break;
      case 'fish':
  script = `complete -c coder-link -f

# Commands
complete -c coder-link -n "__fish_use_subcommand" -a "init" -d "Open interactive menu"
complete -c coder-link -n "__fish_use_subcommand" -a "auth" -d "API key management"
complete -c coder-link -n "__fish_use_subcommand" -a "lang" -d "Language management"
complete -c coder-link -n "__fish_use_subcommand" -a "tools" -d "Manage coding tools"
complete -c coder-link -n "__fish_use_subcommand" -a "mcp" -d "Manage MCP services"
complete -c coder-link -n "__fish_use_subcommand" -a "doctor" -d "Inspect system configuration"
complete -c coder-link -n "__fish_use_subcommand" -a "status" -d "Show current status"
complete -c coder-link -n "__fish_use_subcommand" -a "completion" -d "Generate shell completion"

# Auth subcommands
${PROVIDER_PLAN_VALUES.map((provider) => `complete -c coder-link -n "__fish_seen_subcommand_from auth" -a "${provider}"`).join('\n')}
complete -c coder-link -n "__fish_seen_subcommand_from auth" -a "revoke"
`;
        break;
      case 'pwsh':
      case 'powershell':
  script = `Register-ArgumentCompleter -Native -CommandName coder-link -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)
    
    $commands = @('init', 'auth', 'lang', 'tools', 'mcp', 'doctor', 'status', 'completion')
    $tools = @('claude-code', 'opencode', 'crush', 'factory-droid', 'kimi', 'amp', 'pi', 'codex')
    $providers = @(${providerValuesQuoted})
    $services = @('filesystem', 'github')
    
    $commandElements = $commandAst.CommandElements | Select-Object -Skip 1
    $command = $commandElements[0].Value
    
    if ($commandElements.Count -eq 1) {
        $commands | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
            [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
        }
    } else {
        switch ($command) {
            'auth' {
                $providers + @('revoke', 'reload') | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
                }
            }
            'tools' {
                @('list', 'install', 'uninstall') | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
                }
            }
            'mcp' {
                @('list', 'installed', 'install', 'uninstall') | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
                }
            }
        }
    }
}
`;
        break;
      default:
        console.error(`Unknown shell: ${shell}. Supported: bash, zsh, fish, pwsh`);
        process.exit(1);
    }
    
    console.log(script.trim());
  });

// Language commands
program
  .command('lang')
  .description('Language management')
  .addCommand(new Command('show')
    .description('Show current language')
    .action(async () => {
      const lang = configManager.getLang();
      if (getOutputFormat().isJson) {
        printData({ currentLanguage: lang, displayName: lang === 'zh_CN' ? '简体中文' : 'English' });
      } else {
        console.log(i18n.t('lang.current', { lang }));
      }
    })
  )
  .addCommand(new Command('set <lang>')
    .description('Set language (zh_CN or en_US)')
    .action(async (lang: string) => {
      try {
        if (lang !== 'zh_CN' && lang !== 'en_US') {
          throw new Error(`Unsupported language: ${lang}`);
        }
        configManager.setLang(lang);
        i18n.setLang(lang);
        console.log(i18n.t('lang.changed'));
      } catch (error) {
        logger.logError('lang.set', error);
        printError(
          error instanceof Error ? error.message : String(error),
          'Supported languages: zh_CN, en_US'
        );
        process.exit(1);
      }
    })
  );

// Auth commands program
program
  .command('auth')
  .description('API key management')
  .action(async () => {
    // Interactive mode if no subcommand provided
    await runWizard();
  })
  .addCommand(new Command('glm_coding_plan_global [token]')
    .description('Set GLM Coding Plan Global API key')
    .action(async (token?: string) => {
      try {
        if (!token) {
          const { apiKey } = await inquirer.prompt<{ apiKey: string }>([{
            type: 'password',
            name: 'apiKey',
            message: i18n.t('wizard.enter_api_key'),
            validate: (input: string) => input.trim().length > 0 || 'API key cannot be empty'
          }]);
          token = apiKey;
        }
        configManager.setAuth('glm_coding_plan_global', token.trim());
        console.log(i18n.t('auth.set_success'));
      } catch (error) {
        logger.logError('auth.set', error);
        printError(
          error instanceof Error ? error.message : String(error),
          'Run "coder-link auth" for interactive setup'
        );
        process.exit(1);
      }
    })
  )
  .addCommand(new Command('glm_coding_plan_china [token]')
    .description('Set GLM Coding Plan China API key')
    .action(async (token?: string) => {
      try {
        if (!token) {
          const { apiKey } = await inquirer.prompt<{ apiKey: string }>([{
            type: 'password',
            name: 'apiKey',
            message: i18n.t('wizard.enter_api_key'),
            validate: (input: string) => input.trim().length > 0 || 'API key cannot be empty'
          }]);
          token = apiKey;
        }
        configManager.setAuth('glm_coding_plan_china', token.trim());
        console.log(i18n.t('auth.set_success'));
      } catch (error) {
        logger.logError('auth.set', error);
        printError(
          error instanceof Error ? error.message : String(error),
          'Run "coder-link auth" for interactive setup'
        );
        process.exit(1);
      }
    })
  )
  .addCommand(new Command('kimi [token]')
    .description('Set Kimi API key')
    .action(async (token?: string) => {
      try {
        if (!token) {
          const { apiKey } = await inquirer.prompt<{ apiKey: string }>([{
            type: 'password',
            name: 'apiKey',
            message: i18n.t('wizard.enter_api_key'),
            validate: (input: string) => input.trim().length > 0 || 'API key cannot be empty'
          }]);
          token = apiKey;
        }
        configManager.setAuth('kimi', token.trim());
        console.log(i18n.t('auth.set_success'));
      } catch (error) {
        logger.logError('auth.set', error);
        printError(
          error instanceof Error ? error.message : String(error),
          'Run "coder-link auth" for interactive setup'
        );
        process.exit(1);
      }
    })
  )
  .addCommand(new Command('openrouter [token]')
    .description('Set OpenRouter API key')
    .action(async (token?: string) => {
      try {
        if (!token) {
          const { apiKey } = await inquirer.prompt<{ apiKey: string }>([{
            type: 'password',
            name: 'apiKey',
            message: i18n.t('wizard.enter_api_key'),
            validate: (input: string) => input.trim().length > 0 || 'API key cannot be empty'
          }]);
          token = apiKey;
        }
        configManager.setAuth('openrouter', token.trim());
        console.log(i18n.t('auth.set_success'));
      } catch (error) {
        logger.logError('auth.set', error);
        printError(
          error instanceof Error ? error.message : String(error),
          'Run "coder-link auth" for interactive setup'
        );
        process.exit(1);
      }
    })
  )
  .addCommand(new Command('nvidia [token]')
    .description('Set NVIDIA API key')
    .action(async (token?: string) => {
      try {
        if (!token) {
          const { apiKey } = await inquirer.prompt<{ apiKey: string }>([{
            type: 'password',
            name: 'apiKey',
            message: i18n.t('wizard.enter_api_key'),
            validate: (input: string) => input.trim().length > 0 || 'API key cannot be empty'
          }]);
          token = apiKey;
        }
        configManager.setAuth('nvidia', token.trim());
        console.log(i18n.t('auth.set_success'));
      } catch (error) {
        logger.logError('auth.set', error);
        printError(
          error instanceof Error ? error.message : String(error),
          'Run "coder-link auth" for interactive setup'
        );
        process.exit(1);
      }
    })
  )
  .addCommand(new Command('alibaba [token]')
    .description('Set Alibaba Coding Plan API key (monthly plan)')
    .action(async (token?: string) => {
      try {
        if (!token) {
          const { apiKey } = await inquirer.prompt<{ apiKey: string }>([{
            type: 'password',
            name: 'apiKey',
            message: i18n.t('wizard.enter_api_key'),
            validate: (input: string) => input.trim().length > 0 || 'API key cannot be empty'
          }]);
          token = apiKey;
        }
        configManager.setAuth('alibaba', token.trim());
        console.log(i18n.t('auth.set_success'));
      } catch (error) {
        logger.logError('auth.set', error);
        printError(
          error instanceof Error ? error.message : String(error),
          'Run "coder-link auth" for interactive setup'
        );
        process.exit(1);
      }
    })
  )
  .addCommand(new Command('alibaba_api [token]')
    .description('Set Alibaba Model Studio API key (Singapore endpoint)')
    .alias('alibaba-api')
    .action(async (token?: string) => {
      try {
        if (!token) {
          const { apiKey } = await inquirer.prompt<{ apiKey: string }>([{
            type: 'password',
            name: 'apiKey',
            message: i18n.t('wizard.enter_api_key'),
            validate: (input: string) => input.trim().length > 0 || 'API key cannot be empty'
          }]);
          token = apiKey;
        }
        configManager.setAuth('alibaba_api', token.trim());
        console.log(i18n.t('auth.set_success'));
      } catch (error) {
        logger.logError('auth.set', error);
        printError(
          error instanceof Error ? error.message : String(error),
          'Run "coder-link auth" for interactive setup'
        );
        process.exit(1);
      }
    })
  )
  .addCommand(new Command('lmstudio [token]')
    .description('Set LM Studio API key (optional for local use)')
    .action(async (token?: string) => {
      try {
        if (!token) {
          const { apiKey } = await inquirer.prompt<{ apiKey: string }>([{
            type: 'password',
            name: 'apiKey',
            message: `${i18n.t('wizard.enter_api_key')} (leave empty for local LM Studio)`,
          }]);
          token = apiKey;
        }
        const normalized = token.trim() || 'lmstudio';
        configManager.setAuth('lmstudio', normalized);
        console.log(i18n.t('auth.set_success'));
      } catch (error) {
        logger.logError('auth.set', error);
        printError(
          error instanceof Error ? error.message : String(error),
          'Run "coder-link auth" for interactive setup'
        );
        process.exit(1);
      }
    })
  )
  .addCommand(new Command('revoke')
    .description('Delete saved API key')
    .action(async () => {
      try {
        const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
          type: 'confirm',
          name: 'confirm',
          message: 'Revoke all saved API keys?',
          default: false,
        }]);
        if (!confirm) {
          console.log('Cancelled.');
          return;
        }
        configManager.revokeAuth();
        console.log(i18n.t('auth.revoke_success'));
      } catch (error) {
        logger.logError('auth.revoke', error);
        printError(
          error instanceof Error ? error.message : String(error),
          'Manually delete ~/.coder-link/config.yaml if persistent issues'
        );
        process.exit(1);
      }
    })
  )
  .addCommand(new Command('reload <tool>')
    .description('Reload configuration into a tool')
    .action(async (tool: string) => {
      try {
        const { plan, apiKey } = configManager.getAuth();
        if (!plan || !apiKey) {
          printError(
            i18n.t('auth.not_set'),
            'Run "coder-link auth <provider> <token>" to set your API key'
          );
          process.exit(1);
        }
        await toolManager.loadConfig(tool, plan, apiKey);
        console.log(i18n.t('auth.reload_success', { tool }));
      } catch (error) {
        logger.logError('auth.reload', error);
        printError(
          error instanceof Error ? error.message : String(error),
          `Check if "${tool}" is supported and installed`
        );
        process.exit(1);
      }
    })
  );

// Tool management commands
program
  .command('tools')
  .description('Manage coding tools')
  .addCommand(new Command('list')
    .description('List all supported tools')
    .action(async () => {
      const tools = getVisibleTools();
      const toolData = [];
      
      for (const tool of tools) {
        const status = await toolManager.isConfigured(tool);
        toolData.push({
          name: tool,
          label: toolLabel(tool),
          configured: status,
          status: status ? 'configured' : 'not_configured'
        });
      }
      
      if (getOutputFormat().isJson) {
        printData({ tools: toolData });
      } else {
        console.log(i18n.t('tools.list_header'));
        for (const t of toolData) {
          console.log(`  ${statusIndicator(t.configured)} ${t.label}`);
        }
      }
    })
  )
  .addCommand(new Command('install <tool>')
    .description('Install a coding tool')
    .action(async (tool: string) => {
      try {
        await toolManager.installTool(tool);
        console.log(i18n.t('tools.install_success', { tool }));
      } catch (error) {
        logger.logError('tools.install', error);
        printError(
          error instanceof Error ? error.message : String(error),
          `Refer to the "${toolLabel(tool)}" documentation for install instructions`
        );
        process.exit(1);
      }
    })
  )
  .addCommand(new Command('uninstall <tool>')
    .description('Uninstall a coding tool')
    .action(async (tool: string) => {
      try {
        await toolManager.uninstallTool(tool);
        console.log(i18n.t('tools.uninstall_success', { tool }));
      } catch (error) {
        logger.logError('tools.uninstall', error);
        printError(
          error instanceof Error ? error.message : String(error),
          'Tool may already be uninstalled or not managed by coder-link'
        );
        process.exit(1);
      }
    })
  );

// MCP interactive menu helper
const BACK_SIGNAL = Symbol('back');

async function mcpInteractiveMenu(): Promise<void> {
  const mcpTools = getMcpCapableTools();
  if (mcpTools.length === 0) {
    printError('No MCP-capable tools enabled', 'Enable at least one tool that supports MCP');
    process.exit(1);
  }

  const auth = configManager.getAuth();

  // Main action loop
  while (true) {
    // Step 1: Select action
    const { action } = await inquirer.prompt<{ action: 'install' | 'uninstall' | '__back' }>([
      {
        type: 'list',
        name: 'action',
        message: 'Action:',
        choices: [
          { name: '📦 Install MCPs', value: 'install' },
          { name: '🗑 Uninstall MCPs', value: 'uninstall' },
          new inquirer.Separator(),
          { name: chalk.gray('← Back'), value: '__back' as const },
        ],
      },
    ]);

    if (action === '__back') return;

    if (action === 'install') {
      const result = await mcpInstallFlow(mcpTools, auth);
      if (result === BACK_SIGNAL) continue; // Go back to action selection
    } else if (action === 'uninstall') {
      const result = await mcpUninstallFlow(mcpTools);
      if (result === BACK_SIGNAL) continue; // Go back to action selection
    }
  }
}

async function mcpInstallFlow(mcpTools: ToolName[], auth: { plan: string | undefined; apiKey: string | undefined }): Promise<typeof BACK_SIGNAL | void> {
  // Step 2: Select MCPs to install (with back option)
  const mcpChoices = [
    ...BUILTIN_MCP_SERVICES.map((s) => ({
      name: `${s.name} (${s.id})`,
      value: s.id,
      short: s.name,
    })),
    new inquirer.Separator(),
    { name: chalk.gray('← Back'), value: '__back' as const },
  ];

  const { selectedMcps } = await inquirer.prompt<{ selectedMcps: (string | '__back')[] }>([
    {
      type: 'checkbox',
      name: 'selectedMcps',
      message: 'Select MCPs to install: (Press <space> to select, <enter> to confirm)',
      choices: mcpChoices,
      pageSize: 12,
    },
  ]);

  // Check if user wants to go back
  if (selectedMcps.includes('__back') || selectedMcps.length === 0) {
    return BACK_SIGNAL;
  }

  const mcpsToInstall = selectedMcps.filter((id): id is string => id !== '__back');
  
  if (mcpsToInstall.length === 0) {
    return BACK_SIGNAL;
  }

  // Check auth for services that require it
  const servicesRequiringAuth = mcpsToInstall.filter((id) => {
    const s = BUILTIN_MCP_SERVICES.find((svc) => svc.id === id);
    return s?.requiresAuth;
  });

  if (!auth.plan) {
    printError(
      i18n.t('auth.not_set'),
      'Run "coder-link auth <provider> <token>" first to select a provider'
    );
    process.exit(1);
  }
  if (servicesRequiringAuth.length > 0 && !auth.apiKey) {
    printError(
      `Provider API key is required for: ${servicesRequiringAuth.join(', ')}`,
      'Configure your provider first'
    );
    process.exit(1);
  }

  // Step 2.5: Collect missing credentials for MCPs that need env vars (with back option)
  const envVarPrompts: Array<{ mcp: MCPService; varName: string }> = [];
  for (const mcpId of mcpsToInstall) {
    const service = BUILTIN_MCP_SERVICES.find((s) => s.id === mcpId);
    if (!service?.envTemplate) continue;
    
    const planEnv = service.envTemplate[auth.plan || ''] || Object.values(service.envTemplate)[0] || {};
    
    for (const [varName] of Object.entries(planEnv)) {
      if (!process.env[varName]) {
        envVarPrompts.push({ mcp: service, varName });
      }
    }
  }

  // Prompt for missing env vars with option to skip or go back
  if (envVarPrompts.length > 0) {
    console.log(chalk.yellow('\nSome MCPs require environment variables:'));
    
    // First ask if user wants to provide them or skip
    const { provideCreds } = await inquirer.prompt<{ provideCreds: 'provide' | 'skip' | '__back' }>([
      {
        type: 'list',
        name: 'provideCreds',
        message: `Missing ${envVarPrompts.length} env var(s). What would you like to do?`,
        choices: [
          { name: '✏️  Provide credentials now', value: 'provide' },
          { name: '⏭️  Skip (MCPs may not work without credentials)', value: 'skip' },
          new inquirer.Separator(),
          { name: chalk.gray('← Back'), value: '__back' as const },
        ],
      },
    ]);

    if (provideCreds === '__back') {
      return BACK_SIGNAL;
    }

    if (provideCreds === 'provide') {
      const seenVars = new Set<string>();
      for (const { mcp, varName } of envVarPrompts) {
        if (seenVars.has(varName)) continue;
        seenVars.add(varName);

        const { value } = await inquirer.prompt<{ value: string }>([
          {
            type: 'input',
            name: 'value',
            message: `${varName} (for ${mcp.name}):`,
            validate: (input) => input.trim().length > 0 || `${varName} is required`,
          },
        ]);
        process.env[varName] = value.trim();
      }
    }
    console.log();
  }

  // Step 3: Select target (with back option)
  const { target } = await inquirer.prompt<{ target: ToolName | 'all' | '__back' }>([
    {
      type: 'list',
      name: 'target',
      message: 'Install to:',
      choices: [
        { name: `All MCP-capable tools (${mcpTools.length})`, value: 'all' },
        new inquirer.Separator(),
        ...mcpTools.map((t) => ({
          name: toolLabel(t),
          value: t,
        })),
        new inquirer.Separator(),
        { name: chalk.gray('← Back'), value: '__back' as const },
      ],
    },
  ]);

  if (target === '__back') {
    return BACK_SIGNAL;
  }

  const targetTools = target === 'all' ? mcpTools : [target];
  let totalSuccess = 0;
  let totalAttempts = targetTools.length * mcpsToInstall.length;

  for (const mcpId of mcpsToInstall) {
    const service = BUILTIN_MCP_SERVICES.find((s) => s.id === mcpId)!;
    for (const tool of targetTools) {
      try {
        await toolManager.installMCP(tool, service, auth.apiKey || '', auth.plan);
        totalSuccess++;
      } catch {
        // skip individual failures
      }
    }
  }

  console.log(chalk.green(`✓ Installed ${totalSuccess}/${totalAttempts} MCP configurations`));
  if (totalSuccess < totalAttempts) {
    printInfo('Some installations skipped due to compatibility or tool-specific constraints.');
  }
}

async function mcpUninstallFlow(mcpTools: ToolName[]): Promise<typeof BACK_SIGNAL | void> {
  // Get all installed MCPs across all tools
  const allInstalled = new Map<string, Set<ToolName>>();
  for (const tool of mcpTools) {
    const installed = await toolManager.getInstalledMCPs(tool);
    for (const id of installed) {
      if (!allInstalled.has(id)) allInstalled.set(id, new Set());
      allInstalled.get(id)!.add(tool);
    }
  }

  if (allInstalled.size === 0) {
    printInfo('No MCPs are currently installed.');
    return;
  }

  // Step 2: Select MCPs to uninstall (with back option)
  const mcpChoices = [
    ...Array.from(allInstalled.entries()).map(([id, tools]) => ({
      name: `${id} (${tools.size} tool${tools.size > 1 ? 's' : ''})`,
      value: id,
      short: id,
    })),
    new inquirer.Separator(),
    { name: chalk.gray('← Back'), value: '__back' as const },
  ];

  const { selectedMcps } = await inquirer.prompt<{ selectedMcps: (string | '__back')[] }>([
    {
      type: 'checkbox',
      name: 'selectedMcps',
      message: 'Select MCPs to uninstall: (Press <space> to select, <enter> to confirm)',
      choices: mcpChoices,
      pageSize: 12,
    },
  ]);

  // Check if user wants to go back
  if (selectedMcps.includes('__back') || selectedMcps.length === 0) {
    return BACK_SIGNAL;
  }

  const mcpsToUninstall = selectedMcps.filter((id): id is string => id !== '__back');
  
  if (mcpsToUninstall.length === 0) {
    return BACK_SIGNAL;
  }

  // Step 3: Select target (with back option)
  const { target } = await inquirer.prompt<{ target: ToolName | 'all' | '__back' }>([
    {
      type: 'list',
      name: 'target',
      message: 'Uninstall from:',
      choices: [
        { name: `All tools`, value: 'all' },
        new inquirer.Separator(),
        ...mcpTools.map((t) => ({
          name: toolLabel(t),
          value: t,
        })),
        new inquirer.Separator(),
        { name: chalk.gray('← Back'), value: '__back' as const },
      ],
    },
  ]);

  if (target === '__back') {
    return BACK_SIGNAL;
  }

  const targetTools = target === 'all' ? mcpTools : [target];
  let totalSuccess = 0;
  let totalAttempts = 0;

  for (const mcpId of mcpsToUninstall) {
    for (const tool of targetTools) {
      const installed = await toolManager.getInstalledMCPs(tool);
      if (installed.includes(mcpId)) {
        totalAttempts++;
        try {
          await toolManager.uninstallMCP(tool, mcpId);
          totalSuccess++;
        } catch {
          // skip individual failures
        }
      }
    }
  }

  if (totalAttempts === 0) {
    printInfo('Selected MCPs were not installed in the target tools.');
  } else {
    console.log(chalk.green(`✓ Uninstalled ${totalSuccess}/${totalAttempts} MCP configurations`));
  }
}

// MCP commands
program
  .command('mcp')
  .description('Manage MCP services (interactive when no subcommand)')
  .action(async () => {
    // When no subcommand, launch interactive menu
    await mcpInteractiveMenu();
  })
  .addCommand(new Command('list')
    .description('List available MCP services')
    .action(async () => {
      const services = BUILTIN_MCP_SERVICES.map((service) => ({
        id: service.id,
        name: service.name,
        description: service.description || '',
        protocol: service.protocol,
      }));
      const mcpTools = getMcpCapableTools();
      
      if (getOutputFormat().isJson) {
        printData({ services, tools: mcpTools });
      } else {
        console.log(i18n.t('mcp.list_header'));
        for (const service of services) {
          console.log(`  ${service.id}: ${service.name} - ${service.description} [${service.protocol}]`);
        }
        console.log(`\nMCP-capable tools: ${mcpTools.map((t) => toolLabel(t)).join(', ')}`);
      }
    })
  )
  .addCommand(new Command('installed')
    .description('List installed MCP services')
    .option('-t, --tool <tool>', 'Target tool (defaults to last used MCP-capable tool)')
    .action(async (options: { tool?: string }) => {
      const targetTool = resolveMcpTool(options.tool);
      const installed = await toolManager.getInstalledMCPs(targetTool);
      
      if (getOutputFormat().isJson) {
        printData({ tool: targetTool, installed });
      } else {
        console.log(`${i18n.t('mcp.installed_header')} (${toolLabel(targetTool)})`);
        for (const id of installed) {
          console.log(`  ${id}`);
        }
        if (installed.length === 0) {
          console.log('  (none)');
        }
      }
    })
  )
  .addCommand(new Command('install [service]')
    .description('Install an MCP service (interactive if no service specified)')
    .option('-t, --tool <tool>', 'Target tool (defaults to last used MCP-capable tool)')
    .action(async (serviceId: string | undefined, options: { tool?: string }) => {
      // If no service provided, launch interactive menu
      if (!serviceId) {
        await mcpInteractiveMenu();
        return;
      }

      try {
        const targetTool = resolveMcpTool(options.tool);
        const auth = configManager.getAuth();

        const service = BUILTIN_MCP_SERVICES.find((s) => s.id === serviceId);
        if (!service) {
          throw new Error(`Unknown MCP service: ${serviceId}`);
        }

        if (!auth.plan) {
          printError(
            i18n.t('auth.not_set'),
            'Run "coder-link auth <provider> <token>" first to select a provider'
          );
          process.exit(1);
        }
        if (service.requiresAuth && !auth.apiKey) {
          throw new Error(`Provider API key is required to install "${serviceId}"`);
        }

        await toolManager.installMCP(targetTool, service, auth.apiKey || '', auth.plan);
        console.log(`${i18n.t('mcp.install_success', { service: serviceId })} (${toolLabel(targetTool)})`);
      } catch (error) {
        logger.logError('mcp.install', error);
        printError(
          error instanceof Error ? error.message : String(error),
          'Check provider auth and tool compatibility'
        );
        process.exit(1);
      }
    })
  )
  .addCommand(new Command('uninstall <service>')
    .description('Uninstall an MCP service')
    .option('-t, --tool <tool>', 'Target tool (defaults to last used MCP-capable tool)')
    .action(async (serviceId: string, options: { tool?: string }) => {
      try {
        const targetTool = resolveMcpTool(options.tool);
        await toolManager.uninstallMCP(targetTool, serviceId);
        console.log(`${i18n.t('mcp.uninstall_success', { service: serviceId })} (${toolLabel(targetTool)})`);
      } catch (error) {
        logger.logError('mcp.uninstall', error);
        printError(
          error instanceof Error ? error.message : String(error),
          'Service may not be installed for the selected tool'
        );
        process.exit(1);
      }
    })
  );

// Health check
program
  .command('doctor')
  .description('Inspect system configuration and tool status')
  .addOption(jsonOption)
  .action(async (options) => {
    try {
      const { plan, apiKey } = configManager.getAuth();
      const tools = getVisibleTools();
      const toolStatuses = [];
      
      for (const tool of tools) {
        const caps = toolManager.getCapabilities(tool);
        const status = caps.supportsProviderConfig ? await toolManager.isConfigured(tool) : false;
        toolStatuses.push({ tool, configured: status, capabilities: caps });
      }

      const mcpByTool: Record<string, string[]> = {};
      for (const tool of tools) {
        if (!toolManager.getCapabilities(tool).supportsMcp) continue;
        mcpByTool[tool] = await toolManager.getInstalledMCPs(tool);
      }
      
      if (options.json) {
        setOutputFormat('json');
        printData({
          configPath: configManager.configPath,
          currentProvider: plan || null,
          hasApiKey: !!apiKey,
          tools: toolStatuses,
          mcps: mcpByTool
        });
      } else {
        console.log(i18n.t('doctor.header'));
        console.log(i18n.t('doctor.config_path', { path: configManager.configPath }));
        console.log(i18n.t('doctor.current_auth'));
        if (plan && apiKey) {
          console.log(`  ${i18n.t('doctor.plan')}: ${planLabel(plan)}`);
          console.log(`  ${i18n.t('doctor.api_key')}: ${apiKey.substring(0, 8)}...`);
        } else {
          console.log(`  ${i18n.t('doctor.not_set')}`);
        }
        console.log('\n' + i18n.t('doctor.tools_header'));
        for (const t of toolStatuses) {
          const status = t.capabilities.supportsProviderConfig ? statusIndicator(t.configured) : '○';
          const suffix = t.capabilities.supportsProviderConfig ? '' : ' (launch only)';
          console.log(`  ${status} ${toolLabel(t.tool)}${suffix}`);
        }
        console.log('\n' + i18n.t('doctor.mcp_header'));
        const entries = Object.entries(mcpByTool);
        if (entries.length === 0) {
          console.log(`  ${i18n.t('doctor.none')}`);
        } else {
          let hasAny = false;
          for (const [tool, services] of entries) {
            if (services.length === 0) continue;
            hasAny = true;
            console.log(`  ${toolLabel(tool)}: ${services.join(', ')}`);
          }
          if (!hasAny) {
            console.log(`  ${i18n.t('doctor.none')}`);
          }
        }
      }
    } catch (error) {
      logger.logError('doctor', error);
      printError(
        error instanceof Error ? error.message : String(error),
        'Your config file may be corrupted. Try deleting ~/.coder-link/config.yaml'
      );
      process.exit(1);
    }
  });

// Quick status command
program
  .command('status')
  .description('Show current configuration status')
  .addOption(jsonOption)
  .action(async (options) => {
    try {
      const { plan, apiKey } = configManager.getAuth();
      const hasProvider = !!(plan && apiKey);
      
      // Tool status summary
      const tools = getVisibleTools();
      let configured = 0;
      let total = 0;
      const toolDetails: Array<{ tool: string; label: string; configured: boolean; supportsProviderConfig: boolean }> = [];
      
      for (const tool of tools) {
        const caps = toolManager.getCapabilities(tool);
        const isConfigured = caps.supportsProviderConfig ? await toolManager.isConfigured(tool) : false;
        if (caps.supportsProviderConfig) {
          total++;
          if (isConfigured) configured++;
        }
        toolDetails.push({
          tool,
          label: toolLabel(tool),
          configured: isConfigured,
          supportsProviderConfig: caps.supportsProviderConfig,
        });
      }
      
      // MCP status
      const mcpByTool: Record<string, string[]> = {};
      for (const tool of tools) {
        if (!toolManager.getCapabilities(tool).supportsMcp) continue;
        mcpByTool[tool] = await toolManager.getInstalledMCPs(tool);
      }
      const mcpTotal = Object.values(mcpByTool).reduce((sum, ids) => sum + ids.length, 0);
      
      if (options.json) {
        setOutputFormat('json');
        printData({
          provider: {
            configured: hasProvider,
            plan: plan || null,
            apiKeyMasked: apiKey ? `${apiKey.substring(0, 4)}****` : null
          },
          tools: {
            configured,
            total,
            details: toolDetails
          },
          mcps: {
            count: mcpTotal,
            byTool: mcpByTool
          },
          configPath: configManager.configPath
        });
      } else {
        // Unified status format matching menu display
        const providerStatus = plan ? chalk.green('●') : chalk.gray('○');
        const providerLabel = plan ? planLabelColored(plan) : chalk.yellow('Not configured');
        const keyDisplay = apiKey ? `${chalk.green(`${apiKey.substring(0, 4)}****`)}` : chalk.yellow('Not set');
        
        console.log(`Provider: ${providerStatus} ${providerLabel} (API Key: ${keyDisplay})`);
        
        const toolStatus = configured === total 
          ? chalk.green('●') 
          : configured > 0 
            ? chalk.yellow('◐') 
            : chalk.gray('○');
        console.log(`Tools: ${toolStatus} ${configured}/${total} configured`);
        
        // Show tool breakdown
        for (const t of toolDetails) {
          const status = t.supportsProviderConfig
            ? (t.configured ? chalk.green('●') : chalk.gray('○'))
            : chalk.gray('○');
          const suffix = t.supportsProviderConfig ? '' : chalk.gray(' (launch only)');
          console.log(`  ${status} ${t.label}${suffix}`);
        }
        
        const mcpStatus = mcpTotal > 0 ? chalk.green('●') : chalk.gray('○');
        console.log(`MCPs: ${mcpStatus} ${mcpTotal} installed`);
        for (const [tool, services] of Object.entries(mcpByTool)) {
          if (services.length === 0) continue;
          console.log(`  ${toolLabel(tool)}: ${services.join(', ')}`);
        }
        
        console.log(`\nConfig: ${chalk.gray(configManager.configPath)}`);
      }
    } catch (error) {
      logger.logError('status', error);
      printError(
        error instanceof Error ? error.message : String(error),
        'Run "coder-link doctor" for detailed diagnostics'
      );
      process.exit(1);
    }
  });

// Init wizard
program
  .command('init')
  .description('Open interactive menu')
  .action(async () => {
    try {
      await runMenu();
    } catch (error) {
      logger.logError('init', error);
      printError(
        error instanceof Error ? error.message : String(error),
        'Try running with "coder-link --help" to see available commands'
      );
      process.exit(1);
    }
  });

// Wizard command (backward compatibility)
program
  .command('wizard')
  .description('Run setup wizard (deprecated, use "init")')
  .action(async () => {
    console.log(chalk.yellow('Note: "wizard" is deprecated. Use "coder-link init" instead.'));
    await runWizard();
  });

// Default action: run wizard (interactive), otherwise show help.
if (process.argv.length <= 2) {
  const isInteractive = !!process.stdin.isTTY && !!process.stdout.isTTY;
  if (isInteractive) {
    runMenu().catch((error) => {
      logger.logError('menu', error);
      printError(
        error instanceof Error ? error.message : String(error),
        'Run "coder-link --help" for usage information'
      );
      process.exit(1);
    });
  } else {
    program.help();
  }
} else {
  program.parse();
}
