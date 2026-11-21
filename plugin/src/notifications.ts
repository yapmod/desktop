import { invoke } from './native';

export function installNotifications() {
  const previous = Object.getOwnPropertyDescriptor(window, 'Notification');
  const notices = new Map<number, DesktopNotification>();
  const enabled = () => yapmod.storage.notifications !== false;
  let alive = true;
  let permission: NotificationPermission = 'default';
  let latestRead = 0;

  async function readPermission(request: boolean): Promise<NotificationPermission> {
    if (!alive || !enabled()) return 'denied';
    const read = ++latestRead;
    try {
      const state = await invoke<NotificationPermission>('notification_permission', { request });
      if (alive && read === latestRead) {
        permission = state === 'granted' || state === 'denied' ? state : 'default';
      }
    } catch (error) {
      yapmod.log('Could not read notification permission.', error);
    }
    return DesktopNotification.permission;
  }

  class DesktopNotification extends EventTarget {
    readonly title: string;
    readonly body: string;
    readonly tag: string;
    readonly data: unknown;
    private id?: number;
    private delivery?: Promise<boolean>;
    onclick?: (event: Event) => void;
    onshow?: (event: Event) => void;
    onclose?: (event: Event) => void;
    onerror?: (event: Event) => void;

    static get permission(): NotificationPermission {
      return alive && enabled() ? permission : 'denied';
    }

    static async requestPermission(callback?: NotificationPermissionCallback) {
      const state = await readPermission(true);
      callback?.(state);
      return state;
    }

    constructor(title: string, options: NotificationOptions = {}) {
      super();
      this.title = String(title);
      this.body = String(options.body ?? '');
      this.tag = String(options.tag ?? '');
      this.data = options.data ?? null;
      for (const type of ['show', 'close', 'click', 'error'] as const) {
        this.addEventListener(type, (event) => this[`on${type}`]?.(event));
      }
      window.dispatchEvent(new CustomEvent('yapmod:desktop-notification', { detail: { title: this.title, body: this.body } }));
      if (DesktopNotification.permission !== 'granted') return;

      const random = new Uint32Array(1);
      let id: number;
      do {
        crypto.getRandomValues(random);
        id = (random[0]! & 0x7fffffff) || 1;
      } while (notices.has(id));
      this.id = id;
      // Some platforms never report dismissal. Bound the callbacks kept for this document.
      if (notices.size >= 100) notices.delete(notices.keys().next().value!);
      notices.set(id, this);
      this.delivery = invoke<void>('desktop_notify', {
        id,
        title: this.title.slice(0, 128) || 'Yapin',
        body: this.body.slice(0, 1024),
      }).then(() => {
        if (notices.get(id) === this) this.dispatchEvent(new Event('show'));
        return true;
      }, (error) => {
        if (notices.get(id) === this) notices.delete(id);
        if (alive) {
          yapmod.log('Could not deliver notification.', error);
          this.dispatchEvent(new Event('error'));
        }
        return false;
      });
    }

    close() {
      const id = this.id;
      if (id === undefined || notices.get(id) !== this) return;
      notices.delete(id);
      this.dispatchEvent(new Event('close'));
      void this.delivery?.then((sent) => {
        if (sent && alive) return invoke<void>('desktop_close_notification', { id });
      }).catch((error) => yapmod.log('Could not dismiss notification.', error));
    }
  }

  function clicked(event: Event) {
    const notice = notices.get((event as CustomEvent<number>).detail);
    if (!notice) return;
    if (enabled()) notice.dispatchEvent(new Event('click'));
    notice.close();
  }

  const clickEvent = 'yapmod:desktop-notification-click';
  Object.defineProperty(window, 'Notification', {
    configurable: true, writable: true, value: DesktopNotification,
  });
  window.addEventListener(clickEvent, clicked);
  yapmod.onDispose(() => {
    alive = false;
    notices.clear();
    window.removeEventListener(clickEvent, clicked);
    if (Object.getOwnPropertyDescriptor(window, 'Notification')?.value !== DesktopNotification) return;
    if (previous) Object.defineProperty(window, 'Notification', previous);
    else Reflect.deleteProperty(window, 'Notification');
  });
  void readPermission(false);
  return DesktopNotification;
}
