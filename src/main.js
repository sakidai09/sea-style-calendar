import { SeaStyleApi, DEFAULT_BASE_URL } from "./api/seaStyleApi.js";
import { createMonthOptions, enumerateMonthDays } from "./utils/date.js";

let apiClient = null;
let apiConfiguration = null;

const STATUS_LABELS = {
  vacant: "空き",
  few: "残りわずか",
  full: "満席",
  unknown: "不明",
};

const DEFAULT_MARINA_NAME = "勝どきマリーナ";
const FALLBACK_MARINAS = [
  {
    code: "3802",
    name: "勝どきマリーナ",
    nameKana: "カチドキマリーナ",
    prefecture: "東京都",
  },
];
const MAX_SUGGESTIONS = 12;
const SUGGESTION_HIDE_DELAY = 150;

let currentRequest = null;

document.addEventListener("DOMContentLoaded", () => {
  const app = document.getElementById("app");
  const template = document.getElementById("app-template");
  if (!app || !template) {
    return;
  }

  app.appendChild(template.content.cloneNode(true));

  const form = document.getElementById("search-form");
  const monthSelect = document.getElementById("month-select");
  const marinaNameInput = document.getElementById("marina-name-input");
  const marinaCodeInput = document.getElementById("marina-code-input");
  const marinaSuggestions = document.getElementById("marina-suggestions");
  const statusPanel = document.getElementById("status-panel");
  const statusMessage = document.getElementById("status-message");
  const results = document.getElementById("results");

  if (!form || !monthSelect || !marinaNameInput || !marinaCodeInput || !marinaSuggestions || !statusPanel || !statusMessage || !results) {
    return;
  }

  apiConfiguration = resolveApiConfiguration();
  apiClient = new SeaStyleApi({ baseUrl: apiConfiguration.baseUrl });

  const submitButton = form.querySelector("button[type=submit]");
  const marinaSearch = createMarinaSearch({
    input: marinaNameInput,
    hiddenInput: marinaCodeInput,
    suggestions: marinaSuggestions,
  });

  populateMonthOptions(monthSelect);

  const params = new URLSearchParams(window.location.search);
  const initialMonth = params.get("month") || params.get("targetMonth");
  const initialMarinaCode = params.get("marinaCd") || params.get("marinaCode");
  const initialMarinaName = params.get("marinaName") || params.get("marinaNm") || "";

  if (initialMonth && Array.from(monthSelect.options).some((option) => option.value === initialMonth)) {
    monthSelect.value = initialMonth;
  }

  updateStatus(statusPanel, statusMessage, createInitialStatusMessage(apiConfiguration));

  let initialSearchPending = true;
  const scheduleInitialSearch = () => {
    if (!initialSearchPending) {
      return;
    }
    if (!marinaCodeInput.value || !monthSelect.value) {
      return;
    }
    initialSearchPending = false;
    const selected = marinaSearch.getSelected();
    triggerSearch({
      marinaCode: marinaCodeInput.value,
      marinaName: selected?.name || marinaNameInput.value,
      monthId: monthSelect.value,
      statusPanel,
      statusMessage,
      results,
      submitButton,
    });
  };

  initializeMarinaDirectory({
    searchController: marinaSearch,
    initialCode: initialMarinaCode,
    initialName: initialMarinaName,
    defaultName: DEFAULT_MARINA_NAME,
  })
    .then(({ usedFallback, selection, error: directoryError }) => {
      if (usedFallback) {
        const hint = createProxyHint(apiConfiguration, directoryError);
        updateStatus(
          statusPanel,
          statusMessage,
          `マリーナ一覧の取得に失敗したため、候補が限定されています。${hint}`,
          "warning",
        );
      } else {
        updateStatus(statusPanel, statusMessage, createInitialStatusMessage(apiConfiguration));
      }
      if (!selection && initialMarinaCode && !marinaCodeInput.value) {
        marinaCodeInput.value = initialMarinaCode;
        if (!marinaNameInput.value) {
          marinaNameInput.value = initialMarinaName || initialMarinaCode;
        }
      }
      scheduleInitialSearch();
    });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const monthId = String(formData.get("targetMonth") || "").trim();
    let marinaCode = String(formData.get("marinaCode") || "").trim();
    let marinaName = String(marinaNameInput.value || "").trim();

    if (!monthId) {
      updateStatus(statusPanel, statusMessage, "表示する月を選択してください。", "error");
      return;
    }

    if (!marinaCode && marinaName) {
      const match = marinaSearch.findExactMatch(marinaName) || marinaSearch.findFirstMatch(marinaName);
      if (match) {
        marinaSearch.select(match);
        marinaCode = match.code;
        marinaName = match.name;
      }
    }

    if (!marinaCode) {
      updateStatus(statusPanel, statusMessage, "マリーナを選択してください。", "error");
      marinaNameInput.focus();
      return;
    }

    triggerSearch({
      marinaCode,
      marinaName,
      monthId,
      statusPanel,
      statusMessage,
      results,
      submitButton,
    });
  });
});

