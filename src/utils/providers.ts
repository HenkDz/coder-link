import type { Plan } from './config.js';
import {
  PROVIDER_CONFIGS,
  getAllPlans,
  getBaseUrl,
  getDefaultModel,
  getProviderDisplayName,
  supportsProtocol,
  getMaxContextSize,
  normalizeLMStudioUrl,
  resolveProviderBaseUrl,
  type Protocol,
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

/**
 * Resolve Anthropic-compatible base URL from OpenAI-compatible URL.
 * Uses the centralized protocol-agnostic URL resolver (Recommendation #2).
 * 
 * @param plan - The provider plan
 * @param openAiBaseUrl - Optional OpenAI-compatible base URL to derive from
 * @returns The resolved Anthropic-compatible base URL, or undefined if not supported
 */
export function resolveAnthropicBaseUrl(plan: Plan, openAiBaseUrl?: string): string | undefined {
  if (!supportsProtocol(plan, 'anthropic')) return undefined;
  
  // Use the generic protocol-agnostic resolver
  return resolveProviderBaseUrl(plan, 'anthropic', { baseUrl: openAiBaseUrl });
}

// Re-export the generic resolver for direct use
export { resolveProviderBaseUrl } from '../lib/provider-registry.js';

// Re-export Protocol type for convenience
export type { Protocol } from '../lib/provider-registry.js';
