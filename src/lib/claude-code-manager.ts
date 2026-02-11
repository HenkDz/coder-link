import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger.js';
import type { Plan } from '../utils/config.js';
import { MCPService } from './tool-manager.js';
import type { ProviderOptions } from './tool-manager.js';
import { readJsonConfig, writeJsonConfig } from './config-io.js';
import { getDefaultAnthropicModel, resolveAnthropicBaseUrl } from '../utils/providers.js';

/**
 * Claude Code Manager
 * 
 * Claude Code requires an Anthropic-compatible API that uses:
 * - POST to /v1/messages endpoint
 * - Anthropic request/response format (not OpenAI)
 * 
 * Claude Code constructs API URLs by appending /v1/messages to ANTHROPIC_BASE_URL.
 * So the base URL should NOT include /v1 or the messages path.
 * 
 * Model Configuration (via environment variables):
 * - ANTHROPIC_DEFAULT_OPUS_MODEL: Model for opus tier
 * - ANTHROPIC_DEFAULT_SONNET_MODEL: Model for sonnet tier (default)
 * - ANTHROPIC_DEFAULT_HAIKU_MODEL: Model for haiku tier / background tasks
 * - CLAUDE_CODE_SUBAGENT_MODEL: Model for subagents
 * 
 * Supported providers:
 * - GLM Coding Plan (Global): https://api.z.ai/api/anthropic → calls /api/anthropic/v1/messages
 * - GLM Coding Plan (China): https://open.bigmodel.cn/api/anthropic → calls /api/anthropic/v1/messages
 * - OpenRouter: https://openrouter.ai/api → calls /api/v1/messages (OpenRouter supports Anthropic format)
 * - Alibaba Coding Plan: https://coding-intl.dashscope.aliyuncs.com/apps/anthropic → calls /apps/anthropic/v1/messages
 * - LM Studio: http://localhost:1234 → calls /v1/messages (LM Studio 0.4.1+ supports Anthropic format)
 * 
 * NOT supported (OpenAI-compatible only, no /v1/messages endpoint):
 * - Kimi/Moonshot: Only provides /v1/chat/completions
 * - NVIDIA NIM: Only provides /v1/chat/completions
 */

export class ClaudeCodeManager {
  static instance: ClaudeCodeManager | null = null;
  private settingsPath: string;
  private mcpConfigPath: string;

  constructor() {
    // Claude Code 配置文件路径（跨平台支持）
    // - macOS/Linux: ~/.claude/settings.json 和 ~/.claude.json
    // - Windows: %USERPROFILE%\.claude\settings.json 和 %USERPROFILE%\.claude.json
    this.settingsPath = join(homedir(), '.claude', 'settings.json');
    this.mcpConfigPath = join(homedir(), '.claude.json');
  }

  static getInstance(): ClaudeCodeManager {
    if (!ClaudeCodeManager.instance) {
      ClaudeCodeManager.instance = new ClaudeCodeManager();
    }
    return ClaudeCodeManager.instance;
  }

  private getSettings() {
    return readJsonConfig(this.settingsPath, 'ClaudeCodeManager.settings');
  }

  private saveSettings(config: any) {
    writeJsonConfig(this.settingsPath, config, 'ClaudeCodeManager.settings', 2);
  }

  private getMCPConfig() {
    return readJsonConfig(this.mcpConfigPath, 'ClaudeCodeManager.mcp');
  }

  private saveMCPConfig(config: any) {
    writeJsonConfig(this.mcpConfigPath, config, 'ClaudeCodeManager.mcp', 2);
  }

