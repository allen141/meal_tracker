const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SLOTS = ["Breakfast", "Lunch", "Dinner", "Snack"];
const STORAGE_KEY = "macroflow-state-v1";
const SESSION_KEY = "macroflow-session-v1";
const API_BASE = (window.MACROFLOW_API_BASE || "").replace(/\/$/, "");

const defaultState = {
  macroTargets: { protein: 170, carbs: 210, fat: 65 },
  mealLibrary: [
    {
      id: "meal-1",
      name: "Chicken Burrito Bowl",
      protein: 42,
      carbs: 58,
      fat: 14,
      tags: ["protein:chicken", "meal-time:lunch", "prep:batch-friendly"],
    },
    {
      id: "meal-2",
      name: "Greek Yogurt Parfait",
      protein: 28,
      carbs: 36,
      fat: 6,
      tags: ["protein:dairy", "meal-time:breakfast", "prep:fast"],
    },
    {
      id: "meal-3",
      name: "Salmon + Rice + Greens",
      protein: 40,
      carbs: 48,
      fat: 16,
      tags: ["protein:fish", "meal-time:dinner", "prep:batch-friendly"],
    },
  ],
  plan: Object.fromEntries(
    DAYS.map((day) => [
      day,
      Object.fromEntries(SLOTS.map((slot) => [slot, []])),
    ])
  ),
  mealPrepBlocks: [],
};

const refs = {
  weekGrid: document.getElementById("weekGrid"),
  targetForm: document.getElementById("targetForm"),
  mealLibrary: document.getElementById("mealLibrary"),
  mealSearch: document.getElementById("mealSearch"),
  prepMealSelect: document.getElementById("prepMealSelect"),
  prepDays: document.getElementById("prepDays"),
  prepList: document.getElementById("prepList"),
  mealPrepForm: document.getElementById("mealPrepForm"),
  prepServings: document.getElementById("prepServings"),
  addMealBtn: document.getElementById("addMealBtn"),
  mealDialog: document.getElementById("mealDialog"),
  mealDialogTitle: document.getElementById("mealDialogTitle"),
  mealForm: document.getElementById("mealForm"),
  cancelMealBtn: document.getElementById("cancelMealBtn"),
  resetBtn: document.getElementById("resetBtn"),
  authEmail: document.getElementById("authEmail"),
  authPassword: document.getElementById("authPassword"),
  loginBtn: document.getElementById("loginBtn"),
  registerBtn: document.getElementById("registerBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  authStatus: document.getElementById("authStatus"),
};

let state = loadState();
let session = loadSession();
let dragPayload = null;
let editingMealId = null;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(defaultState);
    const parsed = JSON.parse(raw);
    return {
      macroTargets: parsed.macroTargets || structuredClone(defaultState.macroTargets),
      mealLibrary: parsed.mealLibrary || structuredClone(defaultState.mealLibrary),
      plan: parsed.plan || structuredClone(defaultState.plan),
      mealPrepBlocks: parsed.mealPrepBlocks || [],
    };
  } catch {
    return structuredClone(defaultState);
  }
}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

function saveStateLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function saveSession() {
  if (session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } else {
    localStorage.removeItem(SESSION_KEY);
  }
}

