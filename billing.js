/* =======================================================
   CONFIG
======================================================= */
const API_BASE_URL = "https://api.thenewspaper.site";

const COGNITO_DOMAIN =
  "https://thenewsroom-auth-1763795763.auth.us-east-1.amazoncognito.com";
const COGNITO_CLIENT_ID = "2shion39m0mim70d0etbtp0eh9";
const COGNITO_REDIRECT = "https://thenewspaper.site/callback.html";

/* =======================================================
   TOKEN HELPERS  (FIXED: USE ID TOKEN ONLY)
======================================================= */

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

function getIdToken() {
  const tokens = getTokens();
  return tokens && tokens.id_token ? tokens.id_token : null;
}

function decodeEmailFromIdToken() {
  const tokens = getTokens();
  if (!tokens || !tokens.id_token) return null;

  try {
    const payload = tokens.id_token.split(".")[1];
    const decoded = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/"))
    );
    return decoded.email || null;
  } catch (e) {
    console.error("Failed to decode id_token:", e);
    return null;
  }
}

/* =======================================================
   FIXED API WRAPPER (USES ID TOKEN)
======================================================= */

async function callApi(path, options = {}) {
  const idToken = getIdToken();
  if (!idToken) {
    const err = new Error("You must be logged in.");
    err.code = "NO_LOGIN";
    throw err;
  }

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
    Authorization: "Bearer " + idToken, // 🔥 FIXED: ALWAYS ID TOKEN
  };

  const res = await fetch(API_BASE_URL + path, {
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

  return res.json();
}

/* =======================================================
   LOGIN FLOW (PKCE)
======================================================= */

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
  const codeVerifier = base64UrlEncode(
    crypto.getRandomValues(new Uint8Array(32))
  );
  const hashed = await sha256(codeVerifier);
  const codeChallenge = base64UrlEncode(hashed);
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
      console.error("Failed to start login", err);
    });
}

/* =======================================================
   UI ELEMENTS
======================================================= */

const pillLabel = document.getElementById("pillLabel");
const statusText = document.getElementById("statusText");
const statusPill = document.getElementById("statusPill");
const statusPillLabel = document.getElementById("statusPillLabel");
const errorBox = document.getElementById("errorBox");
const userEmailBadge = document.getElementById("userEmailBadge");
const btnSubscribe = document.getElementById("btnSubscribe");
const btnRefresh = document.getElementById("btnRefresh");
const btnLoginHeader = document.getElementById("btnLoginHeader");

function setError(msg) {
  errorBox.textContent = msg || "";
}

function setLoading(isLoading) {
  btnSubscribe.disabled = isLoading;
  btnRefresh.disabled = isLoading;
}

function updateEmailBadge() {
  const email = decodeEmailFromIdToken();
  if (email) {
    userEmailBadge.textContent = email;
  } else {
    userEmailBadge.textContent = "Not logged in";
  }
}

function applyActiveStatus(renewsMs) {
  statusText.innerHTML =
    "<strong>Active subscription.</strong> You’ll receive the full daily briefing.";
  statusPill.className = "status-pill active";
  statusPillLabel.textContent = "Active";
  pillLabel.textContent = "Subscriber · Daily briefing";

  if (renewsMs) {
    const d = new Date(renewsMs);
    if (!isNaN(d.getTime())) {
      statusText.innerHTML += `<br /><span style="font-size:11px;color:var(--text-muted);">Renews around ${d.toLocaleDateString()}.</span>`;
    }
  }

  btnSubscribe.textContent = "Update billing";
}

function applyInactiveStatus(reasonText) {
  statusText.textContent =
    reasonText ||
    "No active subscription found. You’re on the free preview.";
  statusPill.className = "status-pill inactive";
  statusPillLabel.textContent = "Not subscribed";
  pillLabel.textContent = "Free preview · Upgrade for full brief";
  btnSubscribe.textContent = "Subscribe · $1.99 / mo";
}

async function refreshStatus() {
  setError("");
  setLoading(true);

  const idToken = getIdToken();
  if (!idToken) {
    statusText.textContent =
      "You must be logged in to view your subscription.";
    statusPill.className = "status-pill inactive";
    statusPillLabel.textContent = "Login required";
    pillLabel.textContent = "Login required";
    setLoading(false);
    return;
  }

  updateEmailBadge();

  try {
    const data = await callApi("/api/subscription-status", { method: "GET" });

    if (data && data.status === "active") {
      applyActiveStatus(data.renews);
    } else {
      applyInactiveStatus();
    }
  } catch (err) {
    console.error(err);

    if (err.code === "NO_LOGIN") {
      statusText.textContent =
        "You must be logged in to view your subscription.";
      pillLabel.textContent = "Login required";
    } else if (err.httpStatus === 401) {
      statusText.textContent =
        "Your login has expired. Please log in again from the main page.";
      pillLabel.textContent = "Login expired";
    } else {
      statusText.textContent = "Could not load subscription status.";
      pillLabel.textContent = "Error loading status";
    }

    statusPill.className = "status-pill inactive";
    statusPillLabel.textContent = "Error";
    setError(err.message);
  } finally {
    setLoading(false);
  }
}

async function startCheckout() {
  setError("");
  setLoading(true);

  try {
    const data = await callApi("/api/create-checkout-session", {
      method: "POST",
      body: JSON.stringify({}),
    });

    if (data && data.url) {
      window.location.href = data.url;
    } else {
      throw new Error("No checkout URL returned from server.");
    }
  } catch (err) {
    console.error(err);

    if (err.code === "NO_LOGIN" || err.httpStatus === 401) {
      setError(
        "You must be logged in to manage billing. Please log in again from the main page."
      );
      pillLabel.textContent = "Login required";
      statusPill.className = "status-pill inactive";
      statusPillLabel.textContent = "Login required";
    } else {
      setError("Could not start checkout: " + err.message);
    }
  } finally {
    setLoading(false);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  btnSubscribe.addEventListener("click", startCheckout);
  btnRefresh.addEventListener("click", refreshStatus);
  if (btnLoginHeader) btnLoginHeader.addEventListener("click", startLogin);

  updateEmailBadge();
  refreshStatus().catch((e) => {
    console.error(e);
  });
});
