import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import * as solid from 'solid-js/dist/solid.js';

const source = await readFile(new URL('../dist/desktop-plugins.js', import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

async function fixture() {
  const window = new EventTarget();
  const timers = new Set();
  const calls = [];
  const actions = [];
  const state = { voice: { channelId: 'room', muted: false, deafened: false }, voiceMembers: {}, speaking: {}, profiles: {} };
  const store = { getState: () => state, useStore: { subscribe() {} } };
  const runtime = { c: new Map([[1, { exports: store }], [2, { exports: {
    toggleMute() { actions.push('mute'); state.voice.muted = !state.voice.muted; },
    toggleDeafen() { actions.push('deafen'); state.voice.deafened = !state.voice.deafened; },
    leaveVoice() { actions.push('leave'); },
  } }]]) };
  const modules = new Map();
  window.TURBOPACK = { push(chunk) {
    if (typeof chunk[2] === 'function') modules.set(chunk[1], chunk[2]);
    else chunk[1].runtimeModuleIds.forEach(id => modules.get(id)(runtime));
  } };
  let reply = () => ({ actions: [], openSettings: false });
  let settingsOpened = 0;
  let settingsClosed = 0;
  const bridge = { async invoke(command, args) {
    calls.push({ command, args });
    if (command === 'desktop_info') return { trayAvailable: true };
    if (command === 'notification_permission') return 'default';
    if (command === 'tray_exchange') return reply(args);
  } };
  const yapmod = {
    storage: {}, log() {}, solid, solidWeb: {}, onDispose: solid.onCleanup,
    ui: { openModal(options) { settingsOpened++; return () => { settingsClosed++; options.onClose(); }; } },
    settings: { registerSection() {} },
  };
  const register = runInNewContext(source, { window, EventTarget, Event, CustomEvent, crypto: globalThis.crypto,
    setTimeout, clearTimeout, setInterval(fn) { timers.add(fn); return fn; }, clearInterval(fn) { timers.delete(fn); } });
  let dispose;
  solid.createRoot(stop => {
    dispose = stop;
    register({ registerClientPlugin(plugin) { plugin.setup(yapmod).onLoad(); return true; } }, bridge);
  });
  await settle();
  return { window, state, calls, actions, timers, dispose,
    setReply(fn) { reply = fn; },
    async tick() { for (const fn of timers) fn(); await settle(); },
    get settingsOpened() { return settingsOpened; }, get settingsClosed() { return settingsClosed; } };
}

test('tray controls and settings work without Yaplay and dispose cleanly on re-enable', async () => {
  for (let activation = 0; activation < 2; activation++) {
    const f = await fixture();
    assert.equal(f.calls.some(call => call.command.startsWith('yaplay_')), false);
    assert.equal(f.timers.size, 1);
    f.setReply(() => ({ actions: [{ type: 'set_mute', muted: true }], openSettings: true }));
    await f.tick();
    await f.tick();
    assert.deepEqual(f.actions, ['mute']);
    assert.equal(f.settingsOpened, 1);
    assert.equal(f.calls.filter(call => call.command === 'tray_exchange').at(-1).args.call.muted, true);
    f.dispose();
    await settle();
    assert.equal(f.timers.size, 0);
    assert.equal(f.settingsClosed, 1);
    assert.equal(f.calls.at(-1).command, 'tray_stop');
  }
});

test('tray discards a delayed control after changing calls or disabling the plugin', async () => {
  for (const stop of [false, true]) {
    const f = await fixture();
    const pending = Promise.withResolvers();
    f.setReply(() => pending.promise);
    await f.tick();
    if (stop) f.dispose();
    else f.state.voice.channelId = 'another-room';
    pending.resolve({ actions: [{ type: 'set_deafen', deafened: true }], openSettings: false });
    await settle();
    assert.deepEqual(f.actions, []);
    f.dispose();
  }
});

test('page navigation stops polling and releases its native tray session', async () => {
  const f = await fixture();
  f.window.dispatchEvent(new Event('pagehide'));
  await settle();
  assert.equal(f.timers.size, 0);
  assert.equal(f.calls.at(-1).command, 'tray_stop');
  f.dispose();
});
