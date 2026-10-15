use crate::db::{self, AppDb};
use chrono::{DateTime, Duration, Local, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc};
use serde::Serialize;
use sqlx::sqlite::SqliteRow;
use sqlx::{Pool, Row, Sqlite};
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_store::StoreExt;

static DESKTOP_NOTIFICATIONS_ENABLED: AtomicBool = AtomicBool::new(true);
static START_LEAD_MINUTES: AtomicI64 = AtomicI64::new(DEFAULT_START_LEAD_MINUTES);
const DESKTOP_NOTIF_STORE_KEY: &str = "desktopNotifications";
const START_LEAD_STORE_KEY: &str = "startLeadMinutes";

pub const POLL_INTERVAL_SECS: u64 = 10;
pub const MISS_GRACE: Duration = Duration::minutes(2);
/// Default lead for start-time notifications (separate from due-at reminders).
pub const DEFAULT_START_LEAD_MINUTES: i64 = 30;
const LEAD_CHOICES: [i64; 6] = [1, 5, 15, 30, 60, 1440];
const QUIT_FLUSH_MS: u64 = 3000;
const DUE_NOTIFY_TITLE: &str = "タスクの期限が近づいています";
const START_NOTIFY_TITLE: &str = "タスクの開始が近づいています";

#[derive(Debug, Clone)]
struct DueReminderTask {
    id: String,
    title: String,
    due_at: String,
    reminder_lead_minutes: i64,
    reminder_enabled: i64,
    reminder_sent_at: Option<String>,
    status: String,
}

#[derive(Debug, Clone)]
struct StartReminderTask {
    id: String,
    title: String,
    start_date: Option<String>,
    scheduled_date: Option<String>,
    start_time: Option<String>,
    start_reminder_sent_at: Option<String>,
    status: String,
}

#[derive(Clone, Serialize)]
struct OpenTaskPayload {
    #[serde(rename = "taskId")]
    task_id: String,
}

#[derive(Clone, Serialize)]
struct InboxNotification {
    id: String,
    #[serde(rename = "taskId")]
    task_id: String,
    title: String,
    body: String,
    #[serde(rename = "createdAt")]
    created_at: String,
}

fn desktop_notifications_enabled() -> bool {
    DESKTOP_NOTIFICATIONS_ENABLED.load(Ordering::Relaxed)
}

fn sanitize_lead_minutes(minutes: i64) -> i64 {
    if LEAD_CHOICES.contains(&minutes) {
        minutes
    } else {
        DEFAULT_START_LEAD_MINUTES
    }
}

fn start_lead_minutes() -> i64 {
    sanitize_lead_minutes(START_LEAD_MINUTES.load(Ordering::Relaxed))
}

fn persist_desktop_notifications_pref(app: &AppHandle, enabled: bool) {
    if let Ok(store) = app.store("config.json") {
        store.set(DESKTOP_NOTIF_STORE_KEY, serde_json::Value::Bool(enabled));
        let _ = store.save();
    }
}

pub fn load_desktop_notifications_pref(app: &AppHandle) {
    let store = app.store("config.json").ok();
    let enabled = store
        .as_ref()
        .and_then(|store| store.get(DESKTOP_NOTIF_STORE_KEY))
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    DESKTOP_NOTIFICATIONS_ENABLED.store(enabled, Ordering::Relaxed);
    let minutes = store
        .as_ref()
        .and_then(|store| store.get(START_LEAD_STORE_KEY))
        .and_then(|v| v.as_i64())
        .unwrap_or(DEFAULT_START_LEAD_MINUTES);
    START_LEAD_MINUTES.store(sanitize_lead_minutes(minutes), Ordering::Relaxed);
}

#[tauri::command]
pub fn set_desktop_notifications_enabled(app: AppHandle, enabled: bool) {
    DESKTOP_NOTIFICATIONS_ENABLED.store(enabled, Ordering::Relaxed);
    persist_desktop_notifications_pref(&app, enabled);
}

