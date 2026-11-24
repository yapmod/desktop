import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import * as solid from 'solid-js/dist/solid.js';

const source = await readFile(new URL('../dist/plugin.js', import.meta.url), 'utf8');
const settle = () => new Promise((resolve) => setImmediate(resolve));

function settings(invoke, info = { autostartAvailable: true }, document, storage = {}, sliderAvailable = true) {
  const window = new EventTarget();
  window.document = document;
  const calls = [];
  window.__TAURI_INTERNALS__ = { async invoke(command, args) {
    if (command === 'desktop_info') return info;
    if (command === 'notification_permission') return 'default';
    calls.push(command);
    return invoke(command, args);
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
    Slider: sliderAvailable ? props => props : undefined,
    Button: props => props,
  };
  const yapmod = {
    ui, solid, solidWeb: { createComponent: solid.createComponent, memo: solid.createMemo },
    storage, onDispose: solid.onCleanup, log() {},
    settings: { registerSection(section) { render = section.render; } },
  };
  const controls = solid.createRoot((stop) => {
    dispose = stop;
    runInNewContext(source, { window, yapmod, EventTarget })().onLoad();
    return solid.children(render);
  });
  return {
    window, calls, dispose, hint: () => row?.hint,
    opacity: () => controls.toArray().find(control => control?.label === 'Window opacity'),
    blur: () => controls.toArray().find(control => control?.['aria-label'] === 'Background blur'),
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
  assert.equal(view.opacity(), undefined);
  assert.deepEqual(view.calls, []);
  view.dispose();
});

test('older clients without the shared slider leave appearance untouched', () => {
  const document = { getElementById: () => ({ dataset: { backdrop: 'system' } }) };
  const view = settings(() => assert.fail('unexpected command'), {}, document, { windowOpacity: 75 }, false);
  assert.equal(view.opacity(), undefined);
  assert.equal(view.blur(), undefined);
  view.dispose();
});

test('shared opacity slider and independent blur persist and clean up', async () => {
  const attributes = new Map();
  const styles = new Map();
  const document = {
    getElementById: id => id === 'yapmod-desktop-appearance' && { dataset: { backdrop: 'system' } },
    documentElement: {
      toggleAttribute: (name, value) => attributes.set(name, value),
      style: { setProperty: (key, value) => styles.set(key, value), removeProperty: key => styles.delete(key) },
    },
  };
  const storage = { windowOpacity: 5 };
  const transitions = [];
  const activate = () => settings((command, { enabled }) => {
    assert.equal(command, 'desktop_set_blur');
    transitions.push(enabled);
    return true;
  }, {}, document, storage);
  let view = activate();
  function slide(value) {
    view.opacity().onChange(value);
  }
  await settle();
  assert.equal(view.blur().checked, true);
  assert.equal(view.opacity().value, 100);
  assert.equal(view.opacity().formatValue(78), '78%');
  slide(78);
  await settle();
  assert.deepEqual(transitions, [false, true]);
  slide(0);
  view.blur().onChange(false);
  await settle();
  assert.equal(storage.windowBlur, false);
  assert.equal(transitions.at(-1), false);
  assert.equal(storage.windowOpacity, 78);
  assert.equal(styles.get('--yapmod-window-opacity'), '0.78');
  view.dispose();
  assert.equal(attributes.get('data-yapmod-translucent'), false);
  assert.equal(styles.size, 0);
  view = activate();
  assert.equal(view.opacity().value, 78);
  assert.equal(attributes.get('data-yapmod-translucent'), true);
  assert.equal(view.blur().checked, false);
  slide(100);
  assert.equal(styles.size, 0);
  assert.equal(storage.windowOpacity, 100);
  view.dispose();
});
