import { Section, SettingRow, SettingText, Switch } from '@yapmod/ui';
import { createSignal } from 'solid-js';
import { loadYapplusplus } from './loader';

export function installYapplusplus() {
  const [enabled, setEnabled] = createSignal(yapmod.storage.yapplusplusEnabled === true);
  const [status, setStatus] = createSignal(enabled() ? 'Loading Yap++…' : 'Disabled');
  let controller: AbortController | undefined;
  let disposed = false;

  function start() {
    controller?.abort();
    controller = new AbortController();
    const request = controller;
    setStatus('Loading Yap++…');
    void loadYapplusplus(request.signal, setStatus).catch((error) => {
      if (disposed || request.signal.aborted) return;
      yapmod.log('Could not load the Yap++ integration.', error);
      setStatus(error instanceof Error ? error.message : String(error));
    });
  }

  function changeEnabled(value: boolean) {
    if (disposed || value === enabled()) return;
    yapmod.storage.yapplusplusEnabled = value;
    setEnabled(value);
    if (value) {
      start();
    } else {
      controller?.abort();
      setStatus('Disabled. Reloading Yapin…');
      window.location.reload();
    }
  }

  yapmod.onDispose(() => {
    disposed = true;
    controller?.abort();
  });
  if (enabled()) start();

  function Settings() {
    return <Section label="Yap++">
      <SettingRow label="Enable Yap++" hint="Loads the latest Yap++ web integration from GitHub alongside the official Yapmod client. Its plugins run with access to this Yapin page and may conflict with Yapmod; turning it off reloads Yapin to remove its changes.">
        <Switch aria-label="Enable Yap++" checked={enabled()} onChange={changeEnabled} />
      </SettingRow>
      {enabled() && <SettingText label="Status" value={status()} />}
    </Section>;
  }
  return Settings;
}