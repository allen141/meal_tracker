export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const SLOTS = ["Breakfast", "Lunch", "Dinner", "Snack"];
export const MACROS = ["protein", "carbs", "fat"];
export const SLOT_TIMES = { Breakfast: "08:00", Lunch: "12:00", Dinner: "18:00", Snack: "15:00" };
export const STORAGE_METHODS = ["fridge", "freezer"];
export const STORAGE_KEY = "macroflow-state-v1";
export const SESSION_KEY = "macroflow-session-v1";

function pad(value) {
  return String(value).padStart(2, "0");
}

export function toDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function getWeekStartDate(date = new Date()) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = next.getDay();
  next.setDate(next.getDate() - (day === 0 ? 6 : day - 1));
  return toDateKey(next);
}

export function addDaysToDateKey(dateKey, days) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + Number(days || 0));
  return toDateKey(date);
}

export function formatDateKey(dateKey, options = { month: "short", day: "numeric" }) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, options).format(new Date(year, month - 1, day));
}

export function getDateForDay(weekStartDate, day, slot = "Breakfast") {
  const date = addDaysToDateKey(weekStartDate, DAYS.indexOf(day));
  return `${date}T${SLOT_TIMES[slot] || "12:00"}`;
}

export const defaultState = {
  macroTargets: { protein: 170, carbs: 210, fat: 65 },
  mealLibrary: [
    {
      id: "meal-1",
      name: "Chicken Burrito Bowl",
      protein: 42,
      carbs: 58,
      fat: 14,
      refrigeratedLifeDays: 4,
      frozenLifeDays: 90,
      freezerFriendly: true,
      tags: ["protein:chicken", "meal-time:lunch", "prep:batch-friendly"],
    },
    {
      id: "meal-2",
      name: "Greek Yogurt Parfait",
      protein: 28,
      carbs: 36,
      fat: 6,
      refrigeratedLifeDays: 4,
      frozenLifeDays: 30,
      freezerFriendly: false,
      tags: ["protein:dairy", "meal-time:breakfast", "prep:fast"],
    },
    {
      id: "meal-3",
      name: "Salmon + Rice + Greens",
      protein: 40,
      carbs: 48,
      fat: 16,
      refrigeratedLifeDays: 3,
      frozenLifeDays: 60,
      freezerFriendly: true,
      tags: ["protein:fish", "meal-time:dinner", "prep:batch-friendly"],
    },
  ],
  plan: Object.fromEntries(
    DAYS.map((day) => [day, Object.fromEntries(SLOTS.map((slot) => [slot, []]))]),
  ),
  weekStartDate: getWeekStartDate(),
  mealPrepBlocks: [],
  prepBatches: [],
};

export function cloneDefaultState() {
  return structuredClone(defaultState);
}

function normalizeMeal(meal, index) {
  if (!meal || typeof meal !== "object") return null;
  const name = String(meal.name || "").trim();
  if (!name) return null;
  return {
    id: String(meal.id || `meal-restored-${index}`),
    name,
    protein: Number(meal.protein) || 0,
    carbs: Number(meal.carbs) || 0,
    fat: Number(meal.fat) || 0,
    refrigeratedLifeDays: Math.max(1, Number(meal.refrigeratedLifeDays) || 4),
    frozenLifeDays: Math.max(1, Number(meal.frozenLifeDays) || 90),
    freezerFriendly: meal.freezerFriendly === true,
    tags: Array.isArray(meal.tags) ? meal.tags.map(String).filter(Boolean) : [],
  };
}

export function normalizePrepBatch(batch, index) {
  if (!batch || typeof batch !== "object" || !batch.mealId) return null;
  return {
    id: String(batch.id || `batch-restored-${index}`),
    mealId: String(batch.mealId),
    servings: Math.max(1, Number(batch.servings) || 1),
    prepDate: /^\d{4}-\d{2}-\d{2}$/.test(String(batch.prepDate || "")) ? String(batch.prepDate) : "",
    storageMethod: STORAGE_METHODS.includes(batch.storageMethod) ? batch.storageMethod : "fridge",
  };
}

