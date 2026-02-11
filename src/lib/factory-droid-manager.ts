import { join } from 'path';
import { homedir } from 'os';
import { MCPService } from './tool-manager.js';
import type { ProviderOptions } from './tool-manager.js';
import { readJsonConfig, writeJsonConfig } from './config-io.js';
import {
  PROVIDER_CONFIGS,
  getBaseUrl,
  getDefaultModel,
  getProviderDisplayName,
  detectPlanFromUrl,
  getMaxOutputTokens,
  getMaxContextSize,
  supportsThinking,
  supportsProtocol,
} from './provider-registry.js';
import type { Plan } from '../utils/config.js';

// ============================================================================
// Main Class
// ============================================================================

export class FactoryDroidManager {
  static instance: FactoryDroidManager | null = null;
  private configPath: string;
  private mcpConfigPath: string;

  constructor() {
    this.configPath = join(homedir(), '.factory', 'settings.json');
    this.mcpConfigPath = join(homedir(), '.factory', 'mcp.json');
  }

  static getInstance(): FactoryDroidManager {
    if (!FactoryDroidManager.instance) {
      FactoryDroidManager.instance = new FactoryDroidManager();
    }
    return FactoryDroidManager.instance;
  }

  // --------------------------------------------------------------------------
  // Config I/O
  // --------------------------------------------------------------------------

  private getConfig() {
    return readJsonConfig(this.configPath, 'FactoryDroidManager.config');
  }

  private saveConfig(config: any) {
    writeJsonConfig(this.configPath, config, 'FactoryDroidManager.config', 2);
  }

  private getMCPConfig() {
    return readJsonConfig(this.mcpConfigPath, 'FactoryDroidManager.mcp');
  }

  private saveMCPConfig(config: any) {
    writeJsonConfig(this.mcpConfigPath, config, 'FactoryDroidManager.mcp', 2);
  }

  // --------------------------------------------------------------------------
  // Helper Methods
  // --------------------------------------------------------------------------

  private resolveBaseUrl(
    plan: Plan,
    protocol: 'anthropic' | 'openai',
    options?: ProviderOptions
  ): string {
    // Priority 1: Protocol-specific custom URL (for anthropic)
    if (protocol === 'anthropic' && options?.anthropicBaseUrl?.trim()) {
      return options.anthropicBaseUrl.trim();
    }

    // Priority 2: Generic custom base URL
    if (options?.baseUrl?.trim()) {
      return options.baseUrl.trim();
    }

    // Priority 3: Lookup from centralized provider registry
    return getBaseUrl(plan, protocol);
  }

  private getDisplayName(
    plan: Plan,
    protocol: 'anthropic' | 'openai',
    options?: ProviderOptions
  ): string {
    const targetModel = options?.model?.trim() || getDefaultModel(plan);
    const modelName = this.extractModelName(targetModel);
    const providerName = getProviderDisplayName(plan);
    const protocolName = protocol === 'anthropic' ? 'Anthropic' : 'OpenAI';
    return `${providerName} - ${modelName} [${protocolName}]`;
  }

  private toCustomModelId(displayName: string, index: number): string {
    const slug = displayName.trim().replace(/\s/g, '-');
    return `custom:${slug}-${index}`;
  }

  private extractModelName(modelId: string): string {
    const parts = modelId.split('/');
    return parts.length > 1 ? parts[parts.length - 1] : modelId;
  }

  private getDisplayNameFilters(): string[] {
    return Object.values(PROVIDER_CONFIGS).map((c) => c.displayName);
  }

  // --------------------------------------------------------------------------
  // Config Loading
  // --------------------------------------------------------------------------

  async loadConfig(plan: string, apiKey: string, options?: ProviderOptions): Promise<void> {
    const planKey = plan as Plan;
    const currentConfig = this.getConfig();
    const targetModel = options?.model?.trim() || getDefaultModel(planKey);
    const baseUrl = this.resolveBaseUrl(planKey, 'openai', options);

    // Filter out old configurations
    const displayNameFilters = this.getDisplayNameFilters();
    const existingModels = (currentConfig.customModels || []).filter((m: any) =>
      displayNameFilters.every((filter) => !m.displayName?.includes(filter))
    );

    // Handle OpenAI-only providers (kimi, nvidia, alibaba_api)
    if (!supportsProtocol(planKey, 'anthropic')) {
      await this.loadOpenAIOnlyProvider(
        currentConfig,
        existingModels,
        planKey,
        apiKey,
        targetModel,
        baseUrl,
        options
      );
      return;
    }

    // Handle dual-protocol providers
    await this.loadDualProtocolProvider(
      currentConfig,
      existingModels,
      planKey,
      apiKey,
      targetModel,
      options
    );
  }