  async loadConfig(plan: string, apiKey: string, options?: ProviderOptions): Promise<void> {
    // 1. Ensure onboarding completed
    this.ensureOnboardingCompleted();
    // 2. Clean up shell environmental variables
    this.cleanupShellEnvVars();
    // 3. Load configurations to settings.json
    const currentSettings = this.getSettings();
    const currentEnv = currentSettings.env || {};
    const {
      ANTHROPIC_API_KEY: _legacyApiKey,
      ANTHROPIC_AUTH_TOKEN: _legacyAuthToken,
      ...cleanedEnv
    } = currentEnv;

    const preferredModel = options?.anthropicModel?.trim() || options?.model?.trim();
    const resolvedAnthropicBaseUrl = resolveAnthropicBaseUrl(plan as Plan, options?.baseUrl);
    const requestedAnthropicBaseUrl = options?.anthropicBaseUrl?.trim() || resolvedAnthropicBaseUrl;

    // Claude Code requires Anthropic-compatible API (POST /v1/messages endpoint)
    // It appends /v1/messages to ANTHROPIC_BASE_URL, so base URL should NOT include /v1
    let baseUrl: string;
    
    // Default models for each provider (opus, sonnet, haiku)
    // These can be overridden by options.model
    let defaultModels: { opus: string; sonnet: string; haiku: string };
    
    if (plan === 'kimi') {
      // Kimi/Moonshot only provides OpenAI-compatible API (/v1/chat/completions)
      // They do NOT support Anthropic's /v1/messages endpoint
      throw new Error(
        'Claude Code requires an Anthropic-compatible API (/v1/messages). ' +
        'Kimi/Moonshot only provides OpenAI-compatible API (/v1/chat/completions). ' +
        'Use a different tool (like OpenCode, Crush, or Pi) for Kimi, or use GLM Coding Plan with Claude Code.'
      );
    }
    
    if (plan === 'lmstudio') {
      // LM Studio 0.4.1+ provides Anthropic-compatible /v1/messages endpoint
      // Claude Code appends /v1/messages to ANTHROPIC_BASE_URL
      // So base URL should be http://localhost:1234 (NOT http://localhost:1234/v1)
      // See: https://lmstudio.ai/blog/claudecode
      baseUrl = requestedAnthropicBaseUrl || 'http://localhost:1234';
      // LM Studio uses whatever model is loaded; auth token is just "lmstudio"
      defaultModels = {
        opus: 'local-model',
        sonnet: 'local-model',
        haiku: 'local-model'
      };
    } else if (plan === 'openrouter') {
      // OpenRouter supports Anthropic format at /api/v1/messages when base is /api
      // Claude Code appends /v1/messages, so: openrouter.ai/api + /v1/messages = /api/v1/messages
      baseUrl = requestedAnthropicBaseUrl || 'https://openrouter.ai/api';
      // OpenRouter Claude models
      defaultModels = {
        opus: 'anthropic/claude-opus-4.6',
        sonnet: 'anthropic/claude-sonnet-4.6',
        haiku: 'anthropic/claude-haiku-4.6'
      };
    } else if (plan === 'nvidia') {
      // NVIDIA NIM only provides OpenAI-compatible API
      throw new Error(
        'Claude Code requires an Anthropic-compatible API (/v1/messages). ' +
        'NVIDIA NIM only provides OpenAI-compatible API (/v1/chat/completions). ' +
        'Use a different tool (like OpenCode, Crush, or Pi) for NVIDIA NIM, or use GLM Coding Plan with Claude Code.'
      );
    } else if (plan === 'alibaba') {
      // Alibaba Coding Plan - Anthropic-compatible endpoint for Claude Code
      // Claude Code appends /v1/messages, so: /apps/anthropic + /v1/messages = /apps/anthropic/v1/messages
      baseUrl = requestedAnthropicBaseUrl || 'https://coding-intl.dashscope.aliyuncs.com/apps/anthropic';
      // Coding Plan currently supports qwen3-coder-plus.
      defaultModels = {
        opus: 'qwen3-coder-plus',
        sonnet: 'qwen3-coder-plus',
        haiku: 'qwen3-coder-plus'
      };
    } else if (plan === 'alibaba_api') {
      // Alibaba Model Studio API (Singapore) can also expose Anthropic-compatible endpoint.
      baseUrl = requestedAnthropicBaseUrl || 'https://dashscope-intl.aliyuncs.com/apps/anthropic';
      defaultModels = {
        opus: 'qwen3-coder-plus',
        sonnet: 'qwen3-coder-plus',
        haiku: 'qwen3-coder-plus'
      };
    } else if (plan === 'glm_coding_plan_global') {
      // GLM Coding Plan Global - use Anthropic-compatible endpoint (NOT the OpenAI endpoint from profile)
      baseUrl = requestedAnthropicBaseUrl || 'https://api.z.ai/api/anthropic';
      // GLM models per Z.AI docs: https://docs.z.ai/scenario-example/develop-tools/claude
      defaultModels = {
        opus: 'glm-4.7',
        sonnet: 'glm-4.7',
        haiku: 'glm-4.5-air'
      };
    } else if (plan === 'glm_coding_plan_china') {
      // GLM Coding Plan China - use Anthropic-compatible endpoint (NOT the OpenAI endpoint from profile)
      baseUrl = requestedAnthropicBaseUrl || 'https://open.bigmodel.cn/api/anthropic';
      // GLM models per Z.AI docs
      defaultModels = {
        opus: 'glm-4.7',
        sonnet: 'glm-4.7',
        haiku: 'glm-4.5-air'
      };
    } else if (options?.baseUrl?.trim() || options?.anthropicBaseUrl?.trim()) {
      // Custom/unknown provider - use provided URL as-is
      baseUrl = requestedAnthropicBaseUrl || options.baseUrl!.trim();
      // Use provided model or fallback
      const customModel = preferredModel || 'claude-sonnet-4-5-20250929';
      defaultModels = {
        opus: customModel,
        sonnet: customModel,
        haiku: customModel
      };
    } else {
      // Fallback (should not reach here for known plans)
      baseUrl = 'https://api.z.ai/api/anthropic';
      defaultModels = {
        opus: 'glm-4.7',
        sonnet: 'glm-4.7',
        haiku: 'glm-4.5-air'
      };
    }

    // If user specified a model, use it for opus/sonnet
    // Note: For OpenRouter, we keep haiku as a known Anthropic model because
    // Claude Code validates haiku more strictly for background tasks
    if (preferredModel) {
      const model = preferredModel;
      if (plan === 'openrouter') {
        // OpenRouter: preserve haiku as Anthropic model, use custom model for opus/sonnet
        defaultModels = {
          opus: model,
          sonnet: model,
          haiku: 'anthropic/claude-haiku-4.6'  // Keep Anthropic model for background tasks
        };
      } else {
        // Other providers: use custom model for all three
        defaultModels = {
          opus: model,
          sonnet: model,
          haiku: model
        };
      }
    } else {
      const fallbackAnthropicModel = getDefaultAnthropicModel(plan as Plan);
      if (fallbackAnthropicModel) {
        defaultModels = {
          opus: defaultModels.opus || fallbackAnthropicModel,
          sonnet: defaultModels.sonnet || fallbackAnthropicModel,
          haiku: defaultModels.haiku || fallbackAnthropicModel,
        };
      }
    }

    const newConfig = {
      ...currentSettings,
      env: {
        ...cleanedEnv,
        // Claude Code provider routing should use API-key auth, not login token auth.
        ANTHROPIC_API_KEY: apiKey,
        ANTHROPIC_BASE_URL: baseUrl,
        // Model configuration - set all three tiers
        ANTHROPIC_DEFAULT_OPUS_MODEL: defaultModels.opus,
        ANTHROPIC_DEFAULT_SONNET_MODEL: defaultModels.sonnet,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: defaultModels.haiku,
        // Subagents use sonnet by default
        CLAUDE_CODE_SUBAGENT_MODEL: defaultModels.sonnet,
        API_TIMEOUT_MS: '3000000',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 1
      }
    };

    this.saveSettings(newConfig);
  }

