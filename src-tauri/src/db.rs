use serde_json::Value;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::{Column, Pool, Row, Sqlite, ValueRef};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

const MIGRATION_001: &str = include_str!("../migrations/001_init.sql");
const MIGRATION_002: &str = include_str!("../migrations/002_add_console_end_date.sql");
const MIGRATION_003: &str = include_str!("../migrations/003_add_category_color.sql");
const MIGRATION_004: &str = include_str!("../migrations/004_add_project_hidden.sql");

pub struct AppDb(Mutex<Option<Pool<Sqlite>>>);

impl AppDb {
    pub fn new() -> Self {
        Self(Mutex::new(None))
    }
}

fn resolve_db_path(app: &AppHandle, custom_dir: Option<String>) -> Result<PathBuf, String> {
    if let Some(dir) = custom_dir {
        let path = PathBuf::from(dir);
        std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
        Ok(path.join("tasks.db"))
    } else {
        let config = app.path().app_config_dir().map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&config).map_err(|e| e.to_string())?;
        Ok(config.join("tasks.db"))
    }
}

async fn run_sql_script(pool: &Pool<Sqlite>, script: &str) -> Result<(), String> {
    for stmt in script.split(';') {
        let s = stmt.trim();
        if !s.is_empty() {
            sqlx::query(s)
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

async fn column_exists(pool: &Pool<Sqlite>, table: &str, column: &str) -> Result<bool, String> {
    // pragma_table_info はテーブル名のバインドが使えないため、許可リストのみ受け付ける
    if table != "tasks" && table != "categories" && table != "projects" && table != "activities" {
        return Err(format!("invalid table: {table}"));
    }
    let sql = format!("SELECT count(*) FROM pragma_table_info('{table}') WHERE name = ?");
    let count: (i64,) = sqlx::query_as(&sql)
        .bind(column)
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(count.0 > 0)
}

async fn run_migrations(pool: &Pool<Sqlite>) -> Result<(), String> {
    run_sql_script(pool, MIGRATION_001).await?;

    if !column_exists(pool, "tasks", "console_end_date").await? {
        run_sql_script(pool, MIGRATION_002).await?;
    }

    if !column_exists(pool, "categories", "color").await? {
        run_sql_script(pool, MIGRATION_003).await?;
    }

    if !column_exists(pool, "projects", "hidden").await? {
        run_sql_script(pool, MIGRATION_004).await?;
    }

    Ok(())
}

fn bind_value<'q>(
    query: sqlx::query::Query<'q, Sqlite, sqlx::sqlite::SqliteArguments<'q>>,
    value: Value,
) -> sqlx::query::Query<'q, Sqlite, sqlx::sqlite::SqliteArguments<'q>> {
    if value.is_null() {
        query.bind(None::<String>)
    } else if let Some(s) = value.as_str() {
        query.bind(s.to_owned())
    } else if let Some(n) = value.as_number() {
        query.bind(n.as_f64().unwrap_or_default())
    } else {
        query.bind(value)
    }
}

#[tauri::command]
pub async fn app_db_connect(
    app: AppHandle,
    db: State<'_, AppDb>,
    custom_dir: Option<String>,
) -> Result<String, String> {
    let db_path = resolve_db_path(&app, custom_dir)?;
    let conn_url = format!("sqlite:{}", db_path.to_string_lossy().replace('\\', "/"));

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(&conn_url)
        .await
        .map_err(|e| e.to_string())?;

    run_migrations(&pool).await?;

    let path_str = db_path.to_string_lossy().to_string();
    *db.0.lock().await = Some(pool);
    Ok(path_str)
}

#[tauri::command]
pub async fn app_db_close(db: State<'_, AppDb>) -> Result<(), String> {
    if let Some(pool) = db.0.lock().await.take() {
        pool.close().await;
    }
    Ok(())
}

#[tauri::command]
pub async fn app_db_execute(
    db: State<'_, AppDb>,
    query: String,
    values: Vec<Value>,
) -> Result<(u64, i64), String> {
    let guard = db.0.lock().await;
    let pool = guard.as_ref().ok_or("Database not connected")?;

    let mut q = sqlx::query(&query);
    for value in values {
        q = bind_value(q, value);
    }
    let result = q.execute(pool).await.map_err(|e| e.to_string())?;
    Ok((result.rows_affected(), result.last_insert_rowid()))
}

#[tauri::command]
pub async fn app_db_select(
    db: State<'_, AppDb>,
    query: String,
    values: Vec<Value>,
) -> Result<Vec<HashMap<String, Value>>, String> {
    let guard = db.0.lock().await;
    let pool = guard.as_ref().ok_or("Database not connected")?;

    let mut q = sqlx::query(&query);
    for value in values {
        q = bind_value(q, value);
    }
    let rows = q.fetch_all(pool).await.map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows {
        let mut map = HashMap::new();
        for (i, column) in row.columns().iter().enumerate() {
            let value: Value = match row.try_get_raw(i) {
                Ok(raw) => {
                    if raw.is_null() {
                        Value::Null
                    } else if let Ok(v) = row.try_get::<String, _>(i) {
                        Value::String(v)
                    } else if let Ok(v) = row.try_get::<i64, _>(i) {
                        Value::Number(v.into())
                    } else if let Ok(v) = row.try_get::<f64, _>(i) {
                        serde_json::Number::from_f64(v)
                            .map(Value::Number)
                            .unwrap_or(Value::Null)
                    } else {
                        Value::Null
                    }
                }
                Err(_) => Value::Null,
            };
            map.insert(column.name().to_string(), value);
        }
        results.push(map);
    }

    Ok(results)
}
