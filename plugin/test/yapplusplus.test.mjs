import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadYapplusplus, YAPPLUSPLUS_SCRIPT_URL } from '../src/yapplusplus/loader.ts';

test('loads the upstream Yap++ web integration and releases its script URL', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const scripts = [];
  const revoked = [];
  const requested = [];
  const statuses = [];
  globalThis.fetch = async (url, options) => {
    requested.push([url, options]);
    return { ok: true, text: async () => 'window.yapplusplusLoaded = true;' };
  };
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'script');
      return { remove() { this.removed = true; } };
    },
    head: { append(script) { scripts.push(script); } },
  };
  URL.createObjectURL = (blob) => {
    assert.equal(blob.type, 'text/javascript');
    return 'blob:yapplusplus-test';
  };
  URL.revokeObjectURL = (url) => revoked.push(url);
  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.document = originalDocument;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  const controller = new AbortController();
  await loadYapplusplus(controller.signal, (value) => statuses.push(value));
  assert.equal(requested[0][0], YAPPLUSPLUS_SCRIPT_URL);
  assert.equal(requested[0][1].cache, 'no-cache');
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, 'blob:yapplusplus-test');
  scripts[0].onload();
  assert.deepEqual(statuses, ['Yap++ started. Check its in-page notice for plugin status.']);
  assert.equal(scripts[0].removed, true);
  assert.deepEqual(revoked, ['blob:yapplusplus-test']);
});

test('rejects unsuccessful or oversized Yap++ sources before injecting code', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  globalThis.document = { createElement() { assert.fail('Unexpected script injection.'); } };
  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.document = originalDocument;
  });

  globalThis.fetch = async () => ({ ok: false, status: 404 });
  await assert.rejects(loadYapplusplus(new AbortController().signal, () => {}), /HTTP 404/);
  globalThis.fetch = async () => ({ ok: true, text: async () => 'x'.repeat(512 * 1024 + 1) });
  await assert.rejects(loadYapplusplus(new AbortController().signal, () => {}), /empty or too large/);
});