
/*
 * Cloudflare Worker URL
 */
const API_BASE =
  "https://google-drive-json-editor-api.laurencengankem.workers.dev";

const TOKEN_KEY = "json_editor_session";
const PAGE_SIZE = 10;

const $ = (id) => document.getElementById(id);

const loginPanel = $("login-panel");
const dashboardPanel = $("dashboard-panel");

let token = sessionStorage.getItem(TOKEN_KEY) || "";

let documentData = {
  membres: [],
  cotisations: []
};

let currentPage = 1;
let isSaving = false;

/* =========================
   GENERAL HELPERS
========================= */

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
  return {
    Authorization: `Bearer ${token}`
  };
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
    throw new Error(
      payload.error || "Session expirée. Veuillez vous reconnecter."
    );
  }

  if (!response.ok) {
    throw new Error(
      payload.error || `Erreur HTTP ${response.status}`
    );
  }

  return payload;
}

function showDashboard() {
  loginPanel.hidden = true;
  dashboardPanel.hidden = false;
}

function showLogin() {
  loginPanel.hidden = false;
  dashboardPanel.hidden = true;
}

function signOut(showMessage = true) {
  token = "";

  documentData = {
    membres: [],
    cotisations: []
  };

  sessionStorage.removeItem(TOKEN_KEY);

  showLogin();
  setStatus("Non connecté");

  if (showMessage) {
    setMessage(
      "login-message",
      "Vous avez été déconnecté."
    );
  }
}

/* =========================
   FORMATTING
========================= */

function formatMoney(amount) {
  return new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 0
  }).format(amount) + " FCFA";
}

function formatDate(date) {
  if (!date) return "—";

  const parsed = new Date(`${date}T00:00:00`);

  if (Number.isNaN(parsed.getTime())) {
    return date;
  }

  return new Intl.DateTimeFormat("fr-FR").format(parsed);
}

function getMemberName(memberId) {
  const member = documentData.membres.find(
    (m) => String(m.id) === String(memberId)
  );

  return member ? member.nom : "Membre inconnu";
}

function getSortedContributions() {
  return [...documentData.cotisations].sort((a, b) => {
    const dateComparison = String(b.date || "")
      .localeCompare(String(a.date || ""));

    if (dateComparison !== 0) {
      return dateComparison;
    }

    return Number(b.id || 0) - Number(a.id || 0);
  });
}

/* =========================
   LOAD DOCUMENT
========================= */

async function loadDocument() {
  const reloadButton = $("reload-button");

  reloadButton.disabled = true;
  setMessage("editor-message", "Chargement des données...");

  try {
    const result = await api("/api/json");

    if (
      !result.data ||
      !Array.isArray(result.data.membres) ||
      !Array.isArray(result.data.cotisations)
    ) {
      throw new Error("Le format du document JSON est incorrect.");
    }

    documentData = result.data;
    currentPage = 1;

    renderDashboard();

    $("last-saved").textContent = result.modifiedTime
      ? `Dernière modification sur Drive : ${
          new Date(result.modifiedTime).toLocaleString("fr-FR")
        }`
      : "";

    setMessage(
      "editor-message",
      "Données chargées avec succès.",
      "success"
    );

    setStatus("Connecté", "ok");

  } catch (error) {
    setMessage("editor-message", error.message, "error");
    setStatus("Erreur de connexion", "error");

  } finally {
    reloadButton.disabled = false;
  }
}

/* =========================
   RENDER DASHBOARD
========================= */

function renderDashboard() {
  renderBalance();
  renderMemberSelect();
  renderContributions();
}

function renderBalance() {
  const total = documentData.cotisations.reduce(
    (sum, contribution) => {
      const amount = Number(contribution.somme);

      return sum + (
        Number.isFinite(amount) ? amount : 0
      );
    },
    0
  );

  $("total-balance").textContent = formatMoney(total);

  const contributionCount = documentData.cotisations.length;
  const memberCount = documentData.membres.length;

  $("contribution-count").textContent =
    `${contributionCount} cotisation${contributionCount > 1 ? "s" : ""}`;

  $("member-count").textContent =
    `${memberCount} membre${memberCount > 1 ? "s" : ""}`;

  $("history-count").textContent =
    `${contributionCount} entrée${contributionCount > 1 ? "s" : ""}`;
}

/* =========================
   MEMBER SELECT
========================= */

function renderMemberSelect() {
  const select = $("contribution-member");
  const previousValue = select.value;

  select.replaceChildren();

  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "Choisir un membre";

  select.appendChild(defaultOption);

  documentData.membres.forEach((member) => {
    const option = document.createElement("option");

    option.value = String(member.id);
    option.textContent = member.nom;

    select.appendChild(option);
  });

  if (
    documentData.membres.some(
      (member) => String(member.id) === previousValue
    )
  ) {
    select.value = previousValue;
  }
}

