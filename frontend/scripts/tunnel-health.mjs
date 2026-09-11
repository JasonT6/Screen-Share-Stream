// Check the public route, not just whether the local cloudflared process exists.
export async function probePublicPage(
  url,
  expected,
  { signal, fetchImpl = fetch, timeoutMs = 4000 } = {}
) {
  try {
    const timeout = AbortSignal.timeout(timeoutMs);
    const response = await fetchImpl(url, {
      cache: "no-store",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout
    });
    const body = await response.text();
    if (response.ok && body === expected) return { ok: true };
    return {
      ok: false,
      reason:
        !response.ok && /\b1033\b/.test(body)
          ? "Cloudflare error 1033: no connected tunnel is available"
          : `HTTP ${response.status}: the public page did not match this app`
    };
  } catch (error) {
    return { ok: false, reason: error.cause?.message || error.message };
  }
}

export function monitorPublicPage(
  url,
  expected,
  { signal, onChange, intervalMs = 15_000, fetchImpl = fetch } = {}
) {
  let stopped = false;
  let checking = false;
  let healthy = true;
  let failures = 0;
  const controller = new AbortController();
  const checkSignal = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;
  async function check() {
    if (stopped || checking || checkSignal.aborted) return;
    checking = true;
    try {
      const result = await probePublicPage(url, expected, {
        signal: checkSignal,
        fetchImpl
      });
      if (stopped || checkSignal.aborted) return;
      failures = result.ok ? 0 : failures + 1;
      // Ignore a single transient failure; report each outage/recovery once.
      if ((result.ok && !healthy) || (!result.ok && healthy && failures >= 2)) {
        healthy = result.ok;
        onChange?.(result);
      }
    } finally {
      checking = false;
    }
  }
  const timer = setInterval(() => void check(), intervalMs);
  function stop() {
    stopped = true;
    clearInterval(timer);
    controller.abort();
    signal?.removeEventListener("abort", stop);
  }
  signal?.addEventListener("abort", stop, { once: true });
  if (signal?.aborted) stop();
  return { check, stop };
}
