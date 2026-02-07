import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

import { CONFIG_DIR } from './config.js';

const LOG_DIR = join(CONFIG_DIR, 'logs');
const LOG_FILE = join(LOG_DIR, 'error.log');

export class Logger {
  private static instance: Logger | null = null;
  private enabled: boolean = true;

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private constructor() {
    this.ensureLogDir();
  }

  private ensureLogDir() {
    if (!existsSync(LOG_DIR)) {
      mkdirSync(LOG_DIR, { recursive: true });
    }
  }

  private log(level: string, message: string, error?: Error) {
    if (!this.enabled) return;

    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}${error ? '\n' + error.stack : ''}\n`;

    // Write to log file
    try {
      appendFileSync(LOG_FILE, logMessage, 'utf-8');
    } catch (e) {
      // Silent fail for logging errors
    }

    // Also output to stderr for errors
    if (level === 'ERROR') {
      console.error(logMessage);
    }
  }

  logError(context: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    this.log('ERROR', `${context}: ${message}`, error instanceof Error ? error : undefined);
  }

  logWarn(message: string) {
    this.log('WARN', message);
  }

  logInfo(message: string) {
    this.log('INFO', message);
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }
}

export const logger = Logger.getInstance();
