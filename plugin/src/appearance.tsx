import { Section, SettingRow, Switch } from '@yapmod/ui';
import { createSignal, type Component } from 'solid-js';
import { invoke } from './native';

const minimum = 50;

type OpacitySlider = Component<{
  label: string;
  value: number;
  min: number;
  max: number;
  formatValue(value: number): string;
  onChange(value: number): void;
}>;

export function installAppearance() {
  const document = window.document;
  const host = document?.getElementById('yapmod-desktop-appearance');
  if (!host) return;
  const { Slider } = yapmod.ui as typeof yapmod.ui & { Slider?: OpacitySlider };
  if (!Slider) return;
  const root = document.documentElement;
  const saved = yapmod.storage.windowOpacity;
  const [opacity, setOpacity] = createSignal(typeof saved === 'number' && Number.isInteger(saved)
    && saved >= minimum && saved <= 100 ? saved : 100);
  const [blur, setBlur] = createSignal(yapmod.storage.windowBlur !== false);
  const [available, setAvailable] = createSignal(host.dataset?.backdrop === 'system');
  let requested: boolean | undefined;
  let revision = 0;
  let pending = Promise.resolve();

  function syncBlur(enabled: boolean) {
    if (!available() || requested === enabled) return;
    requested = enabled;
    const current = ++revision;
    pending = pending.then(async () => {
      if (current !== revision) return;
      const supported = await invoke<boolean>('desktop_set_blur', { enabled });
      setAvailable(supported);
    }).catch(error => {
      yapmod.log('Background blur is unavailable.', error);
      setAvailable(false);
    });
  }

  function apply(value: number) {
    root.toggleAttribute('data-yapmod-translucent', value < 100);
    if (value < 100) root.style.setProperty('--yapmod-window-opacity', String(value / 100));
    else root.style.removeProperty('--yapmod-window-opacity');
    syncBlur(value < 100 && blur());
  }
  apply(opacity());
  const clear = () => apply(100);
  const restore = () => apply(opacity());
  window.addEventListener('pagehide', clear);
  window.addEventListener('pageshow', restore);
  yapmod.onDispose(() => {
    window.removeEventListener('pagehide', clear);
    window.removeEventListener('pageshow', restore);
    clear();
  });

  function change(value: number) {
    if (!Number.isInteger(value) || value < minimum || value > 100) return;
    setOpacity(value);
    apply(value);
    yapmod.storage.windowOpacity = value;
  }

  return () => <Section label="Appearance">
    <Slider label="Window opacity" min={minimum} max={100} value={opacity()}
      formatValue={value => `${value}%`} onChange={change} />
    <SettingRow label="Background blur" hint={available()
      ? 'Soften what’s behind the window when opacity is below 100%.'
      : 'Background blur is unavailable on this desktop.'}>
      <Switch aria-label="Background blur" checked={available() && blur()} disabled={!available()}
        onChange={value => {
          setBlur(value);
          yapmod.storage.windowBlur = value;
          syncBlur(opacity() < 100 && value);
        }} />
    </SettingRow>
  </Section>;
}
