# SPEC.md — Flare API Client

> File-based API Testing Desktop Application
> Stack: Tauri v2 + Rust + React + TypeScript + Zustand + Monaco Editor

---

## 1. Overview

**Flare** is a lightweight, file-based API client desktop application for macOS and Windows. The core philosophy is: **every request is a `.json` file on disk**. There is no database, no cloud sync, no proprietary format. Open a folder → see your API files → click to test.

### Design Philosophy

- IDE-like feel (similar to VSCode layout)
- File-first: source of truth is always the `.json` file on disk
- Fast: sub-100ms startup, minimal RAM usage (~30–60MB)
- No internet required, fully offline
- No account, no login, no telemetry

---

## 2. Technology Stack

### Desktop Framework

- **Tauri v2** — Rust backend + system WebView (no bundled Chromium)
- Target platforms: macOS (ARM + Intel), Windows (x64)

### Frontend

- **React 18** + **TypeScript**
- **Zustand** — global state management
- **Monaco Editor** — for JSON body editor, response viewer, cURL import
- **TanStack Query** (optional) — for async state if needed
- **Tailwind CSS** — styling
- **Lucide React** — icons
- **react-arborist** or custom — file tree component

### Backend (Rust / Tauri Commands)

- `tauri::command` handlers for:
  - File system operations (read, write, watch)
  - HTTP requests (using `reqwest` crate)
  - cURL parsing
  - History storage

### HTTP Client

- Rust `reqwest` (async) — handles all HTTP calls from Rust process, **no CORS issues**

---