function normalizeState(candidate) {
  const source = candidate && typeof candidate === "object" ? candidate : {};
  const meals = Array.isArray(source.mealLibrary)
    ? source.mealLibrary.map(normalizeMeal).filter(Boolean)
    : cloneDefaultState().mealLibrary;
  const fallback = cloneDefaultState();

  return {
    macroTargets: {
      ...fallback.macroTargets,
      ...(source.macroTargets && typeof source.macroTargets === "object"
        ? Object.fromEntries(
            MACROS.map((key) => {
              const value = source.macroTargets[key];
              return [
                key,
                value === undefined ? fallback.macroTargets[key] : Math.max(0, Number(value) || 0),
              ];
            }),
          )
        : {}),
    },
    mealLibrary: meals,
    weekStartDate: /^\d{4}-\d{2}-\d{2}$/.test(String(source.weekStartDate || "")) ? String(source.weekStartDate) : fallback.weekStartDate,
    plan: Object.fromEntries(
      DAYS.map((day) => [
        day,
        Object.fromEntries(
          SLOTS.map((slot) => [
            slot,
            Array.isArray(source.plan?.[day]?.[slot])
              ? source.plan[day][slot].map(String)
              : [],
          ]),
        ),
      ]),
    ),
    mealPrepBlocks: Array.isArray(source.mealPrepBlocks)
      ? source.mealPrepBlocks
          .filter((block) => block && typeof block === "object" && block.mealId)
          .map((block) => ({
            mealId: String(block.mealId),
            servings: Math.max(1, Number(block.servings) || 1),
            days: Array.isArray(block.days)
              ? block.days.filter((day) => DAYS.includes(day))
              : [],
          }))
          .filter((block) => block.days.length)
      : [],
    prepBatches: Array.isArray(source.prepBatches) ? source.prepBatches.map(normalizePrepBatch).filter((batch) => batch && batch.prepDate) : [],
  };
}

export function loadLocalState(storage = window.localStorage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return raw ? normalizeState(JSON.parse(raw)) : cloneDefaultState();
  } catch {
    return cloneDefaultState();
  }
}

export function saveLocalState(nextState, storage = window.localStorage) {
  storage.setItem(STORAGE_KEY, JSON.stringify(normalizeState(nextState)));
}

