use chrono::{Local, Utc};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
  collections::HashMap,
  fs,
  path::{Path, PathBuf},
  time::Instant,
};
use tauri::{
  menu::{
    AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu, HELP_SUBMENU_ID,
    WINDOW_SUBMENU_ID,
  },
  Emitter, Runtime, WebviewUrl, WebviewWindowBuilder,
};
use uuid::Uuid;
use walkdir::WalkDir;

const NEW_WINDOW_MENU_ID: &str = "new-window";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileNode {
  name: String,
  path: String,
  is_dir: bool,
  is_environment: bool,
  method: Option<String>,
  children: Vec<FileNode>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendSettings {
  follow_redirects: bool,
  verify_ssl: bool,
  timeout_ms: u64,
  proxy: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Timing {
  dns_ms: u64,
  connect_ms: u64,
  tls_ms: u64,
  ttfb_ms: u64,
  download_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HttpResponse {
  status_code: u16,
  status_text: String,
  headers: HashMap<String, String>,
  body: String,
  time_ms: u64,
  size_bytes: usize,
  timing: Timing,
}

#[derive(Debug, Serialize)]
struct ParsedHeader {
  key: String,
  value: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ParsedCurl {
  method: String,
  url: String,
  headers: Vec<ParsedHeader>,
  body: Value,
  auth: Value,
  settings: Value,
}

fn tand_dir() -> Result<PathBuf, String> {
  let home = dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string())?;
  let dir = home.join(".tand");
  fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  Ok(dir)
}

fn config_path() -> Result<PathBuf, String> {
  Ok(tand_dir()?.join("config.json"))
}

fn history_dir() -> Result<PathBuf, String> {
  let dir = tand_dir()?.join("history");
  fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  Ok(dir)
}

fn normalize_name(name: &str) -> String {
  let mut out = name
    .trim()
    .to_lowercase()
    .chars()
    .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
    .collect::<String>();
  while out.contains("--") {
    out = out.replace("--", "-");
  }
  out = out.trim_matches('-').to_string();
  if out.ends_with(".json") {
    out
  } else {
    format!("{out}.json")
  }
}

fn request_method(path: &Path) -> Option<String> {
  let text = fs::read_to_string(path).ok()?;
  let value: Value = serde_json::from_str(&text).ok()?;
  value
    .pointer("/request/method")
    .and_then(Value::as_str)
    .map(str::to_uppercase)
}

fn list_node(path: &Path, root: &Path) -> Result<FileNode, String> {
  let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
  let is_dir = metadata.is_dir();
  let name = path
    .file_name()
    .map(|s| s.to_string_lossy().to_string())
    .unwrap_or_else(|| root.to_string_lossy().to_string());
  let is_environment = path
    .components()
    .any(|c| c.as_os_str().to_string_lossy() == "environments");

  let mut children = Vec::new();
  if is_dir {
    let mut entries = fs::read_dir(path)
      .map_err(|e| e.to_string())?
      .filter_map(Result::ok)
      .map(|entry| entry.path())
      .filter(|entry_path| {
        if entry_path.is_dir() {
          return true;
        }
        entry_path
          .extension()
          .is_some_and(|ext| ext.to_string_lossy().eq_ignore_ascii_case("json"))
      })
      .collect::<Vec<_>>();
    entries.sort_by(|a, b| match (a.is_dir(), b.is_dir()) {
      (true, false) => std::cmp::Ordering::Less,
      (false, true) => std::cmp::Ordering::Greater,
      _ => a.file_name().cmp(&b.file_name()),
    });

    for child in entries {
      children.push(list_node(&child, root)?);
    }
  }

  Ok(FileNode {
    name,
    path: path.to_string_lossy().to_string(),
    is_dir,
    is_environment,
    method: if is_dir { None } else { request_method(path) },
    children,
  })
}

fn default_request(name: &str) -> Value {
  let now = Utc::now().to_rfc3339();
  json!({
    "$schema": "https://flare-app.dev/schema/request/v1.json",
    "name": name,
    "request": {
      "method": "GET",
      "url": "",
      "params": [],
      "headers": [],
      "body": { "type": "none", "content": null },
      "auth": { "type": "none" },
      "settings": {
        "followRedirects": true,
        "verifySsl": true,
        "timeoutMs": 30000,
        "proxy": null
      }
    },
    "meta": {
      "description": "",
      "tags": [],
      "createdAt": now,
      "updatedAt": now
    }
  })
}

#[tauri::command]
fn open_folder_dialog() -> Result<Option<String>, String> {
  Ok(
    rfd::FileDialog::new()
      .pick_folder()
      .map(|path| path.to_string_lossy().to_string()),
  )
}

#[tauri::command]
fn list_directory(path: String) -> Result<Vec<FileNode>, String> {
  let root = PathBuf::from(path);
  let node = list_node(&root, &root)?;
  Ok(node.children)
}

#[tauri::command]
fn read_request_file(path: String) -> Result<Value, String> {
  let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
  serde_json::from_str(&text).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_request_file(path: String, content: Value) -> Result<(), String> {
  let mut content = content;
  if let Some(meta) = content.get_mut("meta").and_then(Value::as_object_mut) {
    meta.insert("updatedAt".to_string(), json!(Utc::now().to_rfc3339()));
  }
  let text = serde_json::to_string_pretty(&content).map_err(|e| e.to_string())?;
  fs::write(path, text).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_request_file(folder_path: String, name: String) -> Result<String, String> {
  fs::create_dir_all(&folder_path).map_err(|e| e.to_string())?;
  let file_name = normalize_name(&name);
  let path = PathBuf::from(folder_path).join(&file_name);
  let display_name = file_name.trim_end_matches(".json").replace('-', " ");
  let text = serde_json::to_string_pretty(&default_request(&display_name)).map_err(|e| e.to_string())?;
  fs::write(&path, text).map_err(|e| e.to_string())?;
  Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
  let path = PathBuf::from(path);
  if path.is_dir() {
    fs::remove_dir_all(path).map_err(|e| e.to_string())
  } else {
    fs::remove_file(path).map_err(|e| e.to_string())
  }
}

#[tauri::command]
fn rename_file(old_path: String, new_path: String) -> Result<(), String> {
  fs::rename(old_path, new_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn move_file(source_path: String, dest_path: String) -> Result<(), String> {
  fs::rename(source_path, dest_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_directory(path: String) -> Result<(), String> {
  fs::create_dir_all(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn watch_directory(app: tauri::AppHandle, path: String) -> Result<(), String> {
  app
    .emit("file-tree-changed", json!({ "path": path }))
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn open_new_window(app: tauri::AppHandle) -> Result<String, String> {
  create_scratch_window(&app)
}

fn create_scratch_window<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<String, String> {
  let label = format!("tand-{}", Uuid::new_v4());
  WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
    .title("tand")
    .inner_size(1280.0, 820.0)
    .min_inner_size(960.0, 640.0)
    .decorations(true)
    .focused(true)
    .initialization_script("window.__TAND_FRESH_WINDOW__ = true;")
    .build()
    .map_err(|e| e.to_string())?;
  Ok(label)
}

fn build_app_menu<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
  let pkg_info = app.package_info();
  let config = app.config();
  let about_metadata = AboutMetadata {
    name: Some(pkg_info.name.clone()),
    version: Some(pkg_info.version.to_string()),
    copyright: config.bundle.copyright.clone(),
    authors: config.bundle.publisher.clone().map(|p| vec![p]),
    ..Default::default()
  };
  let new_window = MenuItem::with_id(app, NEW_WINDOW_MENU_ID, "New Window", true, Some("CmdOrCtrl+Shift+N"))?;

  let window_menu = Submenu::with_id_and_items(
    app,
    WINDOW_SUBMENU_ID,
    "Window",
    true,
    &[
      &PredefinedMenuItem::minimize(app, None)?,
      &PredefinedMenuItem::maximize(app, None)?,
      #[cfg(target_os = "macos")]
      &PredefinedMenuItem::separator(app)?,
      &PredefinedMenuItem::close_window(app, None)?,
    ],
  )?;

  let help_menu = Submenu::with_id_and_items(
    app,
    HELP_SUBMENU_ID,
    "Help",
    true,
    &[
      #[cfg(not(target_os = "macos"))]
      &PredefinedMenuItem::about(app, None, Some(about_metadata.clone()))?,
    ],
  )?;

  Menu::with_items(
    app,
    &[
      #[cfg(target_os = "macos")]
      &Submenu::with_items(
        app,
        pkg_info.name.clone(),
        true,
        &[
          &PredefinedMenuItem::about(app, None, Some(about_metadata))?,
          &PredefinedMenuItem::separator(app)?,
          &PredefinedMenuItem::services(app, None)?,
          &PredefinedMenuItem::separator(app)?,
          &PredefinedMenuItem::hide(app, None)?,
          &PredefinedMenuItem::hide_others(app, None)?,
          &PredefinedMenuItem::separator(app)?,
          &PredefinedMenuItem::quit(app, None)?,
        ],
      )?,
      &Submenu::with_items(
        app,
        "File",
        true,
        &[
          &new_window,
          &PredefinedMenuItem::separator(app)?,
          &PredefinedMenuItem::close_window(app, None)?,
          #[cfg(not(target_os = "macos"))]
          &PredefinedMenuItem::quit(app, None)?,
        ],
      )?,
      &Submenu::with_items(
        app,
        "Edit",
        true,
        &[
          &PredefinedMenuItem::undo(app, None)?,
          &PredefinedMenuItem::redo(app, None)?,
          &PredefinedMenuItem::separator(app)?,
          &PredefinedMenuItem::cut(app, None)?,
          &PredefinedMenuItem::copy(app, None)?,
          &PredefinedMenuItem::paste(app, None)?,
          &PredefinedMenuItem::select_all(app, None)?,
        ],
      )?,
      #[cfg(target_os = "macos")]
      &Submenu::with_items(app, "View", true, &[&PredefinedMenuItem::fullscreen(app, None)?])?,
      &window_menu,
      &help_menu,
    ],
  )
}

#[tauri::command]
fn read_config() -> Result<Value, String> {
  let path = config_path()?;
  if !path.exists() {
    return Ok(json!({
      "version": 1,
      "recentFolders": [],
      "lastOpenedFolder": null,
      "lastActiveFile": null,
      "lastEnvironment": null,
      "theme": "dark",
      "layout": {
        "leftPanelWidth": 240,
        "rightPanelWidth": 400,
        "leftPanelCollapsed": false,
        "rightPanelCollapsed": false
      },
      "history": { "maxEntries": 500 },
      "editor": { "fontSize": 13, "wordWrap": false }
    }));
  }
  let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
  serde_json::from_str(&text).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_config(config: Value) -> Result<(), String> {
  let text = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
  fs::write(config_path()?, text).map_err(|e| e.to_string())
}

#[tauri::command]
async fn send_request(
  method: String,
  url: String,
  headers: HashMap<String, String>,
  body: Option<String>,
  settings: SendSettings,
) -> Result<HttpResponse, String> {
  let redirect = if settings.follow_redirects {
    reqwest::redirect::Policy::limited(10)
  } else {
    reqwest::redirect::Policy::none()
  };
  let mut builder = reqwest::Client::builder()
    .redirect(redirect)
    .danger_accept_invalid_certs(!settings.verify_ssl)
    .timeout(std::time::Duration::from_millis(settings.timeout_ms.max(1)));
  if let Some(proxy) = settings.proxy.filter(|p| !p.trim().is_empty()) {
    builder = builder.proxy(reqwest::Proxy::all(proxy).map_err(|e| e.to_string())?);
  }
  let client = builder.build().map_err(|e| e.to_string())?;
  let req_method = method.parse::<reqwest::Method>().map_err(|e| e.to_string())?;
  let mut request = client.request(req_method, &url);

  let mut header_map = HeaderMap::new();
  for (key, value) in headers {
    let name = HeaderName::from_bytes(key.as_bytes()).map_err(|e| e.to_string())?;
    let value = HeaderValue::from_str(&value).map_err(|e| e.to_string())?;
    header_map.insert(name, value);
  }
  request = request.headers(header_map);
  if let Some(body) = body {
    request = request.body(body);
  }

  let start = Instant::now();
  let response = request.send().await.map_err(|e| e.to_string())?;
  let status = response.status();
  let headers = response
    .headers()
    .iter()
    .map(|(key, value)| {
      (
        key.as_str().to_string(),
        value.to_str().unwrap_or("").to_string(),
      )
    })
    .collect::<HashMap<_, _>>();
  let bytes = response.bytes().await.map_err(|e| e.to_string())?;
  let total = start.elapsed().as_millis() as u64;
  let size_bytes = bytes.len();
  let body = String::from_utf8_lossy(&bytes).to_string();

  Ok(HttpResponse {
    status_code: status.as_u16(),
    status_text: status.canonical_reason().unwrap_or("").to_string(),
    headers,
    body,
    time_ms: total,
    size_bytes,
    timing: Timing {
      dns_ms: 0,
      connect_ms: 0,
      tls_ms: 0,
      ttfb_ms: total,
      download_ms: 0,
    },
  })
}

#[tauri::command]
fn save_history(entry: Value) -> Result<(), String> {
  let date = Local::now().format("%Y-%m-%d").to_string();
  let path = history_dir()?.join(format!("{date}.json"));
  let mut entries = if path.exists() {
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str::<Vec<Value>>(&text).unwrap_or_default()
  } else {
    Vec::new()
  };
  let mut entry = entry;
  if entry.get("id").is_none() {
    entry["id"] = json!(Uuid::new_v4().to_string());
  }
  entries.insert(0, entry);
  if entries.len() > 500 {
    entries.truncate(500);
  }
  fs::write(path, serde_json::to_string_pretty(&entries).map_err(|e| e.to_string())?)
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn load_history(page: usize, limit: usize, filter: Option<Value>) -> Result<Vec<Value>, String> {
  let query = filter
    .and_then(|v| v.get("query").and_then(Value::as_str).map(str::to_lowercase))
    .unwrap_or_default();
  let mut files = fs::read_dir(history_dir()?)
    .map_err(|e| e.to_string())?
    .filter_map(Result::ok)
    .map(|entry| entry.path())
    .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
    .collect::<Vec<_>>();
  files.sort_by(|a, b| b.file_name().cmp(&a.file_name()));

  let mut all = Vec::new();
  for path in files {
    let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut entries = serde_json::from_str::<Vec<Value>>(&text).unwrap_or_default();
    all.append(&mut entries);
  }
  if !query.is_empty() {
    all.retain(|entry| entry.to_string().to_lowercase().contains(&query));
  }
  let start = page.saturating_mul(limit);
  Ok(all.into_iter().skip(start).take(limit).collect())
}

#[tauri::command]
fn delete_history_entry(id: String) -> Result<(), String> {
  for entry in WalkDir::new(history_dir()?).min_depth(1).max_depth(1) {
    let path = entry.map_err(|e| e.to_string())?.path().to_path_buf();
    if path.extension().is_none_or(|ext| ext != "json") {
      continue;
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut entries = serde_json::from_str::<Vec<Value>>(&text).unwrap_or_default();
    let before = entries.len();
    entries.retain(|entry| entry.get("id").and_then(Value::as_str) != Some(&id));
    if entries.len() != before {
      fs::write(path, serde_json::to_string_pretty(&entries).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    }
  }
  Ok(())
}

#[tauri::command]
fn clear_history() -> Result<(), String> {
  for entry in WalkDir::new(history_dir()?).min_depth(1).max_depth(1) {
    let path = entry.map_err(|e| e.to_string())?.path().to_path_buf();
    if path.extension().is_some_and(|ext| ext == "json") {
      fs::remove_file(path).map_err(|e| e.to_string())?;
    }
  }
  Ok(())
}

#[tauri::command]
fn parse_curl(curl_string: String) -> Result<ParsedCurl, String> {
  let cleaned = curl_string.replace("\\\n", " ");
  let mut tokens = shell_words::split(&cleaned).map_err(|e| e.to_string())?;
  if tokens.first().is_some_and(|token| token == "curl") {
    tokens.remove(0);
  }

  let mut method: Option<String> = None;
  let mut url = String::new();
  let mut headers = Vec::new();
  let mut data_parts = Vec::new();
  let mut form_data = Vec::new();
  let mut urlencoded = Vec::new();
  let mut auth = json!({ "type": "none" });
  let mut follow_redirects = false;
  let mut i = 0;

  while i < tokens.len() {
    let token = &tokens[i];
    let next = |idx: usize, tokens: &Vec<String>| -> Result<String, String> {
      tokens
        .get(idx + 1)
        .cloned()
        .ok_or_else(|| format!("Missing value after {}", tokens[idx]))
    };

    match token.as_str() {
      "-X" | "--request" => {
        method = Some(next(i, &tokens)?.to_uppercase());
        i += 2;
      }
      "-H" | "--header" => {
        let header = next(i, &tokens)?;
        if let Some((key, value)) = header.split_once(':') {
          headers.push(ParsedHeader {
            key: key.trim().to_string(),
            value: value.trim().to_string(),
          });
        }
        i += 2;
      }
      "-d" | "--data" | "--data-raw" | "--data-binary" => {
        data_parts.push(next(i, &tokens)?);
        i += 2;
      }
      "-F" | "--form" => {
        let part = next(i, &tokens)?;
        if let Some((key, value)) = part.split_once('=') {
          form_data.push(json!({
            "enabled": true,
            "key": key,
            "value": value.trim_start_matches('@'),
            "type": if value.starts_with('@') { "file" } else { "text" },
            "description": ""
          }));
        }
        i += 2;
      }
      "--data-urlencode" => {
        let part = next(i, &tokens)?;
        if let Some((key, value)) = part.split_once('=') {
          urlencoded.push(json!({
            "enabled": true,
            "key": key,
            "value": value,
            "description": ""
          }));
        }
        i += 2;
      }
      "-u" | "--user" => {
        let value = next(i, &tokens)?;
        let (username, password) = value.split_once(':').unwrap_or((value.as_str(), ""));
        auth = json!({ "type": "basic", "username": username, "password": password });
        i += 2;
      }
      "-L" | "--location" => {
        follow_redirects = true;
        i += 1;
      }
      "--compressed" | "-s" | "--silent" => i += 1,
      value if value.starts_with("--request=") => {
        method = Some(value.trim_start_matches("--request=").to_uppercase());
        i += 1;
      }
      value if value.starts_with("--header=") => {
        let header = value.trim_start_matches("--header=");
        if let Some((key, value)) = header.split_once(':') {
          headers.push(ParsedHeader {
            key: key.trim().to_string(),
            value: value.trim().to_string(),
          });
        }
        i += 1;
      }
      value if value.starts_with('-') => {
        i += 1;
      }
      value => {
        if url.is_empty() {
          url = value.to_string();
        }
        i += 1;
      }
    }
  }

  let body = if !form_data.is_empty() {
    method.get_or_insert_with(|| "POST".to_string());
    json!({ "type": "form-data", "content": form_data })
  } else if !urlencoded.is_empty() {
    method.get_or_insert_with(|| "POST".to_string());
    json!({ "type": "form-urlencoded", "content": urlencoded })
  } else if !data_parts.is_empty() {
    method.get_or_insert_with(|| "POST".to_string());
    let content = data_parts.join("&");
    let content_type = headers
      .iter()
      .find(|h| h.key.eq_ignore_ascii_case("content-type"))
      .map(|h| h.value.to_lowercase())
      .unwrap_or_default();
    if content_type.contains("json") || content.trim_start().starts_with('{') || content.trim_start().starts_with('[') {
      json!({ "type": "json", "content": content })
    } else {
      json!({ "type": "raw", "contentType": "text/plain", "content": content })
    }
  } else {
    json!({ "type": "none", "content": null })
  };

  if url.is_empty() {
    return Err("Could not find a URL in the cURL command".to_string());
  }

  Ok(ParsedCurl {
    method: method.unwrap_or_else(|| "GET".to_string()),
    url,
    headers,
    body,
    auth,
    settings: json!({ "followRedirects": follow_redirects }),
  })
}

pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      let menu = build_app_menu(app.handle())?;
      app.set_menu(menu)?;
      Ok(())
    })
    .on_menu_event(|app, event| {
      if event.id().as_ref() == NEW_WINDOW_MENU_ID {
        let _ = create_scratch_window(app);
      }
    })
    .invoke_handler(tauri::generate_handler![
      open_folder_dialog,
      list_directory,
      read_request_file,
      write_request_file,
      create_request_file,
      delete_file,
      rename_file,
      move_file,
      create_directory,
      watch_directory,
      open_new_window,
      read_config,
      write_config,
      send_request,
      save_history,
      load_history,
      delete_history_entry,
      clear_history,
      parse_curl
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
