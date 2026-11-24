import { installTray } from './tray';
import { installNotifications } from './notifications';
import { connect, type NativeBridge } from './native';
import { installYaplay } from './yaplay';
import { DesktopSettings } from './settings';
import { installAppearance } from './appearance';

export default function desktopPlugin(_api: typeof yapmod, bridge: NativeBridge | undefined = window.__TAURI_INTERNALS__) {
  return {
    onLoad() {
      if (!bridge) return;
      connect(bridge);
      const Appearance = installAppearance();
      const notifications = installNotifications();
      const YaplaySettings = installYaplay(bridge);
      installTray(bridge);
      yapmod.settings.registerSection({
        id: 'desktop',
        label: 'Desktop',
        icon: 'settings',
        render: () => <DesktopSettings appearance={Appearance} yaplay={YaplaySettings} requestPermission={() => notifications.requestPermission()} />,
      });
    },
  };
}
