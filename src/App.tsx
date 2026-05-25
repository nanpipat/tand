import Editor from "@monaco-editor/react";
import clsx from "clsx";
import {
  AppWindow,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Clipboard,
  Copy,
  Eye,
  FileJson,
  Folder,
  FolderOpen,
  History,
  Moon,
  PanelBottom,
  PanelRight,
  Plus,
  Save,
  Search,
  Send,
  Settings,
  Sun,
  Trash2,
  Variable,
  Wand2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "./lib/api";
import { copyAsCurl, emptyRow, methodColors, parseParamsFromUrl, syncUrlParams } from "./lib/request";
import { extractVariables, isVariableResolved, resolveVariables } from "./lib/variables";
import { useAppStore } from "./store";
import type { Environment, FileNode, HttpMethod, KeyValueRow, RequestBody } from "./types";

const methods: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const requestTabs = ["params", "headers", "body", "auth", "pre-request", "settings"] as const;
const responseTabs = ["body", "headers", "cookies", "timeline"] as const;

export default function App() {
  const state = useAppStore();
  const [fileSearch, setFileSearch] = useState("");
  const [previewVariables, setPreviewVariables] = useState(false);

  useEffect(() => {
    void state.hydrate();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = state.theme;
  }, [state.theme]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const current = useAppStore.getState();
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) {
        if (event.key === "Escape") useAppStore.setState({ isSending: false });
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "n" && event.shiftKey) {
        event.preventDefault();
        void current.openNewWindow();
        return;
      }
      if (key === "enter") {
        event.preventDefault();
        void current.sendRequest();
      }
      if (key === "s") {
        event.preventDefault();
        void (current.activeEnvironmentEditor ? current.saveEnvironment() : current.saveRequest());
      }
      if (key === "n") {
        event.preventDefault();
        void current.createRequest();
      }
      if (key === "b") {
        event.preventDefault();
        current.setLayout({ leftPanelCollapsed: !current.leftPanelCollapsed });
      }
      if (key === "o" && event.shiftKey) {
        event.preventDefault();
        void current.openFolder();
      }
      if (key === "r" && event.shiftKey) {
        event.preventDefault();
        current.setLayout({ rightPanelCollapsed: !current.rightPanelCollapsed });
      }
      if (key === "h") {
        event.preventDefault();
        void current.toggleHistory();
      }
      if (key === "v" && event.shiftKey) {
        event.preventDefault();
        navigator.clipboard.readText().then((text) => useAppStore.getState().importCurl(text));
      }
      if (key === "f" && event.shiftKey) {
        event.preventDefault();
        formatActiveJsonBody();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const activeEnvironment = state.environments.find((env) => env.name === state.activeEnvironmentName) ?? null;

  return (
    <div className="app-shell">
      <Toolbar activeEnvironment={activeEnvironment} />
      <main className={clsx("workspace", state.responsePlacement === "bottom" && "bottom-response-workspace")}>
        {!state.leftPanelCollapsed && (
          <aside className="sidebar" style={{ width: state.leftPanelWidth }}>
            <div className="tree-toolbar">
              <button title="New request" onClick={() => void state.createRequest()}>
                <Plus size={15} />
              </button>
              <button title="New folder" onClick={() => void state.createFolder()}>
                <Folder size={15} />
              </button>
              <button title="New environment" onClick={() => void state.createEnvironment()}>
                <Variable size={15} />
              </button>
              <label className="search-box">
                <Search size={14} />
                <input value={fileSearch} onChange={(event) => setFileSearch(event.target.value)} placeholder="Search" />
              </label>
            </div>
            <FileTree nodes={filterTree(state.fileTree, fileSearch)} />
          </aside>
        )}
        {!state.leftPanelCollapsed && <ResizeHandle side="left" />}
        <section className="main-area">
          <section className="center-panel">
            <RequestEditor
              activeEnvironment={activeEnvironment}
              previewVariables={previewVariables}
              setPreviewVariables={setPreviewVariables}
            />
          </section>
          {state.responsePlacement === "bottom" && !state.rightPanelCollapsed && <ResizeHandle side="bottom" />}
          {state.responsePlacement === "bottom" && !state.rightPanelCollapsed && (
            <aside className={clsx("response-panel response-panel-bottom", state.lastResponse ? "has-response" : "is-empty")} style={{ height: state.bottomPanelHeight }}>
              <ResponsePanel />
            </aside>
          )}
        </section>
        {state.responsePlacement === "right" && !state.rightPanelCollapsed && <ResizeHandle side="right" />}
        {state.responsePlacement === "right" && !state.rightPanelCollapsed && (
          <aside className={clsx("response-panel", state.lastResponse ? "has-response" : "is-empty")} style={{ width: state.rightPanelWidth }}>
            <ResponsePanel />
          </aside>
        )}
        {state.isHistoryOpen && <HistoryPanel />}
      </main>
      <StatusBar activeEnvironment={activeEnvironment} />
      <CreateDialog />
      <ToastStack />
    </div>
  );
}

function Toolbar({ activeEnvironment }: { activeEnvironment: Environment | null }) {
  const state = useAppStore();
  const folderName = state.openFolderPath?.split(/[\\/]/).filter(Boolean).at(-1) ?? "Open Folder";
  return (
    <header className="topbar">
      <button className="brand" onClick={() => state.setLayout({ leftPanelCollapsed: !state.leftPanelCollapsed })}>
        <span className="brand-mark" aria-hidden="true" />
        <span>tand</span>
      </button>
      <button className="folder-button" onClick={() => void state.openFolder()}>
        <FolderOpen size={16} />
        <span>{folderName}</span>
        <ChevronDown size={14} />
      </button>
      <select value={state.activeEnvironmentName ?? ""} onChange={(event) => state.setActiveEnvironment(event.target.value || null)}>
        <option value="">No Environment</option>
        {state.environments.map((env) => (
          <option key={env.name} value={env.name}>
            {env.name}
          </option>
        ))}
      </select>
      <span className="env-count">{activeEnvironment ? `${activeEnvironment.variables.filter((v) => v.enabled).length} vars` : "Offline ready"}</span>
      <div className="topbar-spacer" />
      <button title="New Window" onClick={() => void state.openNewWindow()}>
        <AppWindow size={16} />
      </button>
      <div className="layout-toggle" aria-label="Response placement">
        <button
          title="Response on right"
          className={clsx(state.responsePlacement === "right" && "active")}
          onClick={() => state.setLayout({ responsePlacement: "right" })}
        >
          <PanelRight size={15} />
        </button>
        <button
          title="Response at bottom"
          className={clsx(state.responsePlacement === "bottom" && "active")}
          onClick={() => state.setLayout({ responsePlacement: "bottom" })}
        >
          <PanelBottom size={15} />
        </button>
      </div>
      <button title="History" onClick={() => void state.toggleHistory()}>
        <History size={16} />
      </button>
      <button
        title={state.theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        onClick={() => state.setTheme(state.theme === "dark" ? "light" : "dark")}
      >
        {state.theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
      </button>
      <button title="Settings">
        <Settings size={16} />
      </button>
    </header>
  );
}

function FileTree({ nodes, depth = 0 }: { nodes: FileNode[]; depth?: number }) {
  const state = useAppStore();
  if (!state.openFolderPath) {
    return (
      <div className="empty-state">
        <FolderOpen size={28} />
        <p>No folder opened</p>
        <button onClick={() => void state.openFolder()}>Open Folder</button>
      </div>
    );
  }
  if (!nodes.length && depth === 0) {
    return (
      <div className="empty-state">
        <FileJson size={28} />
        <p>No request files</p>
        <button onClick={() => void state.createRequest()}>Create Request</button>
        <button onClick={() => void state.createEnvironment()}>Create Environment</button>
      </div>
    );
  }
  return (
    <div className="tree">
      {nodes.map((node) => (
        <TreeNode key={node.path} node={node} depth={depth} />
      ))}
    </div>
  );
}

function TreeNode({ node, depth }: { node: FileNode; depth: number }) {
  const state = useAppStore();
  const [open, setOpen] = useState(true);
  const active = state.activeFilePath === node.path;
  const method = node.method ?? "GET";
  return (
    <>
      <div
        className={clsx("tree-row", active && "active")}
        style={{ paddingLeft: 10 + depth * 14 }}
        onClick={() => (node.isDir ? setOpen(!open) : void state.selectFile(node.path))}
        onContextMenu={(event) => {
          event.preventDefault();
          if (node.isDir) {
            void state.createRequest(node.path);
          } else if (confirm(`Delete ${node.name}?`)) {
            api.deleteFile(node.path).then(() => state.refreshTree());
          }
        }}
      >
        {node.isDir ? <Folder size={15} /> : <FileJson size={15} />}
        {!node.isDir && !node.isEnvironment && <span className={clsx("method-badge", methodColors[method])}>{method}</span>}
        {node.isEnvironment && <span className="env-dot">ENV</span>}
        <span className="tree-label">{node.name}</span>
      </div>
      {node.isDir && open && <FileTree nodes={node.children} depth={depth + 1} />}
    </>
  );
}

function RequestEditor({
  activeEnvironment,
  previewVariables,
  setPreviewVariables,
}: {
  activeEnvironment: Environment | null;
  previewVariables: boolean;
  setPreviewVariables: (value: boolean) => void;
}) {
  const state = useAppStore();
  const request = state.activeRequest;
  const environmentEditor = state.activeEnvironmentEditor;

  if (environmentEditor) {
    return <EnvironmentEditor environment={environmentEditor} />;
  }

  if (!request) {
    return (
      <div className="editor-empty">
        <FileJson size={36} />
        <h1>Open or create a request</h1>
        <button onClick={() => void state.createRequest()}>
          <Plus size={16} />
          New Request
        </button>
      </div>
    );
  }

  const setRequest = state.updateRequest;
  const urlPreview = resolveVariables(syncUrlParams(request.request.url, request.request.params), activeEnvironment);

  return (
    <div className="request-editor">
      <div className="request-title">
        <input
          value={request.name}
          onChange={(event) => setRequest((draft) => ({ ...draft, name: event.target.value }))}
        />
        {!state.activeFilePath && <span className="scratch-pill">Scratch</span>}
        {state.isDirty && <span className="dirty-dot" title="Unsaved changes" />}
        <button title={state.activeFilePath ? "Save" : "Save scratch to folder"} onClick={() => void state.saveRequest()}>
          <Save size={15} />
        </button>
        <button
          title="Copy as cURL"
          onClick={() => {
            navigator.clipboard.writeText(copyAsCurl(request, activeEnvironment, true));
            state.toast("Copied cURL", "success");
          }}
        >
          <Clipboard size={15} />
        </button>
      </div>
      <div className="url-bar">
        <select
          value={request.request.method}
          className={methodColors[request.request.method]}
          onChange={(event) =>
            setRequest((draft) => ({
              ...draft,
              request: { ...draft.request, method: event.target.value as HttpMethod },
            }))
          }
        >
          {methods.map((method) => (
            <option key={method}>{method}</option>
          ))}
        </select>
        <input
          value={request.request.url}
          placeholder="Enter URL or paste cURL"
          onPaste={(event) => {
            const text = event.clipboardData.getData("text");
            if (text.trim().startsWith("curl ")) {
              event.preventDefault();
              void state.importCurl(text);
            }
          }}
          onChange={(event) => {
            const value = event.target.value;
            if (value.trim().startsWith("curl ")) {
              void state.importCurl(value);
              return;
            }
            setRequest((draft) => ({
              ...draft,
              request: { ...draft.request, url: value, params: parseParamsFromUrl(value) },
            }));
          }}
        />
        <button className="send-button" onClick={() => void state.sendRequest()}>
          <Send size={16} />
          {state.isSending ? "Sending" : "Send"}
        </button>
      </div>
      <div className="variable-row">
        <label>
          <input type="checkbox" checked={previewVariables} onChange={(event) => setPreviewVariables(event.target.checked)} />
          Preview
        </label>
        <VariablePreview text={request.request.url} env={activeEnvironment} />
      </div>
      {previewVariables && <div className="resolved-preview">{urlPreview || "Resolved URL preview"}</div>}
      <div className="tabs">
        {requestTabs.map((tab) => (
          <button key={tab} className={clsx(state.activeTab === tab && "active")} onClick={() => state.setActiveTab(tab)}>
            {titleCase(tab)}
          </button>
        ))}
      </div>
      <div className="tab-body">
        {state.activeTab === "params" && (
          <KeyValueTable
            rows={request.request.params}
            onChange={(rows) =>
              setRequest((draft) => ({
                ...draft,
                request: { ...draft.request, params: rows, url: syncUrlParams(draft.request.url, rows) },
              }))
            }
            env={activeEnvironment}
          />
        )}
        {state.activeTab === "headers" && (
          <KeyValueTable
            rows={request.request.headers}
            onChange={(headers) => setRequest((draft) => ({ ...draft, request: { ...draft.request, headers } }))}
            env={activeEnvironment}
            suggestions={["Content-Type", "Authorization", "Accept", "X-Request-ID", "User-Agent"]}
          />
        )}
        {state.activeTab === "body" && <BodyEditor body={request.request.body} env={activeEnvironment} />}
        {state.activeTab === "auth" && <AuthEditor env={activeEnvironment} />}
        {state.activeTab === "pre-request" && <PreRequest />}
        {state.activeTab === "settings" && <RequestSettingsEditor />}
      </div>
    </div>
  );
}

function EnvironmentEditor({ environment }: { environment: Environment }) {
  const state = useAppStore();
  const update = (updater: (environment: Environment) => Environment) => state.updateEnvironment(updater);
  const setVariable = (index: number, patch: Partial<Environment["variables"][number]>) =>
    update((draft) => ({
      ...draft,
      variables: draft.variables.map((variable, idx) => (idx === index ? { ...variable, ...patch } : variable)),
    }));
  return (
    <div className="request-editor">
      <div className="request-title">
        <input value={environment.name} onChange={(event) => update((draft) => ({ ...draft, name: event.target.value }))} />
        {state.isDirty && <span className="dirty-dot" title="Unsaved changes" />}
        <button title="Save environment" onClick={() => void state.saveEnvironment()}>
          <Save size={15} />
        </button>
      </div>
      <div className="env-editor">
        <div className="env-editor-head">
          <h2>Environment Variables</h2>
          <button
            onClick={() =>
              update((draft) => ({
                ...draft,
                variables: [...draft.variables, { key: "", value: "", enabled: true, secret: false }],
              }))
            }
          >
            <Plus size={15} />
            Add Variable
          </button>
        </div>
        <div className="env-table">
          <div className="env-head">
            <span>On</span>
            <span>Key</span>
            <span>Value</span>
            <span>Secret</span>
            <span />
          </div>
          {environment.variables.map((variable, index) => (
            <div className="env-row" key={index}>
              <input type="checkbox" checked={variable.enabled} onChange={(event) => setVariable(index, { enabled: event.target.checked })} />
              <input value={variable.key} onChange={(event) => setVariable(index, { key: event.target.value })} />
              <input
                value={variable.value}
                type={variable.secret ? "password" : "text"}
                onChange={(event) => setVariable(index, { value: event.target.value })}
              />
              <button title="Toggle secret" className={clsx(variable.secret && "active")} onClick={() => setVariable(index, { secret: !variable.secret })}>
                <Eye size={14} />
              </button>
              <button
                title="Delete variable"
                onClick={() => update((draft) => ({ ...draft, variables: draft.variables.filter((_, idx) => idx !== index) }))}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function KeyValueTable({
  rows,
  onChange,
  env,
  suggestions = [],
}: {
  rows: KeyValueRow[];
  onChange: (rows: KeyValueRow[]) => void;
  env: Environment | null;
  suggestions?: string[];
}) {
  const update = (index: number, patch: Partial<KeyValueRow>) => onChange(rows.map((row, idx) => (idx === index ? { ...row, ...patch } : row)));
  return (
    <div className="kv-table">
      <div className="kv-head">
        <span />
        <span>Key</span>
        <span>Value</span>
        <span>Description</span>
        <span />
      </div>
      {[...rows, emptyRow()].map((row, index) => {
        const isNew = index === rows.length;
        return (
          <div className="kv-row" key={index}>
            <input
              type="checkbox"
              checked={row.enabled}
              onChange={(event) => (isNew ? onChange([...rows, { ...emptyRow(), enabled: event.target.checked }]) : update(index, { enabled: event.target.checked }))}
            />
            <input
              value={row.key}
              list={suggestions.length ? "header-suggestions" : undefined}
              onChange={(event) => (isNew ? onChange([...rows, { ...emptyRow(), key: event.target.value }]) : update(index, { key: event.target.value }))}
            />
            <div className="value-cell">
              <input
                value={row.value}
                onChange={(event) => (isNew ? onChange([...rows, { ...emptyRow(), value: event.target.value }]) : update(index, { value: event.target.value }))}
              />
              <VariablePreview text={row.value} env={env} />
            </div>
            <input
              value={row.description ?? ""}
              onChange={(event) => (isNew ? onChange([...rows, { ...emptyRow(), description: event.target.value }]) : update(index, { description: event.target.value }))}
            />
            {!isNew && (
              <button title="Delete row" onClick={() => onChange(rows.filter((_, idx) => idx !== index))}>
                <Trash2 size={14} />
              </button>
            )}
          </div>
        );
      })}
      <datalist id="header-suggestions">
        {suggestions.map((suggestion) => (
          <option key={suggestion} value={suggestion} />
        ))}
      </datalist>
    </div>
  );
}

function BodyEditor({ body, env }: { body: RequestBody; env: Environment | null }) {
  const state = useAppStore();
  const editorTheme = state.theme === "light" ? "vs-light" : "vs-dark";
  const updateBody = (patch: Partial<RequestBody>) =>
    state.updateRequest((draft) => ({ ...draft, request: { ...draft.request, body: { ...draft.request.body, ...patch } } }));
  const formatRequestJson = () => {
    if (body.type !== "json" || typeof body.content !== "string") return;
    const formatted = formatJsonText(body.content);
    if (!formatted) {
      state.toast("Body is not valid JSON", "warning");
      return;
    }
    updateBody({ content: formatted });
    state.toast("Formatted request JSON", "success");
  };
  return (
    <div className="body-editor">
      <div className="body-toolbar">
        <div className="segmented">
          {(["none", "json", "form-data", "form-urlencoded", "raw"] as const).map((type) => (
            <button
              key={type}
              className={clsx(body.type === type && "active")}
              onClick={() => updateBody({ type, content: type === "none" ? null : type.includes("form") ? [] : "" })}
            >
              {titleCase(type)}
            </button>
          ))}
        </div>
        {body.type === "json" && (
          <button className="tool-button" title="Format JSON" onClick={formatRequestJson}>
            <Wand2 size={14} />
            Format JSON
          </button>
        )}
      </div>
      {body.type === "none" && <div className="empty-inline">No body will be sent with this request.</div>}
      {(body.type === "json" || body.type === "raw") && (
        <>
          {body.type === "raw" && (
            <select value={body.contentType ?? "text/plain"} onChange={(event) => updateBody({ contentType: event.target.value })}>
              <option>text/plain</option>
              <option>application/xml</option>
              <option>application/javascript</option>
              <option>text/html</option>
            </select>
          )}
          <Editor
            height="100%"
            defaultLanguage={body.type === "json" ? "json" : "text"}
            theme={editorTheme}
            value={typeof body.content === "string" ? body.content : ""}
            options={{ minimap: { enabled: false }, fontSize: 12, lineHeight: 18, wordWrap: "off", lineNumbersMinChars: 3 }}
            onChange={(value) => updateBody({ content: value ?? "" })}
          />
          <VariablePreview text={typeof body.content === "string" ? body.content : ""} env={env} />
        </>
      )}
      {(body.type === "form-data" || body.type === "form-urlencoded") && (
        <KeyValueTable
          rows={Array.isArray(body.content) ? body.content : []}
          onChange={(rows) => updateBody({ content: rows })}
          env={env}
        />
      )}
    </div>
  );
}

function AuthEditor({ env }: { env: Environment | null }) {
  const { activeRequest, updateRequest } = useAppStore();
  if (!activeRequest) return null;
  const auth = activeRequest.request.auth;
  const setAuth = (next: typeof auth) => updateRequest((draft) => ({ ...draft, request: { ...draft.request, auth: next } }));
  return (
    <div className="form-panel">
      <select
        value={auth.type}
        onChange={(event) => {
          const type = event.target.value;
          if (type === "bearer") setAuth({ type, token: "" });
          else if (type === "basic") setAuth({ type, username: "", password: "" });
          else if (type === "api-key") setAuth({ type, key: "", value: "", location: "header" });
          else setAuth({ type: "none" });
        }}
      >
        <option value="none">No Auth</option>
        <option value="bearer">Bearer Token</option>
        <option value="basic">Basic Auth</option>
        <option value="api-key">API Key</option>
        <option value="custom">Custom</option>
      </select>
      {auth.type === "bearer" && (
        <LabeledInput label="Token" value={auth.token} env={env} onChange={(token) => setAuth({ ...auth, token })} />
      )}
      {auth.type === "basic" && (
        <>
          <LabeledInput label="Username" value={auth.username} env={env} onChange={(username) => setAuth({ ...auth, username })} />
          <LabeledInput label="Password" value={auth.password} env={env} onChange={(password) => setAuth({ ...auth, password })} />
        </>
      )}
      {auth.type === "api-key" && (
        <>
          <LabeledInput label="Key" value={auth.key} env={env} onChange={(key) => setAuth({ ...auth, key })} />
          <LabeledInput label="Value" value={auth.value} env={env} onChange={(value) => setAuth({ ...auth, value })} />
          <select value={auth.location} onChange={(event) => setAuth({ ...auth, location: event.target.value as "header" | "query" })}>
            <option value="header">Header</option>
            <option value="query">Query Param</option>
          </select>
        </>
      )}
    </div>
  );
}

function LabeledInput({ label, value, onChange, env }: { label: string; value: string; onChange: (value: string) => void; env: Environment | null }) {
  return (
    <label className="labeled-input">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
      <VariablePreview text={value} env={env} />
    </label>
  );
}

function PreRequest() {
  return (
    <div className="form-panel">
      <p className="muted">Temporary header and environment overrides are represented in request notes for v1.</p>
      <textarea placeholder="Notes or pre-request comments" />
    </div>
  );
}

function RequestSettingsEditor() {
  const { activeRequest, updateRequest } = useAppStore();
  if (!activeRequest) return null;
  const settings = activeRequest.request.settings;
  const setSettings = (patch: Partial<typeof settings>) =>
    updateRequest((draft) => ({ ...draft, request: { ...draft.request, settings: { ...draft.request.settings, ...patch } } }));
  return (
    <div className="form-panel settings-grid">
      <label>
        <input type="checkbox" checked={settings.followRedirects} onChange={(event) => setSettings({ followRedirects: event.target.checked })} />
        Follow Redirects
      </label>
      <label>
        <input type="checkbox" checked={settings.verifySsl} onChange={(event) => setSettings({ verifySsl: event.target.checked })} />
        SSL Verification
      </label>
      <label>
        <span>Timeout</span>
        <input type="number" value={settings.timeoutMs} onChange={(event) => setSettings({ timeoutMs: Number(event.target.value) })} />
      </label>
      <label>
        <span>Proxy</span>
        <input value={settings.proxy ?? ""} onChange={(event) => setSettings({ proxy: event.target.value || null })} />
      </label>
    </div>
  );
}

function ResponsePanel() {
  const state = useAppStore();
  const editorTheme = state.theme === "light" ? "vs-light" : "vs-dark";
  const response = state.lastResponse;
  if (!response) {
    return (
      <div className="response-empty">
        <Send size={30} />
        <p>Send a request to see the response</p>
      </div>
    );
  }
  const contentType = Object.entries(response.headers).find(([key]) => key.toLowerCase() === "content-type")?.[1] ?? "";
  const body = prettyBody(response.body, contentType);
  const canFormatJson = Boolean(formatJsonText(response.body));
  const formatResponseJson = () => {
    const formatted = formatJsonText(response.body);
    if (!formatted) {
      state.toast("Response body is not valid JSON", "warning");
      return;
    }
    useAppStore.setState({ lastResponse: { ...response, body: formatted } });
    state.setResponseTab("body");
    state.toast("Formatted response JSON", "success");
  };
  return (
    <div className="response-viewer">
      <div className="response-status">
        <span className={clsx("status-pill", statusClass(response.statusCode))}>
          {response.statusCode || "ERR"} {response.statusText}
        </span>
        <span>{response.timeMs}ms</span>
        <span>{formatBytes(response.sizeBytes)}</span>
        {canFormatJson && (
          <button title="Format JSON" onClick={formatResponseJson}>
            <Wand2 size={15} />
          </button>
        )}
        <button title="Copy response" onClick={() => navigator.clipboard.writeText(response.body)}>
          <Copy size={15} />
        </button>
      </div>
      <div className="tabs compact">
        {responseTabs.map((tab) => (
          <button key={tab} className={clsx(state.responseTab === tab && "active")} onClick={() => state.setResponseTab(tab)}>
            {titleCase(tab)}
          </button>
        ))}
      </div>
      <div className="response-content">
        {state.responseTab === "body" && (
          <div className="response-editor-shell">
            <Editor
              key={`${response.statusCode}-${response.timeMs}-${response.sizeBytes}-${body.length}`}
              height="100%"
              language={contentType.includes("json") ? "json" : contentType.includes("xml") ? "xml" : "text"}
              theme={editorTheme}
              value={body || "(empty response)"}
              options={{
                readOnly: true,
                domReadOnly: true,
                minimap: { enabled: false },
                fontSize: 11,
                lineHeight: 17,
                wordWrap: "on",
                automaticLayout: false,
                scrollBeyondLastLine: false,
                folding: true,
                lineNumbers: "on",
                lineNumbersMinChars: 3,
                renderLineHighlight: "none",
                contextmenu: true,
                copyWithSyntaxHighlighting: false,
              }}
              onMount={(editor) => editor.layout()}
            />
          </div>
        )}
        {state.responseTab === "headers" && (
          <div className="headers-list">
            {Object.entries(response.headers)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, value]) => (
                <button key={key} onClick={() => navigator.clipboard.writeText(value)}>
                  <span>{key}</span>
                  <code>{value}</code>
                </button>
              ))}
          </div>
        )}
        {state.responseTab === "cookies" && <div className="empty-inline">Cookies are shown when returned as response headers.</div>}
        {state.responseTab === "timeline" && (
          <div className="timeline">
            {Object.entries(response.timing).map(([key, value]) => (
              <div key={key}>
                <span>{key.replace("Ms", "")}</span>
                <b style={{ width: `${Math.max(4, Number(value))}%` }} />
                <em>{String(value)}ms</em>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function HistoryPanel() {
  const state = useAppStore();
  const [query, setQuery] = useState("");
  const rows = useMemo(() => state.history.filter((entry) => JSON.stringify(entry).toLowerCase().includes(query.toLowerCase())), [state.history, query]);
  return (
    <aside className="history-panel">
      <div className="history-head">
        <h2>History</h2>
        <button onClick={() => void state.toggleHistory()}>
          <ChevronsRight size={16} />
        </button>
      </div>
      <label className="search-box">
        <Search size={14} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter history" />
      </label>
      <div className="history-list">
        {rows.map((entry) => (
          <button key={entry.id} onClick={() => useAppStore.setState({ lastResponse: entry.response })}>
            <span className={clsx("method-badge", methodColors[entry.request.method])}>{entry.request.method}</span>
            <span>{entry.request.resolvedUrl}</span>
            <b>{entry.response.statusCode}</b>
          </button>
        ))}
      </div>
    </aside>
  );
}

function ResizeHandle({ side }: { side: "left" | "right" | "bottom" }) {
  const state = useAppStore();
  return (
    <div
      className={clsx("resize-handle", side === "bottom" && "resize-handle-horizontal")}
      onMouseDown={(event) => {
        const startX = event.clientX;
        const startY = event.clientY;
        const startLeft = state.leftPanelWidth;
        const startRight = state.rightPanelWidth;
        const startBottom = state.bottomPanelHeight;
        let pendingPatch: { leftPanelWidth?: number; rightPanelWidth?: number; bottomPanelHeight?: number } = {};
        const onMove = (move: MouseEvent) => {
          if (side === "left") {
            pendingPatch = { leftPanelWidth: Math.max(180, Math.min(420, startLeft + move.clientX - startX)) };
          } else if (side === "right") {
            pendingPatch = { rightPanelWidth: Math.max(300, Math.min(620, startRight - (move.clientX - startX))) };
          } else {
            pendingPatch = { bottomPanelHeight: Math.max(220, Math.min(520, startBottom - (move.clientY - startY))) };
          }
          state.setLayout(pendingPatch, { persist: false });
        };
        const onUp = () => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
          if (Object.keys(pendingPatch).length) state.setLayout(pendingPatch);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      }}
    />
  );
}

function StatusBar({ activeEnvironment }: { activeEnvironment: Environment | null }) {
  const state = useAppStore();
  const request = state.activeRequest;
  return (
    <footer className="statusbar">
      <button onClick={() => state.setLayout({ leftPanelCollapsed: !state.leftPanelCollapsed })}>
        {state.leftPanelCollapsed ? <ChevronsRight size={14} /> : <ChevronsLeft size={14} />}
      </button>
      <span>{request?.request.method ?? "No method"}</span>
      <span>{request?.request.url || "No URL"}</span>
      <span>{state.lastResponse ? `${state.lastResponse.statusCode} ${state.lastResponse.timeMs}ms` : "No response"}</span>
      <span>{activeEnvironment?.name ?? "No Environment"}</span>
      <strong>{state.statusMessage}</strong>
    </footer>
  );
}

function ToastStack() {
  const toasts = useAppStore((state) => state.toasts);
  return (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <div className={clsx("toast", toast.tone)} key={toast.id}>
          {toast.message}
        </div>
      ))}
    </div>
  );
}

function CreateDialog() {
  const state = useAppStore();
  const [name, setName] = useState("");
  const dialog = state.createDialog;

  useEffect(() => {
    if (!dialog) return;
    if (dialog.kind === "request") setName("new-request");
    if (dialog.kind === "folder") setName("new-folder");
    if (dialog.kind === "environment") setName("local");
  }, [dialog]);

  if (!dialog) return null;

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (dialog.kind === "request") void state.createRequest(dialog.folderPath, trimmed);
    if (dialog.kind === "folder") void state.createFolder(dialog.folderPath, trimmed);
    if (dialog.kind === "environment") void state.createEnvironment(dialog.folderPath, trimmed);
  };

  const title = dialog.kind === "request" ? "New Request" : dialog.kind === "folder" ? "New Folder" : "New Environment";

  return (
    <div className="modal-backdrop" onMouseDown={state.closeCreateDialog}>
      <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <h2>{title}</h2>
        <label className="labeled-input">
          <span>Name</span>
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
              if (event.key === "Escape") state.closeCreateDialog();
            }}
          />
        </label>
        <div className="modal-actions">
          <button onClick={state.closeCreateDialog}>Cancel</button>
          <button className="primary" onClick={submit}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

function VariablePreview({ text, env }: { text: string; env: Environment | null }) {
  const variables = extractVariables(text);
  if (!variables.length) return null;
  return (
    <div className="variable-preview">
      {variables.map((variable) => (
        <span key={variable} className={clsx(isVariableResolved(variable, env) ? "resolved" : "unresolved")} title={isVariableResolved(variable, env) ? `Resolves to ${resolveVariables(`{{${variable}}}`, env)}` : "Variable not found in active environment"}>
          {"{{"}
          {variable}
          {"}}"}
        </span>
      ))}
    </div>
  );
}

function filterTree(nodes: FileNode[], query: string): FileNode[] {
  if (!query.trim()) return nodes;
  const lower = query.toLowerCase();
  return nodes
    .map((node) => ({ ...node, children: filterTree(node.children, query) }))
    .filter((node) => node.name.toLowerCase().includes(lower) || node.children.length);
}

function formatActiveJsonBody() {
  const state = useAppStore.getState();
  const request = state.activeRequest;
  if (!request || request.request.body.type !== "json" || typeof request.request.body.content !== "string") return;
  try {
    const formatted = JSON.stringify(JSON.parse(request.request.body.content || "{}"), null, 2);
    state.updateRequest((draft) => ({ ...draft, request: { ...draft.request, body: { ...draft.request.body, content: formatted } } }));
  } catch {
    state.toast("Body is not valid JSON", "warning");
  }
}

function titleCase(value: string) {
  return value.replace("-", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function prettyBody(body: string, contentType: string) {
  return contentType.includes("json") ? formatJsonText(body) ?? body : formatJsonText(body) ?? body;
}

function formatJsonText(value: string) {
  try {
    const trimmed = value.trim();
    if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return null;
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return null;
  }
}

function statusClass(status: number) {
  if (status >= 200 && status < 300) return "ok";
  if (status >= 300 && status < 400) return "redirect";
  if (status >= 400 && status < 500) return "client";
  if (status >= 500) return "server";
  return "neutral";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
