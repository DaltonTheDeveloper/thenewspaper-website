// ===== CONFIG =====
const PREFS_API_BASE = "https://api.thenewspaper.site";

const COGNITO_DOMAIN =
  "https://thenewsroom-auth-1763795763.auth.us-east-1.amazoncognito.com";
const COGNITO_CLIENT_ID = "2shion39m0mim70d0etbtp0eh9";
const COGNITO_REDIRECT = "https://thenewspaper.site/callback.html";

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
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
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

// ===== LOGIN / PKCE (same pattern as main page) =====

async function sha256(plain) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hash);
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function createCodeChallengeAndVerifier() {
  const verifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const hashed = await sha256(verifier);
  const challenge = base64UrlEncode(hashed);
  return { verifier, challenge };
}

function startLogin() {
  createCodeChallengeAndVerifier().then(({ verifier, challenge }) => {
    sessionStorage.setItem("newsroom_pkce_verifier", verifier);

    const params = new URLSearchParams({
      client_id: COGNITO_CLIENT_ID,
      response_type: "code",
      scope: "openid email profile",
      redirect_uri: COGNITO_REDIRECT,
      code_challenge_method: "S256",
      code_challenge: challenge,
    });

    window.location.href = `${COGNITO_DOMAIN}/oauth2/authorize?${params.toString()}`;
  });
}

// ===== API HELPER =====

async function callPrefsApi(path, method = "GET", body) {
  const idToken = getIdToken();

  const headers = {
    "Content-Type": "application/json",
  };

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

// grey-out / enable per-topic section depending on toggle
function syncTopicsDisabled() {
  const top10Toggle = qs("#modeTop10");
  const topicsSection = qs("#topicsSection");
  if (!top10Toggle || !topicsSection) return;

  const isTop10 = !!top10Toggle.checked;
  topicsSection.classList.toggle("disabled", isTop10);

  const note = qs("#prefs-mode-note");
  if (note) {
    if (isTop10) {
      note.textContent =
        "You’ll receive the overall Top 10 stories each day. Topic caps are ignored in this mode.";
    } else {
      note.textContent =
        "We only show what we have; these caps just stop any single topic from taking over the email.";
    }
  }
}

// Collect prefs from the form into a JSON payload
function collectPreferences(email) {
  const top10Toggle = qs("#modeTop10");
  const isTop10 = !!(top10Toggle && top10Toggle.checked);

  const leanRadio = qs('input[name="lean"]:checked');
  const lean = leanRadio ? leanRadio.value : "neutral";

  const topics = [];
  qsa(".topic-row").forEach((row) => {
    const key = row.getAttribute("data-topic-key");
    if (!key) return;

    const checkbox = row.querySelector(".topic-checkbox");
    const maxInput = row.querySelector(".topic-max-input");
    if (!checkbox || !maxInput) return;

    let maxStories = parseInt(maxInput.value || "0", 10);
    if (Number.isNaN(maxStories) || maxStories < 0) maxStories = 0;
    if (maxStories > 10) {
      maxStories = 10;
      maxInput.value = "10";
    }

    topics.push({
      key,
      enabled: !!checkbox.checked,
      maxStories,
    });
  });

  return {
    email,
    mode: isTop10 ? "top10" : "custom",
    lean,
    topics: isTop10 ? [] : topics,
  };
}

// Apply loaded prefs to the form
function applyPreferencesToForm(prefs) {
  const top10Toggle = qs("#modeTop10");
  const mode = prefs.mode === "custom" ? "custom" : "top10";

  if (top10Toggle) {
    top10Toggle.checked = mode === "top10";
  }

  // Perspective
  const lean = prefs.lean || "neutral";
  const leanMap = {
    neutral: "#lean-neutral",
    democrat: "#lean-democrat",
    republican: "#lean-republican",
  };
  const leanSelector = leanMap[lean] || "#lean-neutral";
  const leanEl = qs(leanSelector);
  if (leanEl) leanEl.checked = true;

  // Topics
  const topicsByKey = {};
  (prefs.topics || []).forEach((t) => {
    if (t && t.key) topicsByKey[t.key] = t;
  });

  qsa(".topic-row").forEach((row) => {
    const key = row.getAttribute("data-topic-key");
    if (!key) return;
    const checkbox = row.querySelector(".topic-checkbox");
    const maxInput = row.querySelector(".topic-max-input");
    if (!checkbox || !maxInput) return;

    const t = topicsByKey[key];
    if (t) {
      checkbox.checked = !!t.enabled;
      let maxStories =
        typeof t.maxStories === "number" ? t.maxStories : parseInt(maxInput.value || "0", 10);
      if (Number.isNaN(maxStories) || maxStories < 0) maxStories = 0;
      if (maxStories > 10) maxStories = 10;
      maxInput.value = String(maxStories);
    } else {
      // defaults if backend has nothing
      // leave existing defaults from HTML for now
    }
  });

  syncTopicsDisabled();
}

// ===== LOAD / SAVE =====

async function loadPreferences(email) {
  const statusEl = qs("#prefsStatus");
  if (statusEl) statusEl.textContent = "Loading preferences…";

  try {
    const prefs = await callPrefsApi(
      `/api/preferences?email=${encodeURIComponent(email)}`,
      "GET"
    );

    applyPreferencesToForm(
      prefs && typeof prefs === "object"
        ? prefs
        : { mode: "top10", lean: "neutral", topics: [] }
    );

    if (statusEl) statusEl.textContent = "Preferences loaded.";
  } catch (err) {
    console.error("Failed to load preferences:", err);
    if (statusEl) {
      statusEl.textContent =
        "Could not load preferences. Using defaults (Top 10 mode).";
    }
    applyPreferencesToForm({ mode: "top10", lean: "neutral", topics: [] });
  }
}

async function savePreferences(email) {
  const statusEl = qs("#prefsStatus");
  if (statusEl) statusEl.textContent = "Saving…";

  const payload = collectPreferences(email);

  try {
    await callPrefsApi("/api/preferences", "POST", payload);
    if (statusEl) statusEl.textContent = "Preferences saved.";
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
  const statusEl = qs("#prefsStatus");
  const loginPillText = qs("#prefsLoginStatusText");
  const loginBtn = qs("#btnPrefsLogin");
  const formEl = qs("#preferences-form");

  // Wire “top 10” toggle regardless of login state
  const top10Toggle = qs("#modeTop10");
  if (top10Toggle) {
    top10Toggle.addEventListener("change", syncTopicsDisabled);
  }
  syncTopicsDisabled();

  if (!email) {
    if (statusEl) {
      statusEl.textContent =
        "You must be logged in to edit your preferences.";
    }
    if (loginPillText) loginPillText.textContent = "Not logged in";
    if (loginBtn) {
      loginBtn.textContent = "Login";
      loginBtn.addEventListener("click", startLogin);
    }
    if (formEl) {
      formEl.classList.add("prefs-form--disabled");
    }
    return;
  }

  // Logged-in UI
  if (loginPillText) loginPillText.textContent = email;
  if (loginBtn) {
    loginBtn.textContent = "Account";
    loginBtn.addEventListener("click", () => {
      window.location.href = "https://thenewspaper.site/billing.html";
    });
  }
  if (formEl) {
    formEl.classList.remove("prefs-form--disabled");
  }

  const saveBtn = qs("#btnSavePrefs");
  if (saveBtn) {
    saveBtn.addEventListener("click", (e) => {
      e.preventDefault();
      savePreferences(email);
    });
  }

  loadPreferences(email);
}

document.addEventListener("DOMContentLoaded", init);
