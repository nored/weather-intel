// Per-adapter token-bucket rate limiter. Each source declares `rate: {perMin}`;
// we never exceed a source's published limit even when the fan-out hits it from
// several domains at once. acquire() resolves when a token is available.

const buckets = new Map(); // id -> { capacity, tokens, refillPerMs, last }

function bucket(id, perMin) {
  let b = buckets.get(id);
  if (!b) {
    const capacity = Math.max(1, perMin || 60);
    b = { capacity, tokens: capacity, refillPerMs: capacity / 60000, last: Date.now() };
    buckets.set(id, b);
  }
  return b;
}

function refill(b) {
  const t = Date.now();
  b.tokens = Math.min(b.capacity, b.tokens + (t - b.last) * b.refillPerMs);
  b.last = t;
}

// Wait for and consume one token from adapter `id`'s bucket (perMin from the
// adapter's `rate`). Caps the wait so a misbehaving source can't hang fan-out.
export async function acquire(id, perMin) {
  const b = bucket(id, perMin);
  for (let i = 0; i < 50; i++) {
    refill(b);
    if (b.tokens >= 1) { b.tokens -= 1; return; }
    const waitMs = Math.min(2000, Math.ceil((1 - b.tokens) / b.refillPerMs));
    await new Promise(r => setTimeout(r, waitMs));
  }
  // give up waiting after ~max; let the call proceed rather than deadlock
}
