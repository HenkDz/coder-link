import { join } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync } from 'fs';

import { MCPService } from './tool-manager.js';
import type { ProviderOptions } from './tool-manager.js';
import { readJsonConfig, writeJsonConfig } from './config-io.js';
import type { Plan } from '../utils/config.js';

// ============================================================================
// Constants
// ============================================================================

/** Default command for stdio MCP servers */
const DEFAULT_NPX_COMMAND = 'npx';

/** Default model if none specified - should be explicitly provided by caller */
const DEFAULT_MODEL_PLACEHOLDER = '<model-required>';

// ============================================================================
// Main Class
// ============================================================================

export class Ob1Manager {
  static instance: Ob1Manager | null = null;
  private settingsPath: string;
  private modelConfigPath: string;
  private mcpConfigPath: string;
  private ob1Dir: string;

  constructor() {
    this.ob1Dir = join(homedir(), '.ob1');
    this.ensureOb1Dir();
    this.settingsPath = join(this.ob1Dir, 'settings.json');
    this.modelConfigPath = join(this.ob1Dir, 'model-config.json');
    this.mcpConfigPath = join(this.ob1Dir, 'mcp.json');
  }

  /**
   * Ensure the .ob1 directory exists
   * @throws Error if directory cannot be created
   */
  private ensureOb1Dir(): void {
    if (!existsSync(this.ob1Dir)) {
      try {
        mkdirSync(this.ob1Dir, { recursive: true });
      } catch (error) {
        throw new Error(
          `Failed to create OB1 config directory at ${this.ob1Dir}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  static getInstance(): Ob1Manager {
    if (!Ob1Manager.instance) {
      Ob1Manager.instance = new Ob1Manager();
    }
    return Ob1Manager.instance;
  }

  // --------------------------------------------------------------------------
  // Config I/O
  // --------------------------------------------------------------------------

  private getSettings() {
    return readJsonConfig(this.settingsPath, 'Ob1Manager.settings');
  }

  private saveSettings(config: any) {
    writeJsonConfig(this.settingsPath, config, 'Ob1Manager.settings', 2);
  }

  private getModelConfig() {
    return readJsonConfig(this.modelConfigPath, 'Ob1Manager.modelConfig');
  }

  private saveModelConfig(config: any) {
    writeJsonConfig(this.modelConfigPath, config, 'Ob1Manager.modelConfig', 2);
  }

  private getMCPConfig() {
    return readJsonConfig(this.mcpConfigPath, 'Ob1Manager.mcp');
  }

  private saveMCPConfig(config: any) {
    writeJsonConfig(this.mcpConfigPath, config, 'Ob1Manager.mcp', 2);
  }

  // --------------------------------------------------------------------------
  // Config Detection
  // --------------------------------------------------------------------------

  async detectCurrentConfig(): Promise<{ plan: string | null; apiKey: string | null; model?: string }> {
    try {
      const settings = this.getSettings();
      const modelConfig = this.getModelConfig();

      const modelKey = modelConfig?.key;
      const aliasEntry = settings?.modelConfigs?.customAliases?.[modelKey];
      const modelName = aliasEntry?.modelConfig?.model || settings?.model?.name || modelKey;

      // Detect plan from the model name prefix
      let plan: string | null = null;
      if (modelName?.startsWith('z-ai/')) {
        // Z.AI models — default to GLM global
        plan = 'glm_coding_plan_global';
      }

      // OB1 uses env vars for endpoint/key, so we can't read them from config files.
      // Return what we know; the launch layer injects env vars at runtime.
      return {
        plan,
        apiKey: null, // managed via env vars at launch time
        model: modelName,
      };
    } catch {
      return { plan: null, apiKey: null };
    }
  }

  // --------------------------------------------------------------------------
  // Config Loading
  // --------------------------------------------------------------------------

  async loadConfig(plan: string, apiKey: string, options?: ProviderOptions): Promise<void> {
    const targetModel = options?.model?.trim();
    if (!targetModel) {
      throw new Error('Model selection is required for OB1. Please specify a model using the --model option or provider settings.');
    }
    const settings = this.getSettings();

    // Register custom alias for the selected model
    const aliasKey = this.extractAliasKey(targetModel);
    if (!settings.modelConfigs) settings.modelConfigs = {};
    if (!settings.modelConfigs.customAliases) settings.modelConfigs.customAliases = {};

    settings.modelConfigs.customAliases[aliasKey] = {
      modelConfig: {
        model: targetModel,
      },
    };

    // Set the active model
    if (!settings.model) settings.model = {};
    settings.model.name = targetModel;

    this.saveSettings(settings);

    // Update model-config.json to match
    this.saveModelConfig({ key: aliasKey });
  }

  /**
   * Unload config - no-op for OB1 since settings.json is always valid
   * The ToolAdapter interface requires this method, but OB1's configuration
   * is designed to persist and remain valid across provider changes.
   */
  async unloadConfig(): Promise<void> {
    // No-op: OB1 settings are always valid
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
    const env = this.buildMCPConfigEnv(mcp, plan);

    if (mcp.requiresAuth) {
      const authVar = mcp.authEnvVar;
      if (!authVar) {
        throw new Error(
          `MCP ${mcp.id} requires authentication but authEnvVar is not defined. ` +
          `Please specify the environment variable name for the API key.`
        );
      }
      if (apiKey) {
        env[authVar] = apiKey;
      }
    }

    return {
      type: 'stdio',
      command: mcp.command || DEFAULT_NPX_COMMAND,
      args:
        mcp.command === DEFAULT_NPX_COMMAND && !mcp.args?.includes('--silent')
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

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private extractAliasKey(model: string): string {
    // e.g. "z-ai/glm-5" → "glm-5", "pony-alpha-2" → "pony-alpha-2"
    const parts = model.split('/');
    return parts.length > 1 ? parts[parts.length - 1] : model;
  }
}

export const ob1Manager = Ob1Manager.getInstance();
