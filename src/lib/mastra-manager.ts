import { join } from 'path';
import { homedir } from 'os';
import { MCPService } from './tool-manager.js';
import type { ProviderOptions } from './tool-manager.js';
import { readJsonConfig, writeJsonConfig } from './config-io.js';

export class MastraManager {
  static instance: MastraManager | null = null;
  private configDir: string;
  private mcpJsonPath: string;

  constructor() {
    this.configDir = join(homedir(), '.mastracode');
    this.mcpJsonPath = join(this.configDir, 'mcp.json');
  }

  static getInstance(): MastraManager {
    if (!MastraManager.instance) {
      MastraManager.instance = new MastraManager();
    }
    return MastraManager.instance;
  }

  private getConfig() {
    return readJsonConfig(this.mcpJsonPath, 'MastraManager');
  }

  private saveConfig(config: any) {
    writeJsonConfig(this.mcpJsonPath, config, 'MastraManager', 2);
  }

  /**
   * Mastra Code does NOT support custom provider configuration.
   * It only works with built-in providers via environment variables:
   * - ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY
   * - DEEPSEEK_API_KEY, CEREBRAS_API_KEY
   * 
   * These methods are kept for interface compatibility but should not be used.
   */
  async loadConfig(_plan: string, _apiKey: string, _options?: ProviderOptions): Promise<void> {
    // Mastra Code doesn't support custom providers - only built-in env vars
    // This method exists for interface compatibility but does nothing
  }

  async unloadConfig(): Promise<void> {
    // No-op - Mastra Code doesn't store provider config
  }

  async detectCurrentConfig(): Promise<{ plan: string | null; apiKey: string | null; model?: string }> {
    // Mastra Code uses built-in providers only, detected via env vars
    // We can't detect which provider is "configured" since it's env-based
    return { plan: null, apiKey: null, model: undefined };
  }

  isMCPInstalled(mcpId: string): boolean {
    try {
      const config = this.getConfig();
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
      const config = this.getConfig();
      if (!config.mcpServers) {
        config.mcpServers = {};
      }

      // Mastra Code CLI only supports stdio MCP servers
      // See: https://mastra.ai/docs/mastra-code/configuration#mcp-servers
      if (mcp.protocol !== 'stdio') {
        throw new Error(`Mastra Code only supports stdio MCP servers. Protocol '${mcp.protocol}' is not supported.`);
      }

      // Determine environment variables
      let env: Record<string, string> = {};
      if (mcp.envTemplate && plan) {
        env = { ...(mcp.envTemplate[plan] || {}) };
      } else if (mcp.env) {
        env = { ...mcp.env };
      }

      // Fill in environment variables from process.env if not set
      for (const [key, value] of Object.entries(env)) {
        if (value !== '' || !process.env[key]) continue;
        env[key] = process.env[key] as string;
      }

      // Add API key if required
      if (mcp.requiresAuth && apiKey) {
        env[mcp.authEnvVar || 'Z_AI_API_KEY'] = apiKey;
      }

      const mcpConfig = {
        command: mcp.command || 'npx',
        args: mcp.args || [],
        env
      };

      config.mcpServers[mcp.id] = mcpConfig;
      this.saveConfig(config);
    } catch (error) {
      throw new Error(`Failed to install MCP ${mcp.name}: ${error}`);
    }
  }

  async uninstallMCP(mcpId: string): Promise<void> {
    try {
      const config = this.getConfig();
      if (!config.mcpServers) {
        return;
      }
      delete config.mcpServers[mcpId];
      this.saveConfig(config);
    } catch (error) {
      throw new Error(`Failed to uninstall MCP ${mcpId}: ${error}`);
    }
  }

  getInstalledMCPs(): string[] {
    try {
      const config = this.getConfig();
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
      const config = this.getConfig();
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
      const config = this.getConfig();
      return config.mcpServers || {};
    } catch {
      return {};
    }
  }
}

export const mastraManager = MastraManager.getInstance();
