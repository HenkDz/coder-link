import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';

import { logger } from '../utils/logger.js';

type JsonRecord = Record<string, any>;

function ensureParentDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function backupCorruptContent(filePath: string, content: string): string | null {
  try {
    const backupPath = `${filePath}.corrupt-${Date.now()}.bak`;
    writeFileSync(backupPath, content, 'utf-8');
    return backupPath;
  } catch {
    return null;
  }
}

export function readJsonConfig(filePath: string, scope: string): JsonRecord {
  if (!existsSync(filePath)) return {};

  const content = readFileSync(filePath, 'utf-8');
  if (!content.trim()) return {};

  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Config root must be a JSON object');
    }
    return parsed as JsonRecord;
  } catch (error) {
    logger.logError(`${scope}.readJsonConfig`, error);
    const backupPath = backupCorruptContent(filePath, content);
    const backupHint = backupPath ? ` A backup was saved to: ${backupPath}` : '';
    throw new Error(`Invalid JSON config at ${filePath}.${backupHint}`);
  }
}

export function writeJsonConfig(filePath: string, config: unknown, scope: string, indent = 2): void {
  try {
    ensureParentDir(filePath);
    writeFileSync(filePath, JSON.stringify(config, null, indent), 'utf-8');
  } catch (error) {
    logger.logError(`${scope}.writeJsonConfig`, error);
    throw new Error(`Failed to write config: ${filePath}`);
  }
}

