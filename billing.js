// ===== shared helpers from section 1 =====
// (paste the shared helpers here in billing.js)
// API_BASE_URL, getTokens, isTokenValid, getEmailFromToken, callApi, startLogin, etc.

const pillLabel        = document.getElementById("pillLabel");
const statusText       = document.getElementById("statusText");
const statusPill       = document.getElementById("statusPill");
const statusPillLabel  = document.getElementById("statusPillLabel");
const errorBox         = document.getElementById("errorBox");
const userEmailBadge   = document.getElementById("userEmailBadge");
const btnPrimary       = document.getElementById("btnPrimary");
const btnRefresh       = document.getElementById("btnRefresh");
const btnLoginHeader   = document.getElementById("btnLoginHeader");

let currentStatus = "unknown"; // "active" | "inactive" | "logged_out" | "error"

function setError(msg) {
  errorBox.textContent = msg || "";
}

function setLoading(isLoading) {
  if (btnPrimary) btnPrimary.disabled = isLoading;
  if (btnRefresh) btnRefresh.disabled = isLoading;
}

function updateEmailBadge() {
  if (!userEmailBadge) return;
  if (!isTokenValid()) {
    userEmailBadge.textContent = "Not logged in";
    return;
  }
  const email = getEmailFromToken();
  userEmailBadge.textContent = email || "Logged in";
}

function applyActiveStatus(renewsMs) {
  currentStatus = "active";
  statusText.innerHTML =
    "<strong>Active subscription.</strong> You’ll receive the full daily briefing.";
  statusPill.className = "status-pill active";
  statusPillLabel.textContent = "Active";
  pillLabel.textContent = "Subscriber · Daily briefing";

  if (renewsMs) {
    const d = new Date(renewsMs);
    if (!isNaN(d.getTime())) {
      statusText.innerHTML +=
        `<br /><span style="font-size:11px;color:var(--text-muted);">Renews around ${d.toLocaleDateString()}.</span>`;
    }
  }

  if (btnPrimary) {
    btnPrimary.textContent = "Manage billing / Cancel";
  }
}

function applyInactiveStatus(reasonText) {
  currentStatus = "inactive";
  statusText.textContent =
    reasonText ||
    "No active subscription found. You’re on the free preview.";
  statusPill.className = "status-pill inactive";
  statusPillLabel.textContent = "Not subscribed";
  pillLabel.textContent = "Free preview · Upgrade for full brief";

  if (btnPrimary) {
    btnPrimary.textContent = "Subscribe · $1.99 / mo";
  }
}

async function refreshStatus() {
  setError("");
  setLoading(true);

  if (!isTokenValid()) {
    clearTokens();
    currentStatus = "logged_out";
    userEmailBadge.textContent = "Not logged in";
    statusText.textContent =
      "You must be logged in to view or manage your subscription.";
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
    currentStatus = "error";

    if (err.code === "NO_LOGIN" || err.httpStatus === 401) {
      clearTokens();
      statusText.textContent =
        "Your login has expired. Please log in again from the main page.";
      pillLabel.textContent = "Login expired";
      currentStatus = "logged_out";
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
      clearTokens();
      pillLabel.textContent = "Login required";
      statusPill.className = "status-pill inactive";
      statusPillLabel.textContent = "Login required";
      currentStatus = "logged_out";
    } else {
      setError("Could not start checkout: " + err.message);
    }
  } finally {
    setLoading(false);
  }
}

// Stripe billing portal session
async function startBillingPortal() {
  setError("");
  setLoading(true);

  try {
    const data = await callApi("/api/create-portal-session", {
      method: "POST",
      body: JSON.stringify({}),
    });

    if (data && data.url) {
      window.location.href = data.url;
    } else {
      throw new Error("No portal URL returned from server.");
    }
  } catch (err) {
    console.error(err);
    if (err.code === "NO_LOGIN" || err.httpStatus === 401) {
      setError(
        "You must be logged in to manage billing. Please log in again from the main page."
      );
      clearTokens();
      currentStatus = "logged_out";
    } else {
      setError("Could not open billing portal: " + err.message);
    }
  } finally {
    setLoading(false);
  }
}

function handlePrimaryClick() {
  if (!isTokenValid()) {
    // always force fresh login if token missing/expired
    clearTokens();
    startLogin();
    return;
  }

  if (currentStatus === "active") {
    // Already subscribed → go to Stripe billing portal, don't create a new subscription
    startBillingPortal();
  } else {
    // Not subscribed → start a new checkout
    startCheckout();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (btnPrimary) btnPrimary.addEventListener("click", handlePrimaryClick);
  if (btnRefresh) btnRefresh.addEventListener("click", refreshStatus);
  if (btnLoginHeader) btnLoginHeader.addEventListener("click", startLogin);

  updateEmailBadge();
  refreshStatus().catch(console.error);
});