function populateMonthOptions(select) {
  if (!select) {
    return;
  }

  const options = createMonthOptions({ monthsBefore: 0, monthsAfter: 5 });
  select.innerHTML = "";
  options.forEach(({ value, label, isCurrent }) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    if (isCurrent) {
      option.selected = true;
    }
    select.appendChild(option);
  });
}

function triggerSearch({
  marinaCode,
  marinaName,
  monthId,
  statusPanel,
  statusMessage,
  results,
  submitButton,
}) {
  if (currentRequest?.abortController) {
    currentRequest.abortController.abort();
  }

  const abortController = new AbortController();
  currentRequest = { abortController };

  results.innerHTML = "";
  results.hidden = true;

  const url = new URL(window.location.href);
  url.searchParams.set("marinaCd", marinaCode);
  url.searchParams.set("month", monthId);
  if (marinaName) {
    url.searchParams.set("marinaName", marinaName);
  } else {
    url.searchParams.delete("marinaName");
  }
  window.history.replaceState({}, "", url);

  if (submitButton) {
    submitButton.disabled = true;
  }

  updateStatus(statusPanel, statusMessage, "データを取得しています…", "loading");

  fetchMonthAvailability({
    marinaCode,
    monthId,
    signal: abortController.signal,
    onProgress: ({ index, total, day, result }) => {
      const progressText = `(${index + 1}/${total}) ${day.label} の情報を取得中…`;
      updateStatus(statusPanel, statusMessage, progressText, "loading");
      if (result) {
        appendDayResult(results, day, result);
        results.hidden = false;
      }
    },
  })
    .then((days) => {
      if (days.every((day) => day.result && day.result.error)) {
        updateStatus(statusPanel, statusMessage, "取得に失敗しました。マリーナ名や月を確認してください。", "error");
      } else {
        const successMessage = `${days.filter((day) => day.result && !day.result.error).length}日分の情報を取得しました。`;
        updateStatus(statusPanel, statusMessage, successMessage, "success");
      }
    })
    .catch((error) => {
      if (error.name === "AbortError") {
        updateStatus(statusPanel, statusMessage, "前回の取得を中断しました。", "warning");
        return;
      }
      console.error(error);
      updateStatus(statusPanel, statusMessage, "取得中にエラーが発生しました。時間をおいて再度お試しください。", "error");
    })
    .finally(() => {
      if (submitButton) {
        submitButton.disabled = false;
      }
      if (currentRequest?.abortController === abortController) {
        currentRequest = null;
      }
    });
}

async function fetchMonthAvailability({ marinaCode, monthId, signal, onProgress }) {
  const days = enumerateMonthDays(monthId);
  const results = [];

  for (let index = 0; index < days.length; index += 1) {
    const day = days[index];
    let result;
    try {
      result = await apiClient.fetchDayAvailability({
        marinaCd: marinaCode,
        isoDate: day.iso,
        signal,
      });
    } catch (error) {
      if (error.name === "AbortError") {
        throw error;
      }
      const wrappedError = wrapNetworkError(error);
      result = { error: wrappedError };
    }

    results.push({ day, result });
    if (typeof onProgress === "function") {
      onProgress({ index, total: days.length, day, result });
    }
  }

  return results;
}

