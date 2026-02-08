export type ApiTestResult = {
  ok: boolean;
  status?: number;
  url: string;
  detail: string;
};

export interface ModelInfo {
  id: string;
  contextLength?: number;
  name?: string;
}

/**
 * Fetch model details from OpenRouter's /models endpoint.
 * Returns context_length and other metadata for a specific model.
 */
export async function fetchOpenRouterModelInfo(params: {
  apiKey: string;
  modelId: string;
  timeoutMs?: number;
}): Promise<ModelInfo | null> {
  const timeoutMs = params.timeoutMs ?? 10000;
  const apiKey = params.apiKey.trim();
  const modelId = params.modelId.trim();

  if (!apiKey || !modelId) return null;

  try {
    const resp = await fetchWithTimeout(
      'https://openrouter.ai/api/v1/models',
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        }
      },
      timeoutMs
    );

    if (!resp.ok) return null;

    const text = await resp.text();
    const json = JSON.parse(text);

    if (!json?.data || !Array.isArray(json.data)) return null;

    // Find the model by ID (case-insensitive match)
    const model = json.data.find(
      (m: any) => m?.id && m.id.toLowerCase() === modelId.toLowerCase()
    );

    if (!model) return null;

    return {
      id: model.id,
      contextLength: typeof model.context_length === 'number' ? model.context_length : undefined,
      name: typeof model.name === 'string' ? model.name : undefined,
    };
  } catch {
    return null;
  }
}

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/g, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function testOpenAICompatibleApi(params: {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}): Promise<ApiTestResult> {
  const timeoutMs = params.timeoutMs ?? 12000;
  const baseUrl = params.baseUrl.trim();
  const apiKey = params.apiKey.trim();

  const url = joinUrl(baseUrl, '/models');

  if (!baseUrl) {
    return { ok: false, url, detail: 'Base URL is empty' };
  }
  if (!apiKey) {
    return { ok: false, url, detail: 'API key is empty' };
  }

  try {
    const resp = await fetchWithTimeout(
      url,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        }
      },
      timeoutMs
    );

    const status = resp.status;
    const text = await resp.text();

    if (resp.ok) {
      // Try to extract a hint (first model id)
      try {
        const json = JSON.parse(text);
        const first = Array.isArray(json?.data) ? json.data[0] : undefined;
        const id = typeof first?.id === 'string' ? first.id : undefined;
        return {
          ok: true,
          status,
          url,
          detail: id ? `OK (first model: ${id})` : 'OK'
        };
      } catch {
        return { ok: true, status, url, detail: 'OK' };
      }
    }

    // Non-2xx: show short snippet
    const snippet = text.length > 300 ? `${text.slice(0, 300)}...` : text;
    return {
      ok: false,
      status,
      url,
      detail: snippet || `HTTP ${status}`
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, url, detail: msg };
  }
}

export async function testOpenAIChatCompletionsApi(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
}): Promise<ApiTestResult> {
  const timeoutMs = params.timeoutMs ?? 12000;
  const baseUrl = params.baseUrl.trim();
  const apiKey = params.apiKey.trim();
  const model = params.model.trim();

  const url = joinUrl(baseUrl, '/chat/completions');

  if (!baseUrl) {
    return { ok: false, url, detail: 'Base URL is empty' };
  }
  if (!apiKey) {
    return { ok: false, url, detail: 'API key is empty' };
  }
  if (!model) {
    return { ok: false, url, detail: 'Model is empty' };
  }

  try {
    const resp = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          stream: false
        })
      },
      timeoutMs
    );

    const status = resp.status;
    const text = await resp.text();

    if (resp.ok) {
      try {
        const json = JSON.parse(text);
        const id = typeof json?.model === 'string' ? json.model : undefined;
        const finish = typeof json?.choices?.[0]?.finish_reason === 'string' ? json.choices[0].finish_reason : undefined;
        const hint = [id ? `model: ${id}` : null, finish ? `finish: ${finish}` : null].filter(Boolean).join(', ');
        return { ok: true, status, url, detail: hint ? `OK (${hint})` : 'OK' };
      } catch {
        return { ok: true, status, url, detail: 'OK' };
      }
    }

    const snippet = text.length > 300 ? `${text.slice(0, 300)}...` : text;
    return {
      ok: false,
      status,
      url,
      detail: snippet || `HTTP ${status}`
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, url, detail: msg };
  }
}
