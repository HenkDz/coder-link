/**
 * Centralized Provider Configuration Registry
 * 
 * This module serves as the single source of truth for all provider-related
 * configurations including base URLs, default models, display names, and
 * detection patterns.
 * 
 * Benefits:
 * - Eliminates duplication across manager files
 * - Makes adding new providers easier (add once, works everywhere)
 * - Ensures consistency across all tools
 * - Simplifies maintenance and updates
 */

import type { Plan } from '../utils/config.js';

// ============================================================================
// Types
// ============================================================================

export type Protocol = 'openai' | 'anthropic';

export interface ProviderUrlConfig {
  /** OpenAI-compatible base URL (for /v1/chat/completions) */
  openai: string;
  /** Anthropic-compatible base URL (for /v1/messages) - undefined if not supported */
  anthropic?: string;
}

export interface ConfigurableDefaults {
  /** Default port(s) for local servers */
  defaultPorts?: number[];
  /** Whether baseUrl can be configured by user */
  allowCustomBaseUrl?: boolean;
}

export interface ProviderConfig {
  /** Unique plan identifier */
  id: Plan;
  /** Human-readable display name */
  displayName: string;
  /** Short name for config keys (no spaces, URL-safe) */
  shortName: string;
  /** Base URLs for each protocol */
  urls: ProviderUrlConfig;
  /** Default model ID */
  defaultModel: string;
  /** Common models for this provider */
  commonModels: string[];
  /** URL patterns for detecting this provider from a base URL */
  detectionPatterns: string[];
  /** Whether this provider supports extended thinking/reasoning */
  supportsThinking: boolean;
  /** Max context size for this provider */
  maxContextSize: number;
  /** Max output tokens for this provider */
  maxOutputTokens: number;
  /** 
   * Configurable defaults for local providers
   * Allows users to override default ports or base URLs without editing code
   */
  configurableDefaults?: ConfigurableDefaults;
  /** Whether this provider requires healthcheck on startup (typically local providers) */
  requiresHealthCheck?: boolean;
}

// ============================================================================
// Provider Configurations
// ============================================================================

