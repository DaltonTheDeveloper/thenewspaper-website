// ===== CONFIG =====
const PREFS_API_BASE = "https://api.thenewspaper.site";

// ===== TOKEN / USER HELPERS =====

function getStoredTokens() {
  const raw = localStorage.getItem("newsroom_tokens");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getIdToken() {
  const tokens = getStoredTokens();
  return tokens && tokens.id_token ? tokens.id_token : null;
}

// Decode JWT payload to read email from Cognito
function decodeJwtPayload(token) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = parts[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const decoded = atob(payload);
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function getUserEmailFromToken() {
  const idToken = getIdToken();
  if (!idToken) return null;
  const payload = decodeJwtPayload(idToken);
  if (!payload) return null;
  return payload.email || payload["cognito:username"] || null;
}

// ===== API HELPER =====

async function callPrefsApi(path, method = "GET", body) {
  const idToken = getIdToken();

  const headers = {
    "Content-Type": "application/json",
  };

  // We still send the token in case you later validate on the backend.
  if (idToken) {
    headers["Authorization"] = `Bearer ${idToken}`;
  }

  const res = await fetch(`${PREFS_API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Prefs API ${method} ${path} failed: ${res.status} ${res.statusText} ${text}`
    );
  }

  return res.json();
}

// ===== DOM HELPERS =====

function qs(sel) {
  return document.querySelector(sel);
}
function qsa(sel) {
  return Array.from(document.querySelectorAll(sel));
}

function getModeRadios() {
  return {
    top10: qs("#mode-top10"),
    custom: qs("#mode-custom"),
  };
}

function getTopicRows() {
  // Each row should have a checkbox + number input.
  // Use classes: .topic-row, .topic-checkbox, .topic-max-input
  return qsa(".topic-row").map((row) => {
    return {
      row,
      checkbox: row.querySelector(".topic-checkbox"),
      maxInput: row.querySelector(".topic-max-input"),
      key: row.getAttribute("data-topic-key"),
    };
  });
}

// Grey-out / enable topic rows depending on mode
function syncModeUI() {
  const { top10, custom } = getModeRadios();
  const isTop10 = !!(top10 && top10.checked);

  const rows = getTopicRows();
  rows.forEach(({ row, checkbox, maxInput }) => {
    if (!checkbox || !maxInput) return;
    checkbox.disabled = isTop10;
    maxInput.disabled = isTop10;
    row.classList.toggle("topic-row--disabled", isTop10);
  });

  const noteEl = qs("#prefs-mode-note");
  if (noteEl) {
    if (isTop10) {
      noteEl.textContent =
        "You’ll receive the overall Top 10 stories each day. Topic sliders are ignored in this mode.";
    } else {
      noteEl.textContent =
        "We only show what we have, which may be fewer stories than your max per topic. Setting a max just caps the number, never increases it.";
    }
  }
}

// Build preferences object from form
function collectPreferences(email) {
  const { top10, custom } = getModeRadios();
  const isTop10 = !!(top10 && top10.checked);

  if (isTop10) {
    return {
      email,
      mode: "top10",
      topics: [], // we don't need per-topic config in this mode
    };
  }

  const rows = getTopicRows();
  const topics = rows.map(({ checkbox, maxInput, key }) => {
    if (!checkbox || !maxInput || !key) return null;
    const enabled = checkbox.checked;
    let maxStories = parseInt(maxInput.value || "0", 10);
    if (Number.isNaN(maxStories) || maxStories < 0) {
      maxStories = 0;
    }
    if (maxStories > 10) {
      maxStories = 10;
      maxInput.value = "10";
    }

    return {
      key,
      enabled,
      maxStories,
    };
  }).filter(Boolean);

  return {
    email,
    mode: "custom",
    topics,
  };
}

// Populate UI from loaded preferences
function applyPreferencesToForm(prefs) {
  const { top10, custom } = getModeRadios();

  const mode = prefs.mode === "custom" ? "custom" : "top10";
  if (top10 && custom) {
    if (mode === "top10") {
      top10.checked = true;
      custom.checked = false;
    } else {
      top10.checked = false;
      custom.checked = true;
    }
  }

  const topicsByKey = {};
  (prefs.topics || []).forEach((t) => {
    if (t && t.key) topicsByKey[t.key] = t;
  });

  const rows = getTopicRows();
  rows.forEach(({ row, checkbox, maxInput, key }) => {
    if (!checkbox || !maxInput || !key) return;
    const t = topicsByKey[key];

    if (t) {
      checkbox.checked = !!t.enabled;
      const maxStories = typeof t.maxStories === "number" ? t.maxStories : 0;
      maxInput.value = String(Math.min(Math.max(maxStories, 0), 10));
    } else {
      // Defaults for new users
      checkbox.checked = false;
      maxInput.value = "3";
    }
  });

  syncModeUI();
}

// ===== LOAD / SAVE =====

async function loadPreferences(email) {
  const statusEl = qs("#prefs-status");
  if (statusEl) {
    statusEl.textContent = "Loading preferences…";
  }

  try {
    const prefs = await callPrefsApi(
      `/api/preferences?email=${encodeURIComponent(email)}`,
      "GET"
    );
    applyPreferencesToForm(
      prefs && typeof prefs === "object"
        ? prefs
        : { mode: "top10", topics: [] }
    );

    if (statusEl) {
      statusEl.textContent = "Preferences loaded.";
    }
  } catch (err) {
    console.error("Failed to load preferences:", err);
    if (statusEl) {
      statusEl.textContent = "Could not load preferences. Using defaults.";
    }
    applyPreferencesToForm({ mode: "top10", topics: [] });
  }
}

async function savePreferences(email) {
  const statusEl = qs("#prefs-status");
  if (statusEl) {
    statusEl.textContent = "Saving…";
  }

  const payload = collectPreferences(email);

  try {
    await callPrefsApi("/api/preferences", "POST", payload);
    if (statusEl) {
      statusEl.textContent = "Preferences saved.";
    }
  } catch (err) {
    console.error("Failed to save preferences:", err);
    if (statusEl) {
      statusEl.textContent =
        "Failed to save preferences. Please try again in a moment.";
    }
  }
}

// ===== INIT =====

function init() {
  const email = getUserEmailFromToken();
  const statusEl = qs("#prefs-status");

  if (!email) {
    if (statusEl) {
      statusEl.textContent =
        "You must be logged in to edit your preferences.";
    }
    const formEl = qs("#preferences-form");
    if (formEl) {
      formEl.classList.add("prefs-form--disabled");
    }
    return;
  }

  // Wire mode radios
  const { top10, custom } = getModeRadios();
  if (top10) top10.addEventListener("change", syncModeUI);
  if (custom) custom.addEventListener("change", syncModeUI);

  // Wire Save button
  const saveBtn = qs("#prefs-save-btn");
  if (saveBtn) {
    saveBtn.addEventListener("click", (e) => {
      e.preventDefault();
      savePreferences(email);
    });
  }

  // Back button (same style as billing page)
  const backBtn = qs("#prefs-back-btn");
  if (backBtn) {
    backBtn.addEventListener("click", (e) => {
      e.preventDefault();
      window.location.href = "index.html";
    });
  }

  // Initial UI + load from backend
  syncModeUI();
  loadPreferences(email);
}

document.addEventListener("DOMContentLoaded", init);
