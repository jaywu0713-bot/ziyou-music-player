use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::{Component, Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Mutex, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use tauri_plugin_fs::FsExt;

const VERSION: &str = "htdemucs-mlx-1.6.1-v1";
const MAX_INPUT: u64 = 512 * 1024 * 1024;
static JOB: OnceLock<Mutex<Option<Job>>> = OnceLock::new();
static CHILD: OnceLock<Mutex<Option<Child>>> = OnceLock::new();
fn jobs() -> &'static Mutex<Option<Job>> {
    JOB.get_or_init(|| Mutex::new(None))
}
fn child() -> &'static Mutex<Option<Child>> {
    CHILD.get_or_init(|| Mutex::new(None))
}
fn valid_key(key: &str) -> bool {
    key.len() == 64
        && key
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheEntry {
    track_id: String,
    key: String,
    name: String,
    source_size: u64,
    source_modified: u64,
    source_path: Option<PathBuf>,
    source_hash: String,
    bytes: u64,
}
impl CacheEntry {
    fn matches(&self, id: &str, size: u64, modified: u64) -> bool {
        self.track_id == id && self.source_size == size && self.source_modified == modified
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    id: String,
    track_id: String,
    stage: String,
    progress: f64,
    #[serde(skip)]
    source: PathBuf,
    #[serde(skip)]
    source_size: u64,
    #[serde(skip)]
    source_modified: u64,
    #[serde(skip)]
    source_path: Option<PathBuf>,
    #[serde(skip)]
    name: String,
    #[serde(skip)]
    received: u64,
    #[serde(skip)]
    cancelled: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    entries: Vec<CacheEntry>,
    job: Option<Job>,
    model_ready: bool,
    model_bytes: u64,
    cache_bytes: u64,
    cache_path: String,
    model_path: String,
}
fn io_error(error: impl std::fmt::Display) -> String {
    format!("伴奏缓存操作失败：{error}")
}
fn directories(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(io_error)?
        .join("accompaniment-v1");
    let models = app
        .path()
        .app_data_dir()
        .map_err(io_error)?
        .join("vocal-models");
    fs::create_dir_all(cache.join("jobs")).map_err(io_error)?;
    fs::create_dir_all(&models).map_err(io_error)?;
    Ok((cache, models))
}
fn main_app(window: &tauri::WebviewWindow) -> Result<tauri::AppHandle, String> {
    if window.label() != "main" {
        return Err("此操作只允许在主窗口执行。".into());
    }
    Ok(window.app_handle().clone())
}
fn entries(cache: &Path) -> Result<Vec<CacheEntry>, String> {
    let path = cache.join("index.json");
    if !path.exists() {
        return Ok(vec![]);
    }
    let list: Vec<CacheEntry> =
        serde_json::from_slice(&fs::read(path).map_err(io_error)?).map_err(io_error)?;
    if list.iter().any(|entry| !valid_key(&entry.key)) {
        return Err("伴奏索引损坏，请保留数据并重试。".into());
    }
    Ok(list)
}
fn save_entries(cache: &Path, list: &[CacheEntry]) -> Result<(), String> {
    let temp = cache.join("index.json.part");
    fs::write(&temp, serde_json::to_vec(list).map_err(io_error)?).map_err(io_error)?;
    fs::rename(temp, cache.join("index.json")).map_err(io_error)
}
fn file_bytes(path: &Path) -> u64 {
    fs::symlink_metadata(path)
        .ok()
        .filter(|m| m.is_file() && !m.is_symlink())
        .map(|m| m.len())
        .unwrap_or(0)
}
fn hash_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(io_error)?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let count = file.read(&mut buffer).map_err(io_error)?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}
fn input_path(app: &tauri::AppHandle, root: &str, relative: &str) -> Result<PathBuf, String> {
    if relative.is_empty()
        || !Path::new(relative)
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
    {
        return Err("音乐路径无效。".into());
    }
    let root = Path::new(root).canonicalize().map_err(io_error)?;
    let path = root.join(relative).canonicalize().map_err(io_error)?;
    if !path.starts_with(root) || !path.is_file() || !app.fs_scope().is_allowed(&path) {
        return Err("请重新授权歌曲所在文件夹。".into());
    }
    Ok(path)
}
fn clear_partial_models(models: &Path) -> Result<(), String> {
    for name in ["htdemucs.safetensors.part", "htdemucs_config.json.part"] {
        let path = models.join(name);
        if path.exists() {
            fs::remove_file(path).map_err(io_error)?;
        }
    }
    Ok(())
}
pub fn initialize(app: &tauri::AppHandle) -> Result<(), String> {
    let (cache, models) = directories(app)?;
    // A previous process cannot still own these staging files after app exit.
    for entry in fs::read_dir(cache.join("jobs"))
        .map_err(io_error)?
        .flatten()
    {
        if entry.file_type().map_err(io_error)?.is_dir() {
            fs::remove_dir_all(entry.path()).map_err(io_error)?;
        }
    }
    for entry in fs::read_dir(models).map_err(io_error)?.flatten() {
        if entry.file_name().to_string_lossy().ends_with(".part") {
            let _ = fs::remove_file(entry.path());
        }
    }
    Ok(())
}
pub fn stop() {
    if let Some(process) = child().lock().unwrap().as_mut() {
        #[cfg(unix)]
        unsafe {
            libc::kill(-(process.id() as i32), libc::SIGKILL);
        }
        let _ = process.kill();
    }
}

#[tauri::command]
pub fn vocal_status(window: tauri::WebviewWindow) -> Result<Status, String> {
    let app = main_app(&window)?;
    let (cache, models) = directories(&app)?;
    let mut list = entries(&cache)?;
    list.retain(|e| file_bytes(&cache.join(format!("{}.flac", e.key))) > 0);
    let model_bytes = fs::read_dir(&models)
        .map_err(io_error)?
        .flatten()
        .map(|e| file_bytes(&e.path()))
        .sum();
    let cache_bytes = fs::read_dir(&cache)
        .map_err(io_error)?
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|ext| ext == "flac"))
        .map(|e| file_bytes(&e.path()))
        .sum();
    Ok(Status {
        entries: list,
        job: jobs().lock().unwrap().clone(),
        model_ready: file_bytes(&models.join("htdemucs.safetensors")) == 168005865
            && file_bytes(&models.join("htdemucs_config.json")) == 4215,
        model_bytes,
        cache_bytes,
        cache_path: cache.display().to_string(),
        model_path: models.display().to_string(),
    })
}