/* =========================
   CONTRIBUTION TABLE
========================= */

function renderContributions() {
  const tbody = $("contributions-table");

  tbody.replaceChildren();

  const contributions = getSortedContributions();

  const totalPages = Math.max(
    1,
    Math.ceil(contributions.length / PAGE_SIZE)
  );

  currentPage = Math.min(currentPage, totalPages);

  const startIndex = (currentPage - 1) * PAGE_SIZE;

  const pageItems = contributions.slice(
    startIndex,
    startIndex + PAGE_SIZE
  );

  if (pageItems.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = 5;
    cell.className = "empty-state";
    cell.textContent = "Aucune cotisation enregistrée.";

    row.appendChild(cell);
    tbody.appendChild(row);

  } else {
    pageItems.forEach((contribution) => {
      const row = document.createElement("tr");

      const dateCell = document.createElement("td");
      dateCell.textContent = formatDate(contribution.date);

      const memberCell = document.createElement("td");
      memberCell.textContent = getMemberName(
        contribution.membreId
      );

      const idCell = document.createElement("td");
      idCell.textContent = contribution.id ?? "—";

      const amountCell = document.createElement("td");
      amountCell.className = "amount-column";
      amountCell.textContent = formatMoney(
        Number(contribution.somme) || 0
      );

      // Delete action
      const actionsCell = document.createElement("td");
      actionsCell.className = "actions-column";

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "delete-button";
      deleteButton.textContent = "🗑️ Supprimer";
      deleteButton.disabled = isSaving;

      deleteButton.addEventListener("click", () => {
        deleteContribution(contribution.id);
      });

      actionsCell.appendChild(deleteButton);

      row.append(
        dateCell,
        memberCell,
        idCell,
        amountCell,
        actionsCell
      );

      tbody.appendChild(row);
    });
  }

  $("pagination-info").textContent =
    `Page ${currentPage} sur ${totalPages}`;

  $("previous-button").disabled = currentPage <= 1;
  $("next-button").disabled = currentPage >= totalPages;
}

/* =========================
   SAVE DOCUMENT TO DRIVE
========================= */

async function saveDocument(data) {
  const result = await api("/api/json", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ data })
  });

  return result;
}

/* =========================
   DELETE CONTRIBUTION
========================= */

async function deleteContribution(id) {
  if (isSaving) return;

  const contribution = documentData.cotisations.find(
    (item) => String(item.id) === String(id)
  );

  if (!contribution) {
    setMessage(
      "editor-message",
      "Cette cotisation est introuvable.",
      "error"
    );
    return;
  }

  const memberName = getMemberName(contribution.membreId);
  const date = formatDate(contribution.date);
  const amount = formatMoney(Number(contribution.somme) || 0);

  // First confirmation
  const confirmed = window.confirm(
    "ATTENTION : vous êtes sur le point de supprimer une cotisation.\n\n" +
    `Membre : ${memberName}\n` +
    `Date : ${date}\n` +
    `Montant : ${amount}\n\n` +
    "Une sauvegarde du fichier sera créée sur Google Drive avant la modification.\n\n" +
    "Voulez-vous vraiment continuer ?"
  );

  if (!confirmed) {
    return;
  }

  const updatedCotisations = documentData.cotisations.filter(
    (item) => String(item.id) !== String(id)
  );

  if (updatedCotisations.length === documentData.cotisations.length) {
    setMessage(
      "editor-message",
      "Aucune cotisation n'a été supprimée.",
      "error"
    );
    return;
  }

  const updatedData = {
    ...documentData,
    cotisations: updatedCotisations
  };

  const reloadButton = $("reload-button");
  const addButton = $("add-button");

  isSaving = true;

  reloadButton.disabled = true;

  if (addButton) {
    addButton.disabled = true;
  }

  renderContributions();

  setMessage(
    "editor-message",
    "Suppression en cours : création de la sauvegarde et mise à jour de Google Drive..."
  );

  try {
    // The Worker creates a backup before updating the original file.
    const result = await saveDocument(updatedData);

    // Update local data only after successful Drive save.
    documentData = updatedData;

    const totalPages = Math.max(
      1,
      Math.ceil(documentData.cotisations.length / PAGE_SIZE)
    );

    currentPage = Math.min(currentPage, totalPages);

    renderDashboard();

    $("last-saved").textContent =
      `Enregistré le ${new Date().toLocaleString("fr-FR")}`;

    setMessage(
      "editor-message",
      result.backupName
        ? `Cotisation supprimée. Sauvegarde créée : ${result.backupName}`
        : "Cotisation supprimée avec succès.",
      "success"
    );

    setStatus("Enregistré", "ok");

  } catch (error) {
    setMessage(
      "editor-message",
      `La suppression a échoué : ${error.message}`,
      "error"
    );

    setStatus("Échec de suppression", "error");

  } finally {
    isSaving = false;

    reloadButton.disabled = false;

    if (addButton) {
      addButton.disabled = false;
    }

    renderContributions();
  }
}

