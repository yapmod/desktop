import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import * as solid from 'solid-js/dist/solid.js';

const source = await readFile(new URL('../dist/plugin.js', import.meta.url), 'utf8');
const settle = () => new Promise((resolve) => setImmediate(resolve));

function settings(invoke, info = { autostartAvailable: true }) {
  const window = new EventTarget();
  const calls = [];
  window.__TAURI_INTERNALS__ = { async invoke(command) {
    if (command === 'desktop_info') return info;
    if (command === 'notification_permission') return 'default';
    calls.push(command);
    return invoke(command);
  } };
  let render, row, dispose;
  const ui = {
    Section: props => props.children,
    SettingsPage: props => props.children,
    SettingRow(props) {
      if (props.label === 'Launch at login') row = props;
      return props.children;
    },
    SettingText: () => null,
    Switch: props => props,
    Button: props => props,
  };
  const yapmod = {
    ui, solid, solidWeb: { createComponent: solid.createComponent, memo: solid.createMemo },
    storage: {}, onDispose: solid.onCleanup, log() {},
    settings: { registerSection(section) { render = section.render; } },
  };
  const controls = solid.createRoot((stop) => {
    dispose = stop;
    runInNewContext(source, { window, yapmod, EventTarget })().onLoad();
    return solid.children(render);
  });
  return {
    window, calls, dispose, hint: () => row?.hint,
    toggle: () => controls.toArray().find(control => control?.['aria-label'] === 'Launch at login'),
    retry: () => controls.toArray().find(control => control?.children === 'Retry'),
  };
}

test('launch at login reads OS registration on mount, after changes, and on refocus', async () => {
  let registered = false;
  const view = settings(command => {
    if (command === 'plugin:autostart|enable') registered = true;
    if (command === 'plugin:autostart|disable') registered = false;
    return registered;
  });
  await settle();
  assert.deepEqual(view.calls, ['plugin:autostart|is_enabled']);
  assert.equal(view.toggle().checked, false);
  for (const next of [true, false]) {
    view.toggle().onChange(next);
    await settle();
    assert.equal(registered, next);
    assert.equal(view.toggle().checked, next);
  }
  registered = true;
  view.window.dispatchEvent(new Event('focus'));
  await settle();
  assert.equal(view.toggle().checked, true);
  view.dispose();
  const count = view.calls.length;
  view.window.dispatchEvent(new Event('focus'));
  assert.equal(view.calls.length, count);
});

test('failed login-item reads can retry and a rejected change restores the OS state', async () => {
  let unavailable = true;
  const view = settings(command => {
    if (unavailable || command !== 'plugin:autostart|is_enabled') throw new Error('Unavailable');
    return false;
  });
  await settle();
  assert.match(view.hint(), /read/);
  unavailable = false;
  view.retry().onClick();
  await settle();
  view.toggle().onChange(true);
  await settle();
  assert.equal(view.toggle().checked, false);
  assert.equal(view.toggle().disabled, false);
  assert.match(view.hint(), /change/);
  view.dispose();
});

test('older hosts can open settings without an autostart command', async () => {
  const view = settings(() => assert.fail('unexpected native command'), {});
  await settle();
  assert.equal(view.toggle(), undefined);
  assert.deepEqual(view.calls, []);
  view.dispose();
});