  async unloadConfig(): Promise<void> {
    const currentSettings = this.getSettings();
    if (!currentSettings.env) {
      return;
    }
    // Remove all Claude Code related environment variables
    const { 
      ANTHROPIC_API_KEY: _0,
      ANTHROPIC_AUTH_TOKEN: _1, 
      ANTHROPIC_BASE_URL: _2, 
      API_TIMEOUT_MS: _3, 
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: _4,
      ANTHROPIC_DEFAULT_OPUS_MODEL: _5,
      ANTHROPIC_DEFAULT_SONNET_MODEL: _6,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: _7,
      CLAUDE_CODE_SUBAGENT_MODEL: _8,
      ...otherEnv 
    } = currentSettings.env;
    const newSettings = {
      ...currentSettings,
      env: otherEnv
    };
    // If env is empty object, delete the field
    if (newSettings.env && Object.keys(newSettings.env).length === 0) {
      delete newSettings.env;
    }
    this.saveSettings(newSettings);
  }

  async detectCurrentConfig(): Promise<{ plan: string | null; apiKey: string | null; model?: string }> {
    try {
      const settings = this.getSettings();
      const env = settings.env;
      if (!env) {
        return { plan: null, apiKey: null };
      }
      const apiKey = env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN;
      if (!apiKey) {
        return { plan: null, apiKey: null };
      }

      const baseUrl = env.ANTHROPIC_BASE_URL;
      let plan: string | null = null;
      
      // GLM endpoints
      if (baseUrl === 'https://api.z.ai/api/anthropic') {
        plan = 'glm_coding_plan_global';
      } else if (baseUrl === 'https://open.bigmodel.cn/api/anthropic') {
        plan = 'glm_coding_plan_china';
      } else if (baseUrl?.includes('openrouter.ai')) {
        // OpenRouter - base is typically https://openrouter.ai/api
        plan = 'openrouter';
      } else if (baseUrl?.includes('localhost:1234') || baseUrl?.includes('127.0.0.1:1234')) {
        // LM Studio local server (default port 1234)
        plan = 'lmstudio';
      } else if (baseUrl?.includes('coding-intl.dashscope.aliyuncs.com')) {
        // Alibaba Coding Plan endpoint
        plan = 'alibaba';
      } else if (baseUrl?.includes('dashscope-intl.aliyuncs.com/apps/anthropic') || baseUrl?.includes('dashscope.aliyuncs.com/apps/anthropic')) {
        // Anthropic-compatible endpoint can be used by either Coding Plan or API profile.
        plan = typeof apiKey === 'string' && apiKey.startsWith('sk-sp-') ? 'alibaba' : 'alibaba_api';
      } else if (baseUrl?.includes('compatible-mode') || baseUrl?.includes('dashscope')) {
        // Alibaba API / other DashScope endpoint
        plan = 'alibaba_api';
      } else if (baseUrl?.includes('nvidia.com')) {
        // NVIDIA - should not work but detect anyway
        plan = 'nvidia';
      } else if (baseUrl?.includes('moonshot.ai') || baseUrl?.includes('kimi')) {
        // Kimi/Moonshot - should not work but detect anyway
        plan = 'kimi';
      } else if (baseUrl) {
        // Custom endpoint - treat as kimi-like for detection purposes
        plan = 'kimi';
      }
      
      // Return the sonnet model as the primary model (used for display)
      // Claude Code uses sonnet as the default
      const model = env.ANTHROPIC_DEFAULT_SONNET_MODEL;
      
      return { plan, apiKey, model };
    } catch {
      return { plan: null, apiKey: null };
    }
  }

