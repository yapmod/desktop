import { installTray } from './tray';
import { installNotifications } from './notifications';
import { connect, type NativeBridge } from './native';
import { installYaplay } from './yaplay';
import { DesktopSettings } from './settings';

export default function desktopPlugin(_api: typeof yapmod, bridge: NativeBridge | undefined = window.__TAURI_INTERNALS__) {
  return {
    onLoad() {
      if (!bridge) return;
      connect(bridge);
      const notifications = installNotifications();
      const YaplaySettings = installYaplay(bridge);
      const renderSettings = () => <DesktopSettings yaplay={YaplaySettings} requestPermission={() => notifications.requestPermission()} />;
      let closeSettings: (() => void) | undefined;
      installTray(bridge, () => {
        if (closeSettings) return;
        closeSettings = yapmod.ui.openModal({ title: 'Desktop settings', wide: true,
          content: renderSettings, onClose: () => { closeSettings = undefined; } });
      });
      yapmod.onDispose(() => closeSettings?.());
      yapmod.settings.registerSection({
        id: 'desktop',
        label: 'Desktop',
        icon: 'settings',
        render: renderSettings,
      });
    },
  };
}