function appendDayResult(container, day, result) {
  const card = document.createElement("article");
  card.className = "day-card";

  const header = document.createElement("header");
  header.className = "day-card__header";

  const dateEl = document.createElement("div");
  dateEl.className = "day-card__date";
  dateEl.textContent = `${day.label}`;
  header.appendChild(dateEl);

  const weekdayEl = document.createElement("div");
  weekdayEl.className = "day-card__weekday";
  weekdayEl.textContent = day.weekdayLabel;
  header.appendChild(weekdayEl);

  const summaryEl = document.createElement("div");
  summaryEl.className = "day-card__summary";
  summaryEl.textContent = result.error
    ? "取得エラー"
    : formatSummary(result.summary);
  header.appendChild(summaryEl);

  card.appendChild(header);

  const body = document.createElement("div");
  if (result.error) {
    const errorMessage = document.createElement("p");
    errorMessage.className = "slot-item__raw";
    errorMessage.textContent = `取得エラー: ${result.error.message || result.error}`;
    body.appendChild(errorMessage);
  } else if (!result.groups || result.groups.length === 0) {
    const noData = document.createElement("p");
    noData.className = "slot-item__raw";
    noData.textContent = "空き情報が見つかりませんでした。";
    body.appendChild(noData);
  } else {
    const list = document.createElement("div");
    list.className = "slot-list";

    result.groups.forEach((group) => {
      const section = document.createElement("section");
      section.className = "slot-list__section";

      if (group.title) {
        const title = document.createElement("h3");
        title.className = "slot-list__title";
        title.textContent = group.title;
        section.appendChild(title);
      }

      const items = document.createElement("div");
      items.className = "slot-list__items";

      group.slots.forEach((slot) => {
        items.appendChild(createSlotItem(slot));
      });

      section.appendChild(items);
      list.appendChild(section);
    });

    body.appendChild(list);

    const details = document.createElement("details");
    details.className = "slot-item__raw";

    const summary = document.createElement("summary");
    summary.textContent = "元データ (デバッグ用)";
    details.appendChild(summary);

    const pre = document.createElement("pre");
    pre.textContent = formatDebugPayload(result.debug?.rawPayload ?? result.raw);
    details.appendChild(pre);

    body.appendChild(details);
  }

  card.appendChild(body);
  container.appendChild(card);
}

function createSlotItem(slot) {
  const item = document.createElement("div");
  item.className = "slot-item";

  if (slot.timeText) {
    const time = document.createElement("div");
    time.className = "slot-item__time";
    time.textContent = slot.timeText;
    item.appendChild(time);
  }

  const status = document.createElement("div");
  status.className = "slot-item__status";
  status.dataset.status = slot.statusKey || "unknown";
  status.textContent = `${STATUS_LABELS[slot.statusKey] || STATUS_LABELS.unknown}`;
  if (slot.statusRaw != null && slot.statusRaw !== slot.statusLabel) {
    status.title = String(slot.statusRaw);
  }
  item.appendChild(status);

  if (slot.note) {
    const note = document.createElement("div");
    note.className = "slot-item__memo";
    note.textContent = slot.note;
    item.appendChild(note);
  }

  if (slot.raw && typeof slot.raw === "object") {
    const rawDetails = document.createElement("details");
    rawDetails.className = "slot-item__raw";
    const summary = document.createElement("summary");
    summary.textContent = "詳細";
    rawDetails.appendChild(summary);
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(slot.raw, null, 2);
    rawDetails.appendChild(pre);
    item.appendChild(rawDetails);
  }

  return item;
}

