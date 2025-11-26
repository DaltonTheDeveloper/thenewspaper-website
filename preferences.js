// ==========================
// CONFIG
// ==========================
const API_BASE_URL = "https://api.thenewspaper.site";

const COGNITO_DOMAIN =
  "https://thenewsroom-auth-1763795763.auth.us-east-1.amazoncognito.com";
const COGNITO_CLIENT_ID = "2shion39m0mim70d0etbtp0eh9";
const COGNITO_REDIRECT = "https://thenewspaper.site/callback.html";

// Topics shown on the page (10 slots)
const TOPICS = [
  {
    id: "congress",
    label: "Congress",
    sub: "House, Senate, legislation, investigations.",
  },
  {
    id: "white_house",
    label: "White House",
    sub: "President, cabinet moves, executive orders.",
  },
  {
    id: "campaigns",
    label: "Campaigns & elections",
    sub: "Races, polling, strategy moves.",
  },
  {
    id: "courts",
    label: "Courts & legal fights",
    sub: "Federal courts, major cases, legal battles.",
  },
  {
    id: "supreme_court",
    label: "Supreme Court",
    sub: "SCOTUS arguments, opinions, and fallout.",
  },
  {
    id: "economy",
    label: "Economy & markets",
    sub: "Jobs, inflation, Fed, markets, major sectors.",
  },
  {
    id: "foreign_policy",
    label: "Foreign policy & war",
    sub: "Major conflicts, alliances, geopolitics.",
  },
  {
    id: "state_local",
    label: "State & local power",
    sub: "Governors, state houses, key city politics.",
  },
  {
    id: "rights",
    label: "Rights & culture",
    sub: "Civil rights, voting, speech, social issues.",
  },
  {
    id: "policy_deep_dives",
    label: "Policy deep dives",
    sub: "Longer explainers on big bills and systems.",
  },
];

// ==========================
// TOKEN + API HELPERS
// ==========================

function getTokens() {
  try {
    const raw = localStorage.getItem("newsroom_tokens");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.error("Failed to parse newsroom_tokens:", e);
    return null;
  }
}

function clearTokens() {
  localStorage.removeItem("newsroom_tokens");
}

function getIdToken() {
  const tokens = getTokens();
  return tokens && tokens.id_token ? tokens.id_token : null;
}

async function callApi(path, options = {}) {
  const idToken = getIdToken();
  if (!idToken) {
    const err = new Error("Not logged in");
    err.httpStatus = 401;
    throw err;
  }

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
    Authorization: `Bearer ${idToken}`,
  };

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const text = await res.text();
    const err = new Error(
      `API ${path} failed: ${res.status} ${text || res.statusText}`
    );
    err.httpStatus = res.status;
    throw err;
  }

  // Some endpoints may return 204
  if (res.status === 204) return null;
  return res.json();
}

// ==========================
// LOGIN (PKCE) – same pattern as index.js
// ==========================

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
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function createPkcePair() {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const codeVerifier = base64UrlEncode(verifierBytes);
  const hash = await sha256(codeVerifier);
  const codeChallenge = base64UrlEncode(hash);
  return { codeVerifier, codeChallenge };
}

function startLogin() {
  createPkcePair()
    .then(({ codeVerifier, codeChallenge }) => {
      sessionStorage.setItem("cognito_code_verifier", codeVerifier);

      const params = new URLSearchParams({
        client_id: COGNITO_CLIENT_ID,
        response_type: "code",
        scope: "openid email profile",
        redirect_uri: COGNITO_REDIRECT,
        code_challenge_method: "S256",
        code_challenge: codeChallenge,
      });

      window.location.href = `${COGNITO_DOMAIN}/oauth2/authorize?${params.toString()}`;
    })
    .catch((err) => {
      console.error("Failed to start login:", err);
    });
}

// ==========================
// UI HOOKS
// ==========================

const topicsGridEl = document.getElementById("topicsGrid");
const maxPerTopicInput = document.getElementById("maxPerTopic");
const biggestTenCheckbox = document.getElementById("biggestTen");
const savePrefsButton = document.getElementById("btnSavePrefs");
const prefsStatusEl = document.getElementById("prefsStatus");
const loginPillText = document.getElementById("prefsLoginStatusText");
const loginPill = document.getElementById("prefsLoginStatusPill");
const btnPrefsLogin = document.getElementById("btnPrefsLogin");

// ==========================
// RENDER TOPICS
// ==========================

