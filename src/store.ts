import { create } from "zustand";
import type {
  AppConfig,
  Environment,
  FileNode,
  HistoryEntry,
  HttpResponse,
  RequestFile,
} from "./types";
import { api } from "./lib/api";
import { buildSendPayload, createDefaultRequest, parseParamsFromUrl } from "./lib/request";
import { resolveVariables, unresolvedVariables } from "./lib/variables";

type Toast = { id: number; message: string; tone: "info" | "success" | "warning" | "danger" };

type AppState = {
  openFolderPath: string | null;
  fileTree: FileNode[];
  activeFilePath: string | null;
  activeRequest: RequestFile | null;
  activeEnvironmentEditor: Environment | null;
  isDirty: boolean;
  isSending: boolean;
  lastResponse: HttpResponse | null;
  environments: Environment[];
  activeEnvironmentName: string | null;
  history: HistoryEntry[];
  isHistoryOpen: boolean;
  leftPanelWidth: number;
  rightPanelWidth: number;
  bottomPanelHeight: number;
  responsePlacement: "right" | "bottom";
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  activeTab: "params" | "headers" | "body" | "auth" | "pre-request" | "settings";
  responseTab: "body" | "headers" | "cookies" | "timeline";
  statusMessage: string;
  toasts: Toast[];
  config: AppConfig | null;
  createDialog: { kind: "request" | "folder"; folderPath: string } | null;
  openNewWindow: () => Promise<void>;
  hydrate: () => Promise<void>;
  openFolder: (path?: string | null) => Promise<void>;
  refreshTree: () => Promise<void>;
  selectFile: (path: string) => Promise<void>;
  updateRequest: (updater: (request: RequestFile) => RequestFile) => void;
  saveRequest: () => Promise<void>;
  updateEnvironment: (updater: (environment: Environment) => Environment) => void;
  saveEnvironment: () => Promise<void>;
  createRequest: (folderPath?: string, name?: string) => Promise<void>;
  createFolder: (folderPath?: string, name?: string) => Promise<void>;
  closeCreateDialog: () => void;
  sendRequest: () => Promise<void>;
  importCurl: (curlString: string) => Promise<void>;
  setActiveEnvironment: (name: string | null) => void;
  setActiveTab: (tab: AppState["activeTab"]) => void;
  setResponseTab: (tab: AppState["responseTab"]) => void;
  setLayout: (
    patch: Partial<Pick<AppState, "leftPanelWidth" | "rightPanelWidth" | "bottomPanelHeight" | "responsePlacement" | "leftPanelCollapsed" | "rightPanelCollapsed">>,
    options?: { persist?: boolean },
  ) => void;
  toggleHistory: () => Promise<void>;
  clearToasts: (id: number) => void;
  toast: (message: string, tone?: Toast["tone"]) => void;
};

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const useAppStore = create<AppState>((set, get) => ({
  openFolderPath: null,
  fileTree: [],
  activeFilePath: null,
  activeRequest: createScratchRequest(),
  activeEnvironmentEditor: null,
  isDirty: false,
  isSending: false,
  lastResponse: null,
  environments: [],
  activeEnvironmentName: null,
  history: [],
  isHistoryOpen: false,
  leftPanelWidth: 240,
  rightPanelWidth: 400,
  bottomPanelHeight: 320,
  responsePlacement: "right",
  leftPanelCollapsed: false,
  rightPanelCollapsed: false,
  activeTab: "params",
  responseTab: "body",
  statusMessage: "Ready",
  toasts: [],
  config: null,
  createDialog: null,

  async openNewWindow() {
    try {
      await api.openNewWindow();
    } catch (error) {
      get().toast(`Could not open new window: ${String(error)}`, "danger");
    }
  },

  async hydrate() {
    try {
      const config = await api.readConfig();
      if (isFreshWindow()) {
        set({
          config,
          openFolderPath: null,
          fileTree: [],
          activeFilePath: null,
          activeRequest: createScratchRequest(),
          activeEnvironmentEditor: null,
          environments: [],
          activeEnvironmentName: null,
          isDirty: false,
          lastResponse: null,
          leftPanelWidth: config.layout.leftPanelWidth,
          rightPanelWidth: config.layout.rightPanelWidth,
          bottomPanelHeight: config.layout.bottomPanelHeight ?? 320,
          responsePlacement: config.layout.responsePlacement ?? "right",
          leftPanelCollapsed: config.layout.leftPanelCollapsed,
          rightPanelCollapsed: config.layout.rightPanelCollapsed,
          statusMessage: "Scratch window",
        });
        return;
      }
      set({
        config,
        openFolderPath: config.lastOpenedFolder,
        activeFilePath: config.lastActiveFile,
        activeEnvironmentName: config.lastEnvironment,
        leftPanelWidth: config.layout.leftPanelWidth,
        rightPanelWidth: config.layout.rightPanelWidth,
        bottomPanelHeight: config.layout.bottomPanelHeight ?? 320,
        responsePlacement: config.layout.responsePlacement ?? "right",
        leftPanelCollapsed: config.layout.leftPanelCollapsed,
        rightPanelCollapsed: config.layout.rightPanelCollapsed,
      });
      if (config.lastOpenedFolder) {
        await get().openFolder(config.lastOpenedFolder);
      }
      if (config.lastActiveFile) {
        await get().selectFile(config.lastActiveFile);
      }
      if (!get().activeRequest && !get().activeEnvironmentEditor) {
        set({ activeRequest: createScratchRequest(), activeFilePath: null, isDirty: false });
      }
    } catch (error) {
      set({ activeRequest: createScratchRequest(), activeFilePath: null, activeEnvironmentEditor: null, isDirty: false });
      get().toast(String(error), "danger");
    }
  },

  async openFolder(path) {
    const folder = path ?? (await api.openFolderDialog());
    if (!folder) return;
    const tree = await api.listDirectory(folder);
    const environments = await loadEnvironments(tree);
    const config = updateConfig(get().config, {
      lastOpenedFolder: folder,
      recentFolders: [{ path: folder, lastOpened: new Date().toISOString() }],
    });
    set({
      openFolderPath: folder,
      fileTree: tree,
      environments,
      activeEnvironmentName: get().activeEnvironmentName ?? environments[0]?.name ?? null,
      config,
      statusMessage: `Opened ${folder}`,
    });
    await api.writeConfig(config);
  },

  async refreshTree() {
    const folder = get().openFolderPath;
    if (!folder) return;
    const tree = await api.listDirectory(folder);
    set({ fileTree: tree, environments: await loadEnvironments(tree) });
  },

  async selectFile(path) {
    try {
      const content = (await api.readRequestFile(path)) as RequestFile | Environment;
      if ("variables" in content) {
        const environment = content;
        set((state) => ({
          environments: upsertEnvironment(state.environments, environment),
          activeEnvironmentName: environment.name,
          activeEnvironmentEditor: environment,
          activeRequest: null,
          activeFilePath: path,
          isDirty: false,
          statusMessage: `Editing environment ${environment.name}`,
        }));
        return;
      }
      set({
        activeFilePath: path,
        activeRequest: normalizeRequest(content),
        activeEnvironmentEditor: null,
        isDirty: false,
        lastResponse: null,
        statusMessage: `Opened ${path}`,
      });
      const config = updateConfig(get().config, { lastActiveFile: path });
      set({ config });
      await api.writeConfig(config);
    } catch (error) {
      set({ activeRequest: createScratchRequest(), activeFilePath: null, activeEnvironmentEditor: null, isDirty: false });
      get().toast(`Could not open file: ${String(error)}. Started a scratch request instead.`, "danger");
    }
  },

  updateRequest(updater) {
    set((state) => {
      if (!state.activeRequest) return state;
      const next = updater(structuredClone(state.activeRequest));
      return { activeRequest: next, isDirty: true };
    });
    if (saveTimer) clearTimeout(saveTimer);
    if (get().activeFilePath) {
      saveTimer = setTimeout(() => void get().saveRequest(), 500);
    }
  },

  async saveRequest() {
    const { activeFilePath, activeRequest } = get();
    if (!activeRequest) return;
    if (!activeFilePath) {
      try {
        const folder = await api.openFolderDialog();
        if (!folder) return;
        const path = await api.createRequestFile(folder, activeRequest.name || "scratch-request");
        await api.writeRequestFile(path, activeRequest);
        await get().openFolder(folder);
        await get().selectFile(path);
        set({ isDirty: false, statusMessage: `Saved ${path}` });
        get().toast("Saved scratch request", "success");
      } catch (error) {
        get().toast(`Save failed: ${String(error)}`, "danger");
      }
      return;
    }
    try {
      await api.writeRequestFile(activeFilePath, activeRequest);
      set({ isDirty: false, statusMessage: "Saved" });
    } catch (error) {
      get().toast(`Save failed: ${String(error)}`, "danger");
    }
  },

  updateEnvironment(updater) {
    set((state) => {
      if (!state.activeEnvironmentEditor) return state;
      const next = updater(structuredClone(state.activeEnvironmentEditor));
      return {
        activeEnvironmentEditor: next,
        environments: upsertEnvironment(state.environments, next),
        activeEnvironmentName: next.name,
        isDirty: true,
      };
    });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void get().saveEnvironment(), 500);
  },

  async saveEnvironment() {
    const { activeFilePath, activeEnvironmentEditor } = get();
    if (!activeFilePath || !activeEnvironmentEditor) return;
    try {
      await api.writeRequestFile(activeFilePath, activeEnvironmentEditor);
      set({ isDirty: false, statusMessage: "Environment saved" });
    } catch (error) {
      get().toast(`Environment save failed: ${String(error)}`, "danger");
    }
  },

  async createRequest(folderPath, name) {
    const root = folderPath ?? get().openFolderPath;
    if (!root) {
      await get().openFolder();
      return;
    }
    if (!name) {
      set({ createDialog: { kind: "request", folderPath: root } });
      return;
    }
    const path = await api.createRequestFile(root, name);
    set({ createDialog: null });
    await get().refreshTree();
    await get().selectFile(path);
    get().toast("Created request", "success");
  },

  async createFolder(folderPath, name) {
    const root = folderPath ?? get().openFolderPath;
    if (!root) return;
    if (!name) {
      set({ createDialog: { kind: "folder", folderPath: root } });
      return;
    }
    await api.createDirectory(`${root}/${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`);
    set({ createDialog: null });
    await get().refreshTree();
  },

  closeCreateDialog() {
    set({ createDialog: null });
  },

  async sendRequest() {
    const { activeRequest, activeFilePath, environments, activeEnvironmentName } = get();
    if (!activeRequest) return;
    const env = environments.find((item) => item.name === activeEnvironmentName) ?? null;
    const allTexts = [
      activeRequest.request.url,
      ...activeRequest.request.params.map((row) => row.value),
      ...activeRequest.request.headers.map((row) => row.value),
      typeof activeRequest.request.body.content === "string" ? activeRequest.request.body.content : "",
    ];
    const missing = unresolvedVariables(allTexts, env);
    if (missing.length) {
      set({ statusMessage: `Unresolved variables: ${missing.join(", ")}` });
    }

    try {
      set({ isSending: true, statusMessage: "Sending request..." });
      const payload = buildSendPayload(activeRequest, env);
      const response = await api.sendRequest(payload);
      const entry: HistoryEntry = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        request: {
          method: activeRequest.request.method,
          url: activeRequest.request.url,
          resolvedUrl: payload.url,
          headers: payload.headers,
          body: payload.body,
        },
        response,
        environment: activeEnvironmentName,
        sourceFile: activeFilePath,
      };
      await api.saveHistory(entry);
      set({
        lastResponse: response,
        isSending: false,
        statusMessage: `${response.statusCode} ${response.statusText} in ${response.timeMs}ms`,
      });
    } catch (error) {
      set({
        isSending: false,
        lastResponse: {
          statusCode: 0,
          statusText: "Network Error",
          headers: {},
          body: humanizeNetworkError(String(error)),
          timeMs: 0,
          sizeBytes: 0,
          timing: { dnsMs: 0, connectMs: 0, tlsMs: 0, ttfbMs: 0, downloadMs: 0 },
        },
        statusMessage: "Request failed",
      });
    }
  },

  async importCurl(curlString) {
    try {
      const parsed = await api.parseCurl(curlString);
      const current = get().activeRequest ?? createDefaultRequest("Imported cURL");
      const next: RequestFile = {
        ...current,
        request: {
          ...current.request,
          method: parsed.method,
          url: parsed.url,
          params: parseParamsFromUrl(parsed.url),
          headers: parsed.headers.map((header) => ({
            enabled: true,
            key: header.key,
            value: header.value,
            description: "",
          })),
          body: parsed.body,
          auth: parsed.auth,
          settings: { ...current.request.settings, ...parsed.settings },
        },
      };
      set({ activeRequest: normalizeRequest(next), isDirty: true });
      get().toast(`Imported cURL: ${parsed.method}, ${parsed.headers.length} headers`, "success");
    } catch (error) {
      get().toast(`Could not parse cURL: ${String(error)}`, "danger");
    }
  },

  setActiveEnvironment(name) {
    set({ activeEnvironmentName: name });
    const config = updateConfig(get().config, { lastEnvironment: name });
    set({ config });
    void api.writeConfig(config);
  },

  setActiveTab(activeTab) {
    set({ activeTab });
  },

  setResponseTab(responseTab) {
    set({ responseTab });
  },

  setLayout(patch, options) {
    set(patch);
    if (options?.persist === false) return;
    const nextState = { ...get(), ...patch };
    const config = updateConfig(get().config, {
      layout: {
        leftPanelWidth: nextState.leftPanelWidth,
        rightPanelWidth: nextState.rightPanelWidth,
        bottomPanelHeight: nextState.bottomPanelHeight,
        responsePlacement: nextState.responsePlacement,
        leftPanelCollapsed: nextState.leftPanelCollapsed,
        rightPanelCollapsed: nextState.rightPanelCollapsed,
      },
    });
    set({ config });
    void api.writeConfig(config);
  },

  async toggleHistory() {
    const isHistoryOpen = !get().isHistoryOpen;
    set({ isHistoryOpen });
    if (isHistoryOpen) {
      set({ history: await api.loadHistory(0, 100) });
    }
  },

  toast(message, tone = "info") {
    const id = Date.now();
    set((state) => ({ toasts: [...state.toasts, { id, message, tone }] }));
    window.setTimeout(() => get().clearToasts(id), 3500);
  },

  clearToasts(id) {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },
}));