function formatSummary(summary) {
  if (!summary || summary.total === 0) {
    return "空き情報なし";
  }
  const parts = [];
  if (summary.statuses.vacant) {
    parts.push(`空き ${summary.statuses.vacant}`);
  }
  if (summary.statuses.few) {
    parts.push(`残りわずか ${summary.statuses.few}`);
  }
  if (summary.statuses.full) {
    parts.push(`満席 ${summary.statuses.full}`);
  }
  if (summary.statuses.unknown) {
    parts.push(`不明 ${summary.statuses.unknown}`);
  }
  parts.push(`全${summary.total}枠`);
  return parts.join(" / ");
}

function updateStatus(panel, messageEl, message, status = "info") {
  if (!panel || !messageEl) {
    return;
  }
  panel.hidden = false;
  messageEl.textContent = message;
  panel.dataset.status = status;
}

function formatDebugPayload(payload) {
  if (payload == null) {
    return "(なし)";
  }
  if (typeof payload === "string") {
    return payload;
  }
  try {
    return JSON.stringify(payload, null, 2);
  } catch (error) {
    return String(payload);
  }
}

async function initializeMarinaDirectory({ searchController, initialCode, initialName, defaultName }) {
  let directoryResult = null;
  let usedFallback = false;
  let lastError = null;

  try {
    directoryResult = await apiClient.fetchMarinaDirectory();
  } catch (error) {
    console.warn("マリーナ一覧の取得に失敗しました", error?.message || error);
    usedFallback = true;
    lastError = error;
  }

  const marinas = Array.isArray(directoryResult?.marinas) && directoryResult.marinas.length > 0
    ? directoryResult.marinas
    : FALLBACK_MARINAS;

  if (!directoryResult?.marinas || directoryResult.marinas.length === 0) {
    usedFallback = true;
  }

  searchController.setEntries(marinas);

  let selection = null;
  if (initialCode) {
    selection = searchController.findByCode(initialCode);
  }
  if (!selection && initialName) {
    selection = searchController.findExactMatch(initialName) || searchController.findFirstMatch(initialName);
  }
  if (!selection && defaultName) {
    selection = searchController.findFirstMatch(defaultName);
  }

  if (selection) {
    searchController.select(selection);
  } else if (initialName) {
    searchController.setInputValue(initialName);
  } else if (defaultName) {
    searchController.setInputValue(defaultName);
  }

  return {
    usedFallback,
    selection,
    entries: searchController.getEntries(),
    raw: directoryResult?.raw ?? null,
    error: lastError,
  };
}

function wrapNetworkError(error) {
  if (!error) {
    return error;
  }
  if (error.name === "AbortError") {
    return error;
  }
  if (!isLikelyNetworkError(error)) {
    return error;
  }
  const friendlyMessage = createNetworkErrorMessage(apiConfiguration);
  const wrapped = new Error(friendlyMessage);
  wrapped.name = error.name || "NetworkError";
  wrapped.cause = error;
  return wrapped;
}

function isLikelyNetworkError(error) {
  if (!error) {
    return false;
  }
  const message = String(error.message || error).toLowerCase();
  return message.includes("failed to fetch") || message.includes("networkerror") || message.includes("load failed") || message.includes("cors");
}

function createNetworkErrorMessage(config) {
  if (config && !config.usingDefault) {
    return `${config.baseUrl} への接続に失敗しました。ネットワーク接続やプロキシ設定を確認してください。`;
  }
  return "ネットワークまたは CORS の制約により取得できませんでした。README の「プロキシサーバー」の手順に従ってローカルプロキシを設定し、URL に ?apiBase=... を指定してください。";
}

