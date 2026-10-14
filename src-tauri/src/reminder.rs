use crate::db::{self, AppDb};
use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use sqlx::sqlite::SqliteRow;
use sqlx::{Pool, Row, Sqlite};
use std::collections::HashSet;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Listener, Manager};
use tauri_plugin_notification::NotificationExt;

pub const POLL_INTERVAL_SECS: u64 = 10;
pub const MISS_GRACE: Duration = Duration::minutes(2);
const QUIT_FLUSH_MS: u64 = 3000;
const NOTIFY_TITLE: &str = "タスクの期限が近づいています";

#[derive(Debug, Clone)]
struct ReminderTask {
    id: String,
    title: String,
    due_at: String,
    reminder_lead_minutes: i64,
    reminder_enabled: i64,
    reminder_sent_at: Option<String>,
    status: String,
}

#[derive(Clone, Serialize)]
struct OpenTaskPayload {
    #[serde(rename = "taskId")]
    task_id: String,
}

pub fn scheduled_at(due: DateTime<Utc>, lead_minutes: i64) -> DateTime<Utc> {
    due - Duration::minutes(lead_minutes)
}

/// Notify only when the scheduled instant is due, but not older than the grace window.
pub fn should_notify(now: DateTime<Utc>, scheduled: DateTime<Utc>, grace: Duration) -> bool {
    scheduled <= now && now.signed_duration_since(scheduled) <= grace
}

fn parse_due(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|d| d.with_timezone(&Utc))
}

pub fn show_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

