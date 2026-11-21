import { Button, Section, SettingRow, SettingsPage, SettingText, Switch } from '@yapmod/ui';
import { type Component, createSignal, onCleanup } from 'solid-js';
import { AutostartSetting } from './AutostartSetting';
import { invoke, type DesktopInfo } from './native';

export function DesktopSettings(props: { yaplay?: Component; requestPermission(): Promise<NotificationPermission> }) {
  const [info, setInfo] = createSignal<DesktopInfo>();
  const [busy, setBusy] = createSignal(false);
  const [available, setAvailable] = createSignal<string | null>(null);
  const [status, setStatus] = createSignal('');
  let active = true;
  onCleanup(() => { active = false; });

  void invoke<DesktopInfo>('desktop_info').then((value) => {
    if (active) setInfo(value);
  }).catch((error) => {
    yapmod.log('Could not read desktop version.', error);
    if (active) setStatus('Desktop information is unavailable.');
  });

  async function changeNotifications(value: boolean) {
    yapmod.storage.notifications = value;
    if (value && await props.requestPermission() !== 'granted' && active && yapmod.storage.notifications) {
      yapmod.ui.showToast('Allow notifications in your system settings.', 'error');
    }
  }

  async function checkUpdate() {
    if (busy()) return;
    const install = Boolean(available());
    setBusy(true);
    setStatus(install ? 'Waiting for installation…' : 'Checking for updates…');
    try {
      const version = await invoke<string | null>('desktop_update', { install });
      if (!active) return;
      setAvailable(version);
      setStatus(version ? `Version ${version} is available.` : 'You’re up to date.');
    } catch (error) {
      yapmod.log('Desktop update failed.', error);
      if (active) setStatus(install ? 'Installation failed. Try again.' : 'Couldn’t check for updates. Try again.');
    } finally {
      if (active) setBusy(false);
    }
  }

  return (
    <SettingsPage title="Desktop">
      <Section label="Notifications">
        <SettingRow label="Desktop notifications" hint="Deliver alerts enabled in Yapin to your notification center.">
          <Switch aria-label="Desktop notifications" checked={yapmod.storage.notifications !== false} onChange={changeNotifications} />
        </SettingRow>
      </Section>
      {info()?.autostartAvailable && <AutostartSetting />}
      {props.yaplay && <props.yaplay />}
      <Section label="Software">
        <SettingText label="Desktop version" value={info()?.version ?? '—'} />
        <SettingText label="Client version" value={window.YapmodClient?.version ?? '—'} />
        <SettingRow label="Application updates" hint={status() || (info()?.updaterAvailable === false
          ? 'This installation is updated manually or by your package manager.' : undefined)}>
          {info()?.updaterAvailable && <Button size="small" disabled={busy()} onClick={checkUpdate}>
            {available() ? 'Install update' : 'Check for updates'}
          </Button>}
        </SettingRow>
      </Section>
    </SettingsPage>
  );
}
