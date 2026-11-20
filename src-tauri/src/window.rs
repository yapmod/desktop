use crate::{
    bundles::BundleStore,
    navigation,
    titlebar::{self, TitlebarLayout},
};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Url, Webview, WebviewUrl,
    WebviewWindowBuilder, Window, WindowBuilder, WindowEvent,
    webview::{NewWindowFeatures, NewWindowResponse, PageLoadEvent, WebviewBuilder},
};

static POPUP_ID: AtomicU64 = AtomicU64::new(0);

fn viewport(window: &Window) -> tauri::Result<LogicalSize<f64>> {
    Ok(window.inner_size()?.to_logical(window.scale_factor()?))
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let builder = WindowBuilder::new(app, "main")
        .title("Yapmod Desktop")
        .inner_size(1150., 760.)
        .min_inner_size(560., 380.)
        .center();
    #[cfg(target_os = "macos")]
    let builder = builder
        .hidden_title(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay);
    #[cfg(target_os = "windows")]
    let builder = builder.decorations(false).shadow(true);
    let window = builder.build()?;
    let init = format!("window.yapmodPlatform = '{}';", std::env::consts::OS);
    let shell = WebviewBuilder::new("shell", WebviewUrl::App("index.html".into()))
        .initialization_script(init)
        .on_new_window(|_, _| NewWindowResponse::Deny);
    window.add_child(shell, LogicalPosition::new(0., 0.), viewport(&window)?)?;
    attach_yapin(&window)?;
    let handle = app.clone();
    window.on_window_event(move |event| {
        if matches!(
            event,
            WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. }
        ) && let Some(window) = handle.get_window("main")
            && let Ok(size) = viewport(&window)
        {
            if let Some(shell) = handle.get_webview("shell") {
                let _ = shell.set_size(size);
            }
            if let Some(page) = handle.get_webview("yapin") {
                let _ = handle.state::<TitlebarLayout>().fit(&page, size);
            }
        }
        if matches!(event, WindowEvent::Destroyed) {
            handle.exit(0);
        }
    });
    Ok(())
}

fn popup(app: &AppHandle, url: Url, features: NewWindowFeatures) -> NewWindowResponse<tauri::Wry> {
    // OAuth needs its opener and the same cookie store to deliver the result.
    if navigation::is_auth(&url) || navigation::is_yapin(&url) || url.as_str() == "about:blank" {
        let label = format!("signin-{}", POPUP_ID.fetch_add(1, Ordering::Relaxed));
        let window = WebviewWindowBuilder::new(
            app,
            label,
            WebviewUrl::External("about:blank".parse().unwrap()),
        )
        .title("Yapin")
        .inner_size(540., 680.)
        .window_features(features)
        .on_navigation(navigation::embedded)
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .build();
        if let Ok(window) = window {
            #[cfg(target_os = "macos")]
            if let Err(error) = crate::popup_macos::install(&window) {
                eprintln!("Could not install the sign-in window close handler: {error}");
            }
            return NewWindowResponse::Create { window };
        }
    } else if matches!(url.scheme(), "https" | "http") {
        let _ = open::that_detached(url.as_str());
    }
    NewWindowResponse::Deny
}

fn load_client(page: Webview) {
    tauri::async_runtime::spawn(async move {
        let app = page.app_handle();
        let bundles = app.state::<BundleStore>();
        let resolved = bundles.resolve().await;
        if !page.url().is_ok_and(|url| navigation::is_yapin(&url)) {
            return;
        }
        match resolved {
            Ok(set) => {
                if let Err(error) = page.eval(set.initialization_script()) {
                    eprintln!("Could not initialize the Yapmod client: {error}");
                }
            }
            Err(error) => {
                eprintln!("Could not load the Yapmod client: {error}");
                let _ = page.eval(include_str!("../webview/unavailable.js"));
            }
        }
    });
}

#[tauri::command]
pub fn open_yapin(app: AppHandle) -> Result<(), String> {
    let page = app
        .get_webview("yapin")
        .ok_or("Yapin window is unavailable.")?;
    page.navigate(navigation::ENTRY.parse().expect("valid Yapin URL"))
        .map_err(|e| e.to_string())
}

fn attach_yapin(window: &Window) -> tauri::Result<()> {
    let popup_app = window.app_handle().clone();
    let page = WebviewBuilder::new(
        "yapin",
        WebviewUrl::External("about:blank".parse().unwrap()),
    )
    .disable_drag_drop_handler()
    .on_navigation(navigation::embedded)
    .on_new_window(move |url, features| popup(&popup_app, url, features))
    .on_page_load(|page, load| {
        if load.event() == PageLoadEvent::Started {
            let _ = page.state::<TitlebarLayout>().set(&page, false);
            return;
        }
        if load.url().as_str() == "about:blank" {
            return;
        }
        if let Some(shell) = page.app_handle().get_webview("shell") {
            let _ = shell.eval("window.dispatchEvent(new Event('yapmod-connected'))");
            // GTK packs child webviews vertically. Only the remote page should
            // participate in the layout once the native-framed window is ready.
            #[cfg(target_os = "linux")]
            let _ = shell.hide();
        }
        let _ = page.show();
        let _ = page.set_focus();
        if navigation::is_yapin(load.url()) {
            let _ = page.eval(titlebar::initialization_script());
            load_client(page);
        }
    });
    #[cfg(target_os = "macos")]
    let page = {
        // Set this before WKWebView copies its configuration. Google's sign-in widget
        // otherwise opens an account window before the user chooses a login method.
        let main = objc2::MainThreadMarker::new().expect("Tauri setup runs on the main thread");
        // SAFETY: this configuration is created and used on the AppKit main thread.
        let config = unsafe {
            let config = objc2_web_kit::WKWebViewConfiguration::new(main);
            config
                .preferences()
                .setJavaScriptCanOpenWindowsAutomatically(false);
            config
        };
        page.with_webview_configuration(config)
    };
    let page = window.add_child(page, LogicalPosition::new(0., 0.), viewport(window)?)?;
    page.hide()?;
    window
        .state::<TitlebarLayout>()
        .fit(&page, viewport(window)?)?;
    page.navigate(navigation::ENTRY.parse().expect("valid Yapin URL"))
}
