// This expression is registered with the running client after every navigation.
// The same file ships in the app and as the independently signed plugin update.
(function registerDesktopPlugin(client, bridge) {
  const { invoke } = bridge;
  const clickEvent = "yapmod:desktop-notification-click";

  function installNotifications(api, enabled) {
    const previous = Object.getOwnPropertyDescriptor(window, "Notification");
    const notices = new Map();
    let alive = true;
    let permission = "default";
    let permissionRead = 0;

    async function readPermission(request) {
      if (!alive || !enabled()) return "denied";
      const read = ++permissionRead;
      try {
        const state = await invoke("notification_permission", { request });
        if (alive && read === permissionRead) {
          permission = ["granted", "denied"].includes(state) ? state : "default";
        }
      } catch (error) {
        api.log("Could not read notification permission.", error);
      }
      return DesktopNotification.permission;
    }

    class DesktopNotification extends EventTarget {
      static get permission() {
        return alive && enabled() ? permission : "denied";
      }

      static async requestPermission(callback) {
        const state = await readPermission(true);
        if (typeof callback === "function") callback(state);
        return state;
      }

      constructor(title, options = {}) {
        super();
        this.title = String(title);
        this.body = String(options.body ?? "");
        this.tag = String(options.tag ?? "");
        this.data = options.data ?? null;
        for (const type of ["show", "close", "click", "error"]) {
          this.addEventListener(type, (event) => this["on" + type]?.(event));
        }
        if (DesktopNotification.permission !== "granted") return;

        const random = new Uint32Array(1);
        do {
          this.id = (crypto.getRandomValues(random)[0] & 0x7fffffff) || 1;
        } while (notices.has(this.id));
        // Operating systems do not all report dismissals. Bound the set of
        // callbacks retained for delivery to this particular document.
        if (notices.size >= 100) notices.delete(notices.keys().next().value);
        notices.set(this.id, this);

        // Slicing UTF-16 at these bounds also satisfies the native UTF-8 size limits.
        this.delivery = invoke("desktop_notify", {
          id: this.id,
          title: this.title.slice(0, 128) || "Yapin",
          body: this.body.slice(0, 1024),
        }).then(() => {
          if (notices.has(this.id)) this.dispatchEvent(new Event("show"));
          return true;
        }, (error) => {
          notices.delete(this.id);
          if (alive) {
            api.log("Could not deliver notification.", error);
            this.dispatchEvent(new Event("error"));
          }
          return false;
        });
      }

      close() {
        if (!notices.delete(this.id)) return;
        this.dispatchEvent(new Event("close"));
        void this.delivery.then((sent) => {
          if (sent && alive) return invoke("desktop_close_notification", { id: this.id });
        }).catch((error) => api.log("Could not dismiss notification.", error));
      }
    }

    function clicked(event) {
      const notice = notices.get(event.detail);
      if (!notice) return;
      if (enabled()) notice.dispatchEvent(new Event("click"));
      notice.close();
    }

    Object.defineProperty(window, "Notification", {
      configurable: true,
      writable: true,
      value: DesktopNotification,
    });
    window.addEventListener(clickEvent, clicked);
    api.onDispose(() => {
      alive = false;
      notices.clear();
      window.removeEventListener(clickEvent, clicked);
      if (window.Notification !== DesktopNotification) return;
      if (previous) Object.defineProperty(window, "Notification", previous);
      else delete window.Notification;
    });
    void readPermission(false);
    return DesktopNotification;
  }

  function setup(api) {
    const { createSignal, createComponent: component } = api.solid;
    const ui = api.ui;
    const enabled = () => api.storage.notifications !== false;
    const notifications = installNotifications(api, enabled);
    const [info, setInfo] = createSignal();
    const [busy, setBusy] = createSignal(false);
    const [available, setAvailable] = createSignal(null);
    const [status, setStatus] = createSignal("");
    let active = true;
    api.onDispose(() => { active = false; });

    async function checkUpdate() {
      if (busy()) return;
      const install = Boolean(available());
      setBusy(true);
      setStatus(install ? "Waiting for installation…" : "Checking for updates…");
      try {
        const version = await invoke("desktop_update", { install });
        if (!active) return;
        setAvailable(version);
        setStatus(version ? `Version ${version} is available.` : "You’re up to date.");
      } catch (error) {
        if (!active) return;
        api.log("Desktop update failed.", error);
        setStatus(install ? "Installation failed. Try again." : "Couldn’t check for updates. Try again.");
      } finally {
        if (active) setBusy(false);
      }
    }

    function renderSettings() {
      if (!info()) {
        void invoke("desktop_info", {}).then((value) => {
          if (active) setInfo(value);
        }).catch((error) => {
          api.log("Could not read desktop version.", error);
          if (active) setStatus("Desktop information is unavailable.");
        });
      }

      const toggle = component(ui.Switch, {
        "aria-label": "Desktop notifications",
        get checked() { return enabled(); },
        onChange(value) {
          api.storage.notifications = value;
          if (value) void notifications.requestPermission().then((permission) => {
            if (active && enabled() && permission !== "granted") {
              ui.showToast("Allow notifications in your system settings.", "error");
            }
          });
        },
      });
      const alerts = component(ui.SettingRow, {
        label: "Desktop notifications",
        hint: "Deliver alerts enabled in Yapin to your notification center.",
        children: toggle,
      });
      const shellVersion = component(ui.SettingText, {
        label: "Desktop version",
        get value() { return info()?.version ?? "—"; },
      });
      const clientVersion = component(ui.SettingText, {
        label: "Client version",
        value: client.version,
      });
      const action = component(ui.Button, {
        size: "small",
        get disabled() { return busy(); },
        onClick: checkUpdate,
        get children() { return available() ? "Install update" : "Check for updates"; },
      });
      const update = component(ui.SettingRow, {
        label: "Application updates",
        get hint() {
          if (status()) return status();
          if (info()?.updaterAvailable === false) return "This installation is updated manually or by your package manager.";
          return undefined;
        },
        get children() { return info()?.updaterAvailable ? action : null; },
      });
      return component(ui.SettingsPage, {
        title: "Desktop",
        children: [
          component(ui.Section, { label: "Notifications", children: alerts }),
          component(ui.Section, { label: "Software", children: [shellVersion, clientVersion, update] }),
        ],
      });
    }

    return {
      onLoad() {
        api.settings?.registerSection?.({
          id: "desktop",
          label: "Desktop",
          icon: "settings",
          render: renderSettings,
        });
      },
    };
  }

  if (!client.registerClientPlugin({
    id: "client:yapmod-desktop",
    manifest: {
      name: "Yapmod Desktop",
      author: "Yapmod",
      description: "Native notifications and desktop settings for Yapin.",
    },
    defaultEnabled: true,
    setup,
  })) {
    throw new Error("The client could not register Yapmod Desktop.");
  }
})
