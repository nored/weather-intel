// Multi-provider LLM registry. Each provider self-registers an object with:
//   { type, defaultModel, supportsGrammar?, isConfigured(creds),
//     complete({system, user, maxTokens, effort, creds}),               -> text
//     completeJson({system, user, schema, maxTokens, effort, creds}) }  -> object
// The registry resolves a [provider, ...fallback] chain and exposes credential
// storage in data/credentials.json (mode 0600).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { coerceJson } from '../jsonschema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const CREDS_PATH = join(ROOT, 'data', 'credentials.json');

const providers = new Map();

export function registerProvider(name, provider) {
  providers.set(name, provider);
}
export function getProvider(name) {
  return providers.get(name);
}

// Environment-variable fallbacks (for Docker / 12-factor deploys). Only keys
// actually present in the environment are overlaid; UI-saved credentials in
// data/credentials.json always take precedence over these.
function envCredentials() {
  const map = {
    anthropic_api_key: process.env.ANTHROPIC_API_KEY,
    anthropic_model: process.env.ANTHROPIC_MODEL || process.env.MODEL,
    openai_base_url: process.env.OPENAI_BASE_URL,
    openai_api_key: process.env.OPENAI_API_KEY,
    openai_model: process.env.OPENAI_MODEL,
    claude_cli_path: process.env.CLAUDE_CLI_PATH,
    claude_cli_model: process.env.CLAUDE_CLI_MODEL,
  };
  if (process.env.CLAUDE_CLI_ENABLED && !['0', 'false', ''].includes(process.env.CLAUDE_CLI_ENABLED)) {
    map.claude_cli_enabled = true;
  }
  const out = {};
  for (const [k, v] of Object.entries(map)) if (v) out[k] = v;
  return out;
}

function fileCredentials() {
  if (!existsSync(CREDS_PATH)) return {};
  try { return JSON.parse(readFileSync(CREDS_PATH, 'utf-8')); } catch { return {}; }
}

export function loadCredentials() {
  return { ...envCredentials(), ...fileCredentials() };
}

export function saveCredentials(updates) {
  mkdirSync(dirname(CREDS_PATH), { recursive: true });
  // Merge onto the on-disk file only — never persist env-provided secrets.
  const merged = { ...fileCredentials(), ...updates };
  writeFileSync(CREDS_PATH, JSON.stringify(merged, null, 2), { mode: 0o600 });
  return merged;
}

export function listProviders() {
  const creds = loadCredentials();
  return [...providers.entries()].map(([name, p]) => ({
    name,
    type: p.type,
    configured: p.isConfigured(creds),
    model: creds[`${name}_model`] || p.defaultModel || null,
  }));
}

function mask(value) {
  if (!value || value.length <= 8) return '***';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function maskedCredentials() {
  const creds = loadCredentials();
  const out = {};
  for (const [k, v] of Object.entries(creds)) {
    if (k.includes('key') || k.includes('secret')) out[k] = { set: !!v, preview: v ? mask(v) : null };
    else out[k] = { set: !!v, value: v };
  }
  return out;
}

function resolveChain(providerName, fallback) {
  const chain = [providerName, ...(fallback || [])].filter((p, i, a) => p && a.indexOf(p) === i);
  const creds = loadCredentials();
  return { chain, creds };
}

// Free-text completion across the fallback chain.
export async function complete({ provider, system, user, maxTokens = 4096, effort = 'high', fallback = [] }) {
  const { chain, creds } = resolveChain(provider, fallback);
  const errors = [];
  for (const name of chain) {
    const p = providers.get(name);
    if (!p || !p.isConfigured(creds)) continue;
    try {
      const text = await p.complete({ system, user, maxTokens, effort, creds });
      return { text, provider_used: name };
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
    }
  }
  throw new Error(errors.length ? `All providers failed:\n${errors.join('\n')}`
    : `No LLM provider configured. Tried: ${chain.join(', ') || '(none)'}`);
}

// Structured completion: returns a parsed+validated-ish object. Providers with
// native structured output use it; others get an instruction + robust parse.
export async function completeJson({ provider, system, user, schema, maxTokens = 2048, effort = 'medium', fallback = [] }) {
  const { chain, creds } = resolveChain(provider, fallback);
  const errors = [];
  for (const name of chain) {
    const p = providers.get(name);
    if (!p || !p.isConfigured(creds)) continue;
    try {
      const obj = await p.completeJson({ system, user, schema, maxTokens, effort, creds });
      if (obj && typeof obj === 'object') return { data: obj, provider_used: name };
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
    }
  }
  throw new Error(errors.length ? `All providers failed (json):\n${errors.join('\n')}`
    : `No LLM provider configured. Tried: ${chain.join(', ') || '(none)'}`);
}

// Shared helper for providers without native structured output.
export function jsonInstruction(schema) {
  return `\n\nRespond with ONLY a single JSON object matching this schema ` +
    `(no prose, no code fences):\n${JSON.stringify(schema)}`;
}
export { coerceJson };
