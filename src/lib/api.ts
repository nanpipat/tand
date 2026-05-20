import { invoke } from "@tauri-apps/api/core";
import type { AppConfig, Environment, FileNode, HistoryEntry, HttpResponse, ParsedCurl, RequestFile } from "../types";
import { createDefaultRequest } from "./request";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const sampleRequest = createDefaultRequest("Health Check");
sampleRequest.request.method = "GET";
sampleRequest.request.url = "https://httpbin.org/get?source=flare";

const sampleTree: FileNode[] = [
  {
    name: "health-check.json",
    path: "/demo/health-check.json",
    isDir: false,
    isEnvironment: false,
    method: "GET",
    children: [],
  },
  {
    name: "environments",
    path: "/demo/environments",
    isDir: true,
    isEnvironment: true,
    children: [
      {
        name: "local.json",
        path: "/demo/environments/local.json",
        isDir: false,
        isEnvironment: true,
        children: [],
      },
    ],
  },
];

const sampleEnv: Environment = {
  name: "Local",
  path: "/demo/environments/local.json",
  variables: [
    { key: "BASE_URL", value: "https://httpbin.org", enabled: true, secret: false },
    { key: "ACCESS_TOKEN", value: "demo-token", enabled: true, secret: true },
  ],
};

const virtualRoot = "/demo";
const dirsKey = "flare:vfs:dirs";
const filePrefix = "flare:vfs:file:";

const defaultConfig: AppConfig = {
  version: 1,
  recentFolders: [],
  lastOpenedFolder: null,
  lastActiveFile: null,
  lastEnvironment: null,
  theme: "dark",
  layout: {
    leftPanelWidth: 240,
    rightPanelWidth: 400,
    bottomPanelHeight: 320,
    responsePlacement: "right",
    leftPanelCollapsed: false,
    rightPanelCollapsed: false,
  },
  history: { maxEntries: 500 },
  editor: { fontSize: 13, wordWrap: false },
};

