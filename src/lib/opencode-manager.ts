import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger.js';
import { MCPService } from './tool-manager.js';
import type { ProviderOptions } from './tool-manager.js';

export class OpenCodeManager {
  static instance: OpenCodeManager | null = null;
  private configPath: string;

  constructor() {
    // OpenCode 配置文件路径: ~/.config/opencode/opencode.json
    this.configPath = join(homedir(), '.config', 'opencode', 'opencode.json');
  }

  static getInstance(): OpenCodeManager {
    if (!OpenCodeManager.instance) {
      OpenCodeManager.instance = new OpenCodeManager();
    }
    return OpenCodeManager.instance;
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
      console.warn('Failed to read OpenCode config:', error);
      logger.logError('OpenCodeManager.getConfig', error);
    }
    return {};
  }

  private saveConfig(config: any) {
    try {
      this.ensureConfigDir();
      writeFileSync(this.configPath, JSON.stringify(config, null, 4), 'utf-8');
    } catch (error) {
      throw new Error(`Failed to save OpenCode config: ${error}`);
    }
  }

  private getProviderName(plan: string): string {
    if (plan === 'kimi') {
      return 'moonshot-ai-coding';
    }
    return plan === 'glm_coding_plan_global' ? 'zai-coding-plan' : 'zhipuai-coding-plan';
  }

  async loadConfig(plan: string, apiKey: string, options?: ProviderOptions): Promise<void> {
    const currentConfig = this.getConfig();
    const providerName = this.getProviderName(plan);

    // Remove old provider configuration (if exists)
    const { provider: oldProvider, ...restConfig } = currentConfig;
    const newProvider: Record<string, any> = {};

    // Keep other providers (if any), but remove old coding-plan provider
    if (oldProvider) {
      for (const [key, value] of Object.entries(oldProvider)) {
        if (key !== 'zhipuai-coding-plan' && key !== 'zai-coding-plan' && key !== 'moonshot-ai-coding') {
          newProvider[key] = value;
        }
      }
    }

    // Add new provider configuration
    if (plan === 'kimi') {
      const source = (options?.source || '').toString().trim().toLowerCase();
      // Only the native Moonshot API supports extended thinking / reasoning mode.
      // Third-party endpoints (NVIDIA NIM, OpenRouter, custom) serve standard chat
      // completions and will hang if the client tries to use thinking parameters.
      const supportsThinking = (source === '' || source === 'moonshot');
      newProvider[providerName] = {
        options: {
          apiKey: apiKey,
          baseUrl: options?.baseUrl?.trim() || 'https://api.moonshot.ai/v1',
          ...(supportsThinking ? {} : { reasoning: false, thinking: false })
        }
      };
    } else {
      newProvider[providerName] = {
        options: {
          apiKey: apiKey
        }
      };
    }

    const kimiBaseModel = (options?.model?.trim() || 'kimi-k2.5');
    // OpenCode model strings are typically "<provider>/<model>". Allow model ids with slashes by keeping them as the "rest".
    const kimiModelRef = kimiBaseModel.startsWith(`${providerName}/`) ? kimiBaseModel : `${providerName}/${kimiBaseModel}`;

    const newConfig = {
      $schema: 'https://opencode.ai/config.json',
      ...restConfig,
      provider: newProvider,
      model: plan === 'kimi' ? kimiModelRef : `${providerName}/glm-4.6`,
      small_model: plan === 'kimi' ? kimiModelRef : `${providerName}/glm-4.5-air`
    };

    this.saveConfig(newConfig);
  }

  async unloadConfig(): Promise<void> {
    const currentConfig = this.getConfig();
    // Remove provider's coding-plan configuration
    if (currentConfig.provider) {
      delete currentConfig.provider['zhipuai-coding-plan'];
      delete currentConfig.provider['zai-coding-plan'];
      delete currentConfig.provider['moonshot-ai-coding'];
      // If provider is empty, delete provider field
      if (Object.keys(currentConfig.provider).length === 0) {
        delete currentConfig.provider;
      }
    }

    // Remove model and small_model (if they are coding-plan)
    if (currentConfig.model?.includes('coding-plan') || currentConfig.model?.includes('moonshot-ai-coding')) {
      delete currentConfig.model;
    }
    if (currentConfig.small_model?.includes('coding-plan') || currentConfig.small_model?.includes('moonshot-ai-coding')) {
      delete currentConfig.small_model;
    }

    this.saveConfig(currentConfig);
  }

  async detectCurrentConfig(): Promise<{ plan: string | null; apiKey: string | null; model?: string }> {
    try {
      const config = this.getConfig();
      // Check provider configuration
      if (!config.provider) {
        return { plan: null, apiKey: null };
      }

      let plan: string | null = null;
      let apiKey: string | null = null;
      let model: string | undefined = undefined;

      if (config.provider['zai-coding-plan']) {
        plan = 'glm_coding_plan_global';
        apiKey = config.provider['zai-coding-plan'].options?.apiKey || null;
      } else if (config.provider['zhipuai-coding-plan']) {
        plan = 'glm_coding_plan_china';
        apiKey = config.provider['zhipuai-coding-plan'].options?.apiKey || null;
      } else if (config.provider['moonshot-ai-coding']) {
        apiKey = config.provider['moonshot-ai-coding'].options?.apiKey || null;
        const baseUrl = config.provider['moonshot-ai-coding'].options?.baseUrl || '';
        if (baseUrl.includes('openrouter.ai')) {
          plan = 'openrouter';
        } else if (baseUrl.includes('nvidia.com')) {
          plan = 'nvidia';
        } else {
          plan = 'kimi';
        }
      }

      // Extract model from config if present
      if (config.model && typeof config.model === 'string') {
        // Model format is typically "provider/model", extract the model part
        const parts = config.model.split('/');
        if (parts.length > 1) {
          model = parts.slice(1).join('/');
        } else {
          model = config.model;
        }
      }

      return { plan, apiKey, model };
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

        // OpenCode uses local type and command array
        const commandArray = [mcp.command || 'npx', ...(mcp.args || [])];
        mcpConfig = {
          type: 'local',
          command: commandArray,
          environment: env
        };
      } else if (mcp.protocol === 'streamable-http') {
        // Determine URL based on plan
        let url = '';
        if (mcp.urlTemplate && plan) {
          url = mcp.urlTemplate[plan];
        } else if (mcp.url) {
          url = mcp.url;
        } else {
          throw new Error(`MCP ${mcp.id} missing url or urlTemplate`);
        }

        // OpenCode uses remote or http type
        mcpConfig = {
          type: 'remote',
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

export const openCodeManager = OpenCodeManager.getInstance();
