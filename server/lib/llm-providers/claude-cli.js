// `claude -p` provider: shells out to Claude Code in headless print mode.
// No API key needed — uses the user's local Claude Code auth. Structured output
// is requested via instruction and robustly parsed (the CLI returns free text).

import { execFile } from 'child_process';
import { registerProvider, jsonInstruction, coerceJson } from './provider-registry.js';

function runClaude(args, { timeoutMs = 600000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(args.bin, args.argv, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(`claude -p failed: ${(stderr || err.message).slice(0, 300)}`));
        resolve(stdout);
      });
  });
}

const provider = {
  type: 'claude-cli',
  defaultModel: '', // empty = use the CLI's configured default

  // Configured if the user opted in (path implies intent to use the local CLI).
  isConfigured(creds) {
    return !!creds.claude_cli_enabled || !!creds.claude_cli_path;
  },

  _argv(creds, prompt) {
    const bin = creds.claude_cli_path || 'claude';
    const argv = ['-p', prompt, '--output-format', 'json'];
    const model = creds.claude_cli_model || this.defaultModel;
    if (model) argv.push('--model', model);
    return { bin, argv };
  },

  _parseResult(stdout) {
    try {
      const parsed = JSON.parse(stdout);
      return (parsed.result ?? stdout).toString().trim();
    } catch {
      return stdout.trim();
    }
  },

  async complete({ system, user, creds }) {
    const prompt = system ? `${system}\n\n${user}` : user;
    const out = await runClaude(this._argv(creds, prompt));
    return this._parseResult(out);
  },

  async completeJson({ system, user, schema, creds }) {
    const base = system ? `${system}\n\n${user}` : user;
    const out = await runClaude(this._argv(creds, base + jsonInstruction(schema)));
    const obj = coerceJson(this._parseResult(out));
    if (!obj) throw new Error('Could not parse JSON from claude -p output');
    return obj;
  },

  // "Test connection": one quick round-trip through the CLI to confirm it's
  // installed and authenticated.
  async probe(creds) {
    const out = await runClaude(this._argv(creds, 'Reply with the single word OK.'), { timeoutMs: 60000 });
    const txt = this._parseResult(out);
    if (!txt) throw new Error('claude -p returned nothing (logged in?)');
    return { detail: `claude -p responding (${(creds.claude_cli_model || 'default model')})` };
  },
};

registerProvider('claude-cli', provider);
