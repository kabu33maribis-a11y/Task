mod db;
mod reminder;

use db::AppDb;
use tauri_plugin_window_state::StateFlags;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_notification::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      reminder::setup_tray(app.handle())?;
      reminder::spawn_poller(app.handle().clone());
      Ok(())
    })
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(
      tauri_plugin_window_state::Builder::default()
        .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
        .build(),
    )
    .plugin(tauri_plugin_store::Builder::default().build())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .manage(AppDb::new())
    .invoke_handler(tauri::generate_handler![
      db::app_db_connect,
      db::app_db_execute,
      db::app_db_select,
      db::app_db_close,
      reminder::set_desktop_notifications_enabled,
      reminder::set_start_lead_minutes,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