export const api = {
  async openFolderDialog() {
    if (!isTauri) {
      ensureVirtualWorkspace();
      return virtualRoot;
    }
    return invoke<string | null>("open_folder_dialog");
  },
  async listDirectory(path: string) {
    if (!isTauri) {
      ensureVirtualWorkspace();
      return buildVirtualTree(path);
    }
    return invoke<FileNode[]>("list_directory", { path });
  },
  async readRequestFile(path: string) {
    if (!isTauri) {
      ensureVirtualWorkspace();
      const stored = localStorage.getItem(`${filePrefix}${path}`);
      if (!stored) throw new Error(`File not found: ${path}`);
      return JSON.parse(stored);
    }
    return invoke<RequestFile>("read_request_file", { path });
  },
  async writeRequestFile(path: string, content: RequestFile | Environment) {
    if (!isTauri) {
      ensureVirtualWorkspace();
      localStorage.setItem(`${filePrefix}${path}`, JSON.stringify(content));
      return;
    }
    return invoke<void>("write_request_file", { path, content });
  },
  async createRequestFile(folderPath: string, name: string) {
    if (!isTauri) {
      ensureVirtualWorkspace();
      const fileName = normalizeFileName(name);
      const path = uniquePath(`${folderPath}/${fileName}`);
      const request = createDefaultRequest(fileName.replace(/\.json$/, "").replaceAll("-", " "));
      localStorage.setItem(`${filePrefix}${path}`, JSON.stringify(request));
      addVirtualDir(folderPath);
      return path;
    }
    return invoke<string>("create_request_file", { folderPath, name });
  },
  async deleteFile(path: string) {
    if (!isTauri) {
      ensureVirtualWorkspace();
      localStorage.removeItem(`${filePrefix}${path}`);
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith(`${filePrefix}${path}/`)) localStorage.removeItem(key);
      }
      setVirtualDirs(getVirtualDirs().filter((dir) => dir !== path && !dir.startsWith(`${path}/`)));
      return;
    }
    return invoke<void>("delete_file", { path });
  },
  async renameFile(oldPath: string, newPath: string) {
    if (!isTauri) {
      ensureVirtualWorkspace();
      const stored = localStorage.getItem(`${filePrefix}${oldPath}`);
      if (stored) {
        localStorage.setItem(`${filePrefix}${newPath}`, stored);
        localStorage.removeItem(`${filePrefix}${oldPath}`);
      }
      return;
    }
    return invoke<void>("rename_file", { oldPath, newPath });
  },
  async createDirectory(path: string) {
    if (!isTauri) {
      ensureVirtualWorkspace();
      addVirtualDir(path);
      return;
    }
    return invoke<void>("create_directory", { path });
  },
  async readConfig() {
    if (!isTauri) {
      ensureVirtualWorkspace();
      const stored = localStorage.getItem("flare:config");
      if (stored) return { ...defaultConfig, ...JSON.parse(stored) };
      return defaultConfig;
    }
    return invoke<AppConfig>("read_config");
  },
  async writeConfig(config: AppConfig) {
    if (!isTauri) {
      localStorage.setItem("flare:config", JSON.stringify(config));
      return;
    }
    return invoke<void>("write_config", { config });
  },
  async sendRequest(payload: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string | null;
    settings: RequestFile["request"]["settings"];
  }) {
    if (!isTauri) {
      const started = performance.now();
      const response = await fetch(payload.url, {
        method: payload.method,
        headers: payload.headers,
        body: payload.body,
        redirect: payload.settings.followRedirects ? "follow" : "manual",
      });
      const body = await response.text();
      const headers = Object.fromEntries(response.headers.entries());
      return {
        statusCode: response.status,
        statusText: response.statusText,
        headers,
        body,
        timeMs: Math.round(performance.now() - started),
        sizeBytes: new Blob([body]).size,
        timing: { dnsMs: 0, connectMs: 0, tlsMs: 0, ttfbMs: 0, downloadMs: 0 },
      } satisfies HttpResponse;
    }
    return invoke<HttpResponse>("send_request", payload);
  },
  async saveHistory(entry: HistoryEntry) {
    if (!isTauri) {
      const current = JSON.parse(localStorage.getItem("flare:history") ?? "[]") as HistoryEntry[];
      localStorage.setItem("flare:history", JSON.stringify([entry, ...current].slice(0, 500)));
      return;
    }
    return invoke<void>("save_history", { entry });
  },
  async loadHistory(page = 0, limit = 100, filter?: { query?: string }) {
    if (!isTauri) {
      const current = JSON.parse(localStorage.getItem("flare:history") ?? "[]") as HistoryEntry[];
      const query = filter?.query?.toLowerCase();
      const filtered = query ? current.filter((entry) => JSON.stringify(entry).toLowerCase().includes(query)) : current;
      return filtered.slice(page * limit, page * limit + limit);
    }
    return invoke<HistoryEntry[]>("load_history", { page, limit, filter });
  },
  async clearHistory() {
    if (!isTauri) {
      localStorage.removeItem("flare:history");
      return;
    }
    return invoke<void>("clear_history");
  },
  async parseCurl(curlString: string) {
    if (!isTauri) return parseCurlFallback(curlString);
    return invoke<ParsedCurl>("parse_curl", { curlString });
  },
  async openNewWindow() {
    if (!isTauri) {
      window.open(`${window.location.origin}${window.location.pathname}?fresh=1`, "_blank", "noopener,noreferrer,width=1280,height=820");
      return null;
    }
    return invoke<string>("open_new_window");
  },
};

function ensureVirtualWorkspace() {
  if (localStorage.getItem("flare:vfs:ready")) return;
  setVirtualDirs([virtualRoot, `${virtualRoot}/environments`, `${virtualRoot}/users`]);
  localStorage.setItem(`${filePrefix}${virtualRoot}/health-check.json`, JSON.stringify(sampleRequest));
  localStorage.setItem(`${filePrefix}${virtualRoot}/environments/local.json`, JSON.stringify(sampleEnv));
  localStorage.setItem("flare:vfs:ready", "1");
}