function resolveApiConfiguration() {
  const params = new URLSearchParams(window.location.search);
  const paramBase = (params.get("apiBase") || params.get("proxyOrigin") || "").trim();
  const sources = [];

  if (paramBase) {
    sources.push({ value: paramBase, source: "URL パラメータ" });
  }

  const globalBase = typeof window !== "undefined" && window.__SEA_STYLE_API_BASE_URL__;
  if (typeof globalBase === "string" && globalBase.trim()) {
    sources.push({ value: globalBase.trim(), source: "window.__SEA_STYLE_API_BASE_URL__" });
  }

  const configBase =
    typeof window !== "undefined" &&
    window.__SEA_STYLE_CONFIG__ &&
    typeof window.__SEA_STYLE_CONFIG__.apiBaseUrl === "string"
      ? window.__SEA_STYLE_CONFIG__.apiBaseUrl.trim()
      : "";
  if (configBase) {
    sources.push({ value: configBase, source: "window.__SEA_STYLE_CONFIG__.apiBaseUrl" });
  }

  const datasetBase = document.documentElement?.dataset?.seaStyleApiBase;
  if (datasetBase) {
    sources.push({ value: datasetBase, source: "document.documentElement.dataset.seaStyleApiBase" });
  }

  const metaBase = document.querySelector('meta[name="sea-style-api-base"]')?.content?.trim();
  if (metaBase) {
    sources.push({ value: metaBase, source: 'meta[name="sea-style-api-base"]' });
  }

  const resolved = sources.find((entry) => entry.value);
  const baseUrl = resolved?.value || DEFAULT_BASE_URL;

  return {
    baseUrl,
    source: resolved?.source || "デフォルト設定",
    usingDefault: !resolved,
  };
}

function createInitialStatusMessage(config) {
  const base = "マリーナ名と月を選択して「表示する」を押してください。";
  if (!config) {
    return base;
  }
  if (config.usingDefault) {
    const hint =
      "ヒント: ローカル環境で取得に失敗する場合は README の「プロキシサーバー」の手順でローカルプロキシを設定し、URL に ?apiBase=プロキシURL を付与してください。";
    return `${base}\n\n${hint}`;
  }
  return `${base}\n\nAPI ベース URL: ${config.baseUrl} (${config.source})`;
}

function createProxyHint(config, error) {
  if (!config) {
    return "";
  }
  const hints = [];
  if (!config.usingDefault) {
    hints.push(`API ベース URL: ${config.baseUrl} (${config.source})`);
  }
  if (config.usingDefault && isLikelyNetworkError(error)) {
    hints.push("ヒント: README の「プロキシサーバー」の手順を参考にローカルプロキシを起動し、?apiBase=プロキシURL を指定してください。");
  }
  if (hints.length === 0) {
    return "";
  }
  return `\n${hints.join("\n")}`;
}