  private ensureOnboardingCompleted() {
    try {
      const mcpConfig = this.getMCPConfig();
      if (!mcpConfig.hasCompletedOnboarding) {
        this.saveMCPConfig({ ...mcpConfig, hasCompletedOnboarding: true });
      }
    } catch (error) {
      console.warn('Failed to ensure onboarding completed:', error);
      logger.logError('ClaudeCodeManager.ensureOnboardingCompleted', error);
    }
  }

  private cleanupShellEnvVars() {
    // 检查当前环境变量是否有这些值
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN && !process.env.ANTHROPIC_BASE_URL) {
      return;
    }
    try {
      // 根据操作系统和 shell 类型确定 rc 文件路径
      const rcFile = this.getShellRcFilePath();
      if (!rcFile || !existsSync(rcFile)) {
        return;
      }
      let content = readFileSync(rcFile, 'utf-8');
      const originalContent = content;
      // 移除 ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN 相关行
      const linesToRemove = [
        /^\s*export\s+ANTHROPIC_BASE_URL=.*$/gm,
        /^\s*export\s+ANTHROPIC_API_KEY=.*$/gm,
        /^\s*export\s+ANTHROPIC_AUTH_TOKEN=.*$/gm,
        /^\s*#\s*Claude Code environment variables\s*$/gm
      ];
      for (const pattern of linesToRemove) {
        content = content.replace(pattern, '');
      }
      // 如果内容有变化，写回文件
      if (content !== originalContent) {
        writeFileSync(rcFile, content, 'utf-8');
        console.log(`Cleaned up ANTHROPIC_* environment variables from ${rcFile}`);
      }
    } catch (error) {
      console.warn('Failed to cleanup shell environment variables:', error);
      logger.logError('ClaudeCodeManager.cleanupShellEnvVars', error);
    }
  }

  private getShellRcFilePath(): string | null {
    const home = homedir();
    // Windows 不使用 rc 文件
    if (process.platform === 'win32') {
      return null;
    }
    // 获取当前 shell
    const shell = process.env.SHELL || '';
    const shellName = shell.split('/').pop() || '';
    switch (shellName) {
      case 'bash':
        return join(home, '.bashrc');
      case 'zsh':
        return join(home, '.zshrc');
      case 'fish':
        return join(home, '.config', 'fish', 'config.fish');
      default:
        return join(home, '.profile');
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

        for (const [key, value] of Object.entries(env)) {
          if (value !== '' || !process.env[key]) continue;
          env[key] = process.env[key] as string;
        }

        // Add API key if required
        if (mcp.requiresAuth && apiKey) {
          env[mcp.authEnvVar || 'Z_AI_API_KEY'] = apiKey;
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

        mcpConfig = {
          type: mcp.protocol === 'sse' ? 'sse' : 'http',
          url: url,
          headers: {
            ...(mcp.headers || {})
          }
        };

        // Add API key to headers if required
        if (mcp.requiresAuth && apiKey) {
          const headerName = mcp.authHeader || 'Authorization';
          const authScheme = mcp.authScheme || 'Bearer';
          mcpConfig.headers = {
            ...mcpConfig.headers,
            [headerName]: authScheme === 'Bearer' ? `Bearer ${apiKey}` : apiKey
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

export const claudeCodeManager = ClaudeCodeManager.getInstance();