function buildVirtualTree(root: string): FileNode[] {
  const dirs = getVirtualDirs();
  const filePaths = Object.keys(localStorage)
    .filter((key) => key.startsWith(filePrefix))
    .map((key) => key.slice(filePrefix.length));
  const allPaths = [...dirs, ...filePaths].filter((path) => path !== root && path.startsWith(`${root}/`));
  const directChildren = allPaths.filter((path) => parentPath(path) === root);
  return directChildren.sort(sortPath).map((path) => {
    const isDir = dirs.includes(path);
    const content = !isDir ? JSON.parse(localStorage.getItem(`${filePrefix}${path}`) ?? "{}") : null;
    return {
      name: path.split("/").at(-1) ?? path,
      path,
      isDir,
      isEnvironment: path.split("/").includes("environments"),
      method: content?.request?.method,
      children: isDir ? buildVirtualTree(path) : [],
    };
  });
}

function getVirtualDirs(): string[] {
  return JSON.parse(localStorage.getItem(dirsKey) ?? "[]");
}

function setVirtualDirs(dirs: string[]) {
  localStorage.setItem(dirsKey, JSON.stringify([...new Set(dirs)].sort()));
}

function addVirtualDir(path: string) {
  const dirs = new Set(getVirtualDirs());
  const parts = path.split("/").filter(Boolean);
  let current = path.startsWith("/") ? "" : parts.shift() ?? "";
  for (const part of path.startsWith("/") ? parts : [current, ...parts].filter(Boolean)) {
    current = `${current}/${part}`;
    dirs.add(current);
  }
  dirs.add(path);
  setVirtualDirs([...dirs]);
}

function parentPath(path: string) {
  return path.split("/").slice(0, -1).join("/") || "/";
}

function sortPath(a: string, b: string) {
  const aDir = getVirtualDirs().includes(a);
  const bDir = getVirtualDirs().includes(b);
  if (aDir !== bDir) return aDir ? -1 : 1;
  return a.localeCompare(b);
}

function normalizeFileName(name: string) {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "new-request";
  return base.endsWith(".json") ? base : `${base}.json`;
}

function uniquePath(path: string) {
  if (!localStorage.getItem(`${filePrefix}${path}`)) return path;
  const ext = path.endsWith(".json") ? ".json" : "";
  const base = ext ? path.slice(0, -ext.length) : path;
  let index = 2;
  while (localStorage.getItem(`${filePrefix}${base}-${index}${ext}`)) index += 1;
  return `${base}-${index}${ext}`;
}

function parseCurlFallback(curlString: string): ParsedCurl {
  const url = curlString.match(/https?:\/\/[^\s'"]+/)?.[0] ?? "";
  const method = (curlString.match(/(?:-X|--request)\s+([A-Z]+)/i)?.[1]?.toUpperCase() ?? (/-d|--data/.test(curlString) ? "POST" : "GET")) as ParsedCurl["method"];
  const headers = [...curlString.matchAll(/-H\s+['"]([^:]+):\s*([^'"]+)['"]/g)].map((match) => ({
    key: match[1],
    value: match[2],
  }));
  const bodyMatch = curlString.match(/(?:-d|--data-raw|--data)\s+('([^']*)'|"([^"]*)")/);
  const content = bodyMatch?.[2] ?? bodyMatch?.[3] ?? null;
  return {
    method,
    url,
    headers,
    body: content ? { type: content.trim().startsWith("{") ? "json" : "raw", content } : { type: "none", content: null },
    auth: { type: "none" },
    settings: { followRedirects: /(?:^|\s)-L(?:\s|$)|--location/.test(curlString) },
  };
}
