export const DEFAULT_BASE_URL = "https://sea-style-m.yamaha-motor.co.jp";

const DEFAULT_STRATEGIES = [attemptJsonApi, attemptAjaxHtml];
const DEFAULT_MARINA_DIRECTORY_STRATEGIES = [
  attemptMarinaDirectoryApi,
  attemptMarinaDirectoryAlternate,
];

const STATUS_LABELS = Object.freeze({
  vacant: "空きあり",
  few: "残りわずか",
  full: "満席",
  unknown: "状況不明",
});

export const AVAILABILITY_STATUS_LABELS = STATUS_LABELS;

export class SeaStyleApi {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || DEFAULT_BASE_URL;
    this.fetchImpl = options.fetch || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
    this.strategies = Array.isArray(options.strategies) && options.strategies.length > 0
      ? options.strategies
      : DEFAULT_STRATEGIES;
    this.marinaDirectoryStrategies =
      Array.isArray(options.marinaDirectoryStrategies) && options.marinaDirectoryStrategies.length > 0
        ? options.marinaDirectoryStrategies
        : DEFAULT_MARINA_DIRECTORY_STRATEGIES;

    if (!this.fetchImpl) {
      throw new Error("fetch API が利用できません。ブラウザ環境またはフェッチ関数を指定してください。");
    }
  }

  async fetchDayAvailability({ marinaCd, isoDate, signal } = {}) {
    if (!marinaCd) {
      throw new Error("marinaCd は必須です。");
    }
    if (!isoDate) {
      throw new Error("isoDate は必須です。");
    }

    const context = {
      baseUrl: this.baseUrl,
      marinaCd,
      isoDate,
      fetchImpl: this.fetchImpl,
      signal,
    };

    let lastError;
    for (const strategy of this.strategies) {
      try {
        const result = await strategy(context);
        if (!result) {
          continue;
        }
        const normalized = normalizePayload(result.payload);
        return {
          ...normalized,
          debug: {
            strategy: result.meta?.strategy ?? strategy.name ?? "unknown",
            endpoint: result.meta?.url ?? null,
            rawPayload: result.payload,
            responseHeaders: result.meta?.headers ?? null,
          },
        };
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError) {
      throw lastError;
    }

    throw new Error("空き情報を取得できませんでした。");
  }

  async fetchMarinaDirectory({ signal } = {}) {
    let lastError;
    for (const strategy of this.marinaDirectoryStrategies) {
      try {
        const result = await strategy({
          baseUrl: this.baseUrl,
          fetchImpl: this.fetchImpl,
          signal,
        });
        if (!result) {
          continue;
        }

        const normalized = normalizeMarinaDirectory(result.payload);
        if (normalized.length > 0) {
          return {
            marinas: normalized,
            meta: {
              strategy: result.meta?.strategy ?? strategy.name ?? "unknown",
              endpoint: result.meta?.url ?? null,
              responseHeaders: result.meta?.headers ?? null,
            },
            raw: result.payload,
          };
        }
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError) {
      throw lastError;
    }

    return { marinas: [], raw: null };
  }
}

async function attemptJsonApi({ baseUrl, marinaCd, isoDate, fetchImpl, signal }) {
  const url = new URL("/api/Reserve/GetClubBoatEmptyList", baseUrl);
  const payloadCandidates = [
    {
      marinaCd,
      targetDate: isoDate,
      serviceType: "clubBoat",
    },
    {
      marinaCd,
      targetDate: isoDate.replaceAll("-", ""),
      serviceType: "clubBoat",
    },
  ];

  const headers = {
    "Content-Type": "application/json;charset=UTF-8",
    "X-Requested-With": "XMLHttpRequest",
  };

  let lastError;
  for (const bodyPayload of payloadCandidates) {
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(bodyPayload),
        signal,
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = response.headers.get("content-type") || "";
      const meta = {
        strategy: "jsonApi",
        url: response.url,
        headers: serializeHeaders(response.headers),
      };

      if (contentType.includes("application/json")) {
        const payload = await response.json();
        return { payload, meta };
      }

      const text = await response.text();
      try {
        const payload = JSON.parse(text);
        return { payload, meta };
      } catch (error) {
        return { payload: text, meta };
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    throw lastError;
  }
  return null;
}

async function attemptAjaxHtml({ baseUrl, marinaCd, isoDate, fetchImpl, signal }) {
  const queryVariants = [
    { targetDate: isoDate, marinaCd },
    { targetDate: isoDate.replaceAll("-", ""), marinaCd },
    { target_date: isoDate, marina_cd: marinaCd },
  ];

  const pathCandidates = [
    "/Marina/Info/ClubBoatEmptyList",
    "/Marina/Info/EmptyList",
    "/Marina/Info/ReserveFrame",
    "/Marina/Info/ClubBoat/EmptyList",
  ];

  let lastError;
  for (const path of pathCandidates) {
    for (const query of queryVariants) {
      try {
        const url = new URL(path, baseUrl);
        Object.entries(query).forEach(([key, value]) => {
          if (value != null) {
            url.searchParams.set(key, value);
          }
        });
        url.searchParams.set("format", "partial");

        const response = await fetchImpl(url, {
          method: "GET",
          headers: {
            "X-Requested-With": "XMLHttpRequest",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
          signal,
          credentials: "include",
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const text = await response.text();
        if (text && text.trim()) {
          return {
            payload: text,
            meta: {
              strategy: "ajaxHtml",
              url: response.url,
              headers: serializeHeaders(response.headers),
            },
          };
        }
      } catch (error) {
        lastError = error;
      }
    }
  }

  if (lastError) {
    throw lastError;
  }
  return null;
}

async function attemptMarinaDirectoryApi({ baseUrl, fetchImpl, signal }) {
  const url = new URL("/api/Reserve/GetMarinaList", baseUrl);
  const payloadCandidates = [
    { serviceType: "clubBoat" },
    { productType: "clubBoat" },
    { menuType: "clubBoat" },
    {},
  ];

  const headers = {
    "Content-Type": "application/json;charset=UTF-8",
    "X-Requested-With": "XMLHttpRequest",
  };

  let lastError;
  for (const body of payloadCandidates) {
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = response.headers.get("content-type") || "";
      const meta = {
        strategy: "marinaDirectoryApi",
        url: response.url,
        headers: serializeHeaders(response.headers),
      };

      if (contentType.includes("application/json")) {
        const payload = await response.json();
        return { payload, meta };
      }

      const text = await response.text();
      try {
        const payload = JSON.parse(text);
        return { payload, meta };
      } catch (error) {
        return { payload: text, meta };
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    throw lastError;
  }

  return null;
}

async function attemptMarinaDirectoryAlternate({ baseUrl, fetchImpl, signal }) {
  const endpoints = [
    { path: "/api/Common/GetMarinaList", method: "POST", body: {} },
    { path: "/api/Common/GetMarinaList", method: "GET" },
    { path: "/api/Marina/GetMarinaList", method: "POST", body: {} },
  ];

  for (const endpoint of endpoints) {
    try {
      const url = new URL(endpoint.path, baseUrl);
      const response = await fetchImpl(url, {
        method: endpoint.method,
        headers: {
          "Content-Type": "application/json;charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: endpoint.body ? JSON.stringify(endpoint.body) : undefined,
        signal,
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = response.headers.get("content-type") || "";
      const meta = {
        strategy: "marinaDirectoryAlternate",
        url: response.url,
        headers: serializeHeaders(response.headers),
      };

      if (contentType.includes("application/json")) {
        const payload = await response.json();
        return { payload, meta };
      }

      const text = await response.text();
      try {
        const payload = JSON.parse(text);
        return { payload, meta };
      } catch (error) {
        return { payload: text, meta };
      }
    } catch (error) {
      // 続く候補を試行
    }
  }

  return null;
}

function normalizePayload(payload) {
  if (payload == null) {
    return {
      groups: [],
      summary: createSummary([]),
      raw: payload,
    };
  }

  if (typeof payload === "string") {
    const htmlResult = parseHtmlPayload(payload);
    return {
      ...htmlResult,
      raw: payload,
    };
  }

  if (typeof payload !== "object") {
    return {
      groups: [],
      summary: createSummary([]),
      raw: payload,
    };
  }

  const groups = extractGroupsFromObject(payload);
  return {
    groups,
    summary: createSummary(groups),
    raw: payload,
  };
}

function extractGroupsFromObject(payload) {
  const queue = [];
  const visited = new Set();
  const collected = [];

  const enqueue = (value, title) => {
    if (value == null) {
      return;
    }
    const isObject = typeof value === "object";
    if (isObject) {
      if (visited.has(value)) {
        return;
      }
      visited.add(value);
    }
    queue.push({ value, title: title ?? "" });
  };

  const seedTitles = [
    payload.title,
    payload.menuName,
    payload.boatName,
    payload.goodsName,
  ].filter(Boolean);

  enqueue(payload, seedTitles[0]);

  while (queue.length) {
    const { value, title } = queue.shift();

    if (Array.isArray(value)) {
      const slots = value
        .map((item) => normalizeSlot(item, title))
        .filter(Boolean);
      if (slots.length > 0) {
        collected.push({ title: title || "クラブ艇", slots });
        continue;
      }

      value.forEach((item) => {
        if (item && typeof item === "object") {
          const nestedTitle =
            item.boatName ||
            item.menuName ||
            item.goodsName ||
            item.itemName ||
            item.title ||
            title;
          enqueue(item, nestedTitle);
        }
      });
      continue;
    }

    if (typeof value === "object") {
      const nestedTitle =
        value.boatName ||
        value.menuName ||
        value.goodsName ||
        value.itemName ||
        value.title ||
        title;

      Object.entries(value).forEach(([key, nested]) => {
        if (Array.isArray(nested)) {
          enqueue(nested, nestedTitle || humanizeKey(key));
        } else if (nested && typeof nested === "object") {
          enqueue(nested, nestedTitle || humanizeKey(key));
        }
      });
      continue;
    }
  }

  const merged = mergeGroups(collected);
  return merged.length > 0 ? merged : [];
}

function mergeGroups(groups) {
  const map = new Map();
  groups.forEach(({ title, slots }) => {
    const key = title || "クラブ艇";
    const existing = map.get(key);
    if (existing) {
      existing.push(...slots);
    } else {
      map.set(key, [...slots]);
    }
  });

  return Array.from(map.entries()).map(([title, slots]) => ({
    title,
    slots: sortSlots(slots),
  }));
}

function sortSlots(slots) {
  return [...slots].sort((a, b) => {
    const aKey = a.sortKey ?? Number.POSITIVE_INFINITY;
    const bKey = b.sortKey ?? Number.POSITIVE_INFINITY;
    if (aKey !== bKey) {
      return aKey - bKey;
    }
    return (a.timeText || "").localeCompare(b.timeText || "");
  });
}

function normalizeSlot(raw, fallbackTitle) {
  if (raw == null) {
    return null;
  }

  if (typeof raw === "string") {
    return normalizeStringSlot(raw);
  }

  if (typeof raw !== "object") {
    return null;
  }

  const timeText = extractTimeText(raw);
  const status = determineStatus(raw, timeText);
  const note = extractNote(raw);
  const boatName =
    raw.boatName ||
    raw.menuName ||
    raw.goodsName ||
    raw.itemName ||
    raw.vesselName ||
    raw.shipName ||
    fallbackTitle ||
    "";

  if (!timeText && !note && !status) {
    return null;
  }

  const slot = {
    timeText,
    statusKey: status.key,
    statusLabel: status.label,
    note,
    boatName,
    raw,
  };

  const sortKey = buildSortKey(timeText, raw);
  if (typeof sortKey === "number" && Number.isFinite(sortKey)) {
    slot.sortKey = sortKey;
  }

  if (status.originalText) {
    slot.statusRaw = status.originalText;
  }

  return slot;
}

function normalizeStringSlot(text) {
  const trimmed = String(text).trim();
  if (!trimmed) {
    return null;
  }

  const timeMatch = trimmed.match(/([0-2]?\d[:時][0-5]\d)\s*[〜~\-ー―]\s*([0-2]?\d[:時][0-5]\d)/);
  let timeText = null;
  if (timeMatch) {
    const start = normalizeTimeNotation(timeMatch[1]);
    const end = normalizeTimeNotation(timeMatch[2]);
    timeText = `${start}〜${end}`;
  }

  const status = mapStatusFromValue(trimmed);

  return {
    timeText,
    statusKey: status.key,
    statusLabel: status.label,
    statusRaw: status.originalText,
    note: trimmed,
    raw: text,
    sortKey: buildSortKey(timeText),
  };
}

function extractTimeText(raw) {
  const candidates = [
    raw.time,
    raw.timeText,
    raw.timeZone,
    raw.timezone,
    raw.timeRange,
    raw.time_range,
    raw.displayTime,
    raw.display_time,
    raw.timeSlot,
    raw.time_slot,
    raw.reserveTime,
    raw.reserve_time,
    raw.serviceTime,
    raw.service_time,
  ];

  for (const candidate of candidates) {
    if (candidate) {
      return normalizeTimeRangeText(String(candidate));
    }
  }

  const startCandidates = [
    raw.startTime,
    raw.start_time,
    raw.startTm,
    raw.fromTime,
    raw.from_time,
    raw.start,
  ];

  const endCandidates = [
    raw.endTime,
    raw.end_time,
    raw.endTm,
    raw.toTime,
    raw.to_time,
    raw.end,
  ];

  const start = startCandidates.find(Boolean);
  const end = endCandidates.find(Boolean);
  if (start || end) {
    const startText = start ? normalizeTimeNotation(String(start)) : "";
    const endText = end ? normalizeTimeNotation(String(end)) : "";
    if (startText || endText) {
      return `${startText}${startText && endText ? "〜" : ""}${endText}`;
    }
  }

  if (typeof raw.timeLabel === "string") {
    return normalizeTimeRangeText(raw.timeLabel);
  }

  return null;
}

function normalizeTimeRangeText(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const parts = trimmed.split(/[〜~\-ー―]/).map((part) => part.trim());
  if (parts.length === 2) {
    const [start, end] = parts;
    const startText = normalizeTimeNotation(start);
    const endText = normalizeTimeNotation(end);
    if (startText || endText) {
      return `${startText}${startText && endText ? "〜" : ""}${endText}`;
    }
  }

  return trimmed;
}

function normalizeTimeNotation(text) {
  if (!text) {
    return "";
  }
  const digits = text.replace(/[時分]/g, ":").replace(/[^0-9:]/g, "");
  if (!digits) {
    return text.trim();
  }
  const [hourPart, minutePart = "00"] = digits.split(":");
  const hour = hourPart.padStart(2, "0");
  const minute = minutePart.padStart(2, "0").slice(0, 2);
  return `${hour}:${minute}`;
}

function extractNote(raw) {
  const parts = [];
  const noteFields = [
    "note",
    "memo",
    "remark",
    "remarks",
    "message",
    "comment",
    "supplement",
    "capacity",
    "acceptCount",
    "remainingCount",
    "remaining",
    "remain",
    "acceptableCount",
    "stock",
  ];

  noteFields.forEach((field) => {
    if (raw[field] != null && raw[field] !== "") {
      const value = typeof raw[field] === "number" ? raw[field] : String(raw[field]).trim();
      if (value !== "") {
        const label = humanizeKey(field);
        parts.push(`${label}: ${value}`);
      }
    }
  });

  if (raw.planName) {
    parts.unshift(String(raw.planName));
  }

  if (Array.isArray(raw.notes)) {
    raw.notes
      .map((item) => (typeof item === "string" ? item.trim() : JSON.stringify(item)))
      .filter(Boolean)
      .forEach((item) => parts.push(item));
  }

  return parts.length > 0 ? parts.join(" ／ ") : null;
}

function determineStatus(raw, timeText) {
  const statusCandidates = [
    raw.status,
    raw.statusText,
    raw.status_label,
    raw.statusLabel,
    raw.reserveStatus,
    raw.reserve_status,
    raw.reserveStatusKbn,
    raw.reserveStatusCd,
    raw.emptyFlag,
    raw.emptyFlg,
    raw.emptyKbn,
    raw.emptyStatus,
    raw.availability,
    raw.stockStatus,
    raw.stockKbn,
    raw.symbol,
  ];

  for (const candidate of statusCandidates) {
    if (candidate != null) {
      const mapped = mapStatusFromValue(candidate);
      if (mapped.key !== "unknown" || mapped.originalText) {
        return mapped;
      }
    }
  }

  if (typeof timeText === "string") {
    return mapStatusFromValue(timeText);
  }

  return { key: "unknown", label: STATUS_LABELS.unknown };
}

function mapStatusFromValue(value) {
  if (value == null) {
    return { key: "unknown", label: STATUS_LABELS.unknown };
  }

  if (typeof value === "boolean") {
    return value
      ? { key: "vacant", label: STATUS_LABELS.vacant, originalText: value }
      : { key: "full", label: STATUS_LABELS.full, originalText: value };
  }

  if (typeof value === "number") {
    if (value === 0) {
      return { key: "vacant", label: STATUS_LABELS.vacant, originalText: value };
    }
    if (value === 1) {
      return { key: "few", label: STATUS_LABELS.few, originalText: value };
    }
    if (value >= 2) {
      return { key: "full", label: STATUS_LABELS.full, originalText: value };
    }
  }

  const text = String(value).trim();
  if (!text) {
    return { key: "unknown", label: STATUS_LABELS.unknown, originalText: value };
  }

  const lower = text.toLowerCase();
  const contains = (pattern) => pattern.test(text) || pattern.test(lower);

  if (contains(/[◯○◎〇可空余availablevacant余裕]/)) {
    return { key: "vacant", label: STATUS_LABELS.vacant, originalText: value };
  }

  if (contains(/[△残僅少fewlessわずか]/)) {
    return { key: "few", label: STATUS_LABELS.few, originalText: value };
  }

  if (contains(/[×✕✖✗╳満無full不可締]/)) {
    return { key: "full", label: STATUS_LABELS.full, originalText: value };
  }

  return { key: "unknown", label: STATUS_LABELS.unknown, originalText: value };
}

function buildSortKey(timeText, raw = {}) {
  if (typeof raw.sortKey === "number" && Number.isFinite(raw.sortKey)) {
    return raw.sortKey;
  }
  if (!timeText) {
    return null;
  }

  const match = timeText.match(/([0-2]?\d)[:時]([0-5]\d)/);
  if (match) {
    const hour = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);
    return hour * 60 + minute;
  }

  return null;
}

function createSummary(groups) {
  const summary = {
    total: 0,
    statuses: {
      vacant: 0,
      few: 0,
      full: 0,
      unknown: 0,
    },
  };

  groups.forEach((group) => {
    group.slots.forEach((slot) => {
      summary.total += 1;
      const key = slot.statusKey && summary.statuses[slot.statusKey] != null ? slot.statusKey : "unknown";
      summary.statuses[key] += 1;
    });
  });

  return summary;
}

function parseHtmlPayload(htmlText) {
  if (typeof DOMParser === "undefined") {
    return {
      groups: [],
      summary: createSummary([]),
      rawHtml: htmlText,
    };
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlText, "text/html");
  const groups = [];

  const tables = Array.from(doc.querySelectorAll("table"));
  tables.forEach((table) => {
    const title = resolveTitle(table);
    const slots = [];
    Array.from(table.querySelectorAll("tbody tr")).forEach((row) => {
      const cells = Array.from(row.querySelectorAll("td"));
      if (cells.length === 0) {
        return;
      }
      if (row.querySelector("th")) {
        return;
      }
      const timeCell = cells[0]?.textContent?.trim();
      const statusCell = cells[1]?.textContent?.trim();
      if (!timeCell && !statusCell) {
        return;
      }
      const status = mapStatusFromValue(statusCell || timeCell);
      const noteCell = cells.slice(2).map((cell) => cell.textContent?.trim()).filter(Boolean).join(" ／ ");
      slots.push({
        timeText: normalizeTimeRangeText(timeCell || ""),
        statusKey: status.key,
        statusLabel: status.label,
        statusRaw: status.originalText,
        note: noteCell || null,
        raw: row.outerHTML,
        sortKey: buildSortKey(timeCell || ""),
      });
    });
    if (slots.length > 0) {
      groups.push({ title, slots: sortSlots(slots) });
    }
  });

  if (groups.length === 0) {
    const candidates = Array.from(doc.querySelectorAll("[data-time], .time, .status"));
    const slots = candidates
      .map((node) => {
        const time = node.getAttribute?.("data-time") || node.textContent?.trim();
        const status = node.getAttribute?.("data-status") || node.dataset?.status || node.textContent?.trim();
        const mapped = mapStatusFromValue(status || time);
        if (!time) {
          return null;
        }
        return {
          timeText: normalizeTimeRangeText(time),
          statusKey: mapped.key,
          statusLabel: mapped.label,
          statusRaw: mapped.originalText,
          note: node.dataset?.note || null,
          raw: node.outerHTML,
          sortKey: buildSortKey(time),
        };
      })
      .filter(Boolean);
    if (slots.length > 0) {
      groups.push({ title: "クラブ艇", slots: sortSlots(slots) });
    }
  }

  return {
    groups,
    summary: createSummary(groups),
    rawHtml: htmlText,
  };
}

function resolveTitle(element) {
  let current = element.previousElementSibling;
  while (current) {
    if (/^h[1-6]$/i.test(current.tagName) || current.classList.contains("title")) {
      const text = current.textContent?.trim();
      if (text) {
        return text;
      }
    }
    current = current.previousElementSibling;
  }
  return "クラブ艇";
}

function humanizeKey(key) {
  if (!key) {
    return "";
  }
  return String(key)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMarinaDirectory(payload) {
  const collected = collectMarinaEntries(payload);
  const unique = new Map();

  collected.forEach((entry) => {
    if (!entry.code || !entry.name) {
      return;
    }
    const key = String(entry.code);
    if (!unique.has(key)) {
      unique.set(key, {
        code: key,
        name: String(entry.name),
        nameKana: entry.nameKana ? String(entry.nameKana) : null,
        prefecture: entry.prefecture ? String(entry.prefecture) : null,
        area: entry.area ? String(entry.area) : null,
        raw: entry.raw ?? null,
      });
    }
  });

  return Array.from(unique.values());
}

function collectMarinaEntries(payload, context = {}, visited = new Set()) {
  const results = [];
  if (payload == null) {
    return results;
  }

  if (Array.isArray(payload)) {
    payload.forEach((item) => {
      results.push(...collectMarinaEntries(item, context, visited));
    });
    return results;
  }

  if (typeof payload === "object") {
    if (visited.has(payload)) {
      return results;
    }
    visited.add(payload);

    const candidate = adaptMarinaCandidate(payload, context);
    if (candidate) {
      results.push(candidate);
    }

    const nextContext = {
      prefecture: payload.prefectureName || payload.prefecture || payload.prefName || context.prefecture || null,
      area: payload.areaName || payload.area || payload.regionName || context.area || null,
    };

    Object.values(payload).forEach((value) => {
      results.push(...collectMarinaEntries(value, nextContext, visited));
    });
  }

  return results;
}

function adaptMarinaCandidate(value, context = {}) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const code =
    value.marinaCd ??
    value.marinaCode ??
    value.marinaID ??
    value.marinaId ??
    value.code ??
    value.id ??
    value.value;
  const name = value.marinaName ?? value.name ?? value.label ?? value.text ?? null;

  if (!code || !name) {
    return null;
  }

  const nameKana = value.marinaNameKana ?? value.nameKana ?? value.kana ?? value.kanaName ?? null;
  const prefecture = value.prefectureName ?? value.prefecture ?? value.prefName ?? context.prefecture ?? null;
  const area = value.areaName ?? value.area ?? value.regionName ?? context.area ?? null;

  return {
    code,
    name,
    nameKana,
    prefecture,
    area,
    raw: value,
  };
}

function serializeHeaders(headers) {
  const result = {};
  if (!headers) {
    return result;
  }
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}
