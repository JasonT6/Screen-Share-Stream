import assert from "node:assert/strict";
import { test } from "node:test";
import {
  monitorPublicPage,
  probePublicPage
} from "../scripts/tunnel-health.mjs";

test("public readiness rejects a 1033 page and a successful response from the wrong site", async () => {
  const probe = (body, status) =>
    probePublicPage("https://example.com", "app", {
      fetchImpl: async () => new Response(body, { status })
    });
  assert.deepEqual(await probe("app", 200), { ok: true });
  assert.match((await probe("error code: 1033", 530)).reason, /1033/);
  assert.equal((await probe("different site", 200)).ok, false);
  const failed = await probePublicPage("https://example.com", "app", {
    fetchImpl: async () => {
      throw new Error("network unavailable");
    }
  });
  assert.equal(failed.reason, "network unavailable");
});

test("public link monitoring reports sustained outages and recovery without repeating warnings", async () => {
  const changes = [];
  let available = false;
  let requests = 0;
  const monitor = monitorPublicPage("https://example.com", "app", {
    onChange: (status) => changes.push(status),
    fetchImpl: async () => {
      requests++;
      return new Response(available ? "app" : "error code: 1033", {
        status: available ? 200 : 530
      });
    }
  });
  try {
    await monitor.check();
    assert.equal(changes.length, 0);
    await monitor.check();
    await monitor.check();
    assert.equal(changes.length, 1);
    assert.match(changes[0].reason, /1033/);
    available = true;
    await monitor.check();
    await monitor.check();
    assert.deepEqual(changes[1], { ok: true });
    assert.equal(changes.length, 2);
    monitor.stop();
    const before = requests;
    await monitor.check();
    assert.equal(requests, before);
  } finally {
    monitor.stop();
  }
});

test("shutdown aborts an in-flight public check without an outage warning", async () => {
  const abort = new AbortController();
  const changes = [];
  let requestSignal;
  const monitor = monitorPublicPage("https://example.com", "app", {
    signal: abort.signal,
    onChange: (status) => changes.push(status),
    fetchImpl: (_, { signal }) =>
      new Promise((_, reject) => {
        requestSignal = signal;
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true
        });
      })
  });
  const checking = monitor.check();
  abort.abort();
  await checking;
  assert.ok(requestSignal.aborted);
  assert.equal(changes.length, 0);
});