export const PROVIDER_CONFIGS: Record<Plan, ProviderConfig> = {
  glm_coding_plan_global: {
    id: 'glm_coding_plan_global',
    displayName: 'GLM Coding Plan (Global)',
    shortName: 'GLM_Global',
    urls: {
      openai: 'https://api.z.ai/api/coding/paas/v4',
      anthropic: 'https://api.z.ai/api/anthropic',
    },
    defaultModel: 'glm-5',
    commonModels: ['glm-5', 'glm-4.7', 'glm-4.7-flash', 'glm-4.7-flashx'],
    detectionPatterns: ['api.z.ai'],
    supportsThinking: true,
    maxContextSize: 128000,
    maxOutputTokens: 131072,
  },

  glm_coding_plan_china: {
    id: 'glm_coding_plan_china',
    displayName: 'GLM Coding Plan (China)',
    shortName: 'GLM_China',
    urls: {
      openai: 'https://open.bigmodel.cn/api/coding/paas/v4',
      anthropic: 'https://open.bigmodel.cn/api/anthropic',
    },
    defaultModel: 'glm-5',
    commonModels: ['glm-5', 'glm-4.7', 'glm-4.7-flash', 'glm-4.7-flashx'],
    detectionPatterns: ['open.bigmodel.cn'],
    supportsThinking: true,
    maxContextSize: 128000,
    maxOutputTokens: 131072,
  },

  kimi: {
    id: 'kimi',
    displayName: 'Kimi (Moonshot)',
    shortName: 'Kimi',
    urls: {
      openai: 'https://api.moonshot.ai/v1',
      // Kimi does not support Anthropic protocol
    },
    defaultModel: 'moonshot-ai/kimi-k2.5',
    commonModels: ['moonshot-ai/kimi-k2.5', 'moonshot-ai/kimi-k2-thinking'],
    detectionPatterns: ['api.moonshot.ai', 'moonshot'],
    supportsThinking: true,
    maxContextSize: 262144,
    maxOutputTokens: 131072,
  },

  openrouter: {
    id: 'openrouter',
    displayName: 'OpenRouter',
    shortName: 'OpenRouter',
    urls: {
      openai: 'https://openrouter.ai/api/v1',
      anthropic: 'https://openrouter.ai/api',
    },
    defaultModel: 'kimi-k2.5',
    commonModels: ['openrouter/pony-alpha', 'anthropic/claude-opus-4.6', 'qwen/qwen3-coder-next'],
    detectionPatterns: ['openrouter.ai'],
    supportsThinking: false,
    maxContextSize: 16384,
    maxOutputTokens: 131072,
  },

  nvidia: {
    id: 'nvidia',
    displayName: 'NVIDIA NIM',
    shortName: 'NVIDIA',
    urls: {
      openai: 'https://integrate.api.nvidia.com/v1',
      // NVIDIA does not support Anthropic protocol
    },
    defaultModel: 'moonshotai/kimi-k2.5',
    commonModels: [
      'moonshotai/kimi-k2.5',
      'deepseek-ai/deepseek-v3.2',
      'meta/llama-3.3-70b-instruct',
      'meta/llama-4-maverick-17b-128e-instruct',
      'qwen/qwen3-coder-480b-a35b-instruct',
      'z-ai/glm4.7',
      'nvidia/llama-3.3-nemotron-super-49b-v1.5',
    ],
    detectionPatterns: ['integrate.api.nvidia.com', 'nvidia.com'],
    supportsThinking: false,
    maxContextSize: 4096,
    maxOutputTokens: 131072,
  },

  lmstudio: {
    id: 'lmstudio',
    displayName: 'LM Studio (Local)',
    shortName: 'LM_Studio',
    urls: {
      openai: 'http://localhost:1234/v1',
      anthropic: 'http://localhost:1234',
    },
    defaultModel: 'lmstudio-community',
    commonModels: ['lmstudio-community', 'deepseek-coder-v3', 'codellama/13b', 'mistral-7b-instruct', 'qwen2.5-coder-7b'],
    detectionPatterns: ['localhost:1234', 'localhost:1235', '127.0.0.1:1234', '127.0.0.1:1235'],
    supportsThinking: false,
    maxContextSize: 262144,
    maxOutputTokens: 131072,
    // Configurable defaults for LM Studio (Recommendation #4)
    configurableDefaults: {
      defaultPorts: [1234, 1235, 8766],
      allowCustomBaseUrl: true,
    },
    // Requires healthcheck on startup (Recommendation #1)
    requiresHealthCheck: true,
  },

  alibaba: {
    id: 'alibaba',
    displayName: 'Alibaba Coding Plan',
    shortName: 'Alibaba_Coding',
    urls: {
      openai: 'https://coding-intl.dashscope.aliyuncs.com/v1',
      anthropic: 'https://coding-intl.dashscope.aliyuncs.com/apps/anthropic',
    },
    defaultModel: 'qwen3-coder-plus',
    commonModels: ['qwen3-coder-plus', 'qwen3-max', 'qwen3-max-preview', 'qwen-plus', 'qwen-flash', 'qwen-turbo', 'qwen3-coder-flash'],
    detectionPatterns: ['coding-intl.dashscope.aliyuncs.com'],
    supportsThinking: false,
    maxContextSize: 262144,
    maxOutputTokens: 131072,
  },

  alibaba_api: {
    id: 'alibaba_api',
    displayName: 'Alibaba Model Studio API (Singapore)',
    shortName: 'Alibaba_API',
    urls: {
      openai: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      anthropic: 'https://dashscope-intl.aliyuncs.com/apps/anthropic',
    },
    defaultModel: 'qwen3-max-2026-01-23',
    commonModels: ['qwen3-max-2026-01-23', 'qwen3-max', 'qwen-plus', 'qwen-turbo', 'qwen3-coder-plus'],
    detectionPatterns: ['dashscope-intl.aliyuncs.com', 'dashscope.aliyuncs.com/compatible-mode'],
    supportsThinking: false,
    maxContextSize: 262144,
    maxOutputTokens: 65536, // qwen3-max has lower limit
  },

  zenmux: {
    id: 'zenmux',
    displayName: 'ZenMux',
    shortName: 'ZenMux',
    urls: {
      openai: 'https://zenmux.ai/api/v1',
      anthropic: 'https://zenmux.ai/api/anthropic',
    },
    defaultModel: 'volcengine/doubao-seed-2.0-code',
    commonModels: ['volcengine/doubao-seed-2.0-code'],
    detectionPatterns: ['zenmux.ai'],
    supportsThinking: true,
    maxContextSize: 256000,
    maxOutputTokens: 32000,
  },

  xiaomi: {
    id: 'xiaomi',
    displayName: 'Xiaomi Token Plan (Singapore)',
    shortName: 'Xiaomi_SGP',
    urls: {
      openai: 'https://token-plan-sgp.xiaomimimo.com/v1',
      anthropic: 'https://token-plan-sgp.xiaomimimo.com/anthropic',
    },
    defaultModel: 'mimo-v2.5-pro',
    commonModels: ['mimo-v2.5-pro'],
    detectionPatterns: ['token-plan-sgp.xiaomimimo.com', 'xiaomimimo.com'],
    supportsThinking: true,
    maxContextSize: 128000,
    maxOutputTokens: 131072,
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the provider configuration for a given plan
 */
export function getProviderConfig(plan: Plan): ProviderConfig {
  return PROVIDER_CONFIGS[plan];
}

/**
 * Get the base URL for a specific plan and protocol
 */
export function getBaseUrl(plan: Plan, protocol: Protocol): string {
  const config = PROVIDER_CONFIGS[plan];
  if (protocol === 'anthropic') {
    return config.urls.anthropic || config.urls.openai;
  }
  return config.urls.openai;
}

/**
 * Check if a provider supports a specific protocol
 */
export function supportsProtocol(plan: Plan, protocol: Protocol): boolean {
  const config = PROVIDER_CONFIGS[plan];
  if (protocol === 'anthropic') {
    return config.urls.anthropic !== undefined;
  }
  return true; // All providers support OpenAI
}

/**
 * Detect the plan from a base URL
 */
export function detectPlanFromUrl(baseUrl: string): Plan | null {
  if (!baseUrl) return null;
  
  const normalized = baseUrl.toLowerCase().replace(/\/+$/g, '');
  if (!normalized) return null;

  for (const [planId, config] of Object.entries(PROVIDER_CONFIGS)) {
    for (const pattern of config.detectionPatterns) {
      if (normalized.includes(pattern.toLowerCase())) {
        return planId as Plan;
      }
    }
  }

  return null;
}

/**
 * Get the default model for a plan
 */
export function getDefaultModel(plan: Plan): string {
  return PROVIDER_CONFIGS[plan].defaultModel;
}

/**
 * Normalize provider-specific model aliases/casing.
 */
export function normalizeProviderModel(plan: Plan, model?: string): string | undefined {
  const trimmed = model?.trim();
  if (!trimmed) return trimmed;

  if (plan === 'xiaomi') {
    const lower = trimmed.toLowerCase();
    if (lower === 'mimo-v2.5-pro' || lower === 'mimo-v2.5') return 'mimo-v2.5-pro';
  }

  return trimmed;
}

/**
 * Get max output tokens for a model (handles special cases like qwen3-max)
 */
export function getMaxOutputTokens(plan: Plan, model?: string): number {
  const config = PROVIDER_CONFIGS[plan];
  // qwen3-max models have lower limit
  if (model?.includes('qwen3-max')) {
    return 65536;
  }
  return config.maxOutputTokens;
}

/**
 * Get max context size for a plan
 */
export function getMaxContextSize(plan: Plan): number {
  return PROVIDER_CONFIGS[plan].maxContextSize;
}

/**
 * Check if a provider requires healthcheck on startup
 */
export function requiresHealthCheck(plan: Plan): boolean {
  return PROVIDER_CONFIGS[plan].requiresHealthCheck === true;
}

/**
 * Get configurable defaults for a provider
 */
export function getConfigurableDefaults(plan: Plan): ConfigurableDefaults | undefined {
  return PROVIDER_CONFIGS[plan].configurableDefaults;
}

// ============================================================================
// Protocol-Agnostic URL Resolution (Recommendation #2)
// ============================================================================

/**
 * Resolve provider base URL for a specific protocol.
 * This is a generic, protocol-agnostic function that handles URL normalization
 * for all providers without requiring separate cases for each protocol extension.
 * 
 * @param plan - The provider plan
 * @param protocol - The target protocol ('openai' or 'anthropic')
 * @param options - Optional base URL overrides
 * @returns The resolved and normalized base URL
 */
export function resolveProviderBaseUrl(
  plan: Plan,
  protocol: Protocol,
  options?: { baseUrl?: string; anthropicBaseUrl?: string }
): string {
  // Priority: protocol-specific override > generic override > default
  if (protocol === 'anthropic' && options?.anthropicBaseUrl?.trim()) {
    return normalizeProviderUrl(options.anthropicBaseUrl.trim(), plan, protocol);
  }
  
  if (options?.baseUrl?.trim()) {
    return normalizeProviderUrl(options.baseUrl.trim(), plan, protocol);
  }
  
  return getBaseUrl(plan, protocol);
}

/**
 * Normalize a user-provided URL based on provider-specific rules.
 * This is the core normalization function that handles all providers
 * in a protocol-agnostic way.
 */
function normalizeProviderUrl(url: string, plan: Plan, protocol: Protocol): string {
  const config = PROVIDER_CONFIGS[plan];
  const normalized = url.replace(/\/+$/g, '');
  const lower = normalized.toLowerCase();

  switch (plan) {
    case 'glm_coding_plan_global':
    case 'glm_coding_plan_china':
      return normalizeGLMUrl(normalized, lower, protocol, config);

    case 'openrouter':
      return normalizeOpenRouterUrl(normalized, lower, protocol);

    case 'lmstudio':
      // Use centralized LM Studio normalization
      return normalizeLMStudioUrl(normalized, protocol);

    case 'alibaba':
    case 'alibaba_api':
      return normalizeAlibabaUrl(normalized, lower, protocol, config);

    case 'zenmux':
      return normalizeZenMuxUrl(normalized, lower, protocol, config);

    case 'xiaomi':
      return normalizeXiaomiUrl(normalized, lower, protocol, config);

    default:
      return normalized;
  }
}

/**
 * Normalize GLM (Zhipu AI) URLs
 */
function normalizeGLMUrl(
  normalized: string,
  lower: string,
  protocol: Protocol,
  config: ProviderConfig
): string {
  if (protocol === 'anthropic') {
    if (lower.endsWith('/api/anthropic')) return normalized;
    if (lower.endsWith('/api/coding/paas/v4')) {
      return normalized.replace(/\/api\/coding\/paas\/v4$/i, '/api/anthropic');
    }
    return config.urls.anthropic || normalized;
  }
  return normalized;
}

/**
 * Normalize OpenRouter URLs
 */
function normalizeOpenRouterUrl(normalized: string, lower: string, protocol: Protocol): string {
  if (protocol === 'anthropic') {
    if (lower.endsWith('/api/v1')) return normalized.replace(/\/api\/v1$/i, '/api');
    if (lower.endsWith('/v1')) return normalized.replace(/\/v1$/i, '');
    if (lower.endsWith('/api')) return normalized;
    return lower.includes('openrouter.ai') ? `${normalized}/api` : normalized;
  }
  return normalized;
}

/**
 * Normalize Alibaba/DashScope URLs
 */
function normalizeAlibabaUrl(
  normalized: string,
  lower: string,
  protocol: Protocol,
  config: ProviderConfig
): string {
  if (protocol === 'anthropic') {
    if (lower.includes('/apps/anthropic')) return normalized;
    if (lower.includes('/compatible-mode/v1')) {
      return normalized.replace(/\/compatible-mode\/v1$/i, '/apps/anthropic');
    }
    if (lower.endsWith('/v1')) {
      return normalized.replace(/\/v1$/i, '/apps/anthropic');
    }
    return config.urls.anthropic || normalized;
  }
  return normalized;
}

/**
 * Normalize ZenMux URLs
 */
function normalizeZenMuxUrl(
  normalized: string,
  lower: string,
  protocol: Protocol,
  config: ProviderConfig
): string {
  if (protocol === 'anthropic') {
    if (lower.endsWith('/api/anthropic')) return normalized;
    if (lower.endsWith('/api/v1')) {
      return normalized.replace(/\/api\/v1$/i, '/api/anthropic');
    }
    if (lower.endsWith('/v1')) {
      return normalized.replace(/\/v1$/i, '/api/anthropic');
    }
    return config.urls.anthropic || normalized;
  }
  return normalized;
}

/**
 * Normalize Xiaomi Token Plan URLs
 */
function normalizeXiaomiUrl(
  normalized: string,
  lower: string,
  protocol: Protocol,
  config: ProviderConfig
): string {
  if (protocol === 'anthropic') {
    if (lower.endsWith('/anthropic')) return normalized;
    if (lower.endsWith('/v1')) {
      return normalized.replace(/\/v1$/i, '/anthropic');
    }
    return config.urls.anthropic || normalized;
  }

  if (protocol === 'openai') {
    if (lower.endsWith('/v1')) return normalized;
    if (lower.endsWith('/anthropic')) {
      return normalized.replace(/\/anthropic$/i, '/v1');
    }
  }

  return normalized;
}

/**
 * Normalize LM Studio URL for a specific protocol (protocol-agnostic)
 * This is a dedicated function to handle LM Studio's URL conventions.
 */
export function normalizeLMStudioUrl(url: string, protocol: Protocol): string {
  const normalized = url.replace(/\/+$/g, '');
  const lower = normalized.toLowerCase();

  // For Anthropic protocol, LM Studio expects base URL without /v1
  if (protocol === 'anthropic') {
    return lower.endsWith('/v1') ? normalized.replace(/\/v1$/i, '') : normalized;
  }

  // For OpenAI protocol, ensure /v1 suffix
  if (protocol === 'openai') {
    return lower.endsWith('/v1') ? normalized : `${normalized}/v1`;
  }

  return normalized;
}

/**
 * Get all provider plans as an array
 */
export function getAllPlans(): Plan[] {
  return Object.keys(PROVIDER_CONFIGS) as Plan[];
}

/**
 * Get provider display name
 */
export function getProviderDisplayName(plan: Plan): string {
  return PROVIDER_CONFIGS[plan].displayName;
}

/**
 * Get provider short name (for config keys)
 */
export function getProviderShortName(plan: Plan): string {
  return PROVIDER_CONFIGS[plan].shortName;
}

/**
 * Check if a provider supports extended thinking
 */
export function supportsThinking(plan: Plan, source?: string): boolean {
  const config = PROVIDER_CONFIGS[plan];
  if (!config.supportsThinking) return false;
  
  // For Kimi, only native Moonshot API supports thinking
  if (plan === 'kimi') {
    return !source || source === '' || source.toLowerCase() === 'moonshot';
  }
  
  return true;
}

// ============================================================================
// LM Studio Detection & Health Check (Enhanced with Robustness Features)
// ============================================================================

/**
 * Error types for LM Studio connection issues
 */
export enum LMStudioErrorType {
  CONNECTION_REFUSED = 'connection-refused',
  TIMEOUT = 'timeout',
  DNS_FAILURE = 'dns-failure',
  HTTP_ERROR = 'http-error',
  UNKNOWN = 'unknown',
}

/**
 * Detailed health check error information
 */
export interface LMStudioHealthError {
  type: LMStudioErrorType;
  message: string;
  statusCode?: number;
  details?: string;
}

/**
 * Response from LM Studio /v1/models endpoint
 */
interface LMStudioModel {
  id: string;
  object: string;
  owned_by?: string;
}

interface LMStudioModelsResponse {
  data: LMStudioModel[];
}

/**
 * Enhanced health check result with detailed diagnostics
 */
export interface LMStudioHealthResult {
  reachable: boolean;
  url?: string;
  version?: string;
  /** Port that responded successfully */
  port?: number;
  /** Error details if unreachable */
  error?: LMStudioHealthError;
  /** Number of attempts made */
  attempts: number;
  /** Whether model was successfully tested */
  modelTested: boolean;
  /** Model ID if available */
  modelId?: string;
}

/** Default health check timeout in milliseconds */
const LM_STUDIO_HEALTH_TIMEOUT = 3000;

/** Default max retries for health check */
const LM_STUDIO_MAX_RETRIES = 3;

/**
 * Get default ports for LM Studio from configuration
 */
function getLMStudioConfiguredPorts(): number[] {
  const config = PROVIDER_CONFIGS.lmstudio;
  return config.configurableDefaults?.defaultPorts || [1234, 1235, 8766];
}

/**
 * Classify network errors for better diagnostics
 */
function classifyLMStudioError(error: unknown): LMStudioHealthError {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    
    // Connection refused - server not running
    if (message.includes('econnrefused') || message.includes('connection refused')) {
      return {
        type: LMStudioErrorType.CONNECTION_REFUSED,
        message: 'Connection refused - LM Studio may not be running',
        details: error.message,
      };
    }
    
    // Timeout - server running but slow/unresponsive
    if (message.includes('etimedout') || message.includes('timeout') || error.name === 'AbortError') {
      return {
        type: LMStudioErrorType.TIMEOUT,
        message: 'Connection timed out - server is slow or overloaded',
        details: error.message,
      };
    }
    
    // DNS failure - invalid hostname
    if (message.includes('enotfound') || message.includes('dns')) {
      return {
        type: LMStudioErrorType.DNS_FAILURE,
        message: 'DNS resolution failed - check host name',
        details: error.message,
      };
    }
    
    // HTTP error with status code (fetch throws Response-like error)
    const errorWithStatus = error as { status?: number };
    if (typeof errorWithStatus.status === 'number') {
      return {
        type: LMStudioErrorType.HTTP_ERROR,
        message: `HTTP error ${errorWithStatus.status}`,
        statusCode: errorWithStatus.status,
        details: error.message,
      };
    }
    
    // Network/unknown errors
    if (message.includes('network') || message.includes('failed')) {
      return {
        type: LMStudioErrorType.UNKNOWN,
        message: 'Network error occurred',
        details: error.message,
      };
    }
  }
  
  return {
    type: LMStudioErrorType.UNKNOWN,
    message: 'Unknown error occurred',
    details: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Extract port from URL string
 */
function extractPort(url: string): number | undefined {
  const match = url.match(/:(\d+)/);
  return match ? parseInt(match[1], 10) : undefined;
}

/**
 * Build health check URL from base URL
 */
function buildHealthUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/$/, '');
  // LM Studio health endpoint is at root
  return normalized;
}

/**
 * Build models endpoint URL from base URL (protocol-agnostic)
 */
function buildModelsUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  // For OpenAI-compatible endpoint, models are at /v1/models
  if (normalized.endsWith('/v1')) {
    return `${normalized}/models`;
  }
  return `${normalized}/v1/models`;
}

