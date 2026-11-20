use tauri::Url;

pub const ENTRY: &str = "https://www.yapin.gg/?auth=in";

fn secure_host(url: &Url) -> Option<&str> {
    (url.scheme() == "https"
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none())
    .then(|| url.host_str())
    .flatten()
}

pub fn is_yapin(url: &Url) -> bool {
    matches!(secure_host(url), Some("www.yapin.gg" | "yapin.gg"))
}

pub fn is_auth(url: &Url) -> bool {
    let Some(host) = secure_host(url) else {
        return false;
    };
    host == "dnfkuqzddwvtdojzgmdm.supabase.co"
        || host.strip_prefix("accounts.").is_some_and(|domain| {
            include_str!("../assets/google-domains.txt")
                .lines()
                .any(|google_domain| domain == google_domain)
        })
}

pub fn embedded(url: &Url) -> bool {
    is_yapin(url)
        || is_auth(url)
        // WebKit also asks the navigation delegate about iframe documents.
        // These built-in documents receive no desktop capabilities.
        || matches!(url.as_str(), "about:blank" | "about:srcdoc")
        || matches!(
            secure_host(url),
            Some("challenges.cloudflare.com" | "www.youtube.com" | "www.youtube-nocookie.com")
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_regional_google_accounts_without_desktop_permissions() {
        for address in [
            "https://accounts.google.com/",
            "https://accounts.google.fr/",
            "https://accounts.google.co.uk/",
        ] {
            let url = address.parse().unwrap();
            assert!(is_auth(&url));
            assert!(embedded(&url));
            assert!(!is_yapin(&url));
        }
        for address in [
            "https://accounts.google.fr.example.org/",
            "https://accounts.google.invalid/",
            "https://accounts.google.fr@example.org/",
            "https://user@accounts.google.fr/",
            "http://accounts.google.fr/",
            "https://accounts.google.fr:8443/",
        ] {
            assert!(!embedded(&address.parse().unwrap()));
        }
    }

    #[test]
    fn allows_webkit_inline_frames_without_granting_the_desktop_bridge() {
        for address in ["about:srcdoc", "about:blank"] {
            let url = address.parse().unwrap();
            assert!(embedded(&url));
            assert!(!is_yapin(&url));
            assert!(!is_auth(&url));
        }
        for address in [
            "about:config",
            "data:text/html,test",
            "https://unrelated.invalid",
        ] {
            assert!(!embedded(&address.parse().unwrap()));
        }
    }

    #[test]
    fn limits_the_bridge_to_the_two_production_origins() {
        for url in [ENTRY, "https://yapin.gg:443/"] {
            assert!(is_yapin(&url.parse().unwrap()));
        }
        for url in [
            "http://yapin.gg",
            "https://www.yapin.gg:8443",
            "https://yapin.gg.example.com",
            "https://yapin.gg@example.com",
            "https://chat.yapin.gg",
            "https://accounts.google.com",
        ] {
            assert!(!is_yapin(&url.parse().unwrap()));
        }
    }
}
