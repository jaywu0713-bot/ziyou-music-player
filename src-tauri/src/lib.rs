use serde::Serialize;
use std::collections::HashSet;
use std::io::Read;
use std::path::{Component, Path};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::Manager;
mod mini;
mod vocal;


const COVER_ID: &str = "12345678-1234-1234-1234-123456789abc";
static NEXT_SEARCH: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();

fn valid_id(id: &str) -> bool {
    id.len() == COVER_ID.len()
        && id.chars().zip(COVER_ID.chars()).all(|(c, shape)| {
            if shape == '-' {
                c == '-'
            } else {
                c.is_ascii_hexdigit()
            }
        })
}

#[derive(Serialize)]
struct CoverCandidate {
    id: String,
    title: String,
    artist: String,
}

fn parse_covers(data: &serde_json::Value, album: bool) -> Vec<CoverCandidate> {
    let mut result = Vec::new();
    let mut seen = HashSet::new();
    let rows = if album {
        data.get("releases")
    } else {
        data.get("recordings")
    };
    for row in rows.and_then(|r| r.as_array()).into_iter().flatten() {
        let artist = row
            .get("artist-credit")
            .and_then(|v| v.as_array())
            .map(|credits| {
                credits
                    .iter()
                    .filter_map(|v| v.get("name").or_else(|| v.get("artist")?.get("name")))
                    .filter_map(|v| v.as_str())
                    .collect::<Vec<_>>()
                    .join(" / ")
            })
            .unwrap_or_default();
        let releases = if album {
            Some(std::slice::from_ref(row))
        } else {
            row.get("releases")
                .and_then(|v| v.as_array())
                .map(|v| v.as_slice())
        };
        for release in releases.into_iter().flatten() {
            let Some(id) = release.get("id").and_then(|v| v.as_str()) else {
                continue;
            };
            let Some(title) = release.get("title").and_then(|v| v.as_str()) else {
                continue;
            };
            if valid_id(id) && seen.insert(id.to_owned()) && result.len() < 12 {
                result.push(CoverCandidate {
                    id: id.to_owned(),
                    title: title.chars().take(300).collect(),
                    artist: artist.chars().take(300).collect(),
                });
            }
        }
    }
    result
}

async fn read_bounded(mut response: reqwest::Response, max: usize) -> Result<Vec<u8>, String> {
    if !response.status().is_success() {
        return Err(format!("封面服务返回 {}。", response.status()));
    }
    if response.content_length().is_some_and(|n| n > max as u64) {
        return Err("封面内容过大。".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "无法读取封面服务响应。")?
    {
        if bytes.len() + chunk.len() > max {
            return Err("封面内容过大。".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

#[tauri::command]
async fn search_lyrics_native(title: String, artist: String) -> Result<serde_json::Value, String> {
    let title = title.trim();
    let artist = artist.trim();
    if title.is_empty() || title.chars().count() > 200 || artist.chars().count() > 200 {
        return Err("歌曲名称或歌手长度无效。".into());
    }
    let mut url =
        reqwest::Url::parse("https://lrclib.net/api/search").map_err(|_| "歌词搜索地址无效。")?;
    url.query_pairs_mut().append_pair("track_name", title);
    if !artist.is_empty() {
        url.query_pairs_mut().append_pair("artist_name", artist);
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "无法启动歌词搜索。")?;
    let response = client
        .get(url)
        .header("User-Agent", "ZiYou/0.10 (personal desktop music player)")
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|_| "无法连接歌词服务，请检查网络或导入本地 .lrc 文件。")?;
    if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err("歌词服务请求过多，请稍后重试。".into());
    }
    if !response.status().is_success() {
        return Err(format!("歌词服务暂不可用（{}）。", response.status()));
    }
    let bytes = read_bounded(response, 2 * 1024 * 1024).await?;
    let data: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| "歌词服务返回格式异常。")?;
    if !data.is_array() {
        return Err("歌词服务返回格式异常。".into());
    }
    Ok(data)
}

#[tauri::command]
async fn search_covers(
    title: String,
    artist: String,
    album: String,
) -> Result<Vec<CoverCandidate>, String> {
    let title = title.trim();
    let artist = artist.trim();
    let album = album.trim();
    if title.is_empty() && album.is_empty() {
        return Err("请填写歌曲或专辑名称。".into());
    }
    if [title, artist, album]
        .iter()
        .any(|v| v.chars().count() > 200)
    {
        return Err("关键词请控制在 200 字以内。".into());
    }
    let limiter = NEXT_SEARCH.get_or_init(|| Mutex::new(None));
    {
        let mut next = limiter.lock().map_err(|_| "搜索暂不可用。")?;
        if next.is_some_and(|time| time > Instant::now()) {
            return Err("搜索较频繁，请稍后重试。".into());
        }
        *next = Some(Instant::now() + Duration::from_millis(1100));
    }
    let kind = if album.is_empty() {
        "recording"
    } else {
        "release"
    };
    let quote = |value: &str| format!("\"{}\"", value.replace(['\\', '"', '\n', '\r'], " "));
    let query = format!(
        "{}:{}{}",
        kind,
        quote(if album.is_empty() { title } else { album }),
        if artist.is_empty() {
            String::new()
        } else {
            format!(" AND artist:{}", quote(artist))
        }
    );
    let mut url = reqwest::Url::parse(&format!("https://musicbrainz.org/ws/2/{kind}"))
        .map_err(|_| "封面搜索地址无效。")?;
    url.query_pairs_mut()
        .append_pair("query", &query)
        .append_pair("fmt", "json")
        .append_pair("limit", "12");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "无法启动封面搜索。")?;
    let response = client
        .get(url)
        .header("User-Agent", "ZiYou/0.8 (personal desktop music player)")
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|_| "无法连接 MusicBrainz。")?;
    let body = read_bounded(response, 1024 * 1024).await?;
    let data: serde_json::Value =
        serde_json::from_slice(&body).map_err(|_| "封面搜索结果格式异常。")?;
    Ok(parse_covers(&data, !album.is_empty()))
}

