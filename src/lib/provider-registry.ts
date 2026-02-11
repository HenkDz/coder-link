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
    defaultModel: 'glm-4-coder',
    commonModels: ['glm-4.7', 'glm-4-coder', 'glm-4-plus', 'glm-4-air', 'glm-4-flash'],
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
    defaultModel: 'glm-4-coder',
    commonModels: ['glm-4.7', 'glm-4-coder', 'glm-4-plus', 'glm-4-air', 'glm-4-flash'],
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
    detectionPatterns: ['localhost:1234', '127.0.0.1:1234'],
    supportsThinking: false,
    maxContextSize: 262144,
    maxOutputTokens: 131072,
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
 * Resolve the effective base URL, handling user overrides and URL normalization
 */
export function resolveBaseUrl(
  plan: Plan,
  protocol: Protocol,
  options?: { baseUrl?: string; anthropicBaseUrl?: string }
): string {
  const config = PROVIDER_CONFIGS[plan];
  
  // Priority: anthropicBaseUrl > baseUrl > default
  if (protocol === 'anthropic' && options?.anthropicBaseUrl?.trim()) {
    return normalizeUrl(options.anthropicBaseUrl.trim(), plan, protocol);
  }
  
  if (options?.baseUrl?.trim()) {
    return normalizeUrl(options.baseUrl.trim(), plan, protocol);
  }
  
  return getBaseUrl(plan, protocol);
}

/**
 * Normalize a user-provided URL based on provider-specific rules
 */
function normalizeUrl(url: string, plan: Plan, protocol: Protocol): string {
  const config = PROVIDER_CONFIGS[plan];
  const normalized = url.replace(/\/+$/g, '');
  const lower = normalized.toLowerCase();

  switch (plan) {
    case 'glm_coding_plan_global':
    case 'glm_coding_plan_china':
      if (protocol === 'anthropic') {
        if (lower.endsWith('/api/anthropic')) return normalized;
        if (lower.endsWith('/api/coding/paas/v4')) {
          return normalized.replace(/\/api\/coding\/paas\/v4$/i, '/api/anthropic');
        }
        return config.urls.anthropic || normalized;
      }
      return normalized;

    case 'openrouter':
      if (protocol === 'anthropic') {
        if (lower.endsWith('/api/v1')) return normalized.replace(/\/api\/v1$/i, '/api');
        if (lower.endsWith('/v1')) return normalized.replace(/\/v1$/i, '');
        if (lower.endsWith('/api')) return normalized;
        return lower.includes('openrouter.ai') ? `${normalized}/api` : normalized;
      }
      return normalized;

    case 'lmstudio':
      if (protocol === 'anthropic') {
        return lower.endsWith('/v1') ? normalized.replace(/\/v1$/i, '') : normalized;
      }
      return normalized;

    case 'alibaba':
    case 'alibaba_api':
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

    default:
      return normalized;
  }
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
