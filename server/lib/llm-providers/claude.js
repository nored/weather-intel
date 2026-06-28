// Anthropic (Claude) provider via the HTTP Messages API.
// - complete(): plain text.
// - completeJson(): forced tool-use, the robust structured-output method on the
//   standard messages API (a single tool whose input_schema IS the target schema,
//   with tool_choice forcing it). No JSON-repair needed on capable models.

import { registerProvider } from './provider-registry.js';
import { hardenSchema } from '../jsonschema.js';

const API = 'https://api.anthropic.com/v1/messages';
const HEADERS = (key) => ({
  'Content-Type': 'application/json',
  'x-api-key': key,
  'anthropic-version': '2023-06-01',
});

const provider = {
  type: 'claude',
  defaultModel: 'claude-opus-4-8',

  isConfigured(creds) {
    return !!creds.anthropic_api_key;
  },

  async complete({ system, user, maxTokens = 4096, creds }) {
    const model = creds.anthropic_model || this.defaultModel;
    const res = await fetch(API, {
      method: 'POST',
      headers: HEADERS(creds.anthropic_api_key),
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: system || 'You are a meticulous research assistant.',
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    if (data.stop_reason === 'refusal') throw new Error('Model refused the request.');
    return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  },

  async completeJson({ system, user, schema, maxTokens = 2048, creds }) {
    const model = creds.anthropic_model || this.defaultModel;
    const inputSchema = hardenSchema(schema);
    const res = await fetch(API, {
      method: 'POST',
      headers: HEADERS(creds.anthropic_api_key),
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: system || 'You are a meticulous research assistant.',
        messages: [{ role: 'user', content: user }],
        tools: [{
          name: 'respond',
          description: 'Return the structured response.',
          input_schema: inputSchema,
        }],
        tool_choice: { type: 'tool', name: 'respond' },
      }),
    });
    if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    if (data.stop_reason === 'refusal') throw new Error('Model refused the request.');
    const tool = (data.content || []).find(b => b.type === 'tool_use');
    if (!tool) throw new Error('Claude returned no tool_use block');
    return tool.input;
  },

  // Cheap reachability/auth check for the "Test connection" button.
  async probe(creds) {
    const model = creds.anthropic_model || this.defaultModel;
    const res = await fetch(API, {
      method: 'POST',
      headers: HEADERS(creds.anthropic_api_key),
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
    });
    if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 160)}`);
    return { detail: `authenticated · model ${model}` };
  },
};

registerProvider('claude', provider);