#[derive(Serialize)]
struct CoverImage {
    bytes: Vec<u8>,
    mime: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecordingCandidate {
    id: String,
    title: String,
    artists: Vec<String>,
    album: String,
    album_artists: Vec<String>,
    duration: Option<f64>,
}

fn credit_names(value: Option<&serde_json::Value>) -> Vec<String> {
    value
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .filter_map(|v| v.get("name").or_else(|| v.get("artist")?.get("name")))
        .filter_map(|v| v.as_str())
        .take(6)
        .map(|v| v.chars().take(200).collect())
        .collect()
}

fn parse_recording_candidates(data: &serde_json::Value) -> Vec<RecordingCandidate> {
    let mut result = Vec::new();
    for row in data
        .get("recordings")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .take(12)
    {
        let Some(id) = row
            .get("id")
            .and_then(|v| v.as_str())
            .filter(|v| valid_id(v))
        else {
            continue;
        };
        let Some(title) = row.get("title").and_then(|v| v.as_str()) else {
            continue;
        };
        let artists = credit_names(row.get("artist-credit"));
        let duration = row
            .get("length")
            .and_then(|v| v.as_f64())
            .filter(|n| *n > 0.0 && *n < 86_400_000.0)
            .map(|n| n / 1000.0);
        let releases = row.get("releases").and_then(|v| v.as_array());
        if let Some(releases) = releases.filter(|rows| !rows.is_empty()) {
            for release in releases.iter().take(4) {
                if result.len() >= 20 {
                    break;
                }
                let album = release.get("title").and_then(|v| v.as_str()).unwrap_or("");
                let release_id = release
                    .get("id")
                    .and_then(|v| v.as_str())
                    .filter(|v| valid_id(v))
                    .unwrap_or(id);
                result.push(RecordingCandidate {
                    id: format!("{id}:{release_id}"),
                    title: title.chars().take(300).collect(),
                    artists: artists.clone(),
                    album: album.chars().take(300).collect(),
                    album_artists: credit_names(release.get("artist-credit")),
                    duration,
                });
            }
        } else {
            result.push(RecordingCandidate {
                id: id.into(),
                title: title.chars().take(300).collect(),
                artists,
                album: String::new(),
                album_artists: vec![],
                duration,
            });
        }
    }
    result
}

fn parse_acoustid_candidates(data: &serde_json::Value) -> Vec<RecordingCandidate> {
    let mut result = Vec::new();
    let mut seen = HashSet::new();
    for match_row in data
        .get("results")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .take(5)
    {
        if match_row
            .get("score")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0)
            < 0.7
        {
            continue;
        }
        for row in match_row
            .get("recordings")
            .and_then(|v| v.as_array())
            .into_iter()
            .flatten()
            .take(8)
        {
            let Some(id) = row
                .get("id")
                .and_then(|v| v.as_str())
                .filter(|v| valid_id(v))
            else {
                continue;
            };
            let Some(title) = row.get("title").and_then(|v| v.as_str()) else {
                continue;
            };
            let artists = row
                .get("artists")
                .and_then(|v| v.as_array())
                .into_iter()
                .flatten()
                .filter_map(|v| v.get("name")?.as_str())
                .take(6)
                .map(|v| v.chars().take(200).collect())
                .collect();
            let duration = row
                .get("duration")
                .and_then(|v| v.as_f64())
                .filter(|v| *v > 0.0 && *v < 86400.0);
            let album = row
                .get("releasegroups")
                .and_then(|v| v.as_array())
                .and_then(|rows| rows.first())
                .and_then(|v| v.get("title"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if seen.insert((id.to_owned(), album.to_owned())) {
                result.push(RecordingCandidate {
                    id: id.to_owned(),
                    title: title.chars().take(300).collect(),
                    artists,
                    album: album.chars().take(300).collect(),
                    album_artists: vec![],
                    duration,
                });
            }
            if result.len() >= 20 {
                return result;
            }
        }
    }
    result
}

fn parse_fpcalc_result(data: &serde_json::Value) -> Result<(u64, String), String> {
    let fingerprint = data
        .get("fingerprint")
        .and_then(|v| v.as_str())
        .filter(|v| !v.is_empty() && v.len() < 100_000)
        .ok_or("没有生成可用指纹。")?
        .to_owned();
    let duration = data
        .get("duration")
        .and_then(|v| v.as_f64())
        .filter(|v| *v > 0.0 && *v < 86400.0)
        .ok_or("无法确认音频时长。")?
        .round() as u64;
    Ok((duration, fingerprint))
}

#[tauri::command]
async fn fingerprint_lookup(
    app: tauri::AppHandle,
    root_path: String,
    relative_path: String,
    client_key: String,
) -> Result<Vec<RecordingCandidate>, String> {
    if client_key.len() < 8
        || client_key.len() > 64
        || !client_key.bytes().all(|b| b.is_ascii_alphanumeric())
    {
        return Err("AcoustID Client API key 无效。".into());
    }
    let relative = Path::new(&relative_path);
    if relative.as_os_str().is_empty()
        || !relative
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
    {
        return Err("歌曲路径无效。".into());
    }
    let root = Path::new(&root_path)
        .canonicalize()
        .map_err(|_| "音乐文件夹不可用。")?;
    let target = root
        .join(relative)
        .canonicalize()
        .map_err(|_| "歌曲文件不可用。")?;
    if !target.starts_with(&root) || !target.is_file() {
        return Err("歌曲不在绑定文件夹中。".into());
    }
    let fpcalc = app
        .path()
        .resolve("resources/fpcalc", tauri::path::BaseDirectory::Resource)
        .map_err(|_| "未找到音频指纹工具。")?;
    let output = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let mut child = Command::new(fpcalc)
            .arg("-json")
            .arg("-length")
            .arg("120")
            .arg(target)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "无法启动音频指纹工具。")?;
        let start = Instant::now();
        loop {
            match child.try_wait().map_err(|_| "音频指纹处理失败。")? {
                Some(status) => {
                    let mut bytes = Vec::new();
                    child
                        .stdout
                        .take()
                        .ok_or("指纹结果不可读。")?
                        .take(128 * 1024)
                        .read_to_end(&mut bytes)
                        .map_err(|_| "指纹结果不可读。")?;
                    return if status.success() {
                        Ok(bytes)
                    } else {
                        Err("该音频暂不能生成指纹。".into())
                    };
                }
                None if start.elapsed() > Duration::from_secs(45) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err("音频指纹处理超时。".into());
                }
                None => std::thread::sleep(Duration::from_millis(100)),
            }
        }
    })
    .await
    .map_err(|_| "音频指纹处理失败。")??;
    let fingerprint_data: serde_json::Value =
        serde_json::from_slice(&output).map_err(|_| "指纹结果格式异常。")?;
    let (duration, fingerprint) = parse_fpcalc_result(&fingerprint_data)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "无法启动指纹查询。")?;
    let response = client
        .post("https://api.acoustid.org/v2/lookup")
        .form(&[
            ("client", client_key.as_str()),
            ("duration", &duration.to_string()),
            ("fingerprint", fingerprint.as_str()),
            ("meta", "recordings releasegroups compress"),
            ("format", "json"),
        ])
        .send()
        .await
        .map_err(|_| "无法连接 AcoustID。")?;
    let body = read_bounded(response, 1024 * 1024).await?;
    let data: serde_json::Value =
        serde_json::from_slice(&body).map_err(|_| "指纹查询结果格式异常。")?;
    if data.get("status").and_then(|v| v.as_str()) != Some("ok") {
        return Err("AcoustID 查询失败，请检查 Client API key。".into());
    }
    Ok(parse_acoustid_candidates(&data))
}