  private async loadOpenAIOnlyProvider(
    currentConfig: any,
    existingModels: any[],
    plan: Plan,
    apiKey: string,
    targetModel: string,
    baseUrl: string,
    options?: ProviderOptions
  ): Promise<void> {
    const displayName = this.getDisplayName(plan, 'openai', options);
    const modelName = this.extractModelName(targetModel);
    const maxOutputTokens = getMaxOutputTokens(plan, targetModel);
    const maxContextSize = options?.maxContextSize ?? getMaxContextSize(plan);

    const openaiModel: Record<string, any> = {
      displayName,
      name: modelName,
      model: targetModel,
      baseUrl,
      apiKey,
      provider: 'generic-chat-completion-api',
      maxOutputTokens,
      maxContextSize,
    };

    // Disable thinking for non-native sources
    if (!supportsThinking(plan, options?.source)) {
      openaiModel.thinking = false;
      openaiModel.reasoning = false;
    }

    const customModels = [...existingModels, openaiModel];
    const modelIndex = customModels.length - 1;

    const newConfig = {
      ...currentConfig,
      model: 'custom-model',
      cloudSessionSync: false,
      sessionDefaultSettings: {
        ...(currentConfig.sessionDefaultSettings || {}),
        model: this.toCustomModelId(openaiModel.displayName, modelIndex),
      },
      customModels,
    };

    this.saveConfig(newConfig);
  }

  private async loadDualProtocolProvider(
    currentConfig: any,
    existingModels: any[],
    plan: Plan,
    apiKey: string,
    targetModel: string,
    options?: ProviderOptions
  ): Promise<void> {
    const maxOutputTokens = getMaxOutputTokens(plan, targetModel);
    const modelName = this.extractModelName(targetModel);

    // Create Anthropic protocol configuration
    const anthropicModel = {
      displayName: this.getDisplayName(plan, 'anthropic', options),
      name: modelName,
      model: targetModel,
      baseUrl: this.resolveBaseUrl(plan, 'anthropic', options),
      apiKey,
      provider: 'anthropic',
      maxOutputTokens,
    };

    // Create OpenAI Chat Completion protocol configuration
    const openaiModel = {
      displayName: this.getDisplayName(plan, 'openai', options),
      name: modelName,
      model: targetModel,
      baseUrl: this.resolveBaseUrl(plan, 'openai', options),
      apiKey,
      provider: 'generic-chat-completion-api',
      maxOutputTokens,
    };

    const customModels = [...existingModels, anthropicModel, openaiModel];
    const openaiModelIndex = customModels.length - 1;

    const newConfig = {
      ...currentConfig,
      model: 'custom-model',
      cloudSessionSync: false,
      sessionDefaultSettings: {
        ...(currentConfig.sessionDefaultSettings || {}),
        model: this.toCustomModelId(openaiModel.displayName, openaiModelIndex),
      },
      customModels,
    };

    this.saveConfig(newConfig);
  }

  // --------------------------------------------------------------------------
  // Config Unloading
  // --------------------------------------------------------------------------

  async unloadConfig(): Promise<void> {
    const currentConfig = this.getConfig();

    if (currentConfig.customModels) {
      const displayNameFilters = this.getDisplayNameFilters();
      currentConfig.customModels = currentConfig.customModels.filter((m: any) =>
        displayNameFilters.every((filter) => !m.displayName?.includes(filter))
      );

      if (currentConfig.customModels.length === 0) {
        delete currentConfig.customModels;
      }
    }

    this.saveConfig(currentConfig);
  }

  // --------------------------------------------------------------------------
  // Config Detection
  // --------------------------------------------------------------------------

  async detectCurrentConfig(): Promise<{ plan: string | null; apiKey: string | null; model?: string }> {
    try {
      const config = this.getConfig();

      if (!config.customModels?.length) {
        return { plan: null, apiKey: null };
      }

      // Find managed configurations by display name patterns
      const displayNameFilters = this.getDisplayNameFilters();
      const managedModel = config.customModels.find((m: any) =>
        displayNameFilters.some((filter) => m.displayName?.includes(filter))
      );

      if (!managedModel) {
        return { plan: null, apiKey: null };
      }

      const plan = detectPlanFromUrl(managedModel.baseUrl);

      return {
        plan,
        apiKey: managedModel.apiKey ?? null,
        model: managedModel.model,
      };
    } catch {
      return { plan: null, apiKey: null };
    }
  }