/* =========================
   ADD CONTRIBUTION
========================= */

$("contribution-form").addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();

    if (isSaving) return;

    const memberIdValue = $("contribution-member").value;
    const date = $("contribution-date").value;
    const amount = Number($("contribution-amount").value);

    if (
      !memberIdValue ||
      !date ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      setMessage(
        "editor-message",
        "Veuillez remplir correctement tous les champs.",
        "error"
      );
      return;
    }

    const member = documentData.membres.find(
      (m) => String(m.id) === memberIdValue
    );

    if (!member) {
      setMessage(
        "editor-message",
        "Le membre sélectionné est introuvable.",
        "error"
      );
      return;
    }

    const existingIds = documentData.cotisations
      .map((item) => Number(item.id))
      .filter((id) => Number.isFinite(id));

    const nextId = existingIds.length
      ? Math.max(...existingIds) + 1
      : 0;

    const newContribution = {
      id: nextId,
      date,
      membreId: member.id,
      somme: amount
    };

    const updatedData = {
      ...documentData,
      cotisations: [
        ...documentData.cotisations,
        newContribution
      ]
    };

    const addButton = $("add-button");
    const reloadButton = $("reload-button");

    isSaving = true;
    addButton.disabled = true;
    reloadButton.disabled = true;

    addButton.textContent = "Sauvegarde en cours...";

    renderContributions();

    setMessage(
      "editor-message",
      "Création de la sauvegarde et enregistrement sur Google Drive..."
    );

    try {
      const result = await saveDocument(updatedData);

      documentData = updatedData;
      currentPage = 1;

      renderDashboard();

      $("contribution-form").reset();
      setTodayAsDefault();

      $("last-saved").textContent =
        `Enregistré le ${new Date().toLocaleString("fr-FR")}`;

      setMessage(
        "editor-message",
        result.backupName
          ? `Cotisation enregistrée. Sauvegarde créée : ${result.backupName}`
          : "Cotisation enregistrée avec succès.",
        "success"
      );

      setStatus("Enregistré", "ok");

    } catch (error) {
      setMessage(
        "editor-message",
        error.message,
        "error"
      );

      setStatus("Échec de sauvegarde", "error");

    } finally {
      isSaving = false;
      addButton.disabled = false;
      reloadButton.disabled = false;
      addButton.textContent = "+ Enregistrer la cotisation";

      renderContributions();
    }
  }
);

/* =========================
   PAGINATION
========================= */

$("previous-button").addEventListener("click", () => {
  if (currentPage > 1) {
    currentPage--;
    renderContributions();
  }
});

$("next-button").addEventListener("click", () => {
  const totalPages = Math.max(
    1,
    Math.ceil(documentData.cotisations.length / PAGE_SIZE)
  );

  if (currentPage < totalPages) {
    currentPage++;
    renderContributions();
  }
});

/* =========================
   DEFAULT DATE
========================= */

function setTodayAsDefault() {
  const now = new Date();

  const localDate = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("-");

  $("contribution-date").value = localDate;
}

/* =========================
   LOGIN
========================= */

$("login-form").addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();

    const password = $("password").value;
    const button = event.submitter;

    button.disabled = true;

    setMessage(
      "login-message",
      "Vérification du mot de passe..."
    );

    try {
      const response = await fetch(
        `${API_BASE}/api/login`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ password })
        }
      );

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          result.error || "Impossible de se connecter."
        );
      }

      token = result.token;

      sessionStorage.setItem(TOKEN_KEY, token);

      $("password").value = "";

      showDashboard();

      await loadDocument();

    } catch (error) {
      setMessage(
        "login-message",
        error.message,
        "error"
      );

      setStatus("Non connecté");

    } finally {
      button.disabled = false;
    }
  }
);

/* =========================
   BUTTONS
========================= */

$("logout-button").addEventListener(
  "click",
  () => signOut()
);

$("reload-button").addEventListener(
  "click",
  loadDocument
);

/* =========================
   INITIALIZATION
========================= */

setTodayAsDefault();

if (token) {
  showDashboard();
  loadDocument();
} else {
  showLogin();
}
