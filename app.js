/*
 * Set API_BASE to your deployed Cloudflare Worker URL.
 * Example: https://my-json-editor-api.your-subdomain.workers.dev
 */
const API_BASE = "https://google-drive-json-editor-api.laurencengankem.workers.dev";

const $ = (id) => document.getElementById(id);
const loginPanel = $("login-panel");
const editorPanel = $("editor-panel");
const editor = $("json-editor");
const TOKEN_KEY = "json_editor_session";

let token = sessionStorage.getItem(TOKEN_KEY) || "";

function setStatus(text, kind = "") {
  const el = $("connection");
  el.textContent = text;
  el.className = `status ${kind}`;
}
function setMessage(id, text, kind = "") {
  const el = $(id);
  el.textContent = text;
  el.className = `message ${kind}`;
}
function authHeaders() {
  return { "Authorization": `Bearer ${token}` };
}
async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(token ? authHeaders() : {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    signOut(false);
    throw new Error(payload.error || "Your session expired. Please sign in again.");
  }
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}
function showEditor() {
  loginPanel.hidden = true;
  editorPanel.hidden = false;
}
function showLogin() {
  loginPanel.hidden = false;
  editorPanel.hidden = true;
}
function signOut(showMessage = true) {
  token = "";
  sessionStorage.removeItem(TOKEN_KEY);
  editor.value = "";
  showLogin();
  setStatus("Signed out");
  if (showMessage) setMessage("login-message", "You have been signed out.");
}
async function loadDocument() {
  $("reload-button").disabled = true;
  setMessage("editor-message", "Loading from Google Drive…");
  try {
    const result = await api("/api/json");
    editor.value = JSON.stringify(result.data, null, 2);
    $("last-saved").textContent = result.modifiedTime
      ? `Drive file last modified: ${new Date(result.modifiedTime).toLocaleString()}`
      : "";
    setMessage("editor-message", "Document loaded.", "success");
    setStatus("Connected", "ok");
    validateEditor();
  } catch (error) {
    setMessage("editor-message", error.message, "error");
    setStatus("Connection error", "error");
  } finally {
    $("reload-button").disabled = false;
  }
}
function validateEditor() {
  try {
    JSON.parse(editor.value);
    $("validation").textContent = "Valid JSON";
    $("validation").className = "validation good";
    $("save-button").disabled = false;
    return true;
  } catch (error) {
    $("validation").textContent = error.message;
    $("validation").className = "validation bad";
    $("save-button").disabled = true;
    return false;
  }
}

$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = $("password").value;
  const button = event.submitter;
  button.disabled = true;
  setMessage("login-message", "Checking password…");
  try {
    const response = await fetch(`${API_BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Unable to sign in.");
    token = result.token;
    sessionStorage.setItem(TOKEN_KEY, token);
    $("password").value = "";
    showEditor();
    await loadDocument();
  } catch (error) {
    setMessage("login-message", error.message, "error");
    setStatus("Not connected");
  } finally {
    button.disabled = false;
  }
});

$("logout-button").addEventListener("click", () => signOut());
$("reload-button").addEventListener("click", loadDocument);
$("format-button").addEventListener("click", () => {
  if (!validateEditor()) return;
  editor.value = JSON.stringify(JSON.parse(editor.value), null, 2);
  validateEditor();
  setMessage("editor-message", "JSON formatted. Remember to save your changes.");
});
editor.addEventListener("input", validateEditor);

$("save-button").addEventListener("click", async () => {
  if (!validateEditor()) return;
  const saveButton = $("save-button");
  saveButton.disabled = true;
  setMessage("editor-message", "Creating backup and saving…");
  try {
    const data = JSON.parse(editor.value);
    const result = await api("/api/json", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data })
    });
    setMessage(
      "editor-message",
      `Saved successfully. Backup: ${result.backupName}`,
      "success"
    );
    $("last-saved").textContent = `Saved: ${new Date().toLocaleString()}`;
    setStatus("Saved", "ok");
  } catch (error) {
    setMessage("editor-message", error.message, "error");
    setStatus("Save failed", "error");
  } finally {
    saveButton.disabled = !validateEditor();
  }
});

// If a tab was refreshed, a still-valid session token can be reused.
if (token) {
  showEditor();
  loadDocument().catch(() => signOut(false));
} else {
  showLogin();
}