#[tauri::command]
pub fn vocal_begin(
    window: tauri::WebviewWindow,
    track_id: String,
    name: String,
    size: u64,
    modified: u64,
    root_path: Option<String>,
    relative_path: Option<String>,
) -> Result<String, String> {
    let app = main_app(&window)?;
    let (cache, _) = directories(&app)?;
    let mut current = jobs().lock().unwrap();
    if current.is_some() {
        return Err("已有处理任务，请先完成或取消。".into());
    }
    if track_id.is_empty()
        || track_id.len() > 500
        || name.len() > 500
        || size == 0
        || size > MAX_INPUT
    {
        return Err("输入文件无效，暂支持 512 MB 以内的单个文件。".into());
    }
    let extension = Path::new(&name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if ![
        "flac", "mp3", "wav", "m4a", "aac", "ogg", "opus", "aif", "aiff", "alac", "ape", "wma",
        "dsf", "dff",
    ]
    .contains(&extension.as_str())
    {
        return Err("音频格式不支持。".into());
    }
    let source_path = match (root_path, relative_path) {
        (Some(root), Some(relative)) => Some(input_path(&app, &root, &relative)?),
        (None, None) => None,
        _ => return Err("缺少音乐文件夹路径。".into()),
    };
    let id = format!(
        "{:x}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(io_error)?
            .as_nanos()
    );
    let directory = cache.join("jobs").join(&id);
    fs::create_dir(&directory).map_err(io_error)?;
    let source = source_path
        .clone()
        .unwrap_or_else(|| directory.join(format!("source.{extension}")));
    if source_path.is_some() && file_bytes(&source) != size {
        let _ = fs::remove_dir_all(directory);
        return Err("原文件已变化，请刷新音乐库。".into());
    }
    *current = Some(Job {
        id: id.clone(),
        track_id,
        stage: if source_path.is_some() {
            "ready"
        } else {
            "upload"
        }
        .into(),
        progress: 0.0,
        source,
        source_size: size,
        source_modified: modified,
        source_path: source_path.clone(),
        name,
        received: if source_path.is_some() { size } else { 0 },
        cancelled: false,
    });
    Ok(id)
}

#[tauri::command]
pub fn vocal_upload(
    window: tauri::WebviewWindow,
    id: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    main_app(&window)?;
    let mut current = jobs().lock().unwrap();
    let job = current
        .as_mut()
        .filter(|j| j.id == id && j.stage == "upload")
        .ok_or("上传任务已取消。")?;
    if bytes.len() > 1024 * 1024
        || bytes.is_empty()
        || job.received + bytes.len() as u64 > job.source_size
    {
        return Err("上传片段大小无效。".into());
    }
    fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&job.source)
        .map_err(io_error)?
        .write_all(&bytes)
        .map_err(io_error)?;
    job.received += bytes.len() as u64;
    job.progress = job.received as f64 / job.source_size as f64;
    Ok(())
}

