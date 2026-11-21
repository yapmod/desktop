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
      installTray(bridge);
      yapmod.settings.registerSection({
        id: 'desktop',
        label: 'Desktop',
        icon: 'settings',
        render: () => <DesktopSettings yaplay={YaplaySettings} requestPermission={() => notifications.requestPermission()} />,
      });
    },
  };
}