/**
 * Health check response from LM Studio
 */
interface LMStudioHealthResponse {
  status?: string;
  version?: string;
}

/**
 * Test chat completions endpoint to verify API is working
 */
async function testChatCompletionsEndpoint(
  baseUrl: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<{ success: boolean; error?: LMStudioHealthError }> {
  const chatUrl = `${buildModelsUrl(baseUrl).replace('/models', '')}/chat/completions`;
  
  try {
    const controller = signal ? null : new AbortController();
    const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
    
    const response = await fetch(chatUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer lmstudio', // LM Studio accepts any key
      },
      body: JSON.stringify({
        model: 'test',
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 10,
      }),
      signal: signal ?? controller?.signal,
    });
    
    if (timeoutId) clearTimeout(timeoutId);
    
    // 200, 400, 401, 404 are all acceptable - means endpoint exists
    if (response.status >= 200 && response.status < 500) {
      return { success: true };
    }
    
    return { 
      success: false,
      error: {
        type: LMStudioErrorType.HTTP_ERROR,
        message: `Unexpected status code: ${response.status}`,
        statusCode: response.status,
      }
    };
    
  } catch (error) {
    return {
      success: false,
      error: classifyLMStudioError(error),
    };
  }
}

/**
 * Check if LM Studio server is reachable with retry logic and error classification
 * Returns detailed health result with diagnostics
 */
