import type { Auth, Environment, HttpMethod, KeyValueRow, RequestBody, RequestFile } from "../types";
import { resolveVariables } from "./variables";

export const methodColors: Record<string, string> = {
  GET: "method-get",
  POST: "method-post",
  PUT: "method-put",
  PATCH: "method-patch",
  DELETE: "method-delete",
  HEAD: "method-neutral",
  OPTIONS: "method-neutral",
};

export function emptyRow(): KeyValueRow {
  return { enabled: true, key: "", value: "", description: "" };
}

export function createDefaultRequest(name = "Untitled Request"): RequestFile {
  const now = new Date().toISOString();
  return {
    $schema: "https://flare-app.dev/schema/request/v1.json",
    name,
    request: {
      method: "GET",
      url: "",
      params: [],
      headers: [],
      body: { type: "none", content: null },
      auth: { type: "none" },
      settings: { followRedirects: true, verifySsl: true, timeoutMs: 30000, proxy: null },
    },
    meta: { description: "", tags: [], createdAt: now, updatedAt: now },
  };
}

export function parseParamsFromUrl(url: string): KeyValueRow[] {
  try {
    const parsed = new URL(url);
    return [...parsed.searchParams.entries()].map(([key, value]) => ({
      enabled: true,
      key,
      value,
      description: "",
    }));
  } catch {
    const query = url.split("?")[1]?.split("#")[0];
    if (!query) return [];
    return query.split("&").filter(Boolean).map((part) => {
      const [key = "", value = ""] = part.split("=");
      return {
        enabled: true,
        key: decodeURIComponent(key),
        value: decodeURIComponent(value),
        description: "",
      };
    });
  }
}

export function syncUrlParams(url: string, rows: KeyValueRow[]): string {
  const enabled = rows.filter((row) => row.enabled && row.key.trim());
  try {
    const parsed = new URL(url || "http://placeholder.local");
    parsed.search = "";
    enabled.forEach((row) => parsed.searchParams.append(row.key, row.value));
    if (!/^https?:\/\//i.test(url)) {
      return parsed.pathname.replace(/^\/?/, "") + parsed.search + parsed.hash;
    }
    return parsed.toString();
  } catch {
    const [base] = url.split("?");
    const query = enabled
      .map((row) => `${encodeURIComponent(row.key)}=${encodeURIComponent(row.value)}`)
      .join("&");
    return query ? `${base}?${query}` : base;
  }
}

export function requestBodyToString(body: RequestBody, env?: Environment | null): string | null {
  if (body.type === "none" || body.content == null) return null;
  if (typeof body.content === "string") {
    const content = resolveVariables(body.content, env);
    return content.length ? content : null;
  }
  if (body.type === "form-urlencoded") {
    return body.content
      .filter((row) => row.enabled && row.key)
      .map((row) => `${encodeURIComponent(row.key)}=${encodeURIComponent(resolveVariables(row.value, env))}`)
      .join("&");
  }
  return JSON.stringify(body.content.filter((row) => row.enabled));
}

export function buildSendPayload(request: RequestFile, env?: Environment | null) {
  const resolvedUrl = resolveVariables(syncUrlParams(request.request.url, request.request.params), env);
  const headers: Record<string, string> = {};
  request.request.headers
    .filter((row) => row.enabled && row.key.trim())
    .forEach((row) => {
      headers[row.key] = resolveVariables(row.value, env);
    });

  const auth = request.request.auth;
  if (auth.type === "bearer" && auth.token) {
    headers.Authorization = `Bearer ${resolveVariables(auth.token, env)}`;
  }
  if (auth.type === "basic" && (auth.username || auth.password)) {
    const token = btoa(`${resolveVariables(auth.username, env)}:${resolveVariables(auth.password, env)}`);
    headers.Authorization = `Basic ${token}`;
  }
  if (auth.type === "api-key" && auth.key && auth.value) {
    if (auth.location === "header") {
      headers[auth.key] = resolveVariables(auth.value, env);
    }
  }

  let finalUrl = resolvedUrl;
  if (auth.type === "api-key" && auth.location === "query" && auth.key && auth.value) {
    finalUrl = syncUrlParams(finalUrl, [
      ...parseParamsFromUrl(finalUrl),
      { enabled: true, key: auth.key, value: resolveVariables(auth.value, env), description: "" },
    ]);
  }

  const body = ["GET", "HEAD"].includes(request.request.method) ? null : requestBodyToString(request.request.body, env);
  if (request.request.body.type === "json" && body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  if (request.request.body.type === "form-urlencoded" && body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }

  return {
    method: request.request.method,
    url: finalUrl,
    headers,
    body,
    settings: request.request.settings,
  };
}

export function copyAsCurl(request: RequestFile, env?: Environment | null, resolved = true): string {
  const payload = buildSendPayload(request, resolved ? env : null);
  const parts = ["curl", "-X", payload.method, shellQuote(payload.url)];
  Object.entries(payload.headers).forEach(([key, value]) => {
    parts.push("-H", shellQuote(`${key}: ${value}`));
  });
  if (payload.body) {
    parts.push("--data-raw", shellQuote(payload.body));
  }
  return parts.join(" ");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function coerceMethod(value: string): HttpMethod {
  const method = value.toUpperCase();
  return ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(method)
    ? (method as HttpMethod)
    : "GET";
}

export function normalizeAuth(auth: Auth): Auth {
  return auth?.type ? auth : { type: "none" };
}
