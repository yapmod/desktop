import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const script = readFileSync(new URL("./badge.js", import.meta.url), "utf8");

function fixture({ origin = "https://www.yapin.gg", label = "yapin", iframe = false, existing, reject = false } = {}) {
  const calls = [];
  const warnings = [];
  const window = {
    location: { origin },
    yapinDesktop: existing,
    __TAURI_INTERNALS__: {
      metadata: { currentWebview: { label } },
      async invoke(command, args) {
        calls.push({ command, count: args.count });
        if (reject) throw new Error("Unavailable");
      },
    },
  };
  window.top = iframe ? {} : window;
  const install = () => runInNewContext(`(${script})("macos")`, {
    window, console: { warn: (...args) => warnings.push(args) },
  });
  install();
  return { window, calls, warnings, install };
}

test("Yapin can supply counts immediately, including clearing and bounded integers", () => {
  for (const origin of ["https://www.yapin.gg", "https://yapin.gg"]) {
    const { window, calls, install } = fixture({ origin });
    const bridge = window.yapinDesktop;
    assert.equal(bridge.platform, "macos");
    assert.equal(calls.length, 0);
    for (const count of [1, 12, 100, 3.9, 0.5, 0, -1, null, undefined, NaN, Infinity, "4"]) {
      bridge.setBadge(count);
    }
    assert.deepEqual(calls.map(call => call.count), [1, 12, 99, 3, null, null, null, null, null, null, null, null]);
    assert.ok(calls.every(call => call.command === "desktop_set_badge"));
    install();
    assert.equal(window.yapinDesktop, bridge);
  }
});

test("authentication pages, popups, the shell, and child frames get no bridge", () => {
  for (const options of [
    { origin: "https://accounts.google.com" },
    { origin: "https://www.yapin.gg.evil.test" },
    { origin: "http://www.yapin.gg" },
    { label: "signin-0" }, { label: "shell" }, { iframe: true },
  ]) {
    assert.equal(fixture(options).window.yapinDesktop, undefined);
  }
  const existing = { setBadge() {} };
  assert.equal(fixture({ existing }).window.yapinDesktop, existing);
});

test("native errors are handled without breaking Yapin's caller", async () => {
  const { window, warnings } = fixture({ reject: true });
  assert.equal(window.yapinDesktop.setBadge(2), undefined);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(warnings.length, 1);
});