fn run_worker(app: tauri::AppHandle, id: String, download: bool) -> Result<(), String> {
    let (cache, models) = directories(&app)?;
    let job = jobs()
        .lock()
        .unwrap()
        .clone()
        .filter(|j| j.id == id)
        .ok_or("处理任务不存在。")?;
    let output = cache.join("jobs").join(&id).join("instrumental.flac");
    let result = (|| {
        let executable = app
            .path()
            .resolve(
                "resources/vocal-engine/vocal-engine",
                tauri::path::BaseDirectory::Resource,
            )
            .map_err(io_error)?;
        let mut command = Command::new(executable);
        command
            .arg(if download { "download" } else { "separate" })
            .arg("--models")
            .arg(&models);
        if !download {
            command
                .arg("--source")
                .arg(&job.source)
                .arg("--output")
                .arg(&output);
        }
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        let mut process = command
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("无法启动本地去人声引擎：{e}"))?;
        let stdout = process.stdout.take().ok_or("无法读取处理进度。")?;
        *child().lock().unwrap() = Some(process);
        if jobs().lock().unwrap().as_ref().is_none_or(|j| j.cancelled) {
            stop();
        }
        let thread_id = id.clone();
        let reader = std::thread::spawn(move || {
            let mut result = None;
            let mut error = None;
            for line in BufReader::new(stdout).lines() {
                let line = line.map_err(io_error)?;
                let Ok(message) = serde_json::from_str::<serde_json::Value>(&line) else {
                    continue;
                };
                if let Some(stage) = message["stage"].as_str() {
                    if stage == "result" {
                        result = Some(message.clone());
                    }
                    if stage == "error" {
                        error = Some(
                            message["message"]
                                .as_str()
                                .unwrap_or("本地处理失败。")
                                .to_owned(),
                        );
                    }
                    if let Some(job) = jobs()
                        .lock()
                        .unwrap()
                        .as_mut()
                        .filter(|j| j.id == thread_id)
                    {
                        job.stage = stage.into();
                        job.progress = message["progress"]
                            .as_f64()
                            .unwrap_or(job.progress)
                            .clamp(0.0, 1.0);
                    }
                }
            }
            Ok::<_, String>((result, error))
        });
        let start = std::time::Instant::now();
        let status = loop {
            if start.elapsed() > Duration::from_secs(6 * 3600) {
                stop();
            }
            let status = child()
                .lock()
                .unwrap()
                .as_mut()
                .ok_or("任务已取消。")?
                .try_wait()
                .map_err(io_error)?;
            if let Some(status) = status {
                break status;
            }
            std::thread::sleep(Duration::from_millis(100));
        };
        *child().lock().unwrap() = None;
        let (response, error) = reader.join().map_err(|_| "进度读取失败。")??;
        if jobs().lock().unwrap().as_ref().is_some_and(|j| j.cancelled) {
            return Err("已取消处理。".into());
        }
        if !status.success() {
            return Err(error.unwrap_or_else(|| "本地处理失败，请重试。".into()));
        }
        let response = response.ok_or("没有收到完整处理结果。")?;
        if !download {
            let hash = response["sourceHash"]
                .as_str()
                .filter(|h| valid_key(h))
                .ok_or("处理结果缺少源文件摘要。")?;
            let bytes = file_bytes(&output);
            if bytes == 0 || bytes > MAX_INPUT {
                return Err("伴奏输出为空或超过当前播放器 512 MB 限制。".into());
            }
            let key = format!(
                "{:x}",
                Sha256::digest(format!("{hash}:{VERSION}:{}", job.track_id).as_bytes())
            );
            let entry = CacheEntry {
                track_id: job.track_id.clone(),
                key: key.clone(),
                name: job.name.clone(),
                source_size: job.source_size,
                source_modified: job.source_modified,
                source_path: job.source_path.clone(),
                source_hash: hash.into(),
                bytes,
            };
            fs::rename(&output, cache.join(format!("{key}.flac"))).map_err(io_error)?;
            let mut list = entries(&cache)?;
            let old = list
                .iter()
                .filter(|e| e.track_id == job.track_id && e.key != key)
                .map(|e| e.key.clone())
                .collect::<Vec<_>>();
            list.retain(|e| e.track_id != job.track_id);
            list.push(entry);
            save_entries(&cache, &list)?;
            for key in old {
                let _ = fs::remove_file(cache.join(format!("{key}.flac")));
            }
        }
        Ok(())
    })();
    if result.is_err() {
        stop();
    }
    if let Some(mut process) = child().lock().unwrap().take() {
        let _ = process.wait();
    }
    let cleanup = if download {
        clear_partial_models(&models)
    } else {
        Ok(())
    };
    let _ = fs::remove_dir_all(cache.join("jobs").join(&id));
    let mut current = jobs().lock().unwrap();
    if current.as_ref().is_some_and(|j| j.id == id) {
        *current = None;
    }
    result.and(cleanup)
}