async function loadEnvironments(tree: FileNode[]): Promise<Environment[]> {
  const envFiles = flatten(tree).filter((node) => node.isEnvironment && !node.isDir && node.name.endsWith(".json"));
  const environments = await Promise.all(
    envFiles.map(async (node) => {
      try {
        return { ...((await api.readRequestFile(node.path)) as Environment), path: node.path };
      } catch {
        return null;
      }
    }),
  );
  return environments.filter(Boolean) as Environment[];
}

function flatten(nodes: FileNode[]): FileNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

function normalizeRequest(input: RequestFile): RequestFile {
  const request = createDefaultRequest(input.name || "Untitled Request");
  const params = input.request?.params?.length ? input.request.params : parseParamsFromUrl(input.request?.url ?? "");
  return {
    ...request,
    ...input,
    request: {
      ...request.request,
      ...input.request,
      params,
      headers: input.request?.headers ?? [],
      body: input.request?.body ?? request.request.body,
      auth: input.request?.auth ?? request.request.auth,
      settings: { ...request.request.settings, ...input.request?.settings },
    },
    meta: { ...request.meta, ...input.meta },
  };
}

function createScratchRequest(): RequestFile {
  const request = createDefaultRequest("Scratch Request");
  request.meta.description = "Unsaved request. Save to choose a folder and create a .json file.";
  return request;
}