function renderTopics() {
  topicsGridEl.innerHTML = "";
  TOPICS.forEach((topic) => {
    const label = document.createElement("label");
    label.className = "pref-topic";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = topic.id;
    checkbox.className = "pref-topic-checkbox";

    const textWrap = document.createElement("div");
    const main = document.createElement("div");
    main.className = "pref-topic-main";
    main.textContent = topic.label;

    const sub = document.createElement("div");
    sub.className = "pref-topic-sub";
    sub.textContent = topic.sub;

    textWrap.appendChild(main);
    textWrap.appendChild(sub);

    label.appendChild(checkbox);
    label.appendChild(textWrap);

    topicsGridEl.appendChild(label);
  });
}

// Helper to read selected topic IDs
function getSelectedTopics() {
  const checkboxes = topicsGridEl.querySelectorAll(".pref-topic-checkbox");
  const ids = [];
  checkboxes.forEach((cb) => {
    if (cb.checked) ids.push(cb.value);
  });
  return ids;
}

function setSelectedTopics(ids) {
  const checkboxes = topicsGridEl.querySelectorAll(".pref-topic-checkbox");
  const set = new Set(ids || []);
  checkboxes.forEach((cb) => {
    cb.checked = set.has(cb.value);
  });
}

// ==========================
// LOAD / SAVE PREFS
// ==========================

async function loadPreferences() {
  const tokens = getTokens();

  if (!tokens || !tokens.id_token) {
    loginPillText.textContent = "Not logged in";
    loginPill.classList.remove("pill-ok");
    prefsStatusEl.textContent = "Login to save personal preferences.";
    return;
  }

  loginPillText.textContent = "Logged in";
  prefsStatusEl.textContent = "Loading your saved preferences…";

  try {
    const prefs = await callApi("/api/preferences", {
      method: "GET",
      credentials: "include",
    });

    if (!prefs) {
      prefsStatusEl.textContent =
        "No preferences saved yet. Choose topics and click save.";
      return;
    }

    setSelectedTopics(prefs.topics || []);
    if (typeof prefs.maxItemsPerTopic === "number") {
      maxPerTopicInput.value = prefs.maxItemsPerTopic;
    }
    biggestTenCheckbox.checked = !!prefs.biggestTen;

    prefsStatusEl.textContent = "Loaded your saved preferences.";
    prefsStatusEl.classList.remove("error");
    prefsStatusEl.classList.add("good");
  } catch (err) {
    console.error("Failed to load preferences:", err);
    if (err.httpStatus === 401) {
      prefsStatusEl.textContent =
        "Not logged in. Use the Login button above, then come back.";
    } else {
      prefsStatusEl.textContent =
        "Could not load preferences from the server right now.";
    }
    prefsStatusEl.classList.remove("good");
    prefsStatusEl.classList.add("error");
  }
}

async function savePreferences() {
  const topics = getSelectedTopics();
  const maxItemsPerTopic = parseInt(maxPerTopicInput.value, 10) || 5;
  const biggestTen = !!biggestTenCheckbox.checked;

  prefsStatusEl.textContent = "Saving…";
  prefsStatusEl.classList.remove("good", "error");

  try {
    await callApi("/api/preferences", {
      method: "POST",
      credentials: "include",
      body: JSON.stringify({
        topics,
        maxItemsPerTopic,
        biggestTen,
      }),
    });

    prefsStatusEl.textContent = "Saved. We’ll use this for your daily briefing.";
    prefsStatusEl.classList.add("good");
  } catch (err) {
    console.error("Failed to save preferences:", err);
    if (err.httpStatus === 401) {
      prefsStatusEl.textContent =
        "You’re not logged in. Please log in and try again.";
    } else {
      prefsStatusEl.textContent =
        "Could not save preferences. Please try again in a moment.";
    }
    prefsStatusEl.classList.remove("good");
    prefsStatusEl.classList.add("error");
  }
}

// ==========================
// INIT
// ==========================

function init() {
  renderTopics();

  btnPrefsLogin.addEventListener("click", () => {
    const tokens = getTokens();
    if (tokens && tokens.id_token) {
      // Simple “logout” for now
      clearTokens();
      loginPillText.textContent = "Logged out";
      prefsStatusEl.textContent = "Logged out. Login again to load preferences.";
      prefsStatusEl.classList.remove("good");
      prefsStatusEl.classList.add("error");
    } else {
      startLogin();
    }
  });

  savePrefsButton.addEventListener("click", () => {
    savePreferences();
  });

  loadPreferences();
}

document.addEventListener("DOMContentLoaded", init);
