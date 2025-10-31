// src/api/seaStyleApi.js

// デフォルトのAPIベースURLを /api/proxy に設定（Vercelのサーバーレス関数経由）
export const DEFAULT_BASE_URL = "/api/proxy";

/**
 * 実行環境（ブラウザ or Node）に応じて origin を解決
 */
function getDefaultOrigin() {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  if (typeof globalThis !== "undefined" && globalThis.location?.origin) {
    return globalThis.location.origin;
  }
  return "http://localhost";
}

/**
 * baseUrlが相対指定のときも正しく解決する
 */
function resolveProxyBase(baseUrl) {
  try {
    return new URL(baseUrl);
  } catch (error) {
    return new URL(baseUrl, getDefaultOrigin());
  }
}

/**
 * URLに path パラメータを使用する必要があるか判定
 */
function shouldUsePathParameter(url) {
  if (url.searchParams.has("path")) return true;
  const pathname = url.pathname || "";
  return pathname.includes("/api/proxy") || pathname.endsWith("/proxy");
}

/**
 * 実際にリクエスト先URLを組み立てる
 */
function createProxyUrl(baseUrl, targetPath) {
  const base = resolveProxyBase(baseUrl);
  const url = new URL(base.toString());

  if (shouldUsePathParameter(url)) {
    url.searchParams.set("path", targetPath);
    return url;
  }

  return new URL(targetPath, url);
}

/**
 * クラブ艇の空き状況を取得
 */
export async function fetchClubBoatEmptyList(baseUrl = DEFAULT_BASE_URL, bodyPayload = {}) {
  const url = createProxyUrl(baseUrl, "/api/Reserve/GetClubBoatEmptyList");

  // デバッグ用ログ
  console.log("プロキシ経由でクラブ艇空き状況APIを呼び出します", {
    url: url.toString(),
    payload: bodyPayload,
  });

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bodyPayload),
  });
  return response.json();
}

/**
 * HTMLの空き状況を取得
 */
export async function fetchAvailabilityHtml(baseUrl = DEFAULT_BASE_URL, path, query = {}) {
  const targetSearch = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value != null) targetSearch.set(key, value);
  });
  targetSearch.set("format", "partial");

  const targetPath = `${path}?${targetSearch.toString()}`;
  const url = createProxyUrl(baseUrl, targetPath);

  console.log("プロキシ経由でHTMLの空き状況を取得します", {
    url: url.toString(),
  });

  const response = await fetch(url.toString());
  return response.text();
}

/**
 * マリーナ一覧を取得
 */
export async function fetchMarinaList(baseUrl = DEFAULT_BASE_URL, body = {}) {
  const url = createProxyUrl(baseUrl, "/api/Reserve/GetMarinaList");

  console.log("プロキシ経由でマリーナ一覧APIを呼び出します", {
    url: url.toString(),
    payload: body,
  });

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json();
}

/**
 * 代替マリーナAPI
 */
export async function fetchAlternativeMarina(baseUrl = DEFAULT_BASE_URL, endpoint) {
  const url = createProxyUrl(baseUrl, endpoint.path);

  console.log("プロキシ経由で代替マリーナAPIを呼び出します", {
    url: url.toString(),
    method: endpoint.method,
  });

  const response = await fetch(url.toString(), { method: endpoint.method });
  return response.json();
}
