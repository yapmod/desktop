import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import * as solid from 'solid-js/dist/solid.js';
import { availableActions, snapshot, findStore, perform } from '../src/yaplay/host.ts';
import { YAPPLUSPLUS_SCRIPT_URL } from '../src/yapplusplus/loader.ts';

function host() {
  const state = { userId: 'self', voice: { channelId: 'room', serverId: 'server', muted: false, deafened: false },
    voiceMembers: { room: [{ userId: 'peer', muted: false, deafened: false }] },
    speaking: { peer: true }, profiles: { self: { display_name: 'Self' }, peer: { username: 'Peer', accent_color: '#102030' } } };
  return { getState: () => state, useStore: { subscribe: () => () => {} } };
}

test('maps full roster, self, speaking, mute/deafen and leaving a call', () => {
  const store = host();
  let value = snapshot(store);
  assert.equal(value.members.length, 2);
  assert.deepEqual(value.members[0], { id: 'peer', name: 'Peer', color: [16,32,48], speaking: true, muted: false, is_self: false });
  assert.equal(value.members[1].is_self, true);
  store.getState().voice.deafened = true;
  store.getState().voiceMembers.room[0].muted = true;
  value = snapshot(store);
  assert.equal(value.muted, true);
  assert.equal(value.members[0].speaking, false);
  store.getState().voice = null;
  assert.deepEqual(snapshot(store), { in_call: false, members: [], muted: false, deafened: false });
});

test('discovers exports without bundle IDs and invokes only requested voice actions', async () => {
  const store = host();
  const calls = [];
  const runtime = { c: new Map([[2, { exports: store }], ['arbitrary-new-id', { exports: {
    toggleMute() { calls.push('mute'); store.getState().voice.muted = true; },
    toggleDeafen() { calls.push('deafen'); }, leaveVoice() { calls.push('leave'); },
  } }]]) };
  assert.equal(findStore(runtime), store);
  await perform(runtime, store, { type: 'set_mute', muted: true });
  await perform(runtime, store, { type: 'set_mute', muted: true });
  await perform(runtime, store, { type: 'set_deafen', deafened: true });
  await perform(runtime, store, { type: 'leave_call' });
  await perform(runtime, store, { type: 'unknown' });
  assert.deepEqual(calls, ['mute', 'deafen', 'leave']);
});

test('discovers partial controls as Yapin loads voice modules', async () => {
  const store = host();
  const runtime = { c: new Map() };
  const calls = [];
  assert.deepEqual(availableActions(runtime), []);
  runtime.c.set(1, { exports: { toggleMute() { calls.push('mute'); } } });
  assert.deepEqual(availableActions(runtime), ['set_mute']);
  await perform(runtime, store, { type: 'set_mute', muted: true });
  runtime.c.set(2, { exports: { leaveVoice() { calls.push('leave'); } } });
  assert.deepEqual(availableActions(runtime), ['set_mute', 'leave_call']);
  await perform(runtime, store, { type: 'leave_call' });
  assert.deepEqual(calls, ['mute', 'leave']);
});