function createMarinaSearch({ input, hiddenInput, suggestions }) {
  const state = {
    entries: [],
    selected: null,
    filtered: [],
    activeIndex: -1,
    hideTimer: null,
  };

  const controller = {
    setEntries(entries) {
      const prepared = (entries || [])
        .map((entry) => prepareMarinaEntry(entry))
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name, "ja", { sensitivity: "base" }));
      state.entries = prepared;

      if (state.selected) {
        const updated = controller.findByCode(state.selected.code);
        if (updated) {
          controller.select(updated, { focus: false, silent: true });
        } else {
          controller.clearSelection();
        }
      }
      if (!suggestions.hidden && input.value) {
        renderSuggestions(input.value);
      }
    },
    getEntries() {
      return state.entries.slice();
    },
    select(entry, { focus = false, silent = false } = {}) {
      if (!entry) {
        controller.clearSelection();
        return null;
      }
      const target =
        state.entries.find((item) => item.code === entry.code) || entry;
      state.selected = target;
      hiddenInput.value = target.code;
      input.value = target.name;
      input.dataset.selectedCode = target.code;
      if (!silent) {
        hideSuggestions();
      }
      if (focus) {
        input.focus();
      }
      return target;
    },
    clearSelection() {
      state.selected = null;
      hiddenInput.value = "";
      delete input.dataset.selectedCode;
    },
    getSelected() {
      return state.selected;
    },
    setInputValue(value) {
      controller.clearSelection();
      input.value = value || "";
    },
    findByCode(code) {
      if (!code) {
        return null;
      }
      const normalized = String(code).trim();
      if (!normalized) {
        return null;
      }
      return state.entries.find((entry) => entry.code === normalized) || null;
    },
    findExactMatch(value) {
      const normalized = normalizeSearchText(value);
      if (!normalized) {
        return null;
      }
      return (
        state.entries.find((entry) => normalizeSearchText(entry.name) === normalized) ||
        state.entries.find((entry) => entry.keywords.includes(normalized)) ||
        null
      );
    },
    findFirstMatch(value) {
      const normalized = normalizeSearchText(value);
      if (!normalized) {
        return null;
      }
      return (
        state.entries.find((entry) => entry.keywords.some((keyword) => keyword.includes(normalized))) ||
        null
      );
    },
  };

  const hide = (delay = SUGGESTION_HIDE_DELAY) => {
    cancelHide();
    state.hideTimer = setTimeout(() => {
      state.hideTimer = null;
      hideSuggestions();
    }, delay);
  };

  const cancelHide = () => {
    if (state.hideTimer) {
      clearTimeout(state.hideTimer);
      state.hideTimer = null;
    }
  };

  const renderSuggestions = (query) => {
    cancelHide();
    const matches = filterEntries(query);
    state.filtered = matches;
    suggestions.innerHTML = "";

    if (!matches.length) {
      hideSuggestions();
      return;
    }

    matches.forEach((entry, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "autocomplete__item";
      option.id = `marina-option-${entry.code}`;
      option.setAttribute("role", "option");
      option.dataset.index = String(index);

      const nameEl = document.createElement("span");
      nameEl.textContent = entry.name;
      option.appendChild(nameEl);

      const codeEl = document.createElement("span");
      codeEl.className = "autocomplete__item-code";
      codeEl.textContent = `コード: ${entry.code}`;
      option.appendChild(codeEl);

      const metaParts = [];
      if (entry.prefecture) {
        metaParts.push(entry.prefecture);
      }
      if (entry.area && entry.area !== entry.prefecture) {
        metaParts.push(entry.area);
      }
      if (entry.nameKana) {
        metaParts.push(entry.nameKana);
      }
      if (metaParts.length) {
        const metaEl = document.createElement("span");
        metaEl.className = "autocomplete__item-meta";
        metaEl.textContent = metaParts.join(" / ");
        option.appendChild(metaEl);
      }

      option.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        selectByIndex(index);
      });
      option.addEventListener("click", (event) => {
        event.preventDefault();
        selectByIndex(index);
        input.focus();
      });

      suggestions.appendChild(option);
    });

    showSuggestions();
    updateActive(0);
  };

  const showSuggestions = () => {
    suggestions.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };

  const hideSuggestions = () => {
    cancelHide();
    if (suggestions.hidden) {
      return;
    }
    suggestions.hidden = true;
    suggestions.innerHTML = "";
    state.filtered = [];
    updateActive(-1);
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  };

  const updateActive = (index) => {
    state.activeIndex = index;
    const options = suggestions.querySelectorAll(".autocomplete__item");
    options.forEach((option, optionIndex) => {
      if (optionIndex === index) {
        option.classList.add("autocomplete__item--active");
        input.setAttribute("aria-activedescendant", option.id);
        option.scrollIntoView({ block: "nearest" });
      } else {
        option.classList.remove("autocomplete__item--active");
      }
    });
    if (index < 0) {
      input.removeAttribute("aria-activedescendant");
    }
  };

  const moveActive = (delta) => {
    if (!state.filtered.length) {
      renderSuggestions(input.value);
      return;
    }
    let next = state.activeIndex + delta;
    if (next < 0) {
      next = state.filtered.length - 1;
    } else if (next >= state.filtered.length) {
      next = 0;
    }
    updateActive(next);
  };

  const selectByIndex = (index) => {
    const entry = state.filtered[index];
    if (!entry) {
      return;
    }
    controller.select(entry);
    hideSuggestions();
  };

  const filterEntries = (query) => {
    const normalized = normalizeSearchText(query);
    if (!normalized) {
      return state.entries.slice(0, MAX_SUGGESTIONS);
    }

    const scored = [];
    state.entries.forEach((entry) => {
      const keywords = entry.keywords || [];
      let matched = false;
      let exact = false;
      let starts = false;
      let bestIndex = Infinity;

      keywords.forEach((keyword) => {
        const index = keyword.indexOf(normalized);
        if (index === -1) {
          return;
        }
        matched = true;
        if (keyword === normalized) {
          exact = true;
        }
        if (index === 0) {
          starts = true;
        }
        if (index < bestIndex) {
          bestIndex = index;
        }
      });

      if (matched) {
        scored.push({ entry, exact, starts, bestIndex });
      }
    });

    scored.sort((a, b) => {
      if (a.exact !== b.exact) {
        return a.exact ? -1 : 1;
      }
      if (a.starts !== b.starts) {
        return a.starts ? -1 : 1;
      }
      if (a.bestIndex !== b.bestIndex) {
        return a.bestIndex - b.bestIndex;
      }
      return a.entry.name.localeCompare(b.entry.name, "ja", { sensitivity: "base" });
    });

    return scored.slice(0, MAX_SUGGESTIONS).map((item) => item.entry);
  };

  const handleInput = () => {
    controller.clearSelection();
    renderSuggestions(input.value);
  };

  const handleFocus = () => {
    if (input.value && !state.selected) {
      renderSuggestions(input.value);
    }
  };

  const handleBlur = () => {
    hide();
  };

  const handleKeyDown = (event) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveActive(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveActive(-1);
        break;
      case "Enter":
        if (!suggestions.hidden && state.activeIndex >= 0) {
          event.preventDefault();
          selectByIndex(state.activeIndex);
        }
        break;
      case "Escape":
        if (!suggestions.hidden) {
          event.preventDefault();
          hideSuggestions();
        }
        break;
      default:
        break;
    }
  };

  input.addEventListener("input", handleInput);
  input.addEventListener("focus", handleFocus);
  input.addEventListener("blur", handleBlur);
  input.addEventListener("keydown", handleKeyDown);

  suggestions.addEventListener("pointerenter", cancelHide);
  suggestions.addEventListener("pointerleave", () => hide());

  return controller;
}