export async function checkLMStudioHealth(
  baseUrl?: string,
  options?: { 
    timeoutMs?: number; 
    signal?: AbortSignal;
    maxRetries?: number;
    testChatEndpoint?: boolean;
  }
): Promise<LMStudioHealthResult> {
  const timeout = options?.timeoutMs ?? LM_STUDIO_HEALTH_TIMEOUT;
  const maxRetries = options?.maxRetries ?? LM_STUDIO_MAX_RETRIES;
  const testChatEndpoint = options?.testChatEndpoint ?? false;
  
  const defaultPorts = getLMStudioConfiguredPorts();
  
  // If specific URL provided, try only that
  const urlsToTry = baseUrl
    ? [{ url: baseUrl.replace(/\/+$/, ''), port: extractPort(baseUrl) }]
    : defaultPorts.map(port => ({ url: `http://localhost:${port}`, port }));
  
  let lastError: LMStudioHealthError | undefined;
  let attempts = 0;
  let lastSuccessfulUrl: string | undefined;
  let lastSuccessfulPort: number | undefined;
  
  for (const { url, port } of urlsToTry) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      attempts++;
      
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        // Try health endpoint first (root)
        const healthUrl = buildHealthUrl(url);
        const response = await fetch(healthUrl, {
          method: 'GET',
          signal: options?.signal ?? controller.signal,
        });
        
        clearTimeout(timeoutId);
        
        // Check if we got a valid response
        if (response.ok || response.status === 200) {
          // Try to parse version info if available
          let version: string | undefined;
          try {
            const data: LMStudioHealthResponse = await response.json();
            version = data.version;
          } catch {
            // Health endpoint might return plain text or no body
          }
          
          // Optionally test chat completions endpoint
          let modelId: string | undefined;
          let modelTested = false;
          
          if (testChatEndpoint) {
            const chatTest = await testChatCompletionsEndpoint(url, timeout, controller.signal);
            if (chatTest.success) {
              modelTested = true;
              // Try to fetch actual model
              const fetchedModel = await fetchLMStudioModel(url, { timeoutMs: timeout });
              modelId = fetchedModel ?? undefined;
            } else {
              lastError = chatTest.error;
            }
          } else {
            modelTested = true;
            const fetchedModel = await fetchLMStudioModel(url, { timeoutMs: timeout });
            modelId = fetchedModel ?? undefined;
          }
          
          return {
            reachable: true,
            url,
            port,
            version,
            modelTested,
            modelId,
            attempts,
          };
        } else {
          lastError = {
            type: LMStudioErrorType.HTTP_ERROR,
            message: `HTTP ${response.status}`,
            statusCode: response.status,
          };
        }
        
      } catch (error) {
        lastError = classifyLMStudioError(error);
        
        // Retry with exponential backoff (except on last attempt)
        if (attempt < maxRetries - 1) {
          const backoffMs = Math.pow(2, attempt) * 500;
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          continue;
        }
      }
    }
    
    lastSuccessfulUrl = url;
    lastSuccessfulPort = port;
  }
  
  // All attempts failed
  return {
    reachable: false,
    url: lastSuccessfulUrl,
    port: lastSuccessfulPort,
    error: lastError,
    attempts,
    modelTested: false,
  };
}