#[tauri::command]
async fn search_recordings(
    title: String,
    artist: String,
) -> Result<Vec<RecordingCandidate>, String> {
    let title = title.trim();
    let artist = artist.trim();
    if title.is_empty() || title.chars().count() > 200 || artist.chars().count() > 200 {
        return Err("歌曲关键词无效。".into());
    }
    let limiter = NEXT_SEARCH.get_or_init(|| Mutex::new(None));
    {
        let mut next = limiter.lock().map_err(|_| "搜索暂不可用。")?;
        if next.is_some_and(|time| time > Instant::now()) {
            return Err("搜索较频繁，请稍后重试。".into());
        }
        *next = Some(Instant::now() + Duration::from_millis(1100));
    }
    let quote = |value: &str| format!("\"{}\"", value.replace(['\\', '"', '\n', '\r'], " "));
    let query = format!(
        "recording:{}{}",
        quote(title),
        if artist.is_empty() {
            String::new()
        } else {
            format!(" AND artist:{}", quote(artist))
        }
    );
    let mut url = reqwest::Url::parse("https://musicbrainz.org/ws/2/recording")
        .map_err(|_| "搜索地址无效。")?;
    url.query_pairs_mut()
        .append_pair("query", &query)
        .append_pair("fmt", "json")
        .append_pair("limit", "12");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "无法启动歌曲搜索。")?;
    let response = client
        .get(url)
        .header("User-Agent", "ZiYou/0.9 (personal desktop music player)")
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|_| "无法连接 MusicBrainz。")?;
    let body = read_bounded(response, 1024 * 1024).await?;
    let data: serde_json::Value =
        serde_json::from_slice(&body).map_err(|_| "歌曲搜索结果格式异常。")?;
    Ok(parse_recording_candidates(&data))
}

