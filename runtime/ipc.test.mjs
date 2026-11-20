import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const script = readFileSync(new URL("./ipc.js", import.meta.url), "utf8")
  .replace("__INVOKE_KEY__", '"test-key"');

function transport(label, origin, iframe = false) {
  const sent = [];
  const rejected = [];
  const internals = {
    metadata: { currentWebview: { label } },
    runCallback: (...args) => rejected.push(args),
  };
  const window = {
    location: { origin },
    __TAURI_INTERNALS__: internals,
    ipc: { postMessage: message => sent.push(JSON.parse(message)) },
  };
  window.top = iframe ? {} : window;
  runInNewContext(script, { window });
  return { internals, sent, rejected };
}

test("Yapin and the local shell send JSON commands without a fetch, including the first call", () => {
  for (const [label, origin, cmd, payload] of [
    ["yapin", "https://www.yapin.gg", "notification_permission", { request: false }],
    ["yapin", "https://yapin.gg", "desktop_info", {}],
    ["shell", "tauri://localhost", "open_yapin", {}],
  ]) {
    const { internals, sent } = transport(label, origin);
    assert.equal(sent.length, 0);
    internals.postMessage({ cmd, callback: 21, error: 22, payload });
    assert.deepEqual(sent, [{
      cmd, callback: 21, error: 22, payload,
      options: { customProtocolIpcBlocked: true },
      __TAURI_INVOKE_KEY__: "test-key",
    }]);
  }
});

test("provider pages, login popups and nested frames do not send desktop commands", () => {
  for (const [label, origin] of [
    ["yapin", "https://accounts.google.com"],
    ["signin-0", "https://www.yapin.gg"],
  ]) {
    const { internals, sent, rejected } = transport(label, origin);
    internals.postMessage({ cmd: "desktop_info", callback: 1, error: 2, payload: {} });
    assert.equal(sent.length, 0);
    assert.equal(rejected[0][0], 2);
  }
  assert.equal(transport("yapin", "https://www.yapin.gg", true).internals.postMessage, undefined);
});