/**
 * Scan localhost for LM Studio across common ports
 * Returns first port that responds, or null if none found
 */
export async function scanForLMStudio(
  options?: { 
    timeoutMs?: number; 
    signal?: AbortSignal;
    additionalPorts?: number[];
  }
): Promise<number | null> {
  const timeout = options?.timeoutMs ?? 1000;
  const basePorts = getLMStudioConfiguredPorts();
  const customPorts = options?.additionalPorts || [];
  const portsToScan = [...basePorts, ...customPorts];
  
  for (const port of portsToScan) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const url = `http://localhost:${port}`;
      const response = await fetch(url, {
        method: 'GET',
        signal: options?.signal ?? controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok || response.status === 200) {
        return port;
      }
      
    } catch {
      continue;
    }
  }
  
  return null;
}

/**
 * Fetch the currently loaded model from LM Studio
 * Returns the model ID if available, null otherwise
 */
export async function fetchLMStudioModel(
  baseUrl?: string,
  options?: { timeoutMs?: number; signal?: AbortSignal; port?: number }
): Promise<string | null> {
  const timeout = options?.timeoutMs ?? LM_STUDIO_HEALTH_TIMEOUT;
  const defaultPorts = getLMStudioConfiguredPorts();

  // Build URLs to try
  let urlsToTry: string[];
  if (baseUrl) {
    urlsToTry = [buildModelsUrl(baseUrl.replace(/\/+$/, ''))];
  } else if (options?.port) {
    urlsToTry = [buildModelsUrl(`http://localhost:${options.port}`)];
  } else {
    urlsToTry = defaultPorts.map(port => buildModelsUrl(`http://localhost:${port}`));
  }

  for (const modelsUrl of urlsToTry) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(modelsUrl, {
        method: 'GET',
        signal: options?.signal ?? controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        continue;
      }

      const data: LMStudioModelsResponse = await response.json();

      if (data.data && data.data.length > 0) {
        // Return the first (usually only) loaded model
        return data.data[0].id;
      }
    } catch {
      // Try next URL
      continue;
    }
  }

  return null;
}

