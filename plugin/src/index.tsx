import { installNotifications } from './notifications';
import { connect, type NativeBridge } from './native';
import { DesktopSettings } from './settings';

export default function desktopPlugin(_api: typeof yapmod, bridge: NativeBridge | undefined = window.__TAURI_INTERNALS__) {
  return {
    onLoad() {
      if (!bridge) return;
      connect(bridge);
      const notifications = installNotifications();
      yapmod.settings.registerSection({
        id: 'desktop',
        label: 'Desktop',
        icon: 'settings',
        render: () => <DesktopSettings requestPermission={() => notifications.requestPermission()} />,
      });
    },
  };
}
