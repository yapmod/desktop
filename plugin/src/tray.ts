import { type DesktopInfo, type NativeBridge } from './native';
import { findStore, getRuntime, perform, type Action } from './yaplay/host';

/** The tray works independently of the optional Yaplay connection. */
export function installTray(bridge: NativeBridge, openSettings: () => void) {
  let session = '';
  let stopped = false;
  let running = false;
  let started = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function tick() {
    if (stopped || running) return;
    running = true;
    try {
      if (!started) {
        await bridge.invoke('tray_start', { session });
        started = true;
        if (stopped) { await bridge.invoke('tray_stop', { session }); return; }
      }
      // Settings remain available while signed out or when voice discovery fails.
      const runtime = await getRuntime().catch(() => undefined);
      if (stopped) return;
      const store = runtime && findStore(runtime);
      const voice = store?.getState().voice;
      const channelId = voice?.channelId ?? null;
      const serverId = voice?.serverId ?? null;
      const reply = await bridge.invoke<{ actions: Action[]; openSettings: boolean }>('tray_exchange', {
        session, call: { available: Boolean(store), channelId, serverId,
          muted: voice?.muted ?? false, deafened: voice?.deafened ?? false },
      });
      if (stopped) return;
      if (reply.openSettings) openSettings();
      for (const action of reply.actions) {
        const current = store?.getState().voice;
        if (stopped || !runtime || !store || !current
          || current.channelId !== channelId || (current.serverId ?? null) !== serverId) break;
        await perform(runtime, store, action);
      }
    } catch (error) {
      if (!stopped) {
        yapmod.log('Tray integration failed.', error);
        started = false;
      }
    } finally { running = false; }
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    if (timer !== undefined) clearInterval(timer);
    window.removeEventListener('pagehide', stop);
    if (started) void bridge.invoke('tray_stop', { session }).catch(() => {});
  }
  yapmod.onDispose(stop);
  window.addEventListener('pagehide', stop);
  void bridge.invoke<DesktopInfo>('desktop_info').then(info => {
    if (stopped || !info?.trayAvailable) return;
    session = crypto.randomUUID();
    timer = setInterval(() => { void tick(); }, 500);
    void tick();
  }).catch(error => yapmod.log('Could not initialize tray controls.', error));
}