/**
 * Check if LM Studio is running and has a model loaded
 * Enhanced with detailed status information and diagnostics
 */
export async function checkLMStudioStatus(
  baseUrl?: string,
  options?: { 
    timeoutMs?: number; 
    port?: number;
    maxRetries?: number;
    testChatEndpoint?: boolean;
  }
): Promise<{
  running: boolean;
  reachable: boolean;
  modelLoaded: boolean;
  modelId?: string;
  actualUrl?: string;
  version?: string;
  port?: number;
  error?: LMStudioHealthError;
  attempts?: number;
}> {
  const health = await checkLMStudioHealth(baseUrl, {
    timeoutMs: options?.timeoutMs,
    maxRetries: options?.maxRetries,
    testChatEndpoint: options?.testChatEndpoint ?? true,
  });
  
  if (!health.reachable) {
    return {
      running: false,
      reachable: false,
      modelLoaded: false,
      error: health.error,
      attempts: health.attempts,
    };
  }
  
  return {
    running: true,
    reachable: true,
    modelLoaded: health.modelTested,
    modelId: health.modelId,
    actualUrl: health.url,
    port: health.port,
    version: health.version,
    attempts: health.attempts,
  };
}

/**
 * Get the effective base URL for LM Studio, considering custom port configuration
 */
