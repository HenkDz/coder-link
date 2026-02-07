import { logger } from '../utils/logger.js';
import type { MCPService } from './tool-manager.js';

export class AmpManager {
  static instance: AmpManager | null = null;

  static getInstance(): AmpManager {
    if (!AmpManager.instance) {
      AmpManager.instance = new AmpManager();
    }
    return AmpManager.instance;
  }

  async detectCurrentConfig(): Promise<{ plan: string | null; apiKey: string | null; model?: string }> {
    // Amp CLI configuration format is not publicly documented in a stable way.
    // We only provide start/install integration for now.
    return { plan: null, apiKey: null };
  }

  async loadConfig(_plan: string, _apiKey: string): Promise<void> {
    const error = new Error('Amp does not support automatic provider injection yet');
    logger.logError('AmpManager.loadConfig', error);
    throw error;
  }

  async unloadConfig(): Promise<void> {
    // no-op
  }

  isMCPInstalled(_mcpId: string): boolean {
    return false;
  }

  async installMCP(_mcp: MCPService, _apiKey: string, _plan: string): Promise<void> {
    throw new Error('Amp does not support MCP configuration via coder-link');
  }

  async uninstallMCP(_mcpId: string): Promise<void> {
    throw new Error('Amp does not support MCP configuration via coder-link');
  }

  getInstalledMCPs(): string[] {
    return [];
  }

  getMCPStatus(_mcpServices: MCPService[]): Map<string, boolean> {
    return new Map();
  }

  getOtherMCPs(_builtinIds: string[]): Array<{ id: string; config: any }> {
    return [];
  }

  getAllMCPServers(): Record<string, any> {
    return {};
  }
}

export const ampManager = AmpManager.getInstance();