#[tauri::command]
pub async fn vocal_run(window: tauri::WebviewWindow, id: String) -> Result<(), String> {
    let app = main_app(&window)?;
    {
        let mut current = jobs().lock().unwrap();
        let job = current
            .as_mut()
            .filter(|j| j.id == id && ["upload", "ready"].contains(&j.stage.as_str()))
            .ok_or("处理任务已取消。")?;
        if job.received != job.source_size {
            return Err("原曲尚未完整传入。".into());
        }
        job.stage = "loading".into();
    }
    tauri::async_runtime::spawn_blocking(move || run_worker(app, id, false))
        .await
        .map_err(io_error)?
}
#[tauri::command]
pub async fn vocal_download(window: tauri::WebviewWindow) -> Result<(), String> {
    let app = main_app(&window)?;
    let (cache, _) = directories(&app)?;
    let id = format!(
        "{:x}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(io_error)?
            .as_nanos()
    );
    {
        let mut current = jobs().lock().unwrap();
        if current.is_some() {
            return Err("已有处理任务。".into());
        }
        fs::create_dir(cache.join("jobs").join(&id)).map_err(io_error)?;
        *current = Some(Job {
            id: id.clone(),
            track_id: String::new(),
            stage: "download".into(),
            progress: 0.0,
            source: PathBuf::new(),
            source_size: 0,
            source_modified: 0,
            source_path: None,
            name: String::new(),
            received: 0,
            cancelled: false,
        });
    }
    tauri::async_runtime::spawn_blocking(move || run_worker(app, id, true))
        .await
        .map_err(io_error)?
}
#[tauri::command]
pub fn vocal_cancel(window: tauri::WebviewWindow) -> Result<(), String> {
    let app = main_app(&window)?;
    let (cache, _) = directories(&app)?;
    {
        let mut current = jobs().lock().unwrap();
        if let Some(job) = current.as_mut() {
            job.cancelled = true;
            if ["upload", "ready"].contains(&job.stage.as_str()) {
                let _ = fs::remove_dir_all(cache.join("jobs").join(&job.id));
                *current = None;
                return Ok(());
            }
        }
    }
    stop();
    Ok(())
}
#[tauri::command]
pub async fn vocal_cached(
    window: tauri::WebviewWindow,
    track_id: String,
    size: u64,
    modified: u64,
) -> Result<Option<String>, String> {
    let app = main_app(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let (cache, _) = directories(&app)?;
        let Some(entry) = entries(&cache)?
            .into_iter()
            .find(|e| e.matches(&track_id, size, modified))
        else {
            return Ok(None);
        };
        if let Some(source) = &entry.source_path {
            if !app.fs_scope().is_allowed(source) || hash_file(source)? != entry.source_hash {
                return Err("原曲已变化或访问授权失效，请刷新音乐库并重新生成伴奏。".into());
            }
        }
        let path = cache.join(format!("{}.flac", entry.key));
        if file_bytes(&path) == 0 {
            return Ok(None);
        }
        app.fs_scope().allow_file(&path).map_err(io_error)?;
        Ok(Some(path.display().to_string()))
    })
    .await
    .map_err(io_error)?
}
#[tauri::command]
pub fn vocal_clear(
    window: tauri::WebviewWindow,
    key: Option<String>,
    model: bool,
) -> Result<(), String> {
    let app = main_app(&window)?;
    let (cache, models) = directories(&app)?;
    let current = jobs().lock().unwrap();
    if current.is_some() {
        return Err("请先取消或完成处理，再清理缓存。".into());
    }
    if model {
        clear_partial_models(&models)?;
        for name in ["htdemucs.safetensors", "htdemucs_config.json"] {
            let p = models.join(name);
            if p.exists() {
                fs::remove_file(p).map_err(io_error)?;
            }
        }
        return Ok(());
    }
    if key.as_ref().is_some_and(|k| !valid_key(k)) {
        return Err("缓存路径无效。".into());
    }
    let mut list = entries(&cache)?;
    let mut failed = false;
    for entry in fs::read_dir(&cache).map_err(io_error)?.flatten() {
        let path = entry.path();
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        if path.extension().is_some_and(|e| e == "flac")
            && valid_key(stem)
            && key.as_ref().is_none_or(|key| key == stem)
            && fs::remove_file(&path).is_err()
        {
            failed = true;
        }
    }
    list.retain(|e| file_bytes(&cache.join(format!("{}.flac", e.key))) > 0);
    save_entries(&cache, &list)?;
    if failed {
        Err("部分伴奏未能删除，保留了对应记录，请重试。".into())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn partial_model_cleanup_preserves_complete_and_unrelated_files() {
        let directory = std::env::temp_dir().join(format!("vocal-cleanup-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        for name in [
            "htdemucs.safetensors.part",
            "htdemucs_config.json",
            "unrelated.part",
        ] {
            fs::write(directory.join(name), b"test").unwrap();
        }
        clear_partial_models(&directory).unwrap();
        assert!(!directory.join("htdemucs.safetensors.part").exists());
        assert!(directory.join("htdemucs_config.json").exists());
        assert!(directory.join("unrelated.part").exists());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn cache_keys_cannot_escape_managed_directory() {
        assert!(valid_key(&"a".repeat(64)));
        assert!(!valid_key("../original.flac"));
        assert!(!valid_key(&"A".repeat(64)));
    }
    #[test]
    fn changed_source_specs_invalidate_cache() {
        let entry = CacheEntry {
            track_id: "one".into(),
            key: "a".repeat(64),
            name: "a.flac".into(),
            source_size: 10,
            source_modified: 20,
            source_path: None,
            source_hash: "b".repeat(64),
            bytes: 5,
        };
        assert!(entry.matches("one", 10, 20));
        assert!(!entry.matches("one", 11, 20));
        assert!(!entry.matches("two", 10, 20));
    }
}
