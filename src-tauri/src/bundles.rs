//! Release files are fetched natively so the page needs neither a GitHub token nor HTTP IPC.
//! Each cached source and its integrity proof are replaced together and rechecked on read.
use base64::{Engine, engine::general_purpose::STANDARD};
use minisign_verify::{PublicKey, Signature};
use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    error::Error,
    fs::{self, File},
    io::{BufReader, Read, Write},
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};
use tempfile::NamedTempFile;
use tokio::sync::Mutex;

type AssetError = Box<dyn Error + Send + Sync>;
type AssetResult<T> = Result<T, AssetError>;

const BUNDLE_ASSET: &str = "yapmod-client.js";
const PLUGIN_ASSET: &str = "desktop-plugins.js";
const CLIENT_LIMIT: usize = 8 * 1024 * 1024;
const PLUGIN_LIMIT: usize = 512 * 1024;
const PROOF_LIMIT: usize = 8 * 1024;
const RECHECK: Duration = Duration::from_secs(5 * 60);
const EMBEDDED_PLUGIN: &str = include_str!(concat!(env!("OUT_DIR"), "/desktop-plugins.js"));
const BOOTSTRAP: &str = include_str!("../webview/bootstrap.js");

#[derive(Clone)]
pub struct BundleSet {
    client: Arc<str>,
    updated_plugin: Option<Arc<str>>,
}

impl BundleSet {
    pub fn initialization_script(&self) -> String {
        // The injected script has Yapin's URL as its base. The standalone
        // client's relative source map is not served from that origin.
        let client = self
            .client
            .trim_end()
            .strip_suffix("\n//# sourceMappingURL=yapmod-client.js.map")
            .unwrap_or(&self.client);
        let bundled = EMBEDDED_PLUGIN.trim_end().trim_end_matches(';');
        let updated = serde_json::to_string(&self.updated_plugin.as_deref())
            .expect("strings serialize to JSON");
        format!("{BOOTSTRAP}(\n() => {{\n{client}\n}},\n{bundled},\n{updated}\n);")
    }
}

pub struct BundleStore {
    cache_dir: PathBuf,
    current: Mutex<Option<(Instant, BundleSet)>>,
}

impl BundleStore {
    pub fn new(cache_dir: PathBuf) -> Self {
        // The updater uses the same process-wide rustls provider.
        let _ = rustls::crypto::ring::default_provider().install_default();
        Self {
            cache_dir: cache_dir.join("bundles-v1"),
            current: Mutex::new(None),
        }
    }

