use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let migrations = vec![
    Migration {
      version: 1,
      description: "init schema",
      sql: include_str!("../migrations/001_init.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 2,
      description: "add console_end_date",
      sql: include_str!("../migrations/002_add_console_end_date.sql"),
      kind: MigrationKind::Up,
    },
  ];

  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_window_state::Builder::default().build())
    .plugin(tauri_plugin_store::Builder::default().build())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(
      tauri_plugin_sql::Builder::default()
        .add_migrations("sqlite:tasks.db", migrations)
        .build(),
    )
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