test('Desktop settings clean up on toggles and discard controls after switching calls', async () => {
  const source = await readFile(new URL('../dist/desktop-plugins.js', import.meta.url), 'utf8');
  const store = host();
  let subscriptions = 0;
  store.useStore.subscribe = () => { subscriptions++; return () => subscriptions--; };
  const voiceActions = [];
  const runtime = { c: new Map([[1, { exports: store }], [2, { exports: {
    toggleMute() { voiceActions.push('mute'); }, toggleDeafen() { voiceActions.push('deafen'); },
    leaveVoice() { voiceActions.push('leave'); },
  } }]]) };
  const window = new EventTarget();
  let reloads = 0;
  window.location = { reload() { reloads++; } };
  const modules = new Map();
  window.TURBOPACK = { push(chunk) {
    if (typeof chunk[2] === 'function') modules.set(chunk[1], chunk[2]);
    else chunk[1].runtimeModuleIds.forEach(id => modules.get(id)(runtime));
  } };
  const calls = [];
  const bridge = { async invoke(command, args) {
    calls.push({ command, args });
    if (command === 'desktop_info') return { yaplayAvailable: true };
    if (command === 'notification_permission') return 'default';
    if (command === 'yaplay_exchange') {
      store.getState().voice = { ...store.getState().voice, channelId: crypto.randomUUID() };
      return { connected: true, actions: [{ type: 'leave_call' }] };
    }
  } };
  const timers = new Set();
  const scripts = [];
  const document = {
    createElement() { return { remove() { this.removed = true; } }; },
    head: { append(script) { scripts.push(script); } },
  };
  const fetches = [];
  const fetch = async (url, options) => {
    fetches.push([url, options]);
    return { ok: true, text: async () => 'window.yapplusplusLoaded = true;' };
  };
  const objectURLs = { createObjectURL: () => 'blob:yapplusplus-test', revokeObjectURL() {} };
  const registrations = [];
  const sections = [];
  const storage = {};
  let dispose;
  const yapmod = {
    storage, log() {}, solid, onDispose: solid.onCleanup,
    solidWeb: { createComponent: solid.createComponent, memo: solid.createMemo },
    ui: { Section: props => props.children, SettingsPage: props => props.children,
      SettingRow: props => props.children, SettingText: () => null,
      Switch: props => props, Button: props => props, Input: props => props },
    settings: { registerSection(section) { sections.push(section); } },
  };
  const controls = solid.createRoot(stop => {
    dispose = stop;
    const register = runInNewContext(source, { window, document, fetch, URL: objectURLs, Blob, AbortController, EventTarget, Event, CustomEvent, crypto: globalThis.crypto, setTimeout, clearTimeout,
      setInterval(fn) { timers.add(fn); return fn; }, clearInterval(fn) { timers.delete(fn); } });
    register({ registerClientPlugin(plugin) {
      registrations.push(plugin.id);
      plugin.setup(yapmod).onLoad();
      return true;
    } }, bridge);
    return solid.children(sections[0].render);
  });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const toggle = () => controls.toArray().find(control => control?.['aria-label'] === 'Connect to Yaplay');
  const yapplusplusToggle = () => controls.toArray().find(control => control?.['aria-label'] === 'Enable Yap++');
  await settle();
  assert.deepEqual(registrations, ['client:yapmod-desktop']);
  assert.deepEqual(sections.map(section => section.id), ['desktop']);
  assert.equal(toggle().checked, false);
  assert.equal(yapplusplusToggle().checked, false);
  assert.deepEqual(fetches, []);
  assert.equal(calls.some(call => call.command.startsWith('yaplay_')), false);
  for (let activation = 0; activation < 2; activation++) {
    toggle().onChange(true);
    await settle();
    assert.equal(storage.yaplayEnabled, true);
    assert.deepEqual(voiceActions, []);
    assert.equal(subscriptions, 1);
    assert.equal(timers.size, 1);
    if (activation === 0) {
      toggle().onChange(false);

      yapplusplusToggle().onChange(true);
      await settle();
      assert.equal(storage.yapplusplusEnabled, true);
      assert.equal(fetches[0][0], YAPPLUSPLUS_SCRIPT_URL);
      assert.equal(scripts.length, 1);
      scripts[0].onload();
      yapplusplusToggle().onChange(false);
      assert.equal(storage.yapplusplusEnabled, false);
      assert.equal(reloads, 1);
      assert.equal(scripts[0].removed, true);
    } else {
      dispose();
    }
    assert.equal(subscriptions, 0);
    assert.equal(timers.size, 0);
  }
  const native = calls.filter(call => call.command.startsWith('yaplay_'));
  assert.deepEqual(native.map(call => call.command), ['yaplay_start', 'yaplay_exchange', 'yaplay_stop', 'yaplay_start', 'yaplay_exchange', 'yaplay_stop']);
  assert.deepEqual(Array.from(native[0].args.actions), ['set_mute', 'set_deafen', 'leave_call']);
  assert.notEqual(native[0].args.session, native[3].args.session);

});


test('forwards public HTTPS avatars and server overrides, with initials fallback', () => {
  const store = host();
  const state = store.getState();
  state.profiles.peer.avatar_path = 'profile.png';
  const paths = [];
  const runtime = { c: new Map([[1, { exports: { publicUrl(bucket, path) {
    paths.push([bucket, path]);
    return path === 'premade' ? '/premade/avatar.png' : `https://media.example/${path}`;
  } } }]]) };
  assert.equal(snapshot(store, runtime).members[0].avatar_url, 'https://media.example/profile.png');
  state.serverLooks = { server: { peer: { avatar_path: 'server.png' } } };
  assert.equal(snapshot(store, runtime).members[0].avatar_url, 'https://media.example/server.png');
  state.serverLooks.server.peer.avatar_path = null;
  state.profiles.peer.avatar_path = 'premade';
  assert.equal(snapshot(store, runtime).members[0].avatar_url, 'https://www.yapin.gg/premade/avatar.png');
  assert.ok(paths.every(([bucket]) => bucket === 'avatars'));
  assert.equal(snapshot(store).members[0].avatar_url, undefined);
  for (const url of ['http://example.com/a', 'data:image/png;base64,a', 'https://user:pass@example.com/a', `https://example.com/${'a'.repeat(2048)}`]) {
    runtime.c.get(1).exports.publicUrl = () => url;
    assert.equal(snapshot(store, runtime).members[0].avatar_url, undefined);
  }
});