#[tauri::command]
async fn get_cover_image(id: String) -> Result<CoverImage, String> {
    if !valid_id(&id) {
        return Err("封面编号无效。".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(18))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "无法启动封面下载。")?;
    let mut url = reqwest::Url::parse(&format!(
        "https://coverartarchive.org/release/{id}/front-500"
    ))
    .map_err(|_| "封面地址无效。")?;
    for _ in 0..6 {
        if url.scheme() != "https"
            || url.port().is_some()
            || !url.username().is_empty()
            || url.password().is_some()
            || !matches!(
                url.host_str(),
                Some("coverartarchive.org") | Some("archive.org")
            ) && !url
                .host_str()
                .is_some_and(|host| host.ends_with(".archive.org"))
        {
            return Err("封面地址不可用。".into());
        }
        let response = client
            .get(url.clone())
            .header("User-Agent", "ZiYou/0.8 (personal desktop music player)")
            .send()
            .await
            .map_err(|_| "无法连接封面服务。")?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or("封面跳转地址无效。")?;
            url = url.join(location).map_err(|_| "封面跳转地址无效。")?;
            if url.scheme() == "http" {
                url.set_scheme("https").map_err(|_| "封面跳转地址无效。")?;
            }
            continue;
        }
        let mime = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .split(';')
            .next()
            .unwrap_or("")
            .to_owned();
        if !["image/jpeg", "image/png", "image/webp"].contains(&mime.as_str()) {
            return Err("封面格式不可用。".into());
        }
        let bytes = read_bounded(response, 10 * 1024 * 1024).await?;
        return Ok(CoverImage { bytes, mime });
    }
    Err("封面跳转次数过多。".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            search_covers,
            get_cover_image,
            search_recordings,
            search_lyrics_native,
            fingerprint_lookup,
            vocal::vocal_status,
            vocal::vocal_begin,
            vocal::vocal_upload,
            vocal::vocal_run,
            vocal::vocal_download,
            vocal::vocal_cancel,
            vocal::vocal_cached,
            vocal::vocal_clear,
            mini::mini_preferences,
            mini::mini_save_preferences,
            mini::mini_save_bounds,
            mini::mini_prepare,
            mini::mini_restore_main,
            mini::mini_collapse,
            mini::mini_expand
        ])
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_persisted_scope::init())
        .setup(|app| {
            vocal::initialize(app.handle()).map_err(std::io::Error::other)?;
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                match mini::close_action(window.label()) {
                    mini::CloseAction::HideMain => {
                        api.prevent_close();
                        if let Err(error) = window.hide() {
                            log::error!("main hide: {error}");
                        }
                    }
                    mini::CloseAction::RestoreMain => {
                        api.prevent_close();
                        if let Err(error) = mini::restore_main(window.app_handle()) {
                            log::error!("mini restore: {error}");
                        }
                    }
                    mini::CloseAction::Default => {}
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = &event {
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.show();
                    let _ = main.set_focus();
                }
            }
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                let _ = mini::save_bounds(app);
                vocal::stop();
            }
        });
}

