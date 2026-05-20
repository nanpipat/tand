export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export type KeyValueRow = {
  enabled: boolean;
  key: string;
  value: string;
  description?: string;
};

export type BodyType = "none" | "json" | "form-data" | "form-urlencoded" | "raw" | "binary";

export type RequestBody = {
  type: BodyType;
  content: string | KeyValueRow[] | null;
  contentType?: string;
};

export type Auth =
  | { type: "none" | "custom" }
  | { type: "bearer"; token: string }
  | { type: "basic"; username: string; password: string }
  | { type: "api-key"; key: string; value: string; location: "header" | "query" };

export type RequestSettings = {
  followRedirects: boolean;
  verifySsl: boolean;
  timeoutMs: number;
  proxy: string | null;
};

export type RequestFile = {
  $schema?: string;
  name: string;
  request: {
    method: HttpMethod;
    url: string;
    params: KeyValueRow[];
    headers: KeyValueRow[];
    body: RequestBody;
    auth: Auth;
    settings: RequestSettings;
  };
  meta: {
    description: string;
    tags: string[];
    createdAt: string;
    updatedAt: string;
  };
};

export type FileNode = {
  name: string;
  path: string;
  isDir: boolean;
  isEnvironment: boolean;
  method?: HttpMethod;
  children: FileNode[];
};

export type EnvironmentVariable = {
  key: string;
  value: string;
  enabled: boolean;
  secret: boolean;
};

export type Environment = {
  name: string;
  path?: string;
  variables: EnvironmentVariable[];
};

export type HttpResponse = {
  statusCode: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  timeMs: number;
  sizeBytes: number;
  timing: {
    dnsMs: number;
    connectMs: number;
    tlsMs: number;
    ttfbMs: number;
    downloadMs: number;
  };
};

export type HistoryEntry = {
  id: string;
  timestamp: string;
  request: {
    method: HttpMethod;
    url: string;
    resolvedUrl: string;
    headers: Record<string, string>;
    body: string | null;
  };
  response: HttpResponse;
  environment: string | null;
  sourceFile: string | null;
};

export type ParsedCurl = {
  method: HttpMethod;
  url: string;
  headers: Array<{ key: string; value: string }>;
  body: RequestBody;
  auth: Auth;
  settings: Partial<RequestSettings>;
};

export type AppConfig = {
  version: number;
  recentFolders: Array<{ path: string; lastOpened: string }>;
  lastOpenedFolder: string | null;
  lastActiveFile: string | null;
  lastEnvironment: string | null;
  theme: "dark";
  layout: {
    leftPanelWidth: number;
    rightPanelWidth: number;
    bottomPanelHeight?: number;
    responsePlacement?: "right" | "bottom";
    leftPanelCollapsed: boolean;
    rightPanelCollapsed: boolean;
  };
  history: { maxEntries: number };
  editor: { fontSize: number; wordWrap: boolean };
};
