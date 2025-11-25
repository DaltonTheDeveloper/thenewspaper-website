// ===== shared helpers (same as billing.js) =====
// paste the helpers from section 1 here: API_BASE_URL, getTokens, isTokenValid, etc.

const loginBtn        = document.querySelector(".btn-login");
const loginLabelSpan  = document.querySelector(".btn-login-label");
const sideText        = document.getElementById("subStatusSide");
const chipText        = document.getElementById("subStatusText");
const manageSubLabel  = document.getElementById("btnManageBillingSub");
const sampleBtn       = document.getElementById("btnViewSample");
const billingBtn      = document.getElementById("btnManageBilling");

async function refreshSubscriptionBadge() {
  if (!isTokenValid()) {
    clearTokens();
    if (sideText) sideText.textContent = "Free preview · Upgrade for full email";
    if (chipText) chipText.textContent = "Free preview · Upgrade for full brief";
    if (manageSubLabel) manageSubLabel.textContent = "Start subscription for $1.99 / mo";
    return;
  }

  if (sideText) sideText.textContent = "Checking…";
  if (chipText) chipText.textContent = "Checking subscription…";

  try {
    const data = await callApi("/api/subscription-status", { method: "GET" });

    if (data && data.status === "active") {
      if (sideText) sideText.textContent = "Active · Full briefings";
      if (chipText) chipText.textContent = "Subscriber · Full access";
      if (manageSubLabel) manageSubLabel.textContent = "Manage subscription in Stripe";
    } else {
      if (sideText) sideText.textContent = "Free preview · Upgrade for full email";
      if (chipText) chipText.textContent = "Free preview · Upgrade for full brief";
      if (manageSubLabel) manageSubLabel.textContent = "Start subscription for $1.99 / mo";
    }
  } catch (err) {
    console.error("Error refreshing subscription status:", err);
    if (sideText) sideText.textContent = "Status unavailable";
    if (chipText) chipText.textContent = "Status unavailable";
    if (manageSubLabel) manageSubLabel.textContent = "Open Stripe billing portal";
  }
}

function initAuthUI() {
  if (!loginBtn) return;

  if (isTokenValid()) {
    if (loginLabelSpan) loginLabelSpan.textContent = "Account";
    loginBtn.onclick = () => {
      window.location.href = "https://thenewspaper.site/billing.html";
    };
    refreshSubscriptionBadge();
  } else {
    clearTokens();
    if (loginLabelSpan) loginLabelSpan.textContent = "Login / Sign up";
    loginBtn.onclick = startLogin;
  }
}

function initButtons() {
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
}

document.addEventListener("DOMContentLoaded", () => {
  initAuthUI();
  initButtons();
});