## 3. Application Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  [Toolbar] Open Folder | Environment Selector | Settings         │
├──────────────┬──────────────────────────────┬───────────────────┤
│              │                              │                   │
│  LEFT PANEL  │      CENTER PANEL            │   RIGHT PANEL     │
│  File Tree   │      Request Editor          │   Response        │
│  (240px)     │      (flex-grow)             │   Viewer (400px)  │
│              │                              │                   │
│              │                              │                   │
└──────────────┴──────────────────────────────┴───────────────────┘
│  [Status Bar] Method | URL | Status Code | Time | Size          │
└─────────────────────────────────────────────────────────────────┘
```

### Panel Behavior

- All three panels are **resizable** via drag handles
- Left panel can be **collapsed** (toggle with `Cmd+B` / `Ctrl+B`)
- Right panel can be **collapsed** (toggle with `Cmd+Shift+R` / `Ctrl+Shift+R`)
- Layout state is persisted in `~/.flare/layout.json`
- Minimum widths: Left=180px, Center=400px, Right=300px

---

## 4. Left Panel — File Tree

### Behavior

- Displays the **folder opened by the user** as a file tree
- Shows **only `.json` files** and **subdirectories** (hide other file types)
- Subdirectories act as **collection groups** (like folders in Postman)
- Each `.json` file is a **single API request**
- **File watcher** (Rust `notify` crate) — auto-refreshes tree if files are added/removed/renamed externally

### Visual Design

- Dark sidebar (similar to VSCode Explorer)
- File icons: show HTTP method badge (GET=green, POST=blue, PUT=orange, DELETE=red, PATCH=yellow) — read from JSON content, not just filename
- Active/selected file highlighted
- Hover reveals context menu icon

### Context Menu (right-click on file)

- **Open** — open in center panel
- **Rename** — inline rename (renames actual file)
- **Duplicate** — copies file with `_copy` suffix
- **Delete** — confirmation dialog, deletes actual file
- **Copy path** — copies absolute file path to clipboard
- **Reveal in Finder/Explorer** — opens OS file manager at file location

### Context Menu (right-click on folder)

- **New Request** — creates new `.json` file in this folder (opens name dialog)
- **New Folder** — creates subfolder
- **Rename Folder**
- **Delete Folder** — confirmation, recursive delete

### Toolbar above file tree

- 🗁 **New Request** button — creates file in root or last active folder
- 📁 **New Folder** button
- 🔍 **Search** — filter file tree by filename in real-time

### Drag & Drop

- Files can be dragged between folders (moves actual file on disk)
- Visual drop indicator

### Empty State

- If no folder opened: show centered message with "Open Folder" button
- If folder is empty: show message with "Create your first request" button

---

## 5. Toolbar (Top Bar)

```
[☰ Flare]  [Open Folder: ~/projects/my-api ▾]  [Env: Production ▾]  [History]  [Settings ⚙]
```

### Open Folder

- Button shows current folder name (truncated if long)
- Click → opens OS native folder picker dialog (`tauri::dialog::open`)
- Recent folders dropdown (last 5 folders), stored in `~/.flare/config.json`
- Keyboard shortcut: `Cmd+Shift+O` / `Ctrl+Shift+O`

### Environment Selector

- Dropdown showing available environments defined in `env.json` (see Section 9)
- Shows: "No Environment" if no env.json found
- "Edit Environments" option at bottom → opens Environment Editor modal
- Active environment name shown in toolbar

### History Button

- Opens History panel (slide-in from right, overlapping response panel)

### Settings

- Opens Settings modal

---

## 6. Center Panel — Request Editor

This is the **most critical panel**. Must feel as polished as Bruno/Postman.

### 6.1 Request URL Bar

```
┌──────────────────────────────────────────────────────────────────┐
│ [GET ▾]  [https://{{BASE_URL}}/api/users/{{userId}}         ] [Send] │
└──────────────────────────────────────────────────────────────────┘
```

#### Method Selector

- Dropdown: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`
- Color-coded: GET=green, POST=blue, PUT=orange, PATCH=yellow, DELETE=red, HEAD/OPTIONS=gray

#### URL Input

- Full-width text input
- **Variable highlighting**: `{{variableName}}` rendered with colored highlight/pill inline
  - If variable exists in active environment → highlight in green/teal
  - If variable NOT found → highlight in red/orange (visual warning)
  - Autocomplete dropdown when typing `{{` — shows available variables from active env
- **URL parsing**: when URL changes, auto-parse query params and sync to Params tab below
- Placeholder: `Enter URL or paste cURL`

#### Send Button

- Primary action button
- While loading: shows spinner + "Cancel" option
- Keyboard shortcut: `Cmd+Enter` / `Ctrl+Enter`

#### cURL Import

- User can **paste a cURL command directly into the URL bar**
- App detects if input starts with `curl ` → auto-parses:
  - Extracts URL
  - Extracts method (`-X POST`)
  - Extracts headers (`-H "..."`)
  - Extracts body (`-d '...'` or `--data-raw`)
  - Extracts auth headers
  - Populates all fields accordingly
  - Shows toast: "Imported from cURL ✓"
- Also available via: right-click URL bar → "Paste as cURL" or `Cmd+Shift+V`

### 6.2 Request Tabs

Below the URL bar, tabs for request configuration:

```
[Params] [Headers] [Body] [Auth] [Pre-Request] [Settings]
```

#### Tab: Params

- Table with columns: `☐ | Key | Value | Description`
- Checkbox to enable/disable individual params (disabled params not sent)
- Add row button at bottom
- Editing a param row automatically updates the URL query string in the URL bar (bidirectional sync)
- Parsing URL query string automatically populates this table
- Rows support `{{variable}}` in Value column — highlighted same as URL bar
- Bulk edit mode: toggle to raw `key=value&key2=value2` text
- Delete row: trash icon on hover

#### Tab: Headers

- Same table structure as Params: `☐ | Key | Value | Description`
- Common headers autocomplete: typing in Key field shows suggestions (`Content-Type`, `Authorization`, `Accept`, `X-Request-ID`, etc.)
- Values support `{{variable}}` interpolation with same highlighting
- Checkbox to enable/disable rows
- Pre-populated row hints: if body type is JSON, show suggested `Content-Type: application/json`

#### Tab: Body

- Radio selector at top: `None | JSON | Form Data | Form URL-encoded | Raw | Binary`

**JSON mode** (default for POST/PUT/PATCH):

- **Monaco Editor** instance
- Full JSON syntax highlighting and validation
- Format/Prettify button (Cmd+Shift+F)
- Collapse/expand JSON nodes
- Line numbers shown
- Error indicator for invalid JSON
- `{{variable}}` support: highlighted inside strings

**Form Data** (multipart/form-data):

- Table: `☐ | Key | Value/File | Type (text/file) | Description`
- File type rows: show file picker button
- Text type rows: support `{{variable}}`

**Form URL-encoded**:

- Same table as Params tab
- Encoded automatically on send

**Raw**:

- Monaco Editor
- Content-Type selector: `text/plain`, `application/xml`, `application/javascript`, etc.

**None**:

- Empty state message (no body sent)

#### Tab: Auth

Auth type selector:

- **No Auth**
- **Bearer Token**: single input field for token, supports `{{variable}}`
  - Auto-adds `Authorization: Bearer <token>` header on send
- **Basic Auth**: Username + Password fields, supports `{{variable}}`
  - Auto-adds `Authorization: Basic <base64>` header on send
- **API Key**: Key name + Value + location (Header or Query Param)
- **Custom** — manually add via Headers tab

#### Tab: Pre-Request (Basic — no JS sandbox)

- Simple key-value overrides before sending:
  - Set/Override headers
  - Set/Override environment variables temporarily for this request
- Text area for notes/comments about this request
- (Advanced JS scripting is **out of scope for v1**)

#### Tab: Settings (per-request)

- **Follow Redirects**: toggle (default: on)
- **SSL Verification**: toggle (default: on) — allow disabling for self-signed certs
- **Timeout**: number input in milliseconds (default: 30000)
- **Proxy**: optional proxy URL for this request

### 6.3 Save Behavior

- Changes in the editor are **auto-saved to the `.json` file** after 500ms debounce
- Visual indicator: dot on tab/filename when unsaved (like VSCode)
- `Cmd+S` / `Ctrl+S` — force save immediately
- On first "New Request" before choosing a folder: prompt to choose save location

---

## 7. Right Panel — Response Viewer

Shown after request is sent.

### 7.1 Response Status Bar (top of panel)

```
[200 OK]  [142ms]  [1.24 KB]  [Copy Response] [Save to File]
```

- Status code color: 2xx=green, 3xx=blue, 4xx=orange, 5xx=red
- Response time in ms
- Response size in KB/MB
- Copy full response body to clipboard
- Save response to file

### 7.2 Response Tabs

```
[Body] [Headers] [Cookies] [Timeline]
```

#### Tab: Body

- **Auto-detect format** from `Content-Type` response header
- **JSON**: Monaco Editor (read-only), pretty-printed, collapsible nodes, search (`Cmd+F`)
- **HTML**: rendered preview toggle (show raw or rendered)
- **XML**: syntax-highlighted in Monaco
- **Plain text**: simple text display
- **Image**: rendered inline (png, jpg, svg, gif)
- **Binary**: show hex dump or download prompt

Search in response: `Cmd+F` opens Monaco find panel

#### Tab: Headers

- Table showing all response headers
- Copy individual header value on click
- Sorted alphabetically, collapsible groups

#### Tab: Cookies

- Table: `Name | Value | Domain | Path | Expires | Secure | HttpOnly`
- Cookies are **not persisted** between requests (stateless, v1)

#### Tab: Timeline

- Visual waterfall showing:
  - DNS lookup time
  - TCP connect time
  - TLS handshake time (if HTTPS)
  - Time to first byte (TTFB)
  - Download time
- Total time highlighted

### 7.3 Empty State

- Before first request sent: show centered message "Send a request to see the response"

---

## 8. JSON File Format (`.json` request file)

Every request is stored as a single `.json` file. This is the canonical format.

```json
{
  "$schema": "https://flare-app.dev/schema/request/v1.json",
  "name": "Get User Profile",
  "request": {
    "method": "GET",
    "url": "{{BASE_URL}}/api/users/{{userId}}",
    "params": [
      {
        "enabled": true,
        "key": "include",
        "value": "avatar,settings",
        "description": "Fields to include"
      }
    ],
    "headers": [
      {
        "enabled": true,
        "key": "Authorization",
        "value": "Bearer {{ACCESS_TOKEN}}",
        "description": ""
      },
      {
        "enabled": true,
        "key": "Content-Type",
        "value": "application/json",
        "description": ""
      }
    ],
    "body": {
      "type": "none",
      "content": null
    },
    "auth": {
      "type": "bearer",
      "token": "{{ACCESS_TOKEN}}"
    },
    "settings": {
      "followRedirects": true,
      "verifySsl": true,
      "timeoutMs": 30000,
      "proxy": null
    }
  },
  "meta": {
    "description": "Fetch a user by their ID. Requires authentication.",
    "tags": ["user", "profile"],
    "createdAt": "2025-01-01T00:00:00Z",
    "updatedAt": "2025-05-19T00:00:00Z"
  }
}
```

### Body type examples

**JSON body**:

```json
"body": {
  "type": "json",
  "content": "{\"name\": \"John\", \"email\": \"{{USER_EMAIL}}\"}"
}
```

**Form Data**:

```json
"body": {
  "type": "form-data",
  "content": [
    { "enabled": true, "key": "name", "value": "John", "type": "text" },
    { "enabled": true, "key": "avatar", "value": "/path/to/file.png", "type": "file" }
  ]
}
```

**Form URL-encoded**:

```json
"body": {
  "type": "form-urlencoded",
  "content": [
    { "enabled": true, "key": "grant_type", "value": "client_credentials" }
  ]
}
```

**Raw**:

```json
"body": {
  "type": "raw",
  "contentType": "application/xml",
  "content": "<root><item>value</item></root>"
}
```

### File Naming Convention

- Filename is used as display label if `name` field is missing
- Recommended: `kebab-case.json` (e.g., `get-user-profile.json`, `create-order.json`)
- No spaces in filenames enforced — spaces auto-replaced with `-` on create

---

## 9. Environment Variables

### File Location

- Each project folder can have an `environments/` subfolder
- Inside: one `.json` file per environment
  - `environments/local.json`
  - `environments/staging.json`
  - `environments/production.json`
- This folder is **shown in the file tree** but with a special icon (🌍), and clicking an env file opens the Environment Editor, not the request editor

### Environment File Format

```json
{
  "name": "Production",
  "variables": [
    {
      "key": "BASE_URL",
      "value": "https://api.example.com",
      "enabled": true,
      "secret": false
    },
    {
      "key": "ACCESS_TOKEN",
      "value": "prod-token-xxx",
      "enabled": true,
      "secret": true
    },
    { "key": "userId", "value": "12345", "enabled": true, "secret": false }
  ]
}
```

### Secret Variables

- `"secret": true` → value shown as `••••••••` in the UI
- Reveal button (eye icon) to temporarily show
- Secret values are **never** written to response history in plain text

### Variable Interpolation

- Before sending request, all `{{variableName}}` placeholders in:
  - URL
  - Query params (values)
  - Headers (values)
  - Body (JSON string values, raw text)
  - Auth fields
- Are replaced with values from the **active environment**
- If variable not found: send `{{variableName}}` as-is, show warning in status bar

### Environment Editor Modal

- Table: `Key | Value | Secret | Enabled | Delete`
- Add new variable button
- Import from `.env` file button (parses standard `.env` format, populates table)
- Export to `.env` file
- Duplicate environment button

---

## 10. History

### Storage

- Stored in `~/.flare/history/` as dated JSON files: `2025-05-19.json`
- Each entry contains:

```json
{
  "id": "uuid-v4",
  "timestamp": "2025-05-19T10:30:00Z",
  "request": {
    "method": "POST",
    "url": "https://api.example.com/users",
    "resolvedUrl": "https://api.example.com/users",
    "headers": { "Content-Type": "application/json" },
    "body": "{\"name\":\"John\"}"
  },
  "response": {
    "statusCode": 201,
    "statusText": "Created",
    "headers": { "content-type": "application/json" },
    "body": "{\"id\":\"abc123\",\"name\":\"John\"}",
    "timeMs": 142,
    "sizeBytes": 1270
  },
  "environment": "Production",
  "sourceFile": "~/projects/my-api/users/create-user.json"
}
```

### History Panel UI

- Slide-in panel from right (overlaps response panel)
- List grouped by **date** (Today, Yesterday, Older)
- Each row: `[Method badge] [URL truncated] [Status] [Time]`
- Click row → loads request + response into view (read-only replay view)
- "Re-send" button on each history item
- "Load into Editor" button → opens source file and populates editor with that request
- Search/filter by URL, method, status code
- Delete individual entries
- Clear all history option

### History Limits

- Keep last 500 entries (auto-prune oldest)
- Configurable in Settings (100 / 500 / 1000 / unlimited)

---

## 11. cURL Import — Detailed Spec

This is a **first-class feature**, must work reliably.

### Trigger Methods

1. Paste cURL text into URL bar (auto-detect)
2. `Cmd+Shift+V` / `Ctrl+Shift+V` — "Paste as cURL" anywhere in app
3. File menu → "Import from cURL"

### Parser Must Handle

```bash
# Basic GET
curl https://api.example.com/users

# Method
curl -X POST https://api.example.com/users
curl --request DELETE https://api.example.com/users/123

# Headers
curl -H "Authorization: Bearer token123" \
     -H "Content-Type: application/json" \
     https://api.example.com/users

# JSON body
curl -X POST https://api.example.com/users \
     -H "Content-Type: application/json" \
     -d '{"name":"John","email":"john@example.com"}'

# --data-raw
curl -X POST https://api.example.com/users \
     --data-raw '{"name":"John"}'

# Form data
curl -X POST https://api.example.com/upload \
     -F "name=John" \
     -F "file=@/path/to/file.png"

# URL-encoded
curl -X POST https://api.example.com/login \
     --data-urlencode "username=john" \
     --data-urlencode "password=secret"

# Query params (in URL)
curl "https://api.example.com/search?q=test&page=1"

# Basic auth
curl -u username:password https://api.example.com/secure

# Follow redirects
curl -L https://api.example.com/redirect

# Compressed
curl --compressed https://api.example.com/data

# Custom method with no body
curl -X OPTIONS https://api.example.com/users

# Multiline with backslash continuation
curl -X POST \
  https://api.example.com/users \
  -H 'Authorization: Bearer token' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "John"
  }'
```

### After Import

- Show diff of what was parsed (method, URL, N headers, body type) as a brief toast
- All fields populated in editor
- File NOT auto-saved — user must save manually (or auto-save kicks in after 500ms)

### Copy as cURL

- "Copy as cURL" button in request editor (top right area)
- Generates valid cURL command from current request state
- Variables are resolved using active environment before generating cURL
- Option: copy with resolved values OR with `{{placeholders}}`

---

## 12. Variable Highlighting in Editor — Detailed Spec

Critical UX feature. Must work exactly as described.

### In URL Input

- Parse `{{...}}` tokens in real-time as user types
- Render as inline colored chips/highlights:
  - **Resolved** (exists in active env): teal/green background highlight
  - **Unresolved** (not in env): orange/red background highlight, tooltip "Variable not found in active environment"
- Autocomplete: type `{{` → dropdown appears with all available variables in active env
  - Fuzzy search as user continues typing
  - Press Enter or Tab to complete
  - Escape to dismiss

### In Headers Table (Value column)

- Same `{{variable}}` detection and coloring
- Inline in the table cell

### In Params Table (Value column)

- Same as headers

### In Body (Monaco Editor)

- Custom Monaco token provider to highlight `{{variableName}}` inside JSON string values
- Resolved: green underline or highlight
- Unresolved: orange/yellow underline
- Monaco hover: show "Resolves to: `actual-value`" tooltip on hover over variable

### In Auth Fields

- Same highlighting as URL input

### Variable Resolution Preview

- Small "Preview" toggle above URL bar
- When active: shows the URL with all `{{variables}}` replaced by actual values (read-only preview text below the URL bar)

---

## 13. Keyboard Shortcuts

| Action             | macOS         | Windows        |
| ------------------ | ------------- | -------------- |
| Send Request       | `Cmd+Enter`   | `Ctrl+Enter`   |
| Save File          | `Cmd+S`       | `Ctrl+S`       |
| New Request        | `Cmd+N`       | `Ctrl+N`       |
| Open Folder        | `Cmd+Shift+O` | `Ctrl+Shift+O` |
| Toggle Left Panel  | `Cmd+B`       | `Ctrl+B`       |
| Toggle Right Panel | `Cmd+Shift+R` | `Ctrl+Shift+R` |
| Paste as cURL      | `Cmd+Shift+V` | `Ctrl+Shift+V` |
| Format Body JSON   | `Cmd+Shift+F` | `Ctrl+Shift+F` |
| Focus URL Bar      | `Cmd+L`       | `Ctrl+L`       |
| Open History       | `Cmd+H`       | `Ctrl+H`       |
| Search Files       | `Cmd+P`       | `Ctrl+P`       |
| Find in Response   | `Cmd+F`       | `Ctrl+F`       |
| Cancel Request     | `Escape`      | `Escape`       |

---

## 14. Project File Structure (on disk)

```
~/my-api-project/
├── environments/
│   ├── local.json
│   ├── staging.json
│   └── production.json
├── users/
│   ├── get-all-users.json
│   ├── get-user-by-id.json
│   ├── create-user.json
│   └── delete-user.json
├── auth/
│   ├── login.json
│   ├── refresh-token.json
│   └── logout.json
├── orders/
│   ├── create-order.json
│   └── get-order-status.json
└── health-check.json
```

---

## 15. App Configuration

### Location

`~/.flare/config.json`

```json
{
  "version": 1,
  "recentFolders": [
    { "path": "~/projects/my-api", "lastOpened": "2025-05-19T10:00:00Z" },
    { "path": "~/projects/another-api", "lastOpened": "2025-05-18T09:00:00Z" }
  ],
  "lastOpenedFolder": "~/projects/my-api",
  "lastActiveFile": "~/projects/my-api/users/get-user-by-id.json",
  "lastEnvironment": "staging",
  "theme": "dark",
  "layout": {
    "leftPanelWidth": 240,
    "rightPanelWidth": 400,
    "leftPanelCollapsed": false,
    "rightPanelCollapsed": false
  },
  "history": {
    "maxEntries": 500
  },
  "editor": {
    "fontSize": 13,
    "wordWrap": false
  }
}
```

---

## 16. Tauri Commands (Rust Backend API)

All HTTP and filesystem operations run in Rust. Frontend calls these via `invoke()`.

### File System Commands

```typescript
// Open native folder picker dialog
invoke('open_folder_dialog'): Promise<string | null>

// List files in directory (returns tree structure)
invoke('list_directory', { path: string }): Promise<FileNode[]>

// Read request file
invoke('read_request_file', { path: string }): Promise<RequestFile>

// Write/save request file
invoke('write_request_file', { path: string, content: RequestFile }): Promise<void>

// Create new request file
invoke('create_request_file', { folderPath: string, name: string }): Promise<string>

// Delete file
invoke('delete_file', { path: string }): Promise<void>

// Rename file
invoke('rename_file', { oldPath: string, newPath: string }): Promise<void>

// Move file
invoke('move_file', { sourcePath: string, destPath: string }): Promise<void>

// Create directory
invoke('create_directory', { path: string }): Promise<void>

// Watch directory for changes (emits events)
invoke('watch_directory', { path: string }): Promise<void>
// → emits Tauri event: "file-tree-changed"

// Read app config
invoke('read_config'): Promise<AppConfig>

// Write app config
invoke('write_config', { config: AppConfig }): Promise<void>
```

### HTTP Commands

```typescript
// Send HTTP request
invoke('send_request', {
  method: string,          // "GET" | "POST" | etc.
  url: string,             // fully resolved URL (variables already replaced by frontend)
  headers: Record<string, string>,
  body: string | null,     // serialized body string
  settings: {
    followRedirects: boolean,
    verifySsl: boolean,
    timeoutMs: number,
    proxy: string | null
  }
}): Promise<HttpResponse>

// Response type
interface HttpResponse {
  statusCode: number
  statusText: string
  headers: Record<string, string>
  body: string              // raw body string (frontend formats it)
  timeMs: number
  sizeBytes: number
  timing: {
    dnsMs: number
    connectMs: number
    tlsMs: number
    ttfbMs: number
    downloadMs: number
  }
}
```

### History Commands

```typescript
// Save history entry
invoke('save_history', { entry: HistoryEntry }): Promise<void>

// Load history (paginated)
invoke('load_history', { page: number, limit: number, filter?: HistoryFilter }): Promise<HistoryEntry[]>

// Delete history entry
invoke('delete_history_entry', { id: string }): Promise<void>

// Clear all history
invoke('clear_history'): Promise<void>
```

### cURL Parser Command

```typescript
// Parse cURL string into request object (done in Rust for reliability)
invoke('parse_curl', { curlString: string }): Promise<ParsedCurl>

interface ParsedCurl {
  method: string
  url: string
  headers: Array<{ key: string, value: string }>
  body: {
    type: 'none' | 'json' | 'form-data' | 'form-urlencoded' | 'raw'
    content: any
  }
  auth: {
    type: 'none' | 'basic'
    username?: string
    password?: string
  }
  settings: {
    followRedirects: boolean
  }
}
```

---

## 17. Frontend State (Zustand)

```typescript
interface AppState {
  // Workspace
  openFolderPath: string | null;
  fileTree: FileNode[];
  activeFilePath: string | null;

  // Request Editor
  activeRequest: RequestFile | null;
  isDirty: boolean; // unsaved changes
  isSending: boolean;

  // Response
  lastResponse: HttpResponse | null;

  // Environment
  environments: Environment[];
  activeEnvironmentName: string | null;

  // History
  history: HistoryEntry[];
  isHistoryOpen: boolean;

  // UI State
  leftPanelWidth: number;
  rightPanelWidth: number;
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;

  // Actions
  openFolder: (path: string) => void;
  selectFile: (path: string) => void;
  updateRequest: (patch: Partial<RequestFile>) => void;
  saveRequest: () => void;
  sendRequest: () => void;
  cancelRequest: () => void;
  setActiveEnvironment: (name: string) => void;
  resolveVariables: (text: string) => string;
  importCurl: (curlString: string) => void;
}
```

---

## 18. Variable Resolution Logic (Frontend)

```typescript
// Core function — called before every send and for preview
function resolveVariables(text: string, env: Environment): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (match, varName) => {
    const variable = env.variables.find(
      (v) => v.key === varName.trim() && v.enabled,
    );
    return variable ? variable.value : match; // keep {{placeholder}} if not found
  });
}

// Get list of all {{variables}} in a string
function extractVariables(text: string): string[] {
  const matches = text.matchAll(/\{\{([^}]+)\}\}/g);
  return [...matches].map((m) => m[1].trim());
}

// Check if variable exists in active environment
function isVariableResolved(varName: string, env: Environment): boolean {
  return env.variables.some((v) => v.key === varName && v.enabled);
}
```

Resolution order before sending:

1. Collect all variables from: URL, params values, header values, body content, auth fields
2. Replace all with active environment values
3. Log any unresolved variables as warnings in status bar
4. Send resolved request

---

## 19. Error Handling

### Network Errors

- Connection refused: "Could not connect to server. Is it running?"
- Timeout: "Request timed out after {X}ms"
- SSL error: "SSL certificate verification failed. Disable SSL check in request settings?"
- DNS failure: "Could not resolve hostname"
- All shown in Response panel with helpful message (not raw error)

### File Errors

- File not found (deleted externally): toast notification, remove from tree
- Permission denied: dialog with explanation
- Invalid JSON in request file: show error in editor, don't crash

### cURL Parse Errors

- "Could not parse cURL command" with specific reason
- Show what was successfully parsed (partial import)

---

## 20. Theme

- **Dark theme only for v1** (no light mode)
- Color palette (CSS variables):
  ```css
  --bg-primary: #0d0d0d; /* main background */
  --bg-secondary: #141414; /* panels */
  --bg-tertiary: #1a1a1a; /* inputs, editors */
  --bg-hover: #222222;
  --border: #2a2a2a;
  --text-primary: #e8e8e8;
  --text-secondary: #888888;
  --text-muted: #555555;
  --accent: #3b82f6; /* blue — primary actions */
  --success: #22c55e; /* green — GET, 2xx */
  --warning: #f59e0b; /* orange — PUT, 4xx */
  --danger: #ef4444; /* red — DELETE, 5xx */
  --info: #3b82f6; /* blue — POST, 3xx */
  --patch: #eab308; /* yellow — PATCH */
  --var-resolved: #0d9488; /* teal — resolved {{variable}} */
  --var-unresolved: #f97316; /* orange — unresolved {{variable}} */
  ```

---

## 21. Project Structure (Codebase)

```
flare/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   ├── commands/
│   │   │   ├── fs.rs          # file system commands
│   │   │   ├── http.rs        # HTTP request sending (reqwest)
│   │   │   ├── history.rs     # history CRUD
│   │   │   └── curl.rs        # cURL parser
│   │   └── models/
│   │       ├── request.rs
│   │       ├── response.rs
│   │       └── history.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── store/
│   │   └── appStore.ts        # Zustand store
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppLayout.tsx
│   │   │   ├── Toolbar.tsx
│   │   │   ├── StatusBar.tsx
│   │   │   └── ResizeHandle.tsx
│   │   ├── file-tree/
│   │   │   ├── FileTree.tsx
│   │   │   ├── FileTreeNode.tsx
│   │   │   ├── FileTreeToolbar.tsx
│   │   │   └── ContextMenu.tsx
│   │   ├── request-editor/
│   │   │   ├── RequestEditor.tsx
│   │   │   ├── UrlBar.tsx
│   │   │   ├── MethodSelector.tsx
│   │   │   ├── SendButton.tsx
│   │   │   ├── tabs/
│   │   │   │   ├── ParamsTab.tsx
│   │   │   │   ├── HeadersTab.tsx
│   │   │   │   ├── BodyTab.tsx
│   │   │   │   ├── AuthTab.tsx
│   │   │   │   └── RequestSettingsTab.tsx
│   │   │   ├── KeyValueTable.tsx
│   │   │   ├── VariableInput.tsx  # input with {{var}} highlighting
│   │   │   └── CurlImporter.tsx
│   │   ├── response-viewer/
│   │   │   ├── ResponseViewer.tsx
│   │   │   ├── ResponseStatusBar.tsx
│   │   │   ├── tabs/
│   │   │   │   ├── ResponseBodyTab.tsx
│   │   │   │   ├── ResponseHeadersTab.tsx
│   │   │   │   ├── CookiesTab.tsx
│   │   │   │   └── TimelineTab.tsx
│   │   │   └── TimingWaterfall.tsx
│   │   ├── environment/
│   │   │   ├── EnvironmentSelector.tsx
│   │   │   └── EnvironmentEditor.tsx
│   │   └── history/
│   │       ├── HistoryPanel.tsx
│   │       └── HistoryItem.tsx
│   ├── hooks/
│   │   ├── useVariableResolver.ts
│   │   ├── useFileWatcher.ts
│   │   ├── useAutoSave.ts
│   │   └── useCurlParser.ts
│   ├── utils/
│   │   ├── variables.ts       # resolveVariables, extractVariables
│   │   ├── requestBuilder.ts  # build final request from state
│   │   └── fileFormat.ts      # serialize/deserialize .json files
│   └── types/
│       ├── request.ts
│       ├── response.ts
│       ├── environment.ts
│       └── history.ts
├── package.json
├── tailwind.config.ts
├── tsconfig.json
└── vite.config.ts
```

---

## 22. MVP Scope (v1.0)

### ✅ Must Have

- Open folder, file tree with watch
- Read/write `.json` request files
- Full request editor (URL, Params, Headers, Body, Auth, Settings tabs)
- `{{variable}}` interpolation with visual highlighting
- Autocomplete for variables when typing `{{`
- cURL import (paste into URL bar or keyboard shortcut)
- Copy as cURL
- Response viewer (Body, Headers, Cookies, Timeline tabs)
- Environment files (multiple environments, switch via toolbar)
- Secret variable masking
- Request history (local file storage)
- Dark theme
- Keyboard shortcuts
- Auto-save with debounce

### ❌ Out of Scope (v1)

- Light theme
- Cloud sync
- Team collaboration
- Pre-request JS scripts
- Test assertions
- WebSocket / GraphQL
- Import from Postman/OpenAPI (nice to have v2)
- Plugin system
- Proxy configuration UI (advanced)

---

## 23. Rust Dependencies (Cargo.toml)

```toml
[dependencies]
tauri = { version = "2", features = ["dialog", "fs", "path"] }
tauri-plugin-dialog = "2"
tauri-plugin-fs = "2"
tauri-plugin-shell = "2"
reqwest = { version = "0.12", features = ["json", "multipart", "cookies"] }
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
notify = "6"          # file watcher
uuid = { version = "1", features = ["v4"] }
chrono = { version = "0.4", features = ["serde"] }
anyhow = "1"
```

## 24. Frontend Dependencies (package.json)

```json
{
  "dependencies": {
    "@tauri-apps/api": "^2",
    "@tauri-apps/plugin-dialog": "^2",
    "@tauri-apps/plugin-fs": "^2",
    "react": "^18",
    "react-dom": "^18",
    "zustand": "^4",
    "@monaco-editor/react": "^4",
    "monaco-editor": "^0.45",
    "react-arborist": "^3",
    "lucide-react": "^0.383",
    "tailwindcss": "^3",
    "clsx": "^2",
    "date-fns": "^3"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2",
    "typescript": "^5",
    "vite": "^5",
    "@vitejs/plugin-react": "^4"
  }
}
```

---

_End of SPEC.md — Flare API Client v1.0_
