use crate::navigation;
use tauri::{
    Url, Webview,
    webview::{PermissionKind, PermissionResponse},
};

pub fn request(webview: Webview, kind: PermissionKind) -> PermissionResponse {
    response(webview.label(), webview.url().ok().as_ref(), kind)
}

fn response(label: &str, url: Option<&Url>, kind: PermissionKind) -> PermissionResponse {
    if !matches!(kind, PermissionKind::Microphone | PermissionKind::Camera) {
        return PermissionResponse::Default;
    }
    if label != "yapin" || !url.is_some_and(navigation::is_yapin) {
        return PermissionResponse::Deny;
    }

    // Let WebKit/WebView2 ask the user and enforce OS privacy settings. Never
    // return Allow based on the top-level URL: Tauri does not expose the
    // requesting frame's origin here. The browser must handle that decision.
    // WebKitGTK's default is denial; Linux media support is a separate task.
    PermissionResponse::Default
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn media_requests_use_browser_consent_only_in_yapin() {
        for kind in [PermissionKind::Microphone, PermissionKind::Camera] {
            for address in [navigation::ENTRY, "https://yapin.gg/"] {
                let url = address.parse().unwrap();
                assert_eq!(
                    response("yapin", Some(&url), kind),
                    PermissionResponse::Default
                );
                for label in ["shell", "signin-0"] {
                    assert_eq!(response(label, Some(&url), kind), PermissionResponse::Deny);
                }
            }
            for address in [
                "about:blank",
                "https://accounts.google.com/",
                "http://yapin.gg/",
                "https://yapin.gg:8443/",
                "https://yapin.gg.example.com/",
            ] {
                assert_eq!(
                    response("yapin", Some(&address.parse().unwrap()), kind),
                    PermissionResponse::Deny
                );
            }
            assert_eq!(response("yapin", None, kind), PermissionResponse::Deny);
        }
    }

    #[test]
    fn other_permissions_keep_their_existing_behavior() {
        for kind in [
            PermissionKind::Notifications,
            PermissionKind::DisplayCapture,
            PermissionKind::Geolocation,
        ] {
            assert_eq!(response("shell", None, kind), PermissionResponse::Default);
        }
    }
}
