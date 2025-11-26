// billing.js – subscription + preferences page
const API_BASE_URL = "https://api.thenewspaper.site";

// === Helpers for tokens (shared with index.js idea) ===
function getTokens() {
  try {
    const raw = window.localStorage.getItem("newsroom_tokens");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.error("Failed to parse newsroom_tokens", e);
    return null;
  }
}

function getIdToken() {
  const tokens = getTokens();
  return tokens?.id_token || null;
}

function getUserEmail() {
  const tokens = getTokens();
  return tokens?.email || null;
}

// === Basic DOM refs ===
const statusPill = document.getElementById("statusPill");
const stripeStatusText = document.getElementById("stripeStatusText");
const emailBadge = document.getElementById("emailBadge");
const btnSubscribe = document.getElementById("btnSubscribe");
const btnManage = document.getElementById("btnManage");
const btnRefresh = document.getElementById("btnRefresh");
const btnLoginHeader = document.getElementById("btnHeaderLogin");
const errorBox = document.getElementById("errorBox");

// === Generic API caller against backend ===
async function callApi(path, options = {}) {
  const idToken = getIdToken();
  if (!idToken) {
    throw new Error("No id_token – user not logged in.");
  }

  const url = `${API_BASE_URL}${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
      ...(options.headers || {}),
    },
    credentials: "include",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${path} failed: ${res.status} ${text}`);
  }

  const ct = res.headers.get("content-type");
  if (ct && ct.includes("application/json")) {
    return res.json();
  }

  return null;
}

// === Status UI helpers ===
function setStatusPill(state, label) {
  statusPill.textContent = label;

  statusPill.classList.remove("state-active", "state-none", "state-error");

  if (state === "active") {
    statusPill.classList.add("state-active");
  } else if (state === "none") {
    statusPill.classList.add("state-none");
  } else if (state === "error") {
    statusPill.classList.add("state-error");
  }
}

function setError(message) {
  if (!errorBox) return;
  if (!message) {
    errorBox.style.display = "none";
    errorBox.textContent = "";
    return;
  }
  errorBox.style.display = "block";
  errorBox.textContent = message;
}

function updateEmailBadge() {
  const email = getUserEmail();
  emailBadge.textContent = email || "Not signed in";
}

// === Subscription status helper ===
async function refreshStatus() {
  setError("");
  setStatusPill("none", "Checking Stripe…");
  stripeStatusText.textContent = "Checking…";

  try {
    const data = await callApi("/stripe/status");

    stripeStatusText.textContent = data.status || "unknown";

    if (data.status === "active") {
      setStatusPill("active", "Active subscriber");
    } else if (data.status === "trialing") {
      setStatusPill("active", "Trialing");
    } else if (data.status === "canceled") {
      setStatusPill("none", "Canceled");
    } else {
      setStatusPill("none", "No subscription");
    }
  } catch (err) {
    console.error(err);
    setStatusPill("error", "Error checking status");
    stripeStatusText.textContent = "Error";
    setError("We couldn't sync with Stripe. Please try again in a few seconds.");
  }
}

// === Checkout / portal ===
async function startCheckout() {
  setError("");
  try {
    const data = await callApi("/stripe/create-checkout-session", {
      method: "POST",
      body: JSON.stringify({ mode: "subscription" }),
    });

    if (!data.url) {
      throw new Error("No checkout URL returned");
    }

    window.location.href = data.url;
  } catch (err) {
    console.error(err);
    setError(
      "We couldn't start checkout. If this keeps happening, email support@thenewspaper.site."
    );
  }
}

async function manageSubscription() {
  setError("");
  try {
    const data = await callApi("/stripe/create-portal-session", {
      method: "POST",
    });

    if (!data.url) {
      throw new Error("No portal URL returned");
    }

    window.location.href = data.url;
  } catch (err) {
    console.error(err);
    setError(
      "We couldn't open the billing portal. If this keeps happening, email support@thenewspaper.site."
    );
  }
}

// === Login redirect from header button ===
function startLogin() {
  // reuse the same hosted UI start as index.js
  window.location.href = "index.html"; // send them back to home where login button lives
}

// === Preferences API integration ===
const PREFS_API_BASE = "http://52.70.162.164:4243";

const prefsForm = document.getElementById("preferences-form");
const freqSelect = document.getElementById("pref-frequency");
const focusSelect = document.getElementById("pref-focus");
const lengthSelect = document.getElementById("pref-length");
const savePrefsBtn = document.getElementById("save-prefs");
const prefsStatus = document.getElementById("prefs-status");

async function loadPreferences() {
  if (!prefsForm) return;
  const tokens = getTokens();
  if (!tokens || !tokens.id_token) {
    prefsStatus.textContent = "Log in to customise your briefing preferences.";
    return;
  }

  try {
    const res = await fetch(`${PREFS_API_BASE}/api/preferences`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tokens.id_token}`,
        "Content-Type": "application/json",
      },
      credentials: "include",
    });

    if (res.status === 404) {
      // No preferences yet; keep defaults
      prefsStatus.textContent =
        "Using smart defaults. Save to personalise your briefing.";
      return;
    }

    if (!res.ok) {
      throw new Error(`Failed to load preferences (${res.status})`);
    }

    const data = await res.json();
    if (data.frequency && freqSelect) freqSelect.value = data.frequency;
    if (data.focus && focusSelect) focusSelect.value = data.focus;
    if (data.length && lengthSelect) lengthSelect.value = data.length;

    prefsStatus.textContent =
      "Preferences loaded. You can adjust them any time.";
  } catch (err) {
    console.error("[PREFS] load error", err);
    prefsStatus.textContent =
      "Couldn't load preferences. We'll use defaults for now.";
  }
}

async function handleSavePreferences(event) {
  event.preventDefault();
  if (!prefsForm) return;

  const tokens = getTokens();
  if (!tokens || !tokens.id_token) {
    prefsStatus.textContent = "Please log in before saving preferences.";
    return;
  }

  const payload = {
    frequency: freqSelect ? freqSelect.value : "daily",
    focus: focusSelect ? focusSelect.value : "us-heavy",
    length: lengthSelect ? lengthSelect.value : "standard",
  };

  try {
    savePrefsBtn.disabled = true;
    prefsStatus.textContent = "Saving preferences...";

    const res = await fetch(`${PREFS_API_BASE}/api/preferences`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.id_token}`,
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error(`Failed to save preferences (${res.status})`);
    }

    prefsStatus.textContent =
      "Saved. Tomorrow's briefing will use these settings.";
  } catch (err) {
    console.error("[PREFS] save error", err);
    prefsStatus.textContent =
      "We couldn't save your preferences. Please try again in a moment.";
  } finally {
    savePrefsBtn.disabled = false;
  }
}
// === End preferences integration ===

document.addEventListener("DOMContentLoaded", () => {
  btnSubscribe.addEventListener("click", startCheckout);
  btnRefresh.addEventListener("click", refreshStatus);
  if (btnManage) btnManage.addEventListener("click", manageSubscription);
  if (btnLoginHeader) btnLoginHeader.addEventListener("click", startLogin);

  if (prefsForm) {
    prefsForm.addEventListener("submit", handleSavePreferences);
    loadPreferences().catch((e) => console.error(e));
  }

  updateEmailBadge();
  refreshStatus().catch((e) => {
    console.error(e);
  });
});