export function getLMStudioBaseUrl(options?: { port?: number; baseUrl?: string }): string {
  if (options?.baseUrl) {
    return options.baseUrl.replace(/\/+$/, '');
  }
  if (options?.port) {
    return `http://localhost:${options.port}`;
  }
  // Default to first configured port
  const defaultPorts = getLMStudioConfiguredPorts();
  return `http://localhost:${defaultPorts[0]}`;
}

/**
 * Get default LM Studio ports from configuration
 */
export function getLMStudioDefaultPorts(): number[] {
  return [...getLMStudioConfiguredPorts()];
}

// ============================================================================
// Generic Provider Health Check (Recommendation #1 extended)
// ============================================================================

export interface ProviderHealthCheckResult {
  reachable: boolean;
  url?: string;
  error?: string;
  /** Provider-specific metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Perform health check for any provider that requires it.
 * This is a generic function that can be extended for other local providers.
 */
export async function checkProviderHealth(
  plan: Plan,
  options?: { baseUrl?: string; timeoutMs?: number; signal?: AbortSignal }
): Promise<ProviderHealthCheckResult> {
  const config = PROVIDER_CONFIGS[plan];
  
  if (!config.requiresHealthCheck) {
    // Provider doesn't require health check, assume reachable
    return { 
      reachable: true, 
      url: options?.baseUrl || getBaseUrl(plan, 'openai') 
    };
  }

  // Currently only LM Studio requires health check
  // This can be extended for other local providers
  if (plan === 'lmstudio') {
    const result = await checkLMStudioHealth(options?.baseUrl, {
      timeoutMs: options?.timeoutMs,
      signal: options?.signal,
    });
    
    return {
      reachable: result.reachable,
      url: result.url,
      metadata: result.version ? { version: result.version } : undefined,
    };
  }

  return { reachable: true };
}