export function loadSession(storage = window.localStorage) {
  try {
    return JSON.parse(storage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

export function saveSession(session, storage = window.localStorage) {
  if (session) storage.setItem(SESSION_KEY, JSON.stringify(session));
  else storage.removeItem(SESSION_KEY);
}

export function getMealById(state, mealId) {
  return state.mealLibrary.find((meal) => meal.id === mealId);
}

export function getScheduledOccurrences(state, weekStartDate = state.weekStartDate) {
  return DAYS.flatMap((day) => SLOTS.flatMap((slot) => state.plan[day][slot].map((mealId, index) => ({
    id: `${day}-${slot}-${index}`, mealId, day, slot,
    date: addDaysToDateKey(weekStartDate, DAYS.indexOf(day)),
    scheduledAt: getDateForDay(weekStartDate, day, slot),
    meal: getMealById(state, mealId),
  })))).filter((occurrence) => occurrence.meal);
}

export function getEffectivePrepBatches(state) {
  const dated = state.prepBatches || [];
  const legacy = (state.mealPrepBlocks || []).flatMap((block, blockIndex) => block.days.map((day, dayIndex) => ({
    id: `legacy-${blockIndex}-${dayIndex}`, mealId: block.mealId, servings: block.servings,
    prepDate: addDaysToDateKey(state.weekStartDate, DAYS.indexOf(day)), storageMethod: "fridge", legacy: true,
  })));
  return [...dated, ...legacy];
}

export function getBatchExpirationDate(batch, meal) {
  if (!batch.prepDate || !meal) return "";
  const lifeDays = batch.storageMethod === "freezer" ? meal.frozenLifeDays : meal.refrigeratedLifeDays;
  return addDaysToDateKey(batch.prepDate, Math.max(0, Number(lifeDays) - 1));
}

export function getBatchCoverage(batch, occurrences, meal) {
  const expirationDate = getBatchExpirationDate(batch, meal);
  const future = occurrences.filter((occurrence) => occurrence.mealId === batch.mealId && occurrence.date >= batch.prepDate);
  const eligible = future.filter((occurrence) => occurrence.date <= expirationDate).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  return { expirationDate, occurrences: eligible.slice(0, batch.servings), surplus: Math.max(0, batch.servings - eligible.length), atRisk: eligible.length < future.length };
}

export function getPrepOverview(state) {
  const occurrences = getScheduledOccurrences(state).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const batches = getEffectivePrepBatches(state).map((batch) => ({ ...batch, meal: getMealById(state, batch.mealId), coverage: getBatchCoverage(batch, occurrences, getMealById(state, batch.mealId)) })).filter((batch) => batch.meal);
  const assigned = new Map();
  batches.forEach((batch) => batch.coverage.occurrences.forEach((occurrence) => { if (!assigned.has(occurrence.id)) assigned.set(occurrence.id, batch.id); }));
  const mealSummaries = state.mealLibrary.map((meal) => {
    const mealOccurrences = occurrences.filter((occurrence) => occurrence.mealId === meal.id);
    const covered = mealOccurrences.filter((occurrence) => assigned.has(occurrence.id));
    const atRisk = mealOccurrences.filter((occurrence) => !assigned.has(occurrence.id) && batches.some((batch) => batch.mealId === meal.id && batch.prepDate <= occurrence.date && batch.coverage.expirationDate < occurrence.date));
    return { meal, occurrences: mealOccurrences, required: mealOccurrences.length, covered: covered.length, uncovered: mealOccurrences.length - covered.length, atRisk };
  }).filter((summary) => summary.required);
  return { occurrences, batches, mealSummaries, scheduledServings: occurrences.length, coveredServings: assigned.size, needsPrep: occurrences.length - assigned.size, freshnessRisks: mealSummaries.reduce((count, summary) => count + summary.atRisk.length, 0) };
}

export function getPrepRecommendations(state) {
  const allOccurrences = getScheduledOccurrences(state).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const covered = new Set();
  getEffectivePrepBatches(state).forEach((batch) => {
    const meal = getMealById(state, batch.mealId);
    getBatchCoverage(batch, allOccurrences, meal).occurrences.forEach((occurrence) => covered.add(occurrence.id));
  });
  const occurrences = allOccurrences.filter((occurrence) => !covered.has(occurrence.id));
  return state.mealLibrary.flatMap((meal) => {
    const mealOccurrences = occurrences.filter((occurrence) => occurrence.mealId === meal.id);
    const recommendations = [];
    let cursor = 0;
    while (cursor < mealOccurrences.length) {
      const first = mealOccurrences[cursor];
      const expiry = getBatchExpirationDate({ prepDate: first.date, storageMethod: "fridge" }, meal);
      let end = cursor;
      while (end + 1 < mealOccurrences.length && mealOccurrences[end + 1].date <= expiry) end += 1;
      recommendations.push({ meal, prepDate: first.date, servings: end - cursor + 1, expirationDate: expiry, occurrences: mealOccurrences.slice(cursor, end + 1) });
      cursor = end + 1;
    }
    return recommendations;
  });
}

export function sumDayMacros(state, day) {
  return SLOTS.reduce(
    (totals, slot) => {
      state.plan[day][slot].forEach((mealId) => {
        const meal = getMealById(state, mealId);
        if (!meal) return;
        MACROS.forEach((key) => {
          totals[key] += Number(meal[key]) || 0;
        });
      });
      return totals;
    },
    { protein: 0, carbs: 0, fat: 0 },
  );
}

export function macroProgress(state, day, key) {
  const target = Number(state.macroTargets[key]) || 0;
  const current = sumDayMacros(state, day)[key];
  return {
    current,
    target,
    ratio: target > 0 ? current / target : 0,
    percent: target > 0 ? Math.round((current / target) * 100) : 0,
  };
}

export function formatMacros(meal) {
  return `P ${meal.protein}g · C ${meal.carbs}g · F ${meal.fat}g`;
}

export function mealMatchesFilter(meal, query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return (
    meal.name.toLowerCase().includes(normalized) ||
    meal.tags.some((tag) => tag.toLowerCase().includes(normalized))
  );
}

export function addMealToSlot(state, mealId, day, slot) {
  const next = normalizeState(state);
  if (!next.plan[day]?.[slot] || !getMealById(next, mealId)) return next;
  next.plan[day][slot].push(mealId);
  return next;
}

export function moveScheduledMeal(state, source, target) {
  const next = normalizeState(state);
  const sourceMeals = next.plan[source.day]?.[source.slot];
  const targetMeals = next.plan[target.day]?.[target.slot];
  if (!sourceMeals || !targetMeals || source.index < 0 || source.index >= sourceMeals.length) {
    return next;
  }
  const [mealId] = sourceMeals.splice(source.index, 1);
  if (mealId) targetMeals.push(mealId);
  return next;
}

export function removeScheduledMeal(state, day, slot, index) {
  const next = normalizeState(state);
  next.plan[day]?.[slot]?.splice(index, 1);
  return next;
}

export function deleteMealFromState(state, mealId) {
  const next = normalizeState(state);
  next.mealLibrary = next.mealLibrary.filter((meal) => meal.id !== mealId);
  DAYS.forEach((day) =>
    SLOTS.forEach((slot) => {
      next.plan[day][slot] = next.plan[day][slot].filter((id) => id !== mealId);
    }),
  );
  next.mealPrepBlocks = next.mealPrepBlocks.filter((block) => block.mealId !== mealId);
  next.prepBatches = next.prepBatches.filter((batch) => batch.mealId !== mealId);
  return next;
}

export function appStateReducer(current, action) {
  if (action.type === "replace") return normalizeState(action.state);
  if (action.type === "update") {
    const next = typeof action.updater === "function" ? action.updater(current) : action.updater;
    return normalizeState(next);
  }
  return current;
}
