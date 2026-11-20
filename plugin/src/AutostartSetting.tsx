import { Button, Section, SettingRow, Switch } from '@yapmod/ui';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { invoke } from './native';

export function AutostartSetting() {
  const [enabled, setEnabled] = createSignal<boolean>();
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal('');
  let active = true;

  async function sync(requested?: boolean) {
    if (!active || pending()) return;
    setPending(true);
    setError('');
    try {
      if (requested !== undefined) {
        // Reflect the click while the native checkbox is disabled.
        setEnabled(requested);
        try {
          await invoke(requested ? 'plugin:autostart|enable' : 'plugin:autostart|disable');
        } catch (cause) {
          yapmod.log('Could not change launch at login.', cause);
          if (active) setError('Couldn’t change this setting. Try again.');
        }
      }
      if (!active) return;
      // Also read back after a failed write, which can partially change the OS registration.
      const registered = await invoke<boolean>('plugin:autostart|is_enabled');
      if (active) setEnabled(registered);
    } catch (cause) {
      yapmod.log('Could not read launch at login.', cause);
      if (active) {
        setEnabled(undefined);
        setError('Couldn’t read the login setting.');
      }
    } finally {
      if (active) setPending(false);
    }
  }

  const refresh = () => { void sync(); };
  onMount(() => {
    refresh();
    window.addEventListener('focus', refresh);
  });
  onCleanup(() => {
    active = false;
    window.removeEventListener('focus', refresh);
  });

  return (
    <Section label="Startup">
      <SettingRow label="Launch at login" hint={error() || 'Open Yapmod Desktop when you sign in to this computer.'}>
        <Show when={enabled() === undefined && error()} fallback={
          <Switch aria-label="Launch at login" checked={enabled() ?? false}
            disabled={pending() || enabled() === undefined} onChange={(next) => void sync(next)} />
        }>
          <Button size="small" disabled={pending()} onClick={refresh}>Retry</Button>
        </Show>
      </SettingRow>
    </Section>
  );
}