#[tauri::command]
pub fn set_start_lead_minutes(app: AppHandle, minutes: i64) {
    let minutes = sanitize_lead_minutes(minutes);
    START_LEAD_MINUTES.store(minutes, Ordering::Relaxed);
    if let Ok(store) = app.store("config.json") {
        store.set(START_LEAD_STORE_KEY, serde_json::Value::from(minutes));
        let _ = store.save();
    }
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

fn nonempty(s: &Option<String>) -> Option<&str> {
    s.as_deref().map(str::trim).filter(|v| !v.is_empty())
}

fn parse_naive_time(time: &str) -> Option<NaiveTime> {
    let t = time.trim();
    NaiveTime::parse_from_str(t, "%H:%M:%S")
        .or_else(|_| NaiveTime::parse_from_str(t, "%H:%M"))
        .ok()
}

/// Combine local calendar date + wall-clock time into UTC.
pub fn parse_local_start(date: &str, time: &str) -> Option<DateTime<Utc>> {
    let d = NaiveDate::parse_from_str(date.trim(), "%Y-%m-%d").ok()?;
    let t = parse_naive_time(time)?;
    let ndt = NaiveDateTime::new(d, t);
    Local
        .from_local_datetime(&ndt)
        .single()
        .map(|dt| dt.with_timezone(&Utc))
}

fn start_instant(task: &StartReminderTask) -> Option<DateTime<Utc>> {
    let date = nonempty(&task.start_date).or_else(|| nonempty(&task.scheduled_date))?;
    let time = nonempty(&task.start_time)?;
    parse_local_start(date, time)
}

pub fn show_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
        // Toast callbacks often cannot steal foreground focus on Windows.
        let _ = win.set_always_on_top(true);
        let _ = win.set_always_on_top(false);
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

fn opt_string(row: &SqliteRow, col: &str) -> Option<String> {
    row.try_get::<Option<String>, _>(col)
        .ok()
        .flatten()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn row_to_due_task(row: &SqliteRow) -> DueReminderTask {
    DueReminderTask {
        id: row.get::<String, _>("id"),
        title: row.try_get::<String, _>("title").unwrap_or_default(),
        due_at: row.try_get::<String, _>("due_at").unwrap_or_default(),
        reminder_lead_minutes: {
            let n = sqlite_i64(row, "reminder_lead_minutes");
            if n > 0 { n } else { 30 }
        },
        reminder_enabled: sqlite_i64(row, "reminder_enabled"),
        reminder_sent_at: opt_string(row, "reminder_sent_at"),
        status: row.try_get::<String, _>("status").unwrap_or_default(),
    }
}

fn row_to_start_task(row: &SqliteRow) -> StartReminderTask {
    StartReminderTask {
        id: row.get::<String, _>("id"),
        title: row.try_get::<String, _>("title").unwrap_or_default(),
        start_date: opt_string(row, "start_date"),
        scheduled_date: opt_string(row, "scheduled_date"),
        start_time: opt_string(row, "start_time"),
        start_reminder_sent_at: opt_string(row, "start_reminder_sent_at"),
        status: row.try_get::<String, _>("status").unwrap_or_default(),
    }
}

fn is_due_eligible(task: &DueReminderTask, now: DateTime<Utc>) -> bool {
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

fn is_start_eligible(task: &StartReminderTask, now: DateTime<Utc>) -> bool {
    if task.status == "DONE" {
        return false;
    }
    if task.start_reminder_sent_at.is_some() {
        return false;
    }
    let Some(start) = start_instant(task) else {
        return false;
    };
    let scheduled = scheduled_at(start, start_lead_minutes());
    should_notify(now, scheduled, MISS_GRACE)
}

async fn load_due_candidates(pool: &Pool<Sqlite>) -> Result<Vec<DueReminderTask>, String> {
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
    Ok(rows.iter().map(row_to_due_task).collect())
}

async fn load_due_task(pool: &Pool<Sqlite>, id: &str) -> Result<Option<DueReminderTask>, String> {
    let row = sqlx::query(
        "SELECT id, title, due_at, reminder_lead_minutes, reminder_enabled, reminder_sent_at, status
         FROM tasks WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(row.as_ref().map(row_to_due_task))
}

async fn load_start_candidates(pool: &Pool<Sqlite>) -> Result<Vec<StartReminderTask>, String> {
    let rows = sqlx::query(
        "SELECT id, title, start_date, scheduled_date, start_time, start_reminder_sent_at, status
         FROM tasks
         WHERE start_time IS NOT NULL
           AND TRIM(start_time) != ''
           AND start_reminder_sent_at IS NULL
           AND status != 'DONE'
           AND (
             (start_date IS NOT NULL AND TRIM(start_date) != '')
             OR (scheduled_date IS NOT NULL AND TRIM(scheduled_date) != '')
           )",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows.iter().map(row_to_start_task).collect())
}

async fn load_start_task(pool: &Pool<Sqlite>, id: &str) -> Result<Option<StartReminderTask>, String> {
    let row = sqlx::query(
        "SELECT id, title, start_date, scheduled_date, start_time, start_reminder_sent_at, status
         FROM tasks WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(row.as_ref().map(row_to_start_task))
}

async fn mark_due_sent(pool: &Pool<Sqlite>, id: &str, sent_at: &str) -> Result<(), String> {
    sqlx::query("UPDATE tasks SET reminder_sent_at = ? WHERE id = ? AND reminder_sent_at IS NULL")
        .bind(sent_at)
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

async fn mark_start_sent(pool: &Pool<Sqlite>, id: &str, sent_at: &str) -> Result<(), String> {
    sqlx::query(
        "UPDATE tasks SET start_reminder_sent_at = ? WHERE id = ? AND start_reminder_sent_at IS NULL",
    )
    .bind(sent_at)
    .bind(id)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn notification_body(title: &str) -> String {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        "(無題)".to_string()
    } else {
        trimmed.to_string()
    }
}

fn next_notification_id(task_id: &str) -> String {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    format!("n_{}_{seq}_{task_id}", Utc::now().timestamp_millis())
}

#[cfg(windows)]
fn apply_windows_app_id(app: &AppHandle, notification: &mut notify_rust::Notification) {
    let Ok(exe) = tauri::utils::platform::current_exe() else {
        return;
    };
    let Some(dir) = exe.parent().map(|p| p.display().to_string()) else {
        return;
    };
    let sep = std::path::MAIN_SEPARATOR;
    let debug = format!("{sep}target{sep}debug");
    let release = format!("{sep}target{sep}release");
    if dir.ends_with(&debug) || dir.ends_with(&release) {
        return;
    }
    notification.app_id(app.config().identifier.as_ref());
}

fn show_notification(app: &AppHandle, task_id: &str, title: &str, body: &str) -> Result<(), String> {
    let mut notification = notify_rust::Notification::new();
    notification.summary(title).body(body);
    // Stay until dismissed so a body click is reported (Short toasts can expire first).
    notification.timeout(notify_rust::Timeout::Never);
    notification.urgency(notify_rust::Urgency::Critical);
    #[cfg(windows)]
    apply_windows_app_id(app, &mut notification);

    let handle = notification.show().map_err(|e| e.to_string())?;
    let app = app.clone();
    let task_id = task_id.to_string();
    std::thread::Builder::new()
        .name("notification-click".into())
        .spawn(move || {
            // Windows body-click is Default. wait_for_action maps that to "__closed".
            let _ = handle.wait_for_response(|response: &notify_rust::NotificationResponse| {
                match response {
                    notify_rust::NotificationResponse::Default
                    | notify_rust::NotificationResponse::Action(_) => open_task(&app, &task_id),
                    _ => {}
                }
            });
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

async fn record_notification(
    pool: &Pool<Sqlite>,
    app: &AppHandle,
    task_id: &str,
    title: &str,
    body: &str,
) -> Result<(), String> {
    let created_at = Utc::now().to_rfc3339();
    let id = next_notification_id(task_id);
    sqlx::query(
        "INSERT INTO app_notifications (id, task_id, title, body, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(task_id)
    .bind(title)
    .bind(body)
    .bind(&created_at)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    let _ = app.emit(
        "app-notification",
        InboxNotification {
            id,
            task_id: task_id.to_string(),
            title: title.to_string(),
            body: body.to_string(),
            created_at,
        },
    );
    Ok(())
}

async fn deliver(
    app: &AppHandle,
    pool: &Pool<Sqlite>,
    task_id: &str,
    task_title: &str,
    notify_title: &str,
) -> Result<(), String> {
    let body = notification_body(task_title);
    show_notification(app, task_id, notify_title, &body)?;
    if let Err(e) = record_notification(pool, app, task_id, notify_title, &body).await {
        log::warn!("reminder record {task_id}: {e}");
    }
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

async fn tick_due(
    app: &AppHandle,
    pool: &Pool<Sqlite>,
    in_flight: &mut HashSet<String>,
) -> Result<(), String> {
    let now = Utc::now();
    let candidates = load_due_candidates(pool).await?;
    for task in candidates {
        let key = format!("due:{}", task.id);
        if in_flight.contains(&key) {
            continue;
        }
        if !is_due_eligible(&task, now) {
            continue;
        }
        if !desktop_notifications_enabled() {
            continue;
        }
        in_flight.insert(key.clone());
        let latest = load_due_task(pool, &task.id).await?;
        let Some(latest) = latest else {
            in_flight.remove(&key);
            continue;
        };
        if !is_due_eligible(&latest, Utc::now()) || !desktop_notifications_enabled() {
            in_flight.remove(&key);
            continue;
        }
        match deliver(app, pool, &latest.id, &latest.title, DUE_NOTIFY_TITLE).await {
            Ok(()) => {
                if let Err(e) = mark_due_sent(pool, &latest.id, &Utc::now().to_rfc3339()).await {
                    log::warn!("reminder mark_sent {}: {e}", latest.id);
                }
            }
            Err(e) => log::warn!("reminder notify {}: {e}", latest.id),
        }
        in_flight.remove(&key);
    }
    Ok(())
}

async fn tick_start(
    app: &AppHandle,
    pool: &Pool<Sqlite>,
    in_flight: &mut HashSet<String>,
) -> Result<(), String> {
    let now = Utc::now();
    let candidates = load_start_candidates(pool).await?;
    for task in candidates {
        let key = format!("start:{}", task.id);
        if in_flight.contains(&key) {
            continue;
        }
        if !is_start_eligible(&task, now) {
            continue;
        }
        if !desktop_notifications_enabled() {
            continue;
        }
        in_flight.insert(key.clone());
        let latest = load_start_task(pool, &task.id).await?;
        let Some(latest) = latest else {
            in_flight.remove(&key);
            continue;
        };
        if !is_start_eligible(&latest, Utc::now()) || !desktop_notifications_enabled() {
            in_flight.remove(&key);
            continue;
        }
        match deliver(app, pool, &latest.id, &latest.title, START_NOTIFY_TITLE).await {
            Ok(()) => {
                if let Err(e) = mark_start_sent(pool, &latest.id, &Utc::now().to_rfc3339()).await {
                    log::warn!("start reminder mark_sent {}: {e}", latest.id);
                }
            }
            Err(e) => log::warn!("start reminder notify {}: {e}", latest.id),
        }
        in_flight.remove(&key);
    }
    Ok(())
}

async fn tick(app: &AppHandle, in_flight: &mut HashSet<String>) -> Result<(), String> {
    let db = app.state::<AppDb>();
    let Some(pool) = db.pool().await else {
        return Ok(());
    };
    tick_due(app, &pool, in_flight).await?;
    tick_start(app, &pool, in_flight).await?;
    Ok(())
}

pub fn spawn_poller(app: AppHandle) {
    load_desktop_notifications_pref(&app);
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

    #[test]
    fn parses_local_start_hhmm() {
        let start = parse_local_start("2026-10-14", "10:30").expect("parse");
        let back = start.with_timezone(&Local);
        assert_eq!(back.format("%Y-%m-%d %H:%M").to_string(), "2026-10-14 10:30");
    }

    #[test]
    fn sanitizes_unknown_lead() {
        assert_eq!(sanitize_lead_minutes(15), 15);
        assert_eq!(sanitize_lead_minutes(1440), 1440);
        assert_eq!(sanitize_lead_minutes(0), DEFAULT_START_LEAD_MINUTES);
        assert_eq!(sanitize_lead_minutes(7), DEFAULT_START_LEAD_MINUTES);
    }

    #[test]
    fn start_eligible_requires_time() {
        let task = StartReminderTask {
            id: "t1".into(),
            title: "x".into(),
            start_date: Some("2026-10-14".into()),
            scheduled_date: None,
            start_time: None,
            start_reminder_sent_at: None,
            status: "TODO".into(),
        };
        assert!(!is_start_eligible(&task, Utc::now()));
    }
}
