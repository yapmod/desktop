use base64::{Engine, engine::general_purpose::STANDARD};
use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{LogicalPosition, LogicalSize, Manager, Rect, Webview};

const FALLBACK_HEIGHT: f64 = if cfg!(any(target_os = "macos", target_os = "windows")) {
    32.
} else {
    0.
};

#[derive(Default)]
pub struct TitlebarLayout(AtomicBool);

impl TitlebarLayout {
    pub fn fit(&self, page: &Webview, size: LogicalSize<f64>) -> tauri::Result<()> {
        let top = if self.0.load(Ordering::Relaxed) {
            0.
        } else {
            FALLBACK_HEIGHT
        };
        page.set_bounds(Rect {
            position: LogicalPosition::new(0., top).into(),
            size: LogicalSize::new(size.width.max(1.), (size.height - top).max(1.)).into(),
        })
    }

    pub fn set(&self, page: &Webview, integrated: bool) -> tauri::Result<()> {
        self.0.store(integrated, Ordering::Relaxed);
        let window = page.window();
        self.fit(
            page,
            window.inner_size()?.to_logical(window.scale_factor()?),
        )
    }
}

pub fn initialization_script() -> String {
    let platform = std::env::consts::OS;
    let logo = STANDARD.encode(include_bytes!("../../shell/yapmod.svg"));
    let styles = concat!(
        include_str!("../../shell/caption.css"),
        "\n",
        include_str!("../../runtime/titlebar.css")
    );
    let css = serde_json::to_string(styles).expect("CSS is valid text");
    let integrate = include_str!("../../runtime/titlebar.js");
    let controls = include_str!("../../shell/caption.js");
    format!("{integrate}('{platform}', 'data:image/svg+xml;base64,{logo}', {css}, {controls});")
}

#[tauri::command]
pub async fn set_integrated_titlebar(webview: Webview, integrated: bool) -> Result<(), String> {
    if webview.label() != "yapin"
        || !webview
            .url()
            .is_ok_and(|url| crate::navigation::is_yapin(&url))
    {
        return Err("The integrated title bar requires the Yapin window.".into());
    }
    webview
        .state::<TitlebarLayout>()
        .set(&webview, integrated)
        .map_err(|e| e.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CaptionAction {
    Drag,
    Minimize,
    ToggleMaximize,
    IsMaximized,
    Close,
}

#[tauri::command]
pub async fn window_caption(webview: Webview, action: CaptionAction) -> Result<bool, String> {
    let window = webview.window();
    if window.label() != "main" {
        return Err("Window controls require the main window.".into());
    }
    let result = match action {
        CaptionAction::Drag => window.start_dragging(),
        CaptionAction::Minimize => window.minimize(),
        CaptionAction::ToggleMaximize => {
            if window.is_maximized().map_err(|e| e.to_string())? {
                window.unmaximize()
            } else {
                window.maximize()
            }
        }
        CaptionAction::IsMaximized => return window.is_maximized().map_err(|e| e.to_string()),
        CaptionAction::Close => window.close(),
    };
    result.map(|()| false).map_err(|e| e.to_string())
}
