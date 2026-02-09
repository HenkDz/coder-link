import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger.js';
import { MCPService } from './tool-manager.js';
import type { ProviderOptions } from './tool-manager.js';

export class FactoryDroidManager {
  static instance: FactoryDroidManager | null = null;
  private configPath: string;
  private mcpConfigPath: string;

  constructor() {
    // Factory Droid 配置文件路径
    this.configPath = join(homedir(), '.factory', 'settings.json');
    // Factory Droid MCP 配置文件路径 (单独文件)
    this.mcpConfigPath = join(homedir(), '.factory', 'mcp.json');
  }

  static getInstance(): FactoryDroidManager {
    if (!FactoryDroidManager.instance) {
      FactoryDroidManager.instance = new FactoryDroidManager();
    }
    return FactoryDroidManager.instance;
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
      console.warn('Failed to read Factory Droid config:', error);
      logger.logError('FactoryDroidManager.getConfig', error);
    }
    return {};
  }

  private saveConfig(config: any) {
    try {
      this.ensureConfigDir();
      writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (error) {
      throw new Error(`Failed to save Factory Droid config: ${error}`);
    }
  }

  private getMCPConfig() {
    try {
      if (existsSync(this.mcpConfigPath)) {
        const content = readFileSync(this.mcpConfigPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      console.warn('Failed to read Factory Droid MCP config:', error);
      logger.logError('FactoryDroidManager.getMCPConfig', error);
    }
    return {};
  }

  private saveMCPConfig(config: any) {
    try {
      this.ensureConfigDir();
      writeFileSync(this.mcpConfigPath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (error) {
      throw new Error(`Failed to save Factory Droid MCP config: ${error}`);
    }
  }

  private getBaseUrl(plan: string, protocol: 'anthropic' | 'openai', options?: ProviderOptions): string {
    if (options?.baseUrl?.trim()) {
      const url = options.baseUrl.trim();
      // If user provided a base URL, they might want to use it for both protocols, 
      // but usually the generic-chat-completion-api works best with OpenAI-like paths.
      return url;
    }
    if (plan === 'kimi') {
      return 'https://api.moonshot.ai/v1';
    }
    if (protocol === 'anthropic') {
      return plan === 'glm_coding_plan_global'
        ? 'https://api.z.ai/api/anthropic'
        : 'https://open.bigmodel.cn/api/anthropic';
    } else {
      return plan === 'glm_coding_plan_global'
        ? 'https://api.z.ai/api/coding/paas/v4'
        : 'https://open.bigmodel.cn/api/coding/paas/v4';
    }
  }

  private getDisplayName(plan: string, protocol: 'anthropic' | 'openai', options?: ProviderOptions): string {
    const targetModel = options?.model?.trim() || (plan === 'kimi' ? 'moonshotai/kimi-k2.5' : 'glm-4-coder');
    const modelName = this.extractModelName(targetModel);
    
    // For kimi-like providers, use the actual source for the display name
    if (plan === 'kimi' || plan === 'openrouter' || plan === 'nvidia') {
      const source = (options?.source || '').toString().trim().toLowerCase();
      const providerName = source === 'openrouter' ? 'OpenRouter' 
        : source === 'nvidia' ? 'NVIDIA NIM' 
        : 'Kimi';
      const protocolName = protocol === 'anthropic' ? 'Anthropic' : 'OpenAI';
      return `${providerName} - ${modelName} [${protocolName}]`;
    }
    const planName = plan === 'glm_coding_plan_global' ? 'GLM Coding Plan Global' : 'GLM Coding Plan China';
    const protocolName = protocol === 'anthropic' ? 'Anthropic' : 'OpenAI';
    return `${planName} - ${modelName} [${protocolName}]`;
  }

  private toCustomModelId(displayName: string, index: number): string {
    const slug = displayName
      .trim()
      .replace(/\s/g, '-');
    return `custom:${slug}-${index}`;
  }

  private extractModelName(modelId: string): string {
    const parts = modelId.split('/');
    if (parts.length > 1) {
      return parts[parts.length - 1];
    }
    return modelId;
  }

  async loadConfig(plan: string, apiKey: string, options?: ProviderOptions): Promise<void> {
    const currentConfig = this.getConfig();

    const targetModel = options?.model?.trim() || (plan === 'kimi' ? 'moonshotai/kimi-k2.5' : 'glm-4-coder');
    // For Kimi/NVIDIA/OpenRouter, we use the provided/detected baseUrl. 
    // For GLM, we might still want to use the dual-protocol endpoints if no override is provided.
    const baseUrl = options?.baseUrl?.trim() || (plan === 'kimi' ? 'https://api.moonshot.ai/v1' : this.getBaseUrl(plan, 'openai', options));

    // Filter out old GLM/Kimi/OpenRouter/NVIDIA Coding Plan configurations (by displayName)
    // This ensures refresh properly updates the config
    const existingModels = (currentConfig.customModels || []).filter(
      (m: any) => !m.displayName.includes('GLM Coding Plan') 
        && !m.displayName.includes('Kimi')
        && !m.displayName.includes('OpenRouter')
        && !m.displayName.includes('NVIDIA')
    );

    // Kimi (Moonshot / OpenRouter / NVIDIA NIM) is OpenAI Chat Completions compatible.
    // Don't write an Anthropic entry for Kimi, and keep provider values within Factory's supported set.
    if (plan === 'kimi') {
      const source = (options?.source || '').toString().trim().toLowerCase();
      // Only the native Moonshot API supports extended thinking / reasoning mode.
      const supportsThinking = (source === '' || source === 'moonshot');
      const displayName = this.getDisplayName(plan, 'openai', options);
      const modelName = this.extractModelName(targetModel);
      const openaiModel: Record<string, any> = {
        displayName,
        name: modelName,
        model: targetModel,
        baseUrl: baseUrl,
        apiKey,
        provider: 'generic-chat-completion-api',
        maxOutputTokens: 131072,
        maxContextSize: options?.maxContextSize || 262144,
      };
      if (!supportsThinking) {
        openaiModel.thinking = false;
        openaiModel.reasoning = false;
      }

      const customModels = [...existingModels, openaiModel];
      const modelIndex = customModels.length - 1;

      const newConfig = {
        ...currentConfig,
        // Ensure droid uses BYOK by default (prevents falling back to Factory-hosted models).
        model: 'custom-model',
        // Avoid requiring a Factory web login just to start sessions.
        cloudSessionSync: false,
        // Best-effort: select the injected custom model as the default.
        sessionDefaultSettings: {
          ...(currentConfig.sessionDefaultSettings || {}),
          model: this.toCustomModelId(openaiModel.displayName, modelIndex)
        },
        customModels
      };

      this.saveConfig(newConfig);
      return;
    }

    // Create Anthropic protocol configuration
    const modelName = this.extractModelName(targetModel);
    const anthropicModel = {
      displayName: this.getDisplayName(plan, 'anthropic', options),
      name: modelName,
      model: targetModel,
      baseUrl: this.getBaseUrl(plan, 'anthropic', options),
      apiKey,
      provider: 'anthropic',
      maxOutputTokens: 131072
    };

    // Create OpenAI Chat Completion protocol configuration
    const openaiModel = {
      displayName: this.getDisplayName(plan, 'openai', options),
      name: modelName,
      model: targetModel,
      baseUrl: this.getBaseUrl(plan, 'openai', options),
      apiKey,
      provider: 'generic-chat-completion-api',
      maxOutputTokens: 131072
    };

    const customModels = [...existingModels, anthropicModel, openaiModel];
    const openaiModelIndex = customModels.length - 1;

    const newConfig = {
      ...currentConfig,
      model: 'custom-model',
      cloudSessionSync: false,
      sessionDefaultSettings: {
        ...(currentConfig.sessionDefaultSettings || {}),
        model: this.toCustomModelId(openaiModel.displayName, openaiModelIndex)
      },
      customModels
    };

    this.saveConfig(newConfig);
  }

  async unloadConfig(): Promise<void> {
    const currentConfig = this.getConfig();
    // Filter out GLM/Kimi Coding Plan configurations
    if (currentConfig.customModels) {
      currentConfig.customModels = currentConfig.customModels.filter((m: any) => !m.displayName.includes('GLM Coding Plan') && !m.displayName.includes('Kimi'));
      // If customModels is empty, delete field
      if (currentConfig.customModels.length === 0) {
        delete currentConfig.customModels;
      }
    }
    this.saveConfig(currentConfig);
  }

  async detectCurrentConfig(): Promise<{ plan: string | null; apiKey: string | null; model?: string }> {
    try {
      const config = this.getConfig();
      if (!config.customModels || config.customModels.length === 0) {
        return { plan: null, apiKey: null };
      }

      // Find GLM/Kimi/OpenRouter/NVIDIA Coding Plan configuration
      const glmModel = config.customModels.find((m: any) => 
        m.displayName.includes('GLM Coding Plan') 
        || m.displayName.includes('Kimi')
        || m.displayName.includes('OpenRouter')
        || m.displayName.includes('NVIDIA')
      );
      if (!glmModel) {
        return { plan: null, apiKey: null };
      }

      const apiKey = glmModel.apiKey || null;
      const baseUrl = glmModel.baseUrl;
      const model = glmModel.model || undefined;
      let plan: string | null = null;

      if (baseUrl === 'https://api.z.ai/api/coding/paas/v4' || baseUrl === 'https://api.z.ai/api/anthropic') {
        plan = 'glm_coding_plan_global';
      } else if (baseUrl === 'https://open.bigmodel.cn/api/coding/paas/v4' || baseUrl === 'https://open.bigmodel.cn/api/anthropic') {
        plan = 'glm_coding_plan_china';
      } else if (baseUrl?.includes('openrouter.ai')) {
        plan = 'openrouter';
      } else if (baseUrl?.includes('nvidia.com')) {
        plan = 'nvidia';
      } else if (baseUrl) {
        plan = 'kimi';
      }

      return { plan, apiKey, model };
    } catch {
      return { plan: null, apiKey: null };
    }
  }

  isMCPInstalled(mcpId: string): boolean {
    try {
      const config = this.getMCPConfig();
      if (!config.mcpServers) {
        return false;
      }
      return mcpId in config.mcpServers;
    } catch {
      return false;
    }
  }

  async installMCP(mcp: MCPService, apiKey: string, plan: string): Promise<void> {
    try {
      const config = this.getMCPConfig();
      if (!config.mcpServers) {
        config.mcpServers = {};
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
          args: mcp.command === 'npx' && !mcp.args?.includes('--silent')
            ? ['--silent', ...(mcp.args || [])]
            : (mcp.args || []),
          env,
          disabled: false
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

        // Factory Droid uses http type
        mcpConfig = {
          type: 'http',
          url: url,
          headers: {
            ...(mcp.headers || {})
          },
          disabled: false
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

      config.mcpServers[mcp.id] = mcpConfig;
      this.saveMCPConfig(config);
    } catch (error) {
      throw new Error(`Failed to install MCP ${mcp.name}: ${error}`);
    }
  }

  async uninstallMCP(mcpId: string): Promise<void> {
    try {
      const config = this.getMCPConfig();
      if (!config.mcpServers) {
        return;
      }
      delete config.mcpServers[mcpId];
      this.saveMCPConfig(config);
    } catch (error) {
      throw new Error(`Failed to uninstall MCP ${mcpId}: ${error}`);
    }
  }

  getInstalledMCPs(): string[] {
    try {
      const config = this.getMCPConfig();
      if (!config.mcpServers) {
        return [];
      }
      return Object.keys(config.mcpServers);
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
      const config = this.getMCPConfig();
      if (!config.mcpServers) {
        return [];
      }
      const otherMCPs: Array<{ id: string; config: any }> = [];
      for (const [id, mcpConfig] of Object.entries(config.mcpServers)) {
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
      const config = this.getMCPConfig();
      return config.mcpServers || {};
    } catch {
      return {};
    }
  }
}

export const factoryDroidManager = FactoryDroidManager.getInstance();
