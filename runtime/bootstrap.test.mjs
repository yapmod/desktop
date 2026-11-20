import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const bootstrap = readFileSync(new URL("./bootstrap.js", import.meta.url), "utf8");

function webview(origin = "https://www.yapin.gg") {
  const window = { location: { origin } };
  window.top = window;
  const registered = [];
  const messages = [];
  const client = {
    state: "ready",
    registerClientPlugin(value) { registered.push(value); },
  };
  const document = { readyState: "complete" };
  const console = { error: (...args) => messages.push(args), warn: (...args) => messages.push(args) };
  // Substitute data URLs so Node's ESM loader can execute the same source as a WebView blob URL.
  class Blob {
    constructor(parts) { this.source = parts.join(""); }
  }
  const URL = {
    createObjectURL: blob => "data:text/javascript," + encodeURIComponent(blob.source),
    revokeObjectURL() {},
  };
  const load = new Function("window", "document", "console", "Blob", "URL", `
    const location = window.location;
    return (${bootstrap});
  `)(window, document, console, Blob, URL);
  const startClient = () => { window.YapmodClient = client; };
  const localPlugin = client => client.registerClientPlugin("bundled");
  return {
    window, document, client, registered, messages,
    run: remote => load(startClient, localPlugin, remote),
  };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test("waits for the host DOM and registers once across duplicate load events", async () => {
  const page = webview();
  page.document.readyState = "loading";
  let ready;
  page.document.addEventListener = (name, listen) => {
    assert.equal(name, "DOMContentLoaded");
    ready = listen;
  };
  page.run();
  page.run();
  assert.equal(page.window.YapmodClient, undefined);
  await ready();
  page.run();
  await settle();
  assert.deepEqual(page.registered, ["bundled"]);
});

test("runs a signed plugin expression and falls back on a broken update", async () => {
  const updated = webview();
  updated.run("client => client.registerClientPlugin('updated')");
  await settle();
  assert.deepEqual(updated.registered, ["updated"]);
  const broken = webview();
  broken.run("this is broken");
  await settle();
  assert.deepEqual(broken.registered, ["bundled"]);
  assert.equal(broken.messages.length, 1);
});

test("leaves login provider pages and subframes untouched", async () => {
  const provider = webview("https://accounts.google.com");
  const nested = webview();
  nested.window.top = {};
  provider.run();
  nested.run();
  await settle();
  assert.equal(provider.window.YapmodClient, undefined);
  assert.equal(nested.window.YapmodClient, undefined);
});
