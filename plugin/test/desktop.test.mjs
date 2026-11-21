import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source = await readFile(new URL("../dist/desktop-plugins.js", import.meta.url), "utf8");
const settle = () => new Promise((resolve) => setImmediate(resolve));

function fixture(invoke, storage = {}) {
  const window = new EventTarget();
  const previous = class {};
  window.Notification = previous;
  const disposers = [];
  const api = {
    solid: { createSignal: (initial) => [() => initial, (next) => { initial = next; }] },
    ui: {}, solidWeb: {}, settings: { registerSection() {} },
    storage,
    log() {},
    onDispose(disposer) { disposers.push(disposer); },
  };
  const register = runInNewContext(source, { window, EventTarget, Event, CustomEvent, crypto: globalThis.crypto });
  register({
    registerClientPlugin(plugin) {
      assert.equal(plugin.id, "client:yapmod-desktop");
      plugin.setup(api).onLoad();
      return true;
    },
  }, { invoke });
  return { window, previous, dispose() { disposers.forEach((dispose) => dispose()); } };
}

test("a notification click routes once and a close waits for native delivery", async () => {
  const calls = [];
  const delivery = Promise.withResolvers();
  const { window, dispose } = fixture(async (command, args) => {
    calls.push({ command, args });
    if (command === "notification_permission") return "granted";
    if (command === "desktop_notify") return delivery.promise;
  });
  await settle();
  const notice = new window.Notification("Hello", {
    body: "Hi", icon: "https://example.test/private-icon", tag: "chat",
  });
  const { id, ...visible } = calls.at(-1).args;
  assert.ok(Number.isInteger(id) && id > 0);
  assert.deepEqual(visible, { title: "Hello", body: "Hi" });
  let clickCount = 0;
  let closeCount = 0;
  notice.onclick = () => { clickCount++; notice.close(); };
  notice.onclose = () => { closeCount++; };
  for (let i = 0; i < 2; i++) {
    window.dispatchEvent(new CustomEvent("yapmod:desktop-notification-click", { detail: id }));
  }
  assert.equal(clickCount, 1);
  assert.equal(closeCount, 1);
  assert.equal(calls.length, 2);
  delivery.resolve();
  await settle();
  assert.equal(calls.at(-1).command, "desktop_close_notification");
  assert.equal(calls.at(-1).args.id, id);
  dispose();
});

test("a late permission read cannot override a newer decision or a stopped plugin", async () => {
  const initial = Promise.withResolvers();
  const calls = [];
  const { window, previous, dispose } = fixture(async (command, { request }) => {
    calls.push(command);
    return request ? "denied" : initial.promise;
  });
  const adapter = window.Notification;
  assert.equal(await adapter.requestPermission(), "denied");
  initial.resolve("granted");
  await settle();
  assert.equal(adapter.permission, "denied");
  new adapter("Hidden");
  dispose();
  assert.equal(window.Notification, previous);
  assert.equal(await adapter.requestPermission(), "denied");
  assert.deepEqual(calls, ["notification_permission", "notification_permission"]);
});

test("an opted-out user gets no native permission prompt or system alert", async () => {
  const calls = [];
  const { window, dispose } = fixture(async (command) => { calls.push(command); }, { notifications: false });
  assert.equal(await window.Notification.requestPermission(), "denied");
  new window.Notification("Hidden");
  assert.deepEqual(calls, []);
  const replacement = class {};
  window.Notification = replacement;
  dispose();
  assert.equal(window.Notification, replacement);
});

test("the SDK output runs through Yapmod's plugin lifecycle with the shared native bridge", async () => {
  const expression = await readFile(new URL("../dist/plugin.js", import.meta.url), "utf8");
  const window = new EventTarget();
  const calls = [];
  window.__TAURI_INTERNALS__ = {
    async invoke(command) { calls.push(command); return "granted"; },
  };
  const disposers = [];
  const sections = [];
  const yapmod = {
    storage: {}, ui: {}, solid: { createSignal: (value) => [() => value, next => { value = next; }] }, solidWeb: {},
    settings: { registerSection(section) { sections.push(section); } },
    onDispose(disposer) { disposers.push(disposer); },
  };
  const factory = runInNewContext(expression, { window, yapmod, EventTarget, Event, CustomEvent });
  for (let activation = 0; activation < 2; activation++) {
    factory(yapmod).onLoad();
    await settle();
    assert.equal(window.Notification.permission, "granted");
    assert.equal(sections[activation].id, "desktop");
    disposers.splice(0).forEach(dispose => dispose());
    assert.equal(window.Notification, undefined);
  }
  assert.deepEqual(calls, ["notification_permission", "notification_permission"]);
});