  // --------------------------------------------------------------------------
  // MCP Management
  // --------------------------------------------------------------------------

  isMCPInstalled(mcpId: string): boolean {
    try {
      const config = this.getMCPConfig();
      return mcpId in (config.mcpServers ?? {});
    } catch {
      return false;
    }
  }

  async installMCP(mcp: MCPService, apiKey: string, plan: string): Promise<void> {
    const config = this.getMCPConfig();
    config.mcpServers ??= {};

    let mcpConfig: any;

    if (mcp.protocol === 'stdio') {
      mcpConfig = this.buildStdioMCPConfig(mcp, apiKey, plan);
    } else if (mcp.protocol === 'sse' || mcp.protocol === 'streamable-http') {
      mcpConfig = this.buildHttpMCPConfig(mcp, apiKey, plan);
    } else {
      throw new Error(`Unsupported protocol: ${mcp.protocol}`);
    }

    config.mcpServers[mcp.id] = mcpConfig;
    this.saveMCPConfig(config);
  }

  private buildStdioMCPConfig(
    mcp: MCPService,
    apiKey: string,
    plan: string
  ): Record<string, any> {
    // Build environment variables
    const env = this.buildMCPConfigEnv(mcp, plan);

    // Add API key if required
    if (mcp.requiresAuth && apiKey) {
      env[mcp.authEnvVar || 'Z_AI_API_KEY'] = apiKey;
    }

    return {
      type: 'stdio',
      command: mcp.command || 'npx',
      args:
        mcp.command === 'npx' && !mcp.args?.includes('--silent')
          ? ['--silent', ...(mcp.args || [])]
          : mcp.args || [],
      env,
      disabled: false,
    };
  }

  private buildMCPConfigEnv(mcp: MCPService, plan: string): Record<string, string> {
    let env: Record<string, string> = {};

    if (mcp.envTemplate && plan) {
      env = { ...(mcp.envTemplate[plan] || {}) };
    } else if (mcp.env) {
      env = { ...mcp.env };
    }

    // Fill in environment variables from process.env if needed
    for (const [key, value] of Object.entries(env)) {
      if (value === '' && process.env[key]) {
        env[key] = process.env[key] as string;
      }
    }

    return env;
  }

  private buildHttpMCPConfig(mcp: MCPService, apiKey: string, plan: string): Record<string, any> {
    const url = mcp.urlTemplate?.[plan] ?? mcp.url;
    if (!url) {
      throw new Error(`MCP ${mcp.id} missing url or urlTemplate`);
    }

    const headers: Record<string, string> = { ...(mcp.headers || {}) };

    // Add API key to headers if required
    if (mcp.requiresAuth && apiKey) {
      const headerName = mcp.authHeader || 'Authorization';
      const authScheme = mcp.authScheme || 'Bearer';
      headers[headerName] = authScheme === 'Bearer' ? `Bearer ${apiKey}` : apiKey;
    }

    return {
      type: 'http',
      url,
      headers,
      disabled: false,
    };
  }

  async uninstallMCP(mcpId: string): Promise<void> {
    const config = this.getMCPConfig();
    delete config.mcpServers?.[mcpId];
    this.saveMCPConfig(config);
  }

  getInstalledMCPs(): string[] {
    try {
      const config = this.getMCPConfig();
      return Object.keys(config.mcpServers ?? {});
    } catch {
      return [];
    }
  }

  getMCPStatus(mcpServices: MCPService[]): Map<string, boolean> {
    return new Map(mcpServices.map((mcp) => [mcp.id, this.isMCPInstalled(mcp.id)]));
  }

  getOtherMCPs(builtinIds: string[]): Array<{ id: string; config: any }> {
    try {
      const config = this.getMCPConfig();
      const mcpServers = config.mcpServers ?? {};

      return Object.entries(mcpServers)
        .filter(([id]) => !builtinIds.includes(id))
        .map(([id, mcpConfig]) => ({ id, config: mcpConfig }));
    } catch {
      return [];
    }
  }

  getAllMCPServers(): Record<string, any> {
    try {
      const config = this.getMCPConfig();
      return config.mcpServers ?? {};
    } catch {
      return {};
    }
  }
}

export const factoryDroidManager = FactoryDroidManager.getInstance();
