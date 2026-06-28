// JSON-schema hardening + robust JSON parsing, ported from the Python engine's
// models.py (strict_schema / coerce_json / parse_into). Providers use hardenSchema
// for native structured output; coerceJson is the fallback for weaker models.

// Harden a JSON schema for strict structured-output formats:
// additionalProperties:false and every property required, recursively.
export function hardenSchema(schema) {
  const harden = (node) => {
    if (!node || typeof node !== 'object') return node;
    if (node.type === 'object' || node.properties) {
      node.additionalProperties = false;
      const props = node.properties || {};
      node.required = Object.keys(props);
      for (const v of Object.values(props)) harden(v);
    }
    if (node.type === 'array' && node.items && typeof node.items === 'object') {
      harden(node.items);
    }
    return node;
  };
  return harden(structuredClone(schema));
}

function stripFences(text) {
  let t = text.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }
  return t.trim();
}

// Best-effort extraction of a JSON object/array from messy LLM output: handles
// code fences, prose preambles, echoed examples, and minor truncation.
export function coerceJson(text) {
  if (text == null) return null;
  const t = stripFences(String(text));
  try { return JSON.parse(t); } catch {}

  // Prefer the LAST balanced object/array (models often echo the example first).
  const candidates = [...t.matchAll(/[\{\[][\s\S]*?[\}\]]/g)];
  for (let i = candidates.length - 1; i >= 0; i--) {
    try { return JSON.parse(candidates[i][0]); } catch {}
  }
  const m = t.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}
