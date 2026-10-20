#[derive(Debug, PartialEq)]
pub enum CloseAction {
    HideMain,
    RestoreMain,
    Default,
}
pub fn close_action(label: &str) -> CloseAction {
    match label {
        "main" => CloseAction::HideMain,
        "mini" => CloseAction::RestoreMain,
        _ => CloseAction::Default,
    }
}
use serde::{Deserialize, Serialize};
use std::{fs, sync::Mutex};
use tauri::{Emitter, Manager};
static PREF_LOCK: Mutex<()> = Mutex::new(());
#[derive(Clone, Copy, Serialize, Deserialize)]
struct Bounds {
    x: i32,
    y: i32,
    width: f64,
    height: f64,
}
struct Area {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale: f64,
}
fn fit_bounds(saved: Option<Bounds>, areas: &[Area]) -> Option<Bounds> {
    let initial = saved.unwrap_or(Bounds {
        x: i32::MAX,
        y: i32::MAX,
        width: 480.0,
        height: 250.0,
    });
    let area = areas
        .iter()
        .find(|a| {
            initial.x as i64 >= a.x as i64
                && (initial.x as i64) < a.x as i64 + a.width as i64
                && initial.y as i64 >= a.y as i64
                && (initial.y as i64) < a.y as i64 + a.height as i64
        })
        .or(areas.first())?;
    let scale = area.scale.max(1.0);
    let width = (if initial.width.is_finite() {
        initial.width.clamp(360.0, 1200.0)
    } else {
        480.0
    })
    .min(area.width as f64 / scale - 16.0)
    .max(360.0);
    let height = (if initial.height.is_finite() {
        initial.height.clamp(220.0, 800.0)
    } else {
        250.0
    })
    .min(area.height as f64 / scale - 48.0)
    .max(220.0);
    let max_x = area
        .x
        .saturating_add((area.width as f64 - width * scale).max(0.0) as i32);
    let max_y = area
        .y
        .saturating_add((area.height as f64 - (height + 28.0) * scale).max(0.0) as i32);
    let visible =
        initial.x >= area.x && initial.x <= max_x && initial.y >= area.y && initial.y <= max_y;
    Some(Bounds {
        x: if visible {
            initial.x
        } else {
            area.x.saturating_add(24).min(max_x)
        },
        y: if visible {
            initial.y
        } else {
            area.y.saturating_add(24).min(max_y)
        },
        width,
        height,
    })
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum CollapsedStyle {
    EdgeTab,
    CoverTile,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CollapsedBounds {
    x: i32,
    y: i32,
    width: f64,
    height: f64,
}
fn collapsed_size(style: CollapsedStyle) -> (f64, f64) {
    match style {
        CollapsedStyle::EdgeTab => (48.0, 84.0),
        CollapsedStyle::CoverTile => (80.0, 80.0),
    }
}
fn fit_collapsed_bounds(
    saved: Option<CollapsedBounds>,
    style: CollapsedStyle,
    areas: &[Area],
) -> Option<CollapsedBounds> {
    let is_default = saved.is_none();
    let initial = saved.unwrap_or(CollapsedBounds {
        x: i32::MAX,
        y: i32::MAX,
        width: 0.0,
        height: 0.0,
    });
    let area = areas
        .iter()
        .find(|a| {
            initial.x as i64 >= a.x as i64
                && (initial.x as i64) < a.x as i64 + a.width as i64
                && initial.y as i64 >= a.y as i64
                && (initial.y as i64) < a.y as i64 + a.height as i64
        })
        .or(areas.first())?;
    let (width, height) = collapsed_size(style);
    let right = area.x.saturating_add(area.width as i32);
    let bottom = area.y.saturating_add(area.height as i32);
    let scale = area.scale.max(1.0);
    let physical_width = (width * scale).ceil() as i32;
    let physical_height = (height * scale).ceil() as i32;
    let edge_x = if initial.x < area.x + area.width as i32 / 2 {
        area.x
    } else {
        right.saturating_sub(physical_width)
    };
    Some(CollapsedBounds {
        x: match style {
            CollapsedStyle::EdgeTab => edge_x,
            CollapsedStyle::CoverTile => initial
                .x
                .clamp(area.x, right.saturating_sub(physical_width)),
        },
        y: if is_default {
            area.y.saturating_add((area.height as f64 / 3.0) as i32)
        } else {
            initial
                .y
                .clamp(area.y, bottom.saturating_sub(physical_height))
        },
        width,
        height,
    })
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Preferences {
    mode: String,
    pinned: bool,
    bounds: Option<Bounds>,
    collapsed_style: String,
    collapsed_bounds: Option<CollapsedBounds>,
    collapsed_active: bool,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            mode: "both".into(),
            pinned: true,
            bounds: None,
            collapsed_style: "edge-tab".into(),
            collapsed_bounds: None,
            collapsed_active: false,
        }
    }
}
fn prefs_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.join("mini-player.json"))
        .map_err(|e| e.to_string())
}
fn read(app: &tauri::AppHandle) -> Preferences {
    let mut prefs = prefs_path(app)
        .ok()
        .and_then(|p| fs::read(p).ok())
        .filter(|b| b.len() < 16384)
        .and_then(|b| serde_json::from_slice::<Preferences>(&b).ok())
        .unwrap_or_default();
    if prefs.mode != "both" && prefs.mode != "mini-only" {
        prefs.mode = "both".into();
    }
    if prefs.collapsed_style != "edge-tab" && prefs.collapsed_style != "cover-tile" {
        prefs.collapsed_style = "edge-tab".into();
    }
    prefs
}
fn write(app: &tauri::AppHandle, prefs: &Preferences) -> Result<(), String> {
    let path = prefs_path(app)?;
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let temporary = path.with_extension("json.part");
    fs::write(
        &temporary,
        serde_json::to_vec(prefs).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(temporary, path).map_err(|e| e.to_string())
}
fn authorized(window: &tauri::WebviewWindow) -> Result<tauri::AppHandle, String> {
    if !["main", "mini"].contains(&window.label()) {
        return Err("此窗口不能控制迷你播放器。".into());
    }
    Ok(window.app_handle().clone())
}
pub fn save_bounds(app: &tauri::AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("mini") else {
        return Ok(());
    };
    let _lock = PREF_LOCK.lock().unwrap();
    let mut prefs = read(app);
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.inner_size().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let bounds = Bounds {
        x: pos.x,
        y: pos.y,
        width: size.width as f64 / scale,
        height: size.height as f64 / scale,
    };
    if prefs.collapsed_active {
        let current = CollapsedBounds {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
        };
        let areas = window
            .available_monitors()
            .map_err(|e| e.to_string())?
            .iter()
            .map(|m| {
                let r = m.work_area();
                Area {
                    x: r.position.x,
                    y: r.position.y,
                    width: r.size.width,
                    height: r.size.height,
                    scale: m.scale_factor(),
                }
            })
            .collect::<Vec<_>>();
        let style = if prefs.collapsed_style == "cover-tile" {
            CollapsedStyle::CoverTile
        } else {
            CollapsedStyle::EdgeTab
        };
        let fitted = fit_collapsed_bounds(Some(current), style, &areas).unwrap_or(current);
        if fitted.x != current.x || fitted.y != current.y {
            window
                .set_position(tauri::PhysicalPosition::new(fitted.x, fitted.y))
                .map_err(|e| e.to_string())?;
        }
        prefs.collapsed_bounds = Some(fitted);
    } else {
        prefs.bounds = Some(bounds);
    }
    write(app, &prefs)
}
#[tauri::command]
pub fn mini_preferences(window: tauri::WebviewWindow) -> Result<Preferences, String> {
    let app = authorized(&window)?;
    let _lock = PREF_LOCK.lock().unwrap();
    Ok(read(&app))
}
#[tauri::command]
pub fn mini_save_preferences(
    window: tauri::WebviewWindow,
    mode: Option<String>,
    pinned: Option<bool>,
    collapsed_style: Option<String>,
) -> Result<Preferences, String> {
    let app = authorized(&window)?;
    let _lock = PREF_LOCK.lock().unwrap();
    let mut prefs = read(&app);
    if let Some(mode) = mode {
        if !["both", "mini-only"].contains(&mode.as_str()) {
            return Err("显示模式无效。".into());
        }
        prefs.mode = mode;
    }
    if let Some(pinned) = pinned {
        app.get_webview_window("mini")
            .ok_or("迷你窗口不存在。")?
            .set_always_on_top(pinned)
            .map_err(|e| e.to_string())?;
        prefs.pinned = pinned;
    }
    if let Some(style) = collapsed_style {
        if style != "edge-tab" && style != "cover-tile" {
            return Err("收起样式无效。".into());
        }
        prefs.collapsed_style = style;
    }
    write(&app, &prefs)?;
    Ok(prefs)
}
#[tauri::command]
pub fn mini_save_bounds(window: tauri::WebviewWindow) -> Result<(), String> {
    save_bounds(&authorized(&window)?)
}
#[tauri::command]
pub fn mini_prepare(window: tauri::WebviewWindow) -> Result<Preferences, String> {
    let app = authorized(&window)?;
    let mut prefs = {
        let _lock = PREF_LOCK.lock().unwrap();
        read(&app)
    };
    let mini = app
        .get_webview_window("mini")
        .ok_or("迷你播放器尚未就绪。")?;
    mini.set_always_on_top(prefs.pinned)
        .map_err(|e| e.to_string())?;
    mini.set_decorations(true).map_err(|e| e.to_string())?;
    mini.set_min_size(Some(tauri::LogicalSize::new(360.0, 220.0)))
        .map_err(|e| e.to_string())?;
    prefs.collapsed_active = false;
    if !mini.is_visible().map_err(|e| e.to_string())? {
        let areas = mini
            .available_monitors()
            .map_err(|e| e.to_string())?
            .iter()
            .map(|m| {
                let r = m.work_area();
                Area {
                    x: r.position.x,
                    y: r.position.y,
                    width: r.size.width,
                    height: r.size.height,
                    scale: m.scale_factor(),
                }
            })
            .collect::<Vec<_>>();
        if let Some(b) = fit_bounds(prefs.bounds, &areas) {
            mini.set_size(tauri::LogicalSize::new(b.width, b.height))
                .map_err(|e| e.to_string())?;
            mini.set_position(tauri::PhysicalPosition::new(b.x, b.y))
                .map_err(|e| e.to_string())?;
        }
    }
    {
        let _lock = PREF_LOCK.lock().unwrap();
        write(&app, &prefs)?;
    }
    Ok(prefs)
}
#[tauri::command]
pub fn mini_collapse(window: tauri::WebviewWindow, style: String) -> Result<Preferences, String> {
    let app = authorized(&window)?;
    if window.label() != "mini" {
        return Err("只能从迷你播放器收起窗口。".into());
    }
    let style = match style.as_str() {
        "edge-tab" => CollapsedStyle::EdgeTab,
        "cover-tile" => CollapsedStyle::CoverTile,
        _ => return Err("收起样式无效。".into()),
    };
    let mini = app.get_webview_window("mini").ok_or("迷你窗口不存在。")?;
    let areas = mini
        .available_monitors()
        .map_err(|e| e.to_string())?
        .iter()
        .map(|m| {
            let r = m.work_area();
            Area {
                x: r.position.x,
                y: r.position.y,
                width: r.size.width,
                height: r.size.height,
                scale: m.scale_factor(),
            }
        })
        .collect::<Vec<_>>();
    let was_collapsed = {
        let _lock = PREF_LOCK.lock().unwrap();
        read(&app).collapsed_active
    };
    if !was_collapsed {
        save_bounds(&app)?;
    }
    let saved = {
        let _lock = PREF_LOCK.lock().unwrap();
        read(&app)
    };
    let position_seed = saved.collapsed_bounds.or_else(|| {
        saved.bounds.map(|bounds| CollapsedBounds {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
        })
    });
    let desired =
        fit_collapsed_bounds(position_seed, style, &areas).ok_or("无法读取屏幕可用区域。")?;
    if let Err(error) = mini
        .set_min_size(None::<tauri::LogicalSize<f64>>)
        .and_then(|_| mini.set_decorations(false))
        .and_then(|_| mini.set_size(tauri::LogicalSize::new(desired.width, desired.height)))
        .and_then(|_| mini.set_position(tauri::PhysicalPosition::new(desired.x, desired.y)))
    {
        let restore = saved.bounds.unwrap_or(Bounds {
            x: desired.x,
            y: desired.y,
            width: 480.0,
            height: 250.0,
        });
        let _ = mini.set_decorations(true);
        let _ = mini.set_min_size(Some(tauri::LogicalSize::new(360.0, 220.0)));
        let _ = mini.set_size(tauri::LogicalSize::new(restore.width, restore.height));
        let _ = mini.set_position(tauri::PhysicalPosition::new(restore.x, restore.y));
        return Err(error.to_string());
    }
    let _lock = PREF_LOCK.lock().unwrap();
    let mut prefs = read(&app);
    prefs.collapsed_style = match style {
        CollapsedStyle::EdgeTab => "edge-tab",
        CollapsedStyle::CoverTile => "cover-tile",
    }
    .into();
    prefs.collapsed_bounds = Some(desired);
    prefs.collapsed_active = true;
    if let Err(error) = write(&app, &prefs) {
        let restore = saved.bounds.unwrap_or(Bounds {
            x: desired.x,
            y: desired.y,
            width: 480.0,
            height: 250.0,
        });
        let _ = mini.set_decorations(true);
        let _ = mini.set_min_size(Some(tauri::LogicalSize::new(360.0, 220.0)));
        let _ = mini.set_size(tauri::LogicalSize::new(restore.width, restore.height));
        let _ = mini.set_position(tauri::PhysicalPosition::new(restore.x, restore.y));
        return Err(error);
    }
    Ok(prefs)
}
#[tauri::command]
pub fn mini_expand(window: tauri::WebviewWindow) -> Result<Preferences, String> {
    let app = authorized(&window)?;
    if window.label() != "mini" {
        return Err("只能从迷你播放器展开窗口。".into());
    }
    let mini = app.get_webview_window("mini").ok_or("迷你窗口不存在。")?;
    save_bounds(&app)?;
    let areas = mini
        .available_monitors()
        .map_err(|e| e.to_string())?
        .iter()
        .map(|m| {
            let r = m.work_area();
            Area {
                x: r.position.x,
                y: r.position.y,
                width: r.size.width,
                height: r.size.height,
                scale: m.scale_factor(),
            }
        })
        .collect::<Vec<_>>();
    let _lock = PREF_LOCK.lock().unwrap();
    let mut prefs = read(&app);
    let bounds = fit_bounds(prefs.bounds, &areas).ok_or("无法读取屏幕可用区域。")?;
    if let Err(error) = mini
        .set_decorations(true)
        .and_then(|_| mini.set_min_size(Some(tauri::LogicalSize::new(360.0, 220.0))))
        .and_then(|_| mini.set_size(tauri::LogicalSize::new(bounds.width, bounds.height)))
        .and_then(|_| mini.set_position(tauri::PhysicalPosition::new(bounds.x, bounds.y)))
    {
        let collapsed = prefs.collapsed_bounds.ok_or_else(|| error.to_string())?;
        let _ = mini.set_decorations(false);
        let _ = mini.set_min_size(None::<tauri::LogicalSize<f64>>);
        let _ = mini.set_size(tauri::LogicalSize::new(collapsed.width, collapsed.height));
        let _ = mini.set_position(tauri::PhysicalPosition::new(collapsed.x, collapsed.y));
        return Err(error.to_string());
    }
    prefs.bounds = Some(bounds);
    prefs.collapsed_active = false;
    if let Err(error) = write(&app, &prefs) {
        if let Some(collapsed) = prefs.collapsed_bounds {
            let _ = mini.set_decorations(false);
            let _ = mini.set_min_size(None::<tauri::LogicalSize<f64>>);
            let _ = mini.set_size(tauri::LogicalSize::new(collapsed.width, collapsed.height));
            let _ = mini.set_position(tauri::PhysicalPosition::new(collapsed.x, collapsed.y));
        }
        return Err(error);
    }
    Ok(prefs)
}
pub fn restore_main(app: &tauri::AppHandle) -> Result<(), String> {
    let main = app.get_webview_window("main").ok_or("主窗口不存在。")?;
    main.show().map_err(|e| e.to_string())?;
    main.unminimize().map_err(|e| e.to_string())?;
    main.set_focus().map_err(|e| e.to_string())?;
    let _ = save_bounds(app);
    if let Some(mini) = app.get_webview_window("mini") {
        mini.hide().map_err(|e| e.to_string())?;
    }
    app.emit_to("main", "ziyou:mini-hidden", ())
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn mini_restore_main(window: tauri::WebviewWindow) -> Result<(), String> {
    restore_main(&authorized(&window)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn main_close_preserves_the_single_player_and_mini_close_restores_it() {
        assert_eq!(close_action("main"), CloseAction::HideMain);
        assert_eq!(close_action("mini"), CloseAction::RestoreMain);
        assert_eq!(close_action("lyrics-one"), CloseAction::Default);
    }
    fn screen() -> Area {
        Area {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
            scale: 2.0,
        }
    }
    #[test]
    fn disconnected_screen_returns_window_to_visible_work_area() {
        let b = fit_bounds(
            Some(Bounds {
                x: 9000,
                y: 9000,
                width: 480.0,
                height: 250.0,
            }),
            &[screen()],
        )
        .unwrap();
        assert!(b.x >= 0 && b.x + 960 <= 1920);
        assert!(b.y >= 0 && b.y + 500 <= 1080);
    }
    #[test]
    fn corrupt_or_oversized_dimensions_never_hide_the_controls() {
        let b = fit_bounds(
            Some(Bounds {
                x: 0,
                y: 0,
                width: f64::NAN,
                height: 99999.0,
            }),
            &[screen()],
        )
        .unwrap();
        assert_eq!(b.width, 480.0);
        assert!(b.height >= 220.0 && b.height <= 540.0);
        assert!(b.y as f64 + (b.height + 28.0) * 2.0 <= 1080.0);
    }
    #[test]
    fn collapsed_edge_tab_snaps_to_nearest_edge_and_keeps_its_own_bounds() {
        let left = fit_collapsed_bounds(
            Some(CollapsedBounds {
                x: 180,
                y: 20,
                width: 480.0,
                height: 250.0,
            }),
            CollapsedStyle::EdgeTab,
            &[screen()],
        )
        .unwrap();
        assert_eq!(
            (left.x, left.y, left.width, left.height),
            (0, 20, 48.0, 84.0)
        );
        let right = fit_collapsed_bounds(
            Some(CollapsedBounds {
                x: 1500,
                y: 1200,
                width: 80.0,
                height: 80.0,
            }),
            CollapsedStyle::EdgeTab,
            &[screen()],
        )
        .unwrap();
        assert_eq!(right.x, 1824);
        assert_eq!(right.y, 912);
    }
    #[test]
    fn cover_tile_keeps_free_position_inside_visible_work_area() {
        let tile = fit_collapsed_bounds(
            Some(CollapsedBounds {
                x: 5000,
                y: -500,
                width: 80.0,
                height: 80.0,
            }),
            CollapsedStyle::CoverTile,
            &[screen()],
        )
        .unwrap();
        assert_eq!(
            (tile.x, tile.y, tile.width, tile.height),
            (1760, 0, 80.0, 80.0)
        );
    }
    #[test]
    fn first_edge_tab_starts_partway_down_the_screen() {
        let tab = fit_collapsed_bounds(None, CollapsedStyle::EdgeTab, &[screen()]).unwrap();
        assert_eq!(tab.x, 1824);
        assert_eq!(tab.y, 360);
    }
}
