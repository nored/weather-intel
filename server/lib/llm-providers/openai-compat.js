// OpenAI-compatible provider: Ollama / LM Studio / vLLM / OpenRouter / OpenAI.
// Structured output via response_format json_schema where supported; robust
// coerceJson fallback otherwise (for weaker local models).

import { registerProvider, jsonInstruction, coerceJson } from './provider-registry.js';
import { hardenSchema } from '../jsonschema.js';

const provider = {
  type: 'openai-compat',
  defaultModel: 'llama3.2',

  isConfigured(creds) {
    return !!creds.openai_base_url;
  },

  async _resolveModel(creds, baseUrl) {
    if (creds.openai_model) return creds.openai_model;
    try {
      const r = await fetch(`${baseUrl}/models`);
      if (r.ok) {
        const data = await r.json();
        const models = data.models || data.data || [];
        if (models.length) return models[0].id || models[0].name || models[0].model;
      }
    } catch {}
    return this.defaultModel;
  },

  async _chat({ baseUrl, model, messages, maxTokens, creds, responseFormat }) {
    const headers = { 'Content-Type': 'application/json' };
    if (creds.openai_api_key) headers['Authorization'] = `Bearer ${creds.openai_api_key}`;
    const body = { model, messages, max_tokens: maxTokens };
    if (responseFormat) body.response_format = responseFormat;
    let res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST', headers, body: JSON.stringify(body),
    });
    if (!res.ok && responseFormat) {
      // Some servers reject response_format — retry plain.
      delete body.response_format;
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST', headers, body: JSON.stringify(body),
      });
    }
    if (!res.ok) throw new Error(`OpenAI-compat ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  },

  async complete({ system, user, maxTokens = 4096, creds }) {
    const baseUrl = creds.openai_base_url.replace(/\/$/, '');
    const model = await this._resolveModel(creds, baseUrl);
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: user });
    return (await this._chat({ baseUrl, model, messages, maxTokens, creds })).trim();
  },

  async completeJson({ system, user, schema, maxTokens = 2048, creds }) {
    const baseUrl = creds.openai_base_url.replace(/\/$/, '');
    const model = await this._resolveModel(creds, baseUrl);
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: user + jsonInstruction(schema) });
    const responseFormat = {
      type: 'json_schema',
      json_schema: { name: 'response', strict: true, schema: hardenSchema(schema) },
    };
    const raw = await this._chat({ baseUrl, model, messages, maxTokens, creds, responseFormat });
    const obj = coerceJson(raw);
    if (!obj) throw new Error('Could not parse JSON from OpenAI-compat output');
    return obj;
  },

  // "Test connection": list models at the endpoint.
  async probe(creds) {
    const baseUrl = creds.openai_base_url.replace(/\/$/, '');
    const headers = {};
    if (creds.openai_api_key) headers['Authorization'] = `Bearer ${creds.openai_api_key}`;
    const res = await fetch(`${baseUrl}/models`, { headers });
    if (!res.ok) throw new Error(`${res.status} from ${baseUrl}/models`);
    const data = await res.json();
    const models = data.data || data.models || [];
    const names = models.map(m => m.id || m.name || m.model).filter(Boolean);
    return { detail: names.length ? `${names.length} model(s): ${names.slice(0, 4).join(', ')}${names.length > 4 ? '…' : ''}` : 'reachable (no models pulled yet)' };
  },
};

registerProvider('openai', provider);