function isFreshWindow() {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has("fresh") || Boolean((window as Window & { __TAND_FRESH_WINDOW__?: boolean }).__TAND_FRESH_WINDOW__);
}

function upsertEnvironment(environments: Environment[], environment: Environment) {
  const existing = environments.filter((item) => item.name !== environment.name);
  return [...existing, environment];
}

function updateConfig(config: AppConfig | null, patch: Partial<AppConfig>): AppConfig {
  const base: AppConfig = config ?? {
    version: 1,
    recentFolders: [],
    lastOpenedFolder: null,
    lastActiveFile: null,
    lastEnvironment: null,
    theme: "dark",
    layout: { leftPanelWidth: 240, rightPanelWidth: 400, bottomPanelHeight: 320, responsePlacement: "right", leftPanelCollapsed: false, rightPanelCollapsed: false },
    history: { maxEntries: 500 },
    editor: { fontSize: 13, wordWrap: false },
  };
  const recent = patch.recentFolders?.[0]
    ? [patch.recentFolders[0], ...base.recentFolders.filter((folder) => folder.path !== patch.recentFolders?.[0]?.path)].slice(0, 5)
    : base.recentFolders;
  return {
    ...base,
    ...patch,
    recentFolders: recent,
    layout: { ...base.layout, ...patch.layout },
    history: { ...base.history, ...patch.history },
    editor: { ...base.editor, ...patch.editor },
  };
}

function humanizeNetworkError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("timeout")) return "Request timed out. Increase the timeout in request settings and try again.";
  if (lower.includes("certificate") || lower.includes("ssl")) {
    return "SSL certificate verification failed. You can disable SSL verification in request settings for self-signed servers.";
  }
  if (lower.includes("dns") || lower.includes("resolve")) return "Could not resolve hostname.";
  if (lower.includes("connection refused")) return "Could not connect to server. Is it running?";
  return message;
}

export function resolveFromStore(text: string) {
  const state = useAppStore.getState();
  const env = state.environments.find((item) => item.name === state.activeEnvironmentName);
  return resolveVariables(text, env);
}
