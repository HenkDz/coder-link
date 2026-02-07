import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger.js';
import { MCPService } from './tool-manager.js';
import type { ProviderOptions } from './tool-manager.js';

export class CrushManager {
  static instance: CrushManager | null = null;
  private configPath: string;

  constructor() {
    // Crush 配置文件路径: ~/.config/crush/crush.json
    this.configPath = join(homedir(), '.config', 'crush', 'crush.json');
  }

  static getInstance(): CrushManager {
    if (!CrushManager.instance) {
      CrushManager.instance = new CrushManager();
    }
    return CrushManager.instance;
  }

  private ensureConfigDir() {
    const dir = dirname(this.configPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private getConfig() {
    try {
      if (existsSync(this.configPath)) {
        const content = readFileSync(this.configPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      console.warn('Failed to read Crush config:', error);
      logger.logError('CrushManager.getConfig', error);
    }
    return {};
  }

  private saveConfig(config: any) {
    try {
      this.ensureConfigDir();
      writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (error) {
      throw new Error(`Failed to save Crush config: ${error}`);
    }
  }

  private getBaseUrl(plan: string, options?: ProviderOptions): string {
    if (plan === 'kimi') {
      return options?.baseUrl?.trim() || 'https://api.moonshot.ai/v1';
    }
    return plan === 'glm_coding_plan_global'
      ? 'https://api.z.ai/api/coding/paas/v4'
      : 'https://open.bigmodel.cn/api/coding/paas/v4';
  }

  async loadConfig(plan: string, apiKey: string, options?: ProviderOptions): Promise<void> {
    const currentConfig = this.getConfig();
    const baseUrl = this.getBaseUrl(plan, options);

    const newConfig = {
      ...currentConfig,
      providers: {
        ...(currentConfig.providers || {}),
        zai: {
          id: 'zai',
          name: plan === 'kimi' ? 'Kimi Provider' : 'ZAI Provider',
          base_url: baseUrl,
          api_key: apiKey
        }
      }
    };

    this.saveConfig(newConfig);
  }

  async unloadConfig(): Promise<void> {
    const currentConfig = this.getConfig();
    // Remove providers' zai configuration
    if (currentConfig.providers) {
      delete currentConfig.providers['zai'];
      // If providers is empty, delete providers field
      if (Object.keys(currentConfig.providers).length === 0) {
        delete currentConfig.providers;
      }
    }
    this.saveConfig(currentConfig);
  }

  async detectCurrentConfig(): Promise<{ plan: string | null; apiKey: string | null; model?: string }> {
    try {
      const config = this.getConfig();
      // Check providers.zai configuration
      if (!config.providers || !config.providers['zai']) {
        return { plan: null, apiKey: null };
      }
      const zaiProvider = config.providers['zai'];
      const apiKey = zaiProvider.api_key || null;
      const baseUrl = zaiProvider.base_url;
      let plan: string | null = null;
      if (baseUrl === 'https://api.z.ai/api/coding/paas/v4') {
        plan = 'glm_coding_plan_global';
      } else if (baseUrl === 'https://open.bigmodel.cn/api/coding/paas/v4') {
        plan = 'glm_coding_plan_china';
      } else if (baseUrl?.includes('openrouter.ai')) {
        plan = 'openrouter';
      } else if (baseUrl?.includes('nvidia.com')) {
        plan = 'nvidia';
      } else if (baseUrl) {
        plan = 'kimi';
      }
      // Crush doesn't store model in provider config
      return { plan, apiKey, model: undefined };
    } catch {
      return { plan: null, apiKey: null };
    }
  }

  isMCPInstalled(mcpId: string): boolean {
    try {
      const config = this.getConfig();
      if (!config.mcp) {
        return false;
      }
      return mcpId in config.mcp;
    } catch {
      return false;
    }
  }

  async installMCP(mcp: MCPService, apiKey: string, plan: string): Promise<void> {
    try {
      const config = this.getConfig();
      if (!config.mcp) {
        config.mcp = {};
      }

      let mcpConfig: any;

      if (mcp.protocol === 'stdio') {
        // Determine environment variables
        let env: Record<string, string> = {};
        if (mcp.envTemplate && plan) {
          env = { ...(mcp.envTemplate[plan] || {}) };
        } else if (mcp.env) {
          env = { ...mcp.env };
        }

        // Add API key if required
        if (mcp.requiresAuth && apiKey) {
          env.Z_AI_API_KEY = apiKey;
        }

        mcpConfig = {
          type: 'stdio',
          command: mcp.command || 'npx',
          args: mcp.args || [],
          env
        };
      } else if (mcp.protocol === 'sse' || mcp.protocol === 'streamable-http') {
        // Determine URL based on plan
        let url = '';
        if (mcp.urlTemplate && plan) {
          url = mcp.urlTemplate[plan];
        } else if (mcp.url) {
          url = mcp.url;
        } else {
          throw new Error(`MCP ${mcp.id} missing url or urlTemplate`);
        }

        // Crush uses http type
        mcpConfig = {
          type: mcp.protocol === 'sse' ? 'sse' : 'http',
          url: url,
          headers: {
            ...(mcp.headers || {})
          }
        };

        // Add API key to headers if required
        if (mcp.requiresAuth && apiKey) {
          mcpConfig.headers = {
            ...mcpConfig.headers,
            'Authorization': `Bearer ${apiKey}`
          };
        }
      } else {
        throw new Error(`Unsupported protocol: ${mcp.protocol}`);
      }

      config.mcp[mcp.id] = mcpConfig;
      this.saveConfig(config);
    } catch (error) {
      throw new Error(`Failed to install MCP ${mcp.name}: ${error}`);
    }
  }

  async uninstallMCP(mcpId: string): Promise<void> {
    try {
      const config = this.getConfig();
      if (!config.mcp) {
        return;
      }
      delete config.mcp[mcpId];
      this.saveConfig(config);
    } catch (error) {
      throw new Error(`Failed to uninstall MCP ${mcpId}: ${error}`);
    }
  }

  getInstalledMCPs(): string[] {
    try {
      const config = this.getConfig();
      if (!config.mcp) {
        return [];
      }
      return Object.keys(config.mcp);
    } catch {
      return [];
    }
  }

  getMCPStatus(mcpServices: MCPService[]): Map<string, boolean> {
    const status = new Map<string, boolean>();
    for (const mcp of mcpServices) {
      status.set(mcp.id, this.isMCPInstalled(mcp.id));
    }
    return status;
  }

  getOtherMCPs(builtinIds: string[]): Array<{ id: string; config: any }> {
    try {
      const config = this.getConfig();
      if (!config.mcp) {
        return [];
      }
      const otherMCPs: Array<{ id: string; config: any }> = [];
      for (const [id, mcpConfig] of Object.entries(config.mcp)) {
        if (!builtinIds.includes(id)) {
          otherMCPs.push({ id, config: mcpConfig });
        }
      }
      return otherMCPs;
    } catch {
      return [];
    }
  }

  getAllMCPServers(): Record<string, any> {
    try {
      const config = this.getConfig();
      return config.mcp || {};
    } catch {
      return {};
    }
  }
}

export const crushManager = CrushManager.getInstance();