function prepareMarinaEntry(entry) {
  if (!entry || entry.code == null || entry.name == null) {
    return null;
  }
  const normalized = {
    code: String(entry.code).trim(),
    name: String(entry.name).trim(),
    nameKana: entry.nameKana ? String(entry.nameKana).trim() : null,
    prefecture: entry.prefecture ? String(entry.prefecture).trim() : null,
    area: entry.area ? String(entry.area).trim() : null,
  };
  normalized.keywords = buildMarinaKeywords(normalized);
  return normalized;
}

function buildMarinaKeywords(entry) {
  const keywords = new Set();
  [entry.code, entry.name, entry.nameKana, entry.prefecture, entry.area].forEach((value) => {
    const normalized = normalizeSearchText(value);
    if (normalized) {
      keywords.add(normalized);
    }
  });

  if (entry.name) {
    const fragments = String(entry.name)
      .replace(/[()（）［］「」【】『』]/g, " ")
      .split(/[\s・,、]+/)
      .map((part) => part.trim())
      .filter(Boolean);
    fragments.forEach((fragment) => {
      const normalized = normalizeSearchText(fragment);
      if (normalized) {
        keywords.add(normalized);
      }
    });
  }

  return Array.from(keywords);
}

function normalizeSearchText(value) {
  if (value == null) {
    return "";
  }
  const stringValue = String(value)
    .normalize("NFKC")
    .trim()
    .toLowerCase();
  if (!stringValue) {
    return "";
  }
  const katakana = stringValue.replace(/[\u3041-\u3096]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) + 0x60),
  );
  return katakana.replace(/\s+/g, "");
}