async function apiFetch(url, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (session?.token) headers.Authorization = `Bearer ${session.token}`;

  const requestUrl = `${API_BASE}${url}`;
  const response = await fetch(requestUrl, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function persistState() {
  saveStateLocal();
  if (!session?.token) return;
  await apiFetch("/api/state", {
    method: "PUT",
    body: JSON.stringify({ state }),
  });
}

function setAuthStatus(message) {
  refs.authStatus.textContent = message;
}

function getMealById(mealId) {
  return state.mealLibrary.find((meal) => meal.id === mealId);
}

function formatMacros({ protein, carbs, fat }) {
  return `P ${protein}g · C ${carbs}g · F ${fat}g`;
}

function sumDayMacros(day) {
  const totals = { protein: 0, carbs: 0, fat: 0 };
  SLOTS.forEach((slot) => {
    state.plan[day][slot].forEach((mealId) => {
      const meal = getMealById(mealId);
      if (!meal) return;
      totals.protein += meal.protein;
      totals.carbs += meal.carbs;
      totals.fat += meal.fat;
    });
  });
  return totals;
}

function renderTargets() {
  refs.targetForm.innerHTML = Object.entries(state.macroTargets)
    .map(
      ([key, value]) => `
        <label class="target-pill">
          ${key[0].toUpperCase() + key.slice(1)}
          <input type="number" min="0" data-macro-key="${key}" value="${value}" />
        </label>
      `
    )
    .join("");
}

function removePlannerMeal(day, slot, index) {
  state.plan[day][slot].splice(index, 1);
  persistState().catch(() => null);
  renderWeekGrid();
}

function renderWeekGrid() {
  refs.weekGrid.innerHTML = "";

  DAYS.forEach((day) => {
    const dayTotals = sumDayMacros(day);
    const dayEl = document.createElement("article");
    dayEl.className = "day-column";

    dayEl.innerHTML = `
      <header class="day-header">
        <strong>${day}</strong>
        <span class="macro-summary">${formatMacros(dayTotals)}</span>
      </header>
      <div class="slots"></div>
    `;

    const slotsContainer = dayEl.querySelector(".slots");

    SLOTS.forEach((slot) => {
      const slotEl = document.createElement("div");
      slotEl.className = "slot";
      slotEl.dataset.day = day;
      slotEl.dataset.slot = slot;
      slotEl.innerHTML = `<div class="slot-title">${slot}</div>`;

      slotEl.addEventListener("dragover", (event) => {
        event.preventDefault();
        slotEl.classList.add("over");
      });

      slotEl.addEventListener("dragleave", () => {
        slotEl.classList.remove("over");
      });

      slotEl.addEventListener("drop", (event) => {
        event.preventDefault();
        slotEl.classList.remove("over");
        if (!dragPayload) return;

        const targetDay = slotEl.dataset.day;
        const targetSlot = slotEl.dataset.slot;

        if (dragPayload.sourceType === "library") {
          state.plan[targetDay][targetSlot].push(dragPayload.mealId);
        } else {
          const { day: sourceDay, slot: sourceSlot, index } = dragPayload;
          const [moved] = state.plan[sourceDay][sourceSlot].splice(index, 1);
          if (moved) state.plan[targetDay][targetSlot].push(moved);
        }

        dragPayload = null;
        persistState().catch(() => null);
        renderWeekGrid();
      });

      state.plan[day][slot].forEach((mealId, index) => {
        const meal = getMealById(mealId);
        if (!meal) return;

        const chip = document.createElement("div");
        chip.className = "meal-chip";
        chip.draggable = true;
        chip.innerHTML = `
          <div class="chip-row">
            <strong>${meal.name}</strong>
            <button class="mini-btn" type="button" data-remove="1">Remove</button>
          </div>
          <span class="chip-macros">${formatMacros(meal)}</span>
        `;

        chip.addEventListener("dragstart", () => {
          dragPayload = { sourceType: "planner", day, slot, index, mealId };
        });

        chip.querySelector("[data-remove]").addEventListener("click", (event) => {
          event.stopPropagation();
          removePlannerMeal(day, slot, index);
        });

        slotEl.appendChild(chip);
      });

      slotsContainer.appendChild(slotEl);
    });

    refs.weekGrid.appendChild(dayEl);
  });
}

function mealMatchesFilter(meal, query) {
  if (!query) return true;
  const normalized = query.toLowerCase();
  return (
    meal.name.toLowerCase().includes(normalized) ||
    meal.tags.some((tag) => tag.toLowerCase().includes(normalized))
  );
}

function deleteMeal(mealId) {
  state.mealLibrary = state.mealLibrary.filter((meal) => meal.id !== mealId);
  DAYS.forEach((day) => {
    SLOTS.forEach((slot) => {
      state.plan[day][slot] = state.plan[day][slot].filter((id) => id !== mealId);
    });
  });
  state.mealPrepBlocks = state.mealPrepBlocks.filter((block) => block.mealId !== mealId);

  if (session?.token) {
    apiFetch(`/api/meals/${mealId}`, { method: "DELETE" }).catch(() => null);
  }

  persistState().catch(() => null);
  renderAll();
}

function populateMealForm(meal) {
  refs.mealForm.elements.name.value = meal.name;
  refs.mealForm.elements.protein.value = meal.protein;
  refs.mealForm.elements.carbs.value = meal.carbs;
  refs.mealForm.elements.fat.value = meal.fat;
  refs.mealForm.elements.tags.value = meal.tags.join(", ");
}

function renderMealLibrary() {
  const query = refs.mealSearch.value.trim();
  refs.mealLibrary.innerHTML = "";

  state.mealLibrary.filter((meal) => mealMatchesFilter(meal, query)).forEach((meal) => {
    const card = document.createElement("div");
    card.className = "library-item";
    card.draggable = true;
    card.innerHTML = `
      <strong>${meal.name}</strong>
      <div class="chip-macros">${formatMacros(meal)}</div>
      <div class="tags">${meal.tags.map((tag) => `<span class="tag">${tag}</span>`).join("")}</div>
      <div class="library-actions">
        <button class="mini-btn" type="button" data-edit="1">Edit</button>
        <button class="mini-btn" type="button" data-delete="1">Delete</button>
      </div>
    `;

    card.addEventListener("dragstart", () => {
      dragPayload = { sourceType: "library", mealId: meal.id };
    });

    card.querySelector("[data-edit]").addEventListener("click", () => {
      editingMealId = meal.id;
      refs.mealDialogTitle.textContent = "Edit meal";
      populateMealForm(meal);
      refs.mealDialog.showModal();
    });

    card.querySelector("[data-delete]").addEventListener("click", () => {
      deleteMeal(meal.id);
    });

    refs.mealLibrary.appendChild(card);
  });

  refs.prepMealSelect.innerHTML = state.mealLibrary
    .map((meal) => `<option value="${meal.id}">${meal.name}</option>`)
    .join("");
}

function renderPrepDays() {
  refs.prepDays.innerHTML = DAYS.map(
    (day) => `<label><input type="checkbox" value="${day}" /> ${day}</label>`
  ).join("");
}

function renderPrepList() {
  refs.prepList.innerHTML = "";
  if (!state.mealPrepBlocks.length) {
    refs.prepList.innerHTML = '<p class="chip-macros">No prep blocks yet.</p>';
    return;
  }

  state.mealPrepBlocks.forEach((block, index) => {
    const meal = getMealById(block.mealId);
    if (!meal) return;
    const item = document.createElement("div");
    item.className = "prep-item";
    item.innerHTML = `
      <span>
        <strong>${meal.name}</strong><br />
        Cook ${block.servings} servings on ${block.days.join(", ")}.
      </span>
      <button class="mini-btn" type="button" data-remove-prep="${index}">Remove</button>
    `;

    item.querySelector("[data-remove-prep]").addEventListener("click", () => {
      state.mealPrepBlocks.splice(index, 1);
      persistState().catch(() => null);
      renderPrepList();
    });

    refs.prepList.appendChild(item);
  });
}

function renderAll() {
  renderTargets();
  renderMealLibrary();
  renderPrepDays();
  renderPrepList();
  renderWeekGrid();
}

async function pullServerState() {
  if (!session?.token) return;
  const response = await apiFetch("/api/state");
  if (response.state) {
    state = response.state;
    saveStateLocal();
  } else {
    await persistState();
  }
  renderAll();
}

async function handleAuth(mode) {
  const email = refs.authEmail.value.trim();
  const password = refs.authPassword.value;
  if (!email || !password) return;

  const endpoint = mode === "register" ? "/api/auth/register" : "/api/auth/login";
  const data = await apiFetch(endpoint, {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

  session = { token: data.token, user: data.user };
  saveSession();
  setAuthStatus(`Logged in as ${session.user.email}. Server sync on.`);
  await pullServerState();
}

function bindEvents() {
  refs.mealSearch.addEventListener("input", renderMealLibrary);

  refs.targetForm.addEventListener("input", (event) => {
    const input = event.target;
    const key = input.dataset.macroKey;
    if (!key) return;
    state.macroTargets[key] = Number(input.value) || 0;
    persistState().catch(() => null);
  });

  refs.mealPrepForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const mealId = refs.prepMealSelect.value;
    const servings = Number(refs.prepServings.value) || 1;
    const selectedDays = Array.from(refs.prepDays.querySelectorAll("input:checked")).map(
      (checkbox) => checkbox.value
    );

    if (!mealId || !selectedDays.length) return;

    state.mealPrepBlocks.push({ mealId, servings, days: selectedDays });
    refs.mealPrepForm.reset();
    renderPrepDays();
    persistState().catch(() => null);
    renderPrepList();
  });

  refs.addMealBtn.addEventListener("click", () => {
    editingMealId = null;
    refs.mealDialogTitle.textContent = "Add meal to library";
    refs.mealForm.reset();
    refs.mealDialog.showModal();
  });

  refs.cancelMealBtn.addEventListener("click", () => refs.mealDialog.close());

  refs.mealForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(refs.mealForm);
    const name = String(formData.get("name") || "").trim();
    const protein = Number(formData.get("protein"));
    const carbs = Number(formData.get("carbs"));
    const fat = Number(formData.get("fat"));
    const tags = String(formData.get("tags") || "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

    if (!name) return;

    if (editingMealId) {
      const existing = getMealById(editingMealId);
      if (existing) {
        existing.name = name;
        existing.protein = protein;
        existing.carbs = carbs;
        existing.fat = fat;
        existing.tags = tags;
        if (session?.token) {
          apiFetch(`/api/meals/${editingMealId}`, {
            method: "PUT",
            body: JSON.stringify(existing),
          }).catch(() => null);
        }
      }
    } else {
      const meal = { id: `meal-${crypto.randomUUID()}`, name, protein, carbs, fat, tags };
      state.mealLibrary.unshift(meal);
      if (session?.token) {
        apiFetch("/api/meals", {
          method: "POST",
          body: JSON.stringify(meal),
        }).catch(() => null);
      }
    }

    refs.mealDialog.close();
    refs.mealForm.reset();
    editingMealId = null;
    persistState().catch(() => null);
    renderAll();
  });

  refs.resetBtn.addEventListener("click", () => {
    state = structuredClone(defaultState);
    persistState().catch(() => null);
    renderAll();
  });

  refs.loginBtn.addEventListener("click", async () => {
    try {
      await handleAuth("login");
    } catch (error) {
      setAuthStatus(error.message);
    }
  });

  refs.registerBtn.addEventListener("click", async () => {
    try {
      await handleAuth("register");
    } catch (error) {
      setAuthStatus(error.message);
    }
  });

  refs.logoutBtn.addEventListener("click", () => {
    session = null;
    saveSession();
    setAuthStatus("Logged out. Local mode.");
  });
}

async function init() {
  renderAll();
  bindEvents();

  if (session?.user?.email) {
    setAuthStatus(`Logged in as ${session.user.email}. Syncing…`);
    try {
      await pullServerState();
      setAuthStatus(`Logged in as ${session.user.email}. Server sync on.`);
    } catch {
      setAuthStatus("Session expired or backend unavailable. Local mode.");
    }
  } else {
    setAuthStatus("Not logged in. Local mode.");
  }
}

init();
