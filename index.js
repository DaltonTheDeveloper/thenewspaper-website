// ===== CONFIG =====
const API_BASE_URL = "https://api.thenewspaper.site";

const COGNITO_DOMAIN = "https://thenewsroom-auth-1763795763.auth.us-east-1.amazoncognito.com";
const COGNITO_CLIENT_ID = "2shion39m0mim70d0etbtp0eh9";
const COGNITO_REDIRECT = "https://thenewspaper.site/callback.html";

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

// Core API: ALWAYS use the ID TOKEN (what server.ts expects).

async function callApi(path, options = {}) {
  const tokens = getTokens();
  const idToken = tokens && tokens.id_token;

  if (!idToken) {
    throw new Error("Not logged in");
  }

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
    Authorization: `Bearer ${idToken}`, // <-- IMPORTANT
  };

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("API error", res.status, text);
    throw new Error(`API error ${res.status}`);
  }

  return res.json();
}

// ===== PKCE / Login flow =====
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

function logoutToHostedUI() {
  const params = new URLSearchParams({
    client_id: COGNITO_CLIENT_ID,
    logout_uri: "https://thenewspaper.site/",
  });

  clearTokens();
  window.location.href = `${COGNITO_DOMAIN}/logout?${params.toString()}`;
}

// ===== Subscription badge =====

async function refreshSubscriptionBadge() {
  const sideText = document.getElementById("subStatusSide");
  const chipText = document.getElementById("subStatusChip");
  const manageSub = document.getElementById("btnManageBillingSub");

  if (sideText) sideText.textContent = "Checking…";
  if (chipText) chipText.textContent = "Checking…";
  if (manageSub) manageSub.textContent = "Checking…";

  try {
    const data = await callApi("/api/subscription-status");

    if (!data || !data.status) {
      throw new Error("Bad response");
    }

    if (data.status === "active") {
      if (sideText) sideText.textContent = "Active subscriber";
      if (chipText) chipText.textContent = "Full briefing unlocked";
      if (manageSub) manageSub.textContent = "Manage subscription";
    } else if (data.status === "canceled" || data.status === "past_due") {
      if (sideText) sideText.textContent = "Subscription inactive";
      if (chipText) chipText.textContent = "Free preview · Upgrade for full brief";
      if (manageSub) manageSub.textContent = "Restart subscription";
    } else {
      if (sideText) sideText.textContent = "On free preview";
      if (chipText)
        chipText.textContent = "Free preview · Upgrade for full brief";
      if (manageSub)
        manageSub.textContent = "Start subscription for $1.99 / mo";
    }
  } catch (err) {
    console.error("Error refreshing subscription status:", err);
    if (sideText) sideText.textContent = "Error loading status";
    if (chipText) chipText.textContent = "Status unavailable";
    if (manageSub) manageSub.textContent = "Open Stripe billing portal";
  }
}

function initAuthUI() {
  const loginBtn = document.querySelector(".btn-login");
  const labelSpan = document.querySelector(".btn-login-label");
  if (!loginBtn) return;

  const tokens = getTokens();

  if (tokens && tokens.id_token) {
    if (labelSpan) labelSpan.textContent = "Account";
    loginBtn.addEventListener("click", () => {
      window.location.href = "https://thenewspaper.site/billing.html";
    });
    refreshSubscriptionBadge();
  } else {
    loginBtn.addEventListener("click", startLogin);
  }
}

function initButtons() {
  const sampleBtn = document.getElementById("btnViewSample");
  const billingBtn = document.getElementById("btnManageBilling");
  const prefsBtn = document.getElementById("btnPreferences");

  if (sampleBtn) {
    sampleBtn.addEventListener("click", () => {
      alert("Sample briefings will be available soon in the beta.");
    });
  }

  if (billingBtn) {
    billingBtn.addEventListener("click", () => {
      window.location.href = "https://thenewspaper.site/billing.html";
    });
  }

  if (prefsBtn) {
    prefsBtn.addEventListener("click", () => {
      window.location.href = "https://thenewspaper.site/preferences.html";
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initAuthUI();
  initButtons();
});
