import type { Plan } from './config.js';
import {
  PROVIDER_CONFIGS,
  getAllPlans,
  getBaseUrl,
  getDefaultModel,
  getProviderDisplayName,
  supportsProtocol,
  getMaxContextSize,
} from '../lib/provider-registry.js';

export type ProviderProtocol = 'openai' | 'anthropic';

export interface ProviderChoice {
  name: string;
  value: Plan;
}

// Generate PROVIDER_CHOICES from the centralized registry
export const PROVIDER_CHOICES: ProviderChoice[] = Object.values(PROVIDER_CONFIGS).map(
  (config) => ({
    name: config.displayName,
    value: config.id,
  })
);

export const PROVIDER_PLAN_VALUES: Plan[] = getAllPlans();

// Generate PROVIDER_PROTOCOLS from the centralized registry
export const PROVIDER_PROTOCOLS: Record<Plan, { openai: boolean; anthropic: boolean }> = 
  Object.fromEntries(
    getAllPlans().map((plan) => [
      plan,
      {
        openai: supportsProtocol(plan, 'openai'),
        anthropic: supportsProtocol(plan, 'anthropic'),
      },
    ])
  ) as Record<Plan, { openai: boolean; anthropic: boolean }>;

// Generate COMMON_MODELS from the centralized registry
export const COMMON_MODELS: Record<Plan, string[]> = Object.fromEntries(
  Object.values(PROVIDER_CONFIGS).map((config) => [config.id, config.commonModels])
) as Record<Plan, string[]>;

export function suggestedContextSize(plan: Plan): number {
  return getMaxContextSize(plan);
}

export function supportsOpenAIProtocol(plan: Plan): boolean {
  return supportsProtocol(plan, 'openai');
}

export function supportsAnthropicProtocol(plan: Plan): boolean {
  return supportsProtocol(plan, 'anthropic');
}

export function getSupportedProtocols(plan: Plan): ProviderProtocol[] {
  const protocols: ProviderProtocol[] = [];
  if (supportsProtocol(plan, 'openai')) protocols.push('openai');
  if (supportsProtocol(plan, 'anthropic')) protocols.push('anthropic');
  return protocols;
}

export function protocolLabel(protocol: ProviderProtocol): string {
  return protocol === 'openai' ? 'OpenAI-compatible' : 'Anthropic-compatible';
}

export function providerProtocolSummary(plan: Plan): string {
  const protocols = getSupportedProtocols(plan).map(protocolLabel);
  return protocols.join(' + ');
}

export function getDefaultAnthropicModel(plan: Plan): string | undefined {
  if (!supportsProtocol(plan, 'anthropic')) return undefined;
  return getDefaultModel(plan);
}

export function resolveAnthropicBaseUrl(plan: Plan, openAiBaseUrl?: string): string | undefined {
  if (!supportsProtocol(plan, 'anthropic')) return undefined;
  
  const config = PROVIDER_CONFIGS[plan];
  const fallback = config.urls.anthropic;
  
  if (!openAiBaseUrl?.trim()) return fallback;
  
  const normalized = openAiBaseUrl.trim().replace(/\/+$/g, '');
  const lower = normalized.toLowerCase();

  // Handle provider-specific URL normalization
  switch (plan) {
    case 'glm_coding_plan_global':
    case 'glm_coding_plan_china':
      if (lower.endsWith('/api/anthropic')) return normalized;
      if (lower.endsWith('/api/coding/paas/v4')) return normalized.replace(/\/api\/coding\/paas\/v4$/i, '/api/anthropic');
      return fallback;

    case 'openrouter':
      if (lower.endsWith('/api/v1')) return normalized.replace(/\/api\/v1$/i, '/api');
      if (lower.endsWith('/v1')) return normalized.replace(/\/v1$/i, '');
      if (lower.endsWith('/api')) return normalized;
      return lower.includes('openrouter.ai') ? `${normalized}/api` : normalized;

    case 'lmstudio':
      return lower.endsWith('/v1') ? normalized.replace(/\/v1$/i, '') : normalized;

    case 'alibaba':
    case 'alibaba_api':
      if (lower.includes('/apps/anthropic')) return normalized;
      if (lower.includes('/compatible-mode/v1')) return normalized.replace(/\/compatible-mode\/v1$/i, '/apps/anthropic');
      if (lower.endsWith('/v1')) return normalized.replace(/\/v1$/i, '/apps/anthropic');
      return fallback;

    default:
      return fallback;
  }
}

