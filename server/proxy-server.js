#!/usr/bin/env node
/**
 * Minimal reverse proxy for the SEA-STYLE endpoints with permissive CORS headers.
 *
 * Usage:
 *   node server/proxy-server.js
 *
 * Environment variables:
 *   PORT                     Port to listen on (default: 8787)
 *   SEA_STYLE_TARGET_ORIGIN  Upstream origin to proxy (default: https://sea-style-m.yamaha-motor.co.jp)
 */

const { createServer } = require("http");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 8787);
const TARGET_ORIGIN = process.env.SEA_STYLE_TARGET_ORIGIN || "https://sea-style-m.yamaha-motor.co.jp";

createServer(async (req, res) => {
  if (handleCorsPreflight(req, res)) {
    return;
  }

  try {
    const targetUrl = new URL(req.url, TARGET_ORIGIN);
    const init = await createProxyInit(req);
    const response = await fetch(targetUrl, init);

    res.statusCode = response.status;
    copyHeaders(response, res);
    setCorsHeaders(res);

    const buffer = Buffer.from(await response.arrayBuffer());
    res.end(buffer);
  } catch (error) {
    console.error("Proxy error", error);
    res.statusCode = 502;
    setCorsHeaders(res);
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Proxy request failed", detail: error.message || String(error) }));
  }
}).listen(PORT, () => {
  console.log(`SEA-STYLE proxy listening on http://localhost:${PORT} -> ${TARGET_ORIGIN}`);
});

function handleCorsPreflight(req, res) {
  if (req.method !== "OPTIONS") {
    return false;
  }
  setCorsHeaders(res);
  res.statusCode = 204;
  res.end();
  return true;
}

function setCorsHeaders(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-credentials", "true");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "Content-Type,X-Requested-With");
  res.setHeader("access-control-expose-headers", "*");
}

async function createProxyInit(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue;
    if (key.toLowerCase() === "host") continue;
    if (Array.isArray(value)) {
      value.forEach((entry) => headers.append(key, entry));
    } else {
      headers.set(key, value);
    }
  }

  const body = await readRequestBody(req);
  const init = {
    method: req.method,
    headers,
    redirect: "manual",
  };

  if (body != null) {
    init.body = body;
  }

  return init;
}

function copyHeaders(response, res) {
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") {
      return;
    }
    res.setHeader(key, value);
  });
}

async function readRequestBody(req) {
  if (req.method === "GET" || req.method === "HEAD") {
    return null;
  }
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return null;
  }
  return Buffer.concat(chunks);
}
