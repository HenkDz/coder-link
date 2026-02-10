import inquirer from 'inquirer';
import chalk from 'chalk';

import { configManager } from '../utils/config.js';
import type { Plan } from '../utils/config.js';
import { i18n } from '../utils/i18n.js';
import { logger } from '../utils/logger.js';
import { printSplash, printStatusBar, printNavigationHints, printConfigPathHint } from '../utils/brand.js';
import { printError, printSuccess, printInfo } from '../utils/output.js';
import { providerMenu } from './provider-menu.js';
import { toolSelectMenu } from './tool-menu.js';
import { diagnosticsMenu, logsMenu } from './system-menu.js';
import { initMenuTerminalGuards, providerSummary, pause } from './shared.js';

export async function runMenu(): Promise<void> {
  i18n.setLang(configManager.getLang());
  initMenuTerminalGuards();

  console.clear();
  printSplash();
  printConfigPathHint(configManager.configPath);
  await new Promise((r) => setTimeout(r, 400));

  while (true) {
    console.clear();
    printSplash();
    const auth = configManager.getAuth();
    printStatusBar(auth.plan, auth.apiKey, auth.plan ? providerSummary(auth.plan as Plan).trim() : undefined);
    printNavigationHints();

    if (!auth.plan || !auth.apiKey) {
      printInfo('First-time setup: open "Provider Setup" to choose provider and add your API key.');
      console.log();
    }

    const mainChoices = [
      { name: '1) ⚡ Provider Setup', value: 'provider' },
      { name: '2) 🛠 Coding Tools', value: 'tools' },
      { name: '3) 🌐 Language', value: 'lang' },
      new inquirer.Separator(),
      { name: '4) 🔬 System Diagnostics', value: 'doctor' },
      { name: '5) 📋 View Logs', value: 'logs' },
      new inquirer.Separator(),
      { name: chalk.gray('Exit'), value: 'exit' },
    ];

    const { op } = await inquirer.prompt<{ op: string }>([
      {
        type: 'list',
        name: 'op',
        message: 'Main Menu:',
        choices: mainChoices,
      },
    ]);

    if (op === 'exit') {
      console.log(chalk.gray('\n  Goodbye!\n'));
      return;
    }

    try {
      if (op === 'provider') {
        await providerMenu();
      } else if (op === 'tools') {
        await toolSelectMenu();
      } else if (op === 'doctor') {
        await diagnosticsMenu();
      } else if (op === 'logs') {
        await logsMenu();
      } else if (op === 'lang') {
        const { lang } = await inquirer.prompt<{ lang: 'zh_CN' | 'en_US' }>([
          {
            type: 'list',
            name: 'lang',
            message: 'Select language:',
            choices: [
              { name: '简体中文', value: 'zh_CN' },
              { name: 'English', value: 'en_US' },
            ],
            default: configManager.getLang(),
          },
        ]);
        configManager.setLang(lang);
        i18n.setLang(lang);
        printSuccess(`Language set to ${lang === 'zh_CN' ? '简体中文' : 'English'}`);
        await pause();
      }
    } catch (error) {
      logger.logError('menu.main', error);
      printError(error instanceof Error ? error.message : String(error), 'Run "coder-link doctor" to check system configuration');
      await pause();
    }
  }
}

