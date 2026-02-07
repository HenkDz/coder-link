#!/usr/bin/env node
import { Command, Option } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { logger } from './utils/logger.js';
import { i18n } from './utils/i18n.js';
import { configManager } from './utils/config.js';
import { toolManager } from './lib/tool-manager.js';
import { runMenu } from './menu.js';
import { runWizard } from './wizard.js';
import { statusIndicator, planLabel, planLabelColored, toolLabel } from './utils/brand.js';
import { setOutputFormat, getOutputFormat, printData, printError } from './utils/output.js';
import { configManager as config } from './utils/config.js';

const program = new Command();

// Use persisted UI language for all commands
i18n.setLang(configManager.getLang());

// Global options
const jsonOption = new Option('-j, --json', 'Output as JSON for programmatic use');
const formatOption = new Option('-f, --format <format>', 'Output format').choices(['pretty', 'json']).default('pretty');

program
  .name('coder-link')
  .description('Coder Link — Connect coding tools to any model/provider')
  .version('0.0.8')
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
    let script = '';
    
    switch (shell) {
      case 'bash':
        script = `#!/bin/bash
_coder_link_completion() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local commands="init auth lang tools doctor status completion"
  local tools="claude-code opencode crush factory-droid kimi amp pi"
  local providers="glm_coding_plan_global glm_coding_plan_china kimi openrouter nvidia"
  local services="filesystem github"
  
  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=($(compgen -W "$commands" -- "$cur"))
  elif [[ \${COMP_CWORD} -ge 2 ]]; then
    local subcommand="\${COMP_WORDS[1]}"
    case "$subcommand" in
      auth)
        COMPREPLY=($(compgen -W "glm_coding_plan_global glm_coding_plan_china kimi openrouter nvidia revoke reload" -- "$cur"))
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
  
  local commands=(init auth lang tools doctor status completion)
  local tools=(claude-code opencode crush factory-droid kimi amp pi)
  local providers=(glm_coding_plan_global glm_coding_plan_china kimi openrouter nvidia)
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
complete -c coder-link -n "__fish_seen_subcommand_from auth" -a "glm_coding_plan_global"
complete -c coder-link -n "__fish_seen_subcommand_from auth" -a "glm_coding_plan_china"
complete -c coder-link -n "__fish_seen_subcommand_from auth" -a "kimi"
complete -c coder-link -n "__fish_seen_subcommand_from auth" -a "openrouter"
complete -c coder-link -n "__fish_seen_subcommand_from auth" -a "nvidia"
complete -c coder-link -n "__fish_seen_subcommand_from auth" -a "revoke"
`;
        break;
      case 'pwsh':
      case 'powershell':
  script = `Register-ArgumentCompleter -Native -CommandName coder-link -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)
    
    $commands = @('init', 'auth', 'lang', 'tools', 'mcp', 'doctor', 'status', 'completion')
    $tools = @('claude-code', 'opencode', 'crush', 'factory-droid', 'kimi', 'amp', 'pi')
    $providers = @('glm_coding_plan_global', 'glm_coding_plan_china', 'kimi', 'openrouter', 'nvidia')
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
      const tools = toolManager.getSupportedTools();
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

// MCP commands
program
  .command('mcp')
  .description('Manage MCP services')
  .addCommand(new Command('list')
    .description('List available MCP services')
    .action(async () => {
      const services = [
        { id: 'filesystem', name: 'Filesystem', description: 'File system operations' },
        { id: 'github', name: 'GitHub', description: 'GitHub integration' }
      ];
      
      if (getOutputFormat().isJson) {
        printData({ services });
      } else {
        console.log(i18n.t('mcp.list_header'));
        for (const service of services) {
          console.log(`  ${service.id}: ${service.name} - ${service.description}`);
        }
      }
    })
  )
  .addCommand(new Command('installed')
    .description('List installed MCP services')
    .action(async () => {
      const { kimiManager } = await import('./lib/kimi-manager.js');
      const installed = kimiManager.getInstalledMCPs();
      
      if (getOutputFormat().isJson) {
        printData({ installed });
      } else {
        console.log(i18n.t('mcp.installed_header'));
        for (const id of installed) {
          console.log(`  ${id}`);
        }
      }
    })
  )
  .addCommand(new Command('install <service>')
    .description('Install an MCP service')
    .action(async (serviceId: string) => {
      try {
        const { kimiManager } = await import('./lib/kimi-manager.js');
        const { toolManager } = await import('./lib/tool-manager.js');
        const { configManager } = await import('./utils/config.js');
        const auth = configManager.getAuth();
        if (!auth.plan || !auth.apiKey) {
          printError(
            i18n.t('auth.not_set'),
            'Run "coder-link auth <provider> <token>" first'
          );
          process.exit(1);
        }
        const service = {
          id: serviceId,
          name: serviceId,
          description: '',
          protocol: 'stdio' as const,
          command: 'npx',
          args: [`-y`, `@modelcontextprotocol/server-${serviceId}`, '/'],
          requiresAuth: false
        };
        await toolManager.installMCP('kimi', service, auth.apiKey, auth.plan);
        console.log(i18n.t('mcp.install_success', { service: serviceId }));
      } catch (error) {
        logger.logError('mcp.install', error);
        printError(
          error instanceof Error ? error.message : String(error),
          'Check that Node.js and npm are installed correctly'
        );
        process.exit(1);
      }
    })
  )
  .addCommand(new Command('uninstall <service>')
    .description('Uninstall an MCP service')
    .action(async (serviceId: string) => {
      try {
        const { kimiManager } = await import('./lib/kimi-manager.js');
        await kimiManager.uninstallMCP(serviceId);
        console.log(i18n.t('mcp.uninstall_success', { service: serviceId }));
      } catch (error) {
        logger.logError('mcp.uninstall', error);
        printError(
          error instanceof Error ? error.message : String(error),
          'Service may not be installed'
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
      const tools = toolManager.getSupportedTools();
      const toolStatuses = [];
      
      for (const tool of tools) {
        const status = await toolManager.isConfigured(tool);
        toolStatuses.push({ tool, configured: status });
      }
      
      const { kimiManager } = await import('./lib/kimi-manager.js');
      const mcpInstalled = kimiManager.getInstalledMCPs();
      
      if (options.json) {
        setOutputFormat('json');
        printData({
          configPath: configManager.configPath,
          currentProvider: plan || null,
          hasApiKey: !!apiKey,
          tools: toolStatuses,
          mcps: mcpInstalled
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
          console.log(`  ${statusIndicator(t.configured)} ${toolLabel(t.tool)}`);
        }
        console.log('\n' + i18n.t('doctor.mcp_header'));
        if (mcpInstalled.length === 0) {
          console.log(`  ${i18n.t('doctor.none')}`);
        } else {
          for (const id of mcpInstalled) {
            console.log(`  ${id}`);
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
      const tools = toolManager.getSupportedTools();
      let configured = 0;
      let total = tools.length;
      let toolDetails = [];
      
      for (const tool of tools) {
        const isConfigured = await toolManager.isConfigured(tool);
        if (isConfigured) configured++;
        toolDetails.push({ tool, label: toolLabel(tool), configured: isConfigured });
      }
      
      // MCP status
      const { kimiManager } = await import('./lib/kimi-manager.js');
      const mcps = kimiManager.getInstalledMCPs();
      
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
            count: mcps.length,
            installed: mcps
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
          const status = t.configured ? chalk.green('●') : chalk.gray('○');
          console.log(`  ${status} ${t.label}`);
        }
        
        const mcpStatus = mcps.length > 0 ? chalk.green('●') : chalk.gray('○');
        console.log(`MCPs: ${mcpStatus} ${mcps.length} installed`);
        
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
