import { Button, Input, Section, SettingRow, SettingText, Switch } from '@yapmod/ui';
import { createSignal } from 'solid-js';
import { type DesktopInfo, type NativeBridge } from '../native';
import { findStore, getRuntime, perform, snapshot, type Action, type HostStore } from './host';

function createConnection(bridge: NativeBridge, setStatus: (value: string) => void) {
  let session = '';
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;
  let store: HostStore | undefined;
  let activePort = 0;
  let notifications: { title: string; body: string }[] = [];
  let pending = false;
  let applied = false;

  async function tick() {
    if (stopped || running || !bridge) return;
    running = true;
    pending = false;
    try {
      const runtime = await getRuntime();
      if (stopped) return;
      if (!store) {
        store = findStore(runtime);
        if (!store) throw new Error('Waiting for Yapin’s voice store.');
        unsubscribe = store.useStore.subscribe(() => { pending = true; });
      }
      const nextPort = Number(yapmod.storage.yaplayPort ?? 8080);
      if (!session || nextPort !== activePort) {
        session = crypto.randomUUID();
        activePort = nextPort;
        await bridge.invoke('yaplay_start', { session, port: activePort });
        if (stopped) { await bridge.invoke('yaplay_stop', { session }); return; }
      }
      const call = store.getState().voice;
      const reply = await bridge.invoke<{ connected: boolean; actions: Action[] }>('yaplay_exchange', {
        session, snapshot: snapshot(store, runtime), notices: notifications.splice(0),
      });
      if (stopped) return;
      setStatus(reply.connected ? 'Connected to Yaplay' : `Waiting for Yaplay on port ${activePort}…`);
      for (const action of reply.actions) {
        const current = store.getState().voice;
        if (stopped || Number(yapmod.storage.yaplayPort ?? 8080) !== activePort
          || current?.channelId !== call?.channelId || current?.serverId !== call?.serverId) break;
        await perform(runtime, store, action);
      }
      applied = true;
    } catch (error) {
      if (!stopped) {
        setStatus(error instanceof Error ? error.message : String(error));
        if (applied) yapmod.log('Yaplay integration failed.', error);
        applied = false;
        // A native lease can expire while the page is suspended.
        session = '';
      }
    } finally { running = false; }
  }
  function notice(event: Event) {
    const value = (event as CustomEvent<{ title: string; body: string }>).detail;
    if (typeof value?.title !== 'string' || typeof value.body !== 'string') return;
    notifications.push({ title: value.title.slice(0, 128), body: value.body.slice(0, 1024) });
    notifications = notifications.slice(-5);
  }
  function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    unsubscribe?.();
    window.removeEventListener('yapmod:desktop-notification', notice);
    window.removeEventListener('pagehide', stop);
    notifications = [];
    if (session) void bridge?.invoke('yaplay_stop', { session }).catch(() => {});
  }
  return {
    async start() {
      const info = await bridge.invoke<DesktopInfo>('desktop_info').catch(() => null);
      if (stopped) return;
      if (!info?.yaplayAvailable) { setStatus('Update Yapmod Desktop to use Yaplay.'); return; }
      window.addEventListener('yapmod:desktop-notification', notice);
      window.addEventListener('pagehide', stop);
      let polls = 0;
      timer = setInterval(() => {
        if (pending || ++polls >= 5) { polls = 0; void tick(); }
      }, 50);
      void tick();
    },
    stop,
    refresh: tick,
  };
}

export function installYaplay(bridge: NativeBridge) {
  const [enabled, setEnabled] = createSignal(yapmod.storage.yaplayEnabled === true);
  const [status, setStatus] = createSignal('Disabled');
  let connection: ReturnType<typeof createConnection> | undefined;
  let disposed = false;

  function changeEnabled(value: boolean) {
    if (disposed) return;
    connection?.stop();
    connection = undefined;
    yapmod.storage.yaplayEnabled = value;
    setEnabled(value);
    setStatus(value ? 'Starting…' : 'Disabled');
    if (value) {
      connection = createConnection(bridge, setStatus);
      void connection.start();
    }
  }
  yapmod.onDispose(() => { disposed = true; connection?.stop(); });
  if (enabled()) changeEnabled(true);

  function Settings() {
    const [port, setPort] = createSignal(String(yapmod.storage.yaplayPort ?? 8080));
    return <Section label="Yaplay">
      <SettingRow label="Connect to Yaplay" hint="Share call activity and notifications with the local overlay and allow its call controls.">
        <Switch aria-label="Connect to Yaplay" checked={enabled()} onChange={changeEnabled} />
      </SettingRow>
      {enabled() && <>
        <SettingText label="Status" value={status()} />
        <SettingRow label="Local port" hint="Use the port configured in Yaplay. The default is 8080.">
          <Input aria-label="Yaplay port" type="number" min="1" max="65535" value={port()} onChange={setPort} />
          <Button size="small" onClick={() => {
            const value = Number(port());
            if (!Number.isInteger(value) || value < 1 || value > 65535) {
              setStatus('Enter a port between 1 and 65535.'); return;
            }
            yapmod.storage.yaplayPort = value;
            void connection?.refresh();
          }}>Apply</Button>
        </SettingRow>
      </>}
    </Section>;
  }
  return Settings;
}