    pub async fn resolve(&self) -> Result<BundleSet, String> {
        #[cfg(debug_assertions)]
        if let Some(path) = std::env::var_os("YAPMOD_DEV_CLIENT_BUNDLE") {
            eprintln!(
                "[yapmod-desktop] Using local client: {}",
                Path::new(&path).display()
            );
            return local_dev_bundle(Path::new(&path));
        }
        let mut current = self.current.lock().await;
        if let Some((checked, set)) = current.as_ref()
            && checked.elapsed() < RECHECK
        {
            return Ok(set.clone());
        }
        let http = Client::builder()
            .https_only(true)
            .user_agent(concat!("Yapmod-Desktop/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(12))
            .build()
            .map_err(|err| err.to_string())?;
        let (client, updated_plugin) = tokio::join!(
            resolve_client(&http, self.cache_dir.join("client.json")),
            resolve_plugin(&http, self.cache_dir.join("desktop-plugin.json"))
        );
        let set = BundleSet {
            client: client.map_err(|err| err.to_string())?.into(),
            updated_plugin: updated_plugin.map(Into::into),
        };
        *current = Some((Instant::now(), set.clone()));
        Ok(set)
    }
}

// Development uses the local client and the plugin compiled by Cargo together.
// Release builds never consult this override or skip signed bundle verification.
#[cfg(debug_assertions)]
fn local_dev_bundle(path: &Path) -> Result<BundleSet, String> {
    let source = fs::read_to_string(path)
        .map_err(|error| format!("Could not read local client {}: {error}", path.display()))?;
    if source.trim().is_empty() || source.len() > CLIENT_LIMIT {
        return Err("The local client bundle is empty or exceeds the size limit".into());
    }
    Ok(BundleSet {
        client: source.into(),
        updated_plugin: None,
    })
}

#[derive(Serialize, Deserialize)]
struct CachedAsset {
    proof: String,
    source: String,
}

impl CachedAsset {
    fn read(path: &Path, limit: usize) -> Option<Self> {
        let file = File::open(path).ok()?;
        // JSON string escaping can expand one byte to six bytes.
        let max_size = (limit * 6 + PROOF_LIMIT * 6 + 64) as u64;
        if file.metadata().ok()?.len() > max_size {
            return None;
        }
        let data: Self = serde_json::from_reader(BufReader::new(file.take(max_size + 1))).ok()?;
        (data.proof.len() <= PROOF_LIMIT && data.source.len() <= limit && !data.source.is_empty())
            .then_some(data)
    }

    fn save(&self, path: &Path) -> AssetResult<()> {
        let directory = path.parent().ok_or("missing bundle cache directory")?;
        fs::create_dir_all(directory)?;
        let mut temp = NamedTempFile::new_in(directory)?;
        temp.write_all(&serde_json::to_vec(self)?)?;
        temp.persist(path)?;
        Ok(())
    }
}

async fn fetch_text(http: &Client, url: Url, limit: usize) -> AssetResult<String> {
    let mut response = http.get(url).send().await?.error_for_status()?;
    if response.content_length().is_some_and(|n| n > limit as u64) {
        return Err("release response exceeds the size limit".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if chunk.len() > limit - bytes.len() {
            return Err("release response exceeds the size limit".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    if bytes.is_empty() {
        return Err("empty release response".into());
    }
    Ok(String::from_utf8(bytes)?)
}

fn asset_url(repo: &str, tag: &str, asset: &str) -> AssetResult<Url> {
    let (owner, project) = repo.split_once('/').ok_or("expected an owner/repository")?;
    let valid = |segment: &str| {
        !segment.is_empty()
            && segment != "."
            && segment != ".."
            && segment
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
    };
    if !valid(owner) || !valid(project) || tag.is_empty() || matches!(tag, "." | "..") {
        return Err("invalid GitHub release coordinates".into());
    }
    let mut url = Url::parse("https://github.com")?;
    url.path_segments_mut()
        .expect("GitHub URL has a path")
        .extend([owner, project, "releases", "download", tag, asset]);
    Ok(url)
}

fn check_digest(source: &str, proof: &str) -> AssetResult<()> {
    if proof != format!("sha256:{:x}", Sha256::digest(source.as_bytes())) {
        return Err("client bundle failed its GitHub SHA-256 check".into());
    }
    Ok(())
}

#[derive(Deserialize)]
struct ClientRelease {
    tag_name: String,
    assets: Vec<ReleaseAsset>,
}

#[derive(Deserialize)]
struct ReleaseAsset {
    name: String,
    digest: Option<String>,
}

async fn resolve_client(http: &Client, path: PathBuf) -> AssetResult<String> {
    let cached = CachedAsset::read(&path, CLIENT_LIMIT)
        .filter(|asset| check_digest(&asset.source, &asset.proof).is_ok());
    let result = async {
        let api = Url::parse("https://api.github.com/repos/yapmod/client/releases/latest")?;
        let release: ClientRelease =
            serde_json::from_str(&fetch_text(http, api, 512 * 1024).await?)?;
        let proof = release
            .assets
            .into_iter()
            .find(|asset| asset.name == BUNDLE_ASSET)
            .and_then(|asset| asset.digest)
            .ok_or("stable release has no digest for yapmod-client.js")?;
        if cached.as_ref().is_some_and(|asset| asset.proof == proof) {
            return Ok(None);
        }
        let url = asset_url("yapmod/client", &release.tag_name, BUNDLE_ASSET)?;
        let source = fetch_text(http, url, CLIENT_LIMIT).await?;
        check_digest(&source, &proof)?;
        Ok(Some(CachedAsset { source, proof }))
    }
    .await;
    select_source(result, cached, &path, "client")
}

fn decode_tauri_text(encoded: &str) -> AssetResult<String> {
    Ok(String::from_utf8(STANDARD.decode(encoded.trim())?)?)
}

fn check_signature(key: &PublicKey, source: &str, proof: &str) -> AssetResult<()> {
    let signature = Signature::decode(&decode_tauri_text(proof)?)?;
    key.verify(source.as_bytes(), &signature, false)?;
    // This release key also signs native installers. Bind the proof to this asset.
    if !signature
        .trusted_comment()
        .split('\t')
        .any(|field| field == "file:desktop-plugins.js")
    {
        return Err("signature belongs to a different release asset".into());
    }
    Ok(())
}

async fn resolve_plugin(http: &Client, path: PathBuf) -> Option<String> {
    let repo = option_env!("YAPMOD_RELEASE_REPO").filter(|s| !s.is_empty())?;
    let key = option_env!("YAPMOD_UPDATER_PUBLIC_KEY").filter(|s| !s.is_empty())?;
    match signed_plugin(http, &path, repo, key).await {
        Ok(source) if source == EMBEDDED_PLUGIN => None,
        Ok(source) => Some(source),
        Err(err) => {
            eprintln!("[yapmod-desktop] Using bundled plugin: {err}");
            None
        }
    }
}

async fn signed_plugin(http: &Client, path: &Path, repo: &str, key: &str) -> AssetResult<String> {
    let key = PublicKey::decode(&decode_tauri_text(key)?)?;
    let cached = CachedAsset::read(path, PLUGIN_LIMIT)
        .filter(|asset| check_signature(&key, &asset.source, &asset.proof).is_ok());
    let result = async {
        let sig_url = asset_url(repo, "plugins-v1", &format!("{PLUGIN_ASSET}.sig"))?;
        let proof = fetch_text(http, sig_url, PROOF_LIMIT).await?;
        if cached.as_ref().is_some_and(|asset| asset.proof == proof) {
            return Ok(None);
        }
        let source_url = asset_url(repo, "plugins-v1", PLUGIN_ASSET)?;
        let source = fetch_text(http, source_url, PLUGIN_LIMIT).await?;
        check_signature(&key, &source, &proof)?;
        Ok(Some(CachedAsset { source, proof }))
    }
    .await;
    select_source(result, cached, path, "desktop plugin")
}

fn select_source(
    result: AssetResult<Option<CachedAsset>>,
    cached: Option<CachedAsset>,
    path: &Path,
    name: &str,
) -> AssetResult<String> {
    match result {
        Ok(Some(new)) => {
            if let Err(err) = new.save(path) {
                eprintln!("[yapmod-desktop] Could not cache {name}: {err}");
            }
            Ok(new.source)
        }
        Ok(None) => cached
            .map(|asset| asset.source)
            .ok_or_else(|| "missing cached bundle".into()),
        Err(err) => match cached {
            Some(asset) => {
                eprintln!("[yapmod-desktop] Using cached {name}: {err}");
                Ok(asset.source)
            }
            None => Err(err),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn omits_the_standalone_source_map_only_from_the_injected_copy() {
        let code = "window.YapmodClient = {};";
        let map = "//# sourceMappingURL=yapmod-client.js.map";
        for newline in ["\n", "\r\n"] {
            let source = format!("{code}{newline}{map}{newline}");
            let set = BundleSet {
                client: source.as_str().into(),
                updated_plugin: None,
            };
            let script = set.initialization_script();
            assert!(script.contains(code));
            assert!(!script.contains(map));
            assert_eq!(&*set.client, source);
        }
        let inline =
            "window.YapmodClient = {};\n//# sourceMappingURL=data:application/json;base64,e30=";
        let set = BundleSet {
            client: inline.into(),
            updated_plugin: None,
        };
        assert!(set.initialization_script().contains(inline));
    }

    #[test]
    fn uses_digest_and_keeps_verified_cache_on_failed_refresh() {
        let path = tempfile::tempdir().unwrap();
        let file = path.path().join("client.json");
        let source = "client-v1";
        let proof = format!("sha256:{:x}", Sha256::digest(source.as_bytes()));
        let asset = CachedAsset {
            source: source.to_owned(),
            proof: proof.clone(),
        };
        select_source(Ok(Some(asset)), None, &file, "client").unwrap();
        let cached = CachedAsset::read(&file, CLIENT_LIMIT).unwrap();
        assert!(check_digest(&cached.source, &cached.proof).is_ok());
        assert!(check_digest("changed", &proof).is_err());
        assert_eq!(
            select_source(Err("offline".into()), Some(cached), &file, "client").unwrap(),
            source
        );
        assert!(CachedAsset::read(&file, 1).is_none());
    }

    #[test]
    fn accepts_tauri_signed_plugin_and_rejects_modified_bytes() {
        // Disposable test key. The signature was generated by tauri signer sign.
        let key = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IENDNUJGQzIxNUQwMEM5ODQKUldTRXlRQmRJZnhieko4bFNCWGdrUlFrOHBFeDRoYkYxUmo2MFZubHBmU0lieTZUeVg2VE5YQnMK";
        let signature = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVTRXlRQmRJZnhiekkwajlNMnZGVmFhUGRDWjZtdlQwMEQzMXFpK211czY4emZxMFk1UnFjT2VvQU0vM0VyK0ErUlhPbDZYcW9EaHBnUFRuREFEWWtxdTFhZGEzR2tVTkF3PQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzk1MjA2MjA4CWZpbGU6ZGVza3RvcC1wbHVnaW5zLmpzCmpVUWxpUjlTSS8wdjFKVWJrN3R6c3dCYVFkb1NoVklxUGV0MWdScWJBbXhNaS9PL1lRMEJLNDZqRGNNYWdYZU9VbjV5M2tGamtKRXgwVjY0Mnc1MkJRPT0K";
        let key = PublicKey::decode(&decode_tauri_text(key).unwrap()).unwrap();
        assert!(check_signature(&key, "() => 1", signature).is_ok());
        assert!(check_signature(&key, "() => 2", signature).is_err());
    }

    #[test]
    fn release_coordinates_remain_under_the_selected_repository() {
        let url = asset_url("yapmod/client", "v1/beta", BUNDLE_ASSET).unwrap();
        assert_eq!(
            url.as_str(),
            "https://github.com/yapmod/client/releases/download/v1%2Fbeta/yapmod-client.js"
        );
        assert!(asset_url("untrusted.invalid/../elsewhere", "tag", BUNDLE_ASSET).is_err());
        assert!(asset_url("yapmod/client", "..", BUNDLE_ASSET).is_err());
    }

    #[test]
    #[cfg(debug_assertions)]
    fn local_development_bundle_is_fresh_and_has_no_plugin_update() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("yapmod-client.js");
        assert!(local_dev_bundle(&path).is_err());
        fs::write(&path, "local client v1").unwrap();
        let first = local_dev_bundle(&path).unwrap();
        assert_eq!(&*first.client, "local client v1");
        assert!(first.updated_plugin.is_none());
        fs::write(&path, "local client v2").unwrap();
        assert_eq!(&*local_dev_bundle(&path).unwrap().client, "local client v2");
        fs::write(&path, " ").unwrap();
        assert!(local_dev_bundle(&path).is_err());
    }

    #[tokio::test]
    #[ignore = "requires GitHub access"]
    async fn resolves_live_client_and_verifies_its_cached_copy() {
        let directory = tempfile::tempdir().unwrap();
        let store = BundleStore::new(directory.path().to_owned());
        let set = store.resolve().await.unwrap();
        assert!(set.client.contains("registerClientPlugin"));
        let cached = CachedAsset::read(&store.cache_dir.join("client.json"), CLIENT_LIMIT).unwrap();
        check_digest(&cached.source, &cached.proof).unwrap();
        assert_eq!(&*set.client, cached.source);
    }
}