fn quit_app(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = app.emit("app-quit-requested", ());
        tokio::time::sleep(std::time::Duration::from_millis(QUIT_FLUSH_MS)).await;
        app.exit(0);
    });
}

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let open_i = MenuItem::with_id(app, "open", "開く", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "終了", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_i, &quit_i])?;
    let icon: Image<'_> = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("default window icon".into()))?;

    TrayIconBuilder::new()
        .icon(icon)
        .tooltip("タスク管理")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "quit" => quit_app(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn sqlite_i64(row: &SqliteRow, col: &str) -> i64 {
    row.try_get::<i64, _>(col)
        .or_else(|_| row.try_get::<f64, _>(col).map(|v| v as i64))
        .unwrap_or(0)
}

fn row_to_task(row: &SqliteRow) -> ReminderTask {
    ReminderTask {
        id: row.get::<String, _>("id"),
        title: row.try_get::<String, _>("title").unwrap_or_default(),
        due_at: row.try_get::<String, _>("due_at").unwrap_or_default(),
        reminder_lead_minutes: {
            let n = sqlite_i64(row, "reminder_lead_minutes");
            if n > 0 { n } else { 30 }
        },
        reminder_enabled: sqlite_i64(row, "reminder_enabled"),
        reminder_sent_at: row.try_get::<Option<String>, _>("reminder_sent_at").ok().flatten(),
        status: row.try_get::<String, _>("status").unwrap_or_default(),
    }
}

fn is_eligible(task: &ReminderTask, now: DateTime<Utc>) -> bool {
    if task.reminder_enabled != 1 {
        return false;
    }
    if task.status == "DONE" {
        return false;
    }
    if task.reminder_sent_at.is_some() {
        return false;
    }
    let Some(due) = parse_due(&task.due_at) else {
        return false;
    };
    let scheduled = scheduled_at(due, task.reminder_lead_minutes);
    should_notify(now, scheduled, MISS_GRACE)
}

async fn load_candidates(pool: &Pool<Sqlite>) -> Result<Vec<ReminderTask>, String> {
    let rows = sqlx::query(
        "SELECT id, title, due_at, reminder_lead_minutes, reminder_enabled, reminder_sent_at, status
         FROM tasks
         WHERE reminder_enabled = 1
           AND due_at IS NOT NULL
           AND due_at != ''
           AND reminder_sent_at IS NULL
           AND status != 'DONE'",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows.iter().map(row_to_task).collect())
}

async fn load_task(pool: &Pool<Sqlite>, id: &str) -> Result<Option<ReminderTask>, String> {
    let row = sqlx::query(
        "SELECT id, title, due_at, reminder_lead_minutes, reminder_enabled, reminder_sent_at, status
         FROM tasks WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(row.as_ref().map(row_to_task))
}

async fn mark_sent(pool: &Pool<Sqlite>, id: &str, sent_at: &str) -> Result<(), String> {
    sqlx::query("UPDATE tasks SET reminder_sent_at = ? WHERE id = ? AND reminder_sent_at IS NULL")
        .bind(sent_at)
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn show_notification(app: &AppHandle, task_id: &str, title: &str) -> Result<(), String> {
    let body = if title.trim().is_empty() { "(無題)" } else { title };
    app.notification()
        .builder()
        .title(NOTIFY_TITLE)
        .body(body)
        .extra("task_id", task_id)
        .show()
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn open_task(app: &AppHandle, task_id: &str) {
    show_main(app);
    let _ = app.emit(
        "open-task",
        OpenTaskPayload {
            task_id: task_id.to_string(),
        },
    );
}

fn extract_task_id(payload: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(payload).ok()?;
    v.get("taskId")
        .or_else(|| v.get("task_id"))
        .or_else(|| v.get("extra").and_then(|e| e.get("task_id")))
        .or_else(|| v.get("notification").and_then(|n| n.get("extra")).and_then(|e| e.get("task_id")))
        .and_then(|x| x.as_str().map(|s| s.to_string()))
}

pub fn setup_notification_click(app: &AppHandle) {
    let handle = app.clone();
    let _id = app.listen("plugin:notification:actionPerformed", move |event| {
        if let Some(id) = extract_task_id(event.payload()) {
            open_task(&handle, &id);
        }
    });
}

async fn tick(app: &AppHandle, in_flight: &mut HashSet<String>) -> Result<(), String> {
    let db = app.state::<AppDb>();
    let Some(pool) = db.pool().await else {
        return Ok(());
    };
    let now = Utc::now();
    let candidates = load_candidates(&pool).await?;
    for task in candidates {
        if in_flight.contains(&task.id) {
            continue;
        }
        if !is_eligible(&task, now) {
            continue;
        }
        in_flight.insert(task.id.clone());
        let latest = load_task(&pool, &task.id).await?;
        let Some(latest) = latest else {
            in_flight.remove(&task.id);
            continue;
        };
        if !is_eligible(&latest, Utc::now()) {
            in_flight.remove(&task.id);
            continue;
        }
        match show_notification(app, &latest.id, &latest.title) {
            Ok(()) => {
                if let Err(e) = mark_sent(&pool, &latest.id, &Utc::now().to_rfc3339()).await {
                    log::warn!("reminder mark_sent {}: {e}", latest.id);
                }
            }
            Err(e) => {
                log::warn!("reminder notify {}: {e}", latest.id);
            }
        }
        in_flight.remove(&task.id);
    }
    Ok(())
}

pub fn spawn_poller(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(e) = db::ensure_connected(&app).await {
            log::warn!("reminder db connect: {e}");
        }
        let mut in_flight = HashSet::new();
        let mut interval =
            tokio::time::interval(std::time::Duration::from_secs(POLL_INTERVAL_SECS));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            if let Err(e) = db::ensure_connected(&app).await {
                log::warn!("reminder db connect: {e}");
                continue;
            }
            if let Err(e) = tick(&app, &mut in_flight).await {
                log::warn!("reminder tick: {e}");
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notifies_inside_grace_window() {
        let due = DateTime::parse_from_rfc3339("2026-10-14T03:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let scheduled = scheduled_at(due, 30);
        let now = scheduled + Duration::seconds(30);
        assert!(should_notify(now, scheduled, MISS_GRACE));
    }

    #[test]
    fn skips_future_and_stale() {
        let due = DateTime::parse_from_rfc3339("2026-10-14T03:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let scheduled = scheduled_at(due, 30);
        assert!(!should_notify(scheduled - Duration::seconds(1), scheduled, MISS_GRACE));
        assert!(!should_notify(
            scheduled + Duration::minutes(3),
            scheduled,
            MISS_GRACE
        ));
    }
}