#[cfg(test)]
mod cover_tests {
    use super::*;

    #[test]
    fn cover_search_keeps_only_release_ids_and_deduplicates() {
        let json = serde_json::json!({"recordings": [{
          "artist-credit": [{"name": "Artist"}],
          "releases": [
            {"id": "12345678-1234-1234-1234-123456789abc", "title": "Album"},
            {"id": "12345678-1234-1234-1234-123456789abc", "title": "Duplicate"},
            {"id": "../bad", "title": "Bad"}
          ]
        }]});
        let covers = parse_covers(&json, false);
        assert_eq!(covers.len(), 1);
        assert_eq!(covers[0].title, "Album");
        assert_eq!(covers[0].artist, "Artist");
    }
}

#[cfg(test)]
mod recognition_tests {
    use super::*;

    #[test]
    fn recording_candidates_keep_bounded_credits_and_album() {
        let data = serde_json::json!({"recordings":[{
            "id":"12345678-1234-1234-1234-123456789abc",
            "title":"Blue Sky","length":180000,
            "artist-credit":[{"name":"Singer"}],
            "releases":[{"title":"Record","artist-credit":[{"name":"Singer"}]}]
        }]});
        let candidates = parse_recording_candidates(&data);
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].artists, vec!["Singer"]);
        assert_eq!(candidates[0].album, "Record");
        assert_eq!(candidates[0].duration, Some(180.0));
    }

    #[test]
    fn recording_without_release_still_proposes_artist() {
        let data = serde_json::json!({"recordings":[{"id":"12345678-1234-1234-1234-123456789abc","title":"Single","length":190000,"artist-credit":[{"name":"Singer"}],"releases":[]}]});
        let candidates = parse_recording_candidates(&data);
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].album, "");
    }

    #[test]
    fn acoustid_results_are_only_review_candidates() {
        let data = serde_json::json!({"results":[{"score":0.98,"recordings":[{
            "id":"12345678-1234-1234-1234-123456789abc","title":"Blue Sky","duration":180,
            "artists":[{"name":"Singer"}],"releasegroups":[{"title":"Record"}]
        }]}]});
        let candidates = parse_acoustid_candidates(&data);
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].album, "Record");
        assert_eq!(candidates[0].artists, vec!["Singer"]);
    }
    #[test]
    fn fpcalc_decimal_duration_is_accepted() {
        let data = serde_json::json!({"duration":7.0,"fingerprint":"AQAAI0mUaEkS"});
        let (duration, fingerprint) = parse_fpcalc_result(&data).unwrap();
        assert_eq!(duration, 7);
        assert_eq!(fingerprint, "AQAAI0mUaEkS");
    }
}
