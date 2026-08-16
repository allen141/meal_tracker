export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const SLOTS = ["Breakfast", "Lunch", "Dinner", "Snack"];
export const MACROS = ["protein", "carbs", "fat"];
export const STORAGE_KEY = "macroflow-state-v1";
export const SESSION_KEY = "macroflow-session-v1";

export const defaultState = {
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
    DAYS.map((day) => [day, Object.fromEntries(SLOTS.map((slot) => [slot, []]))]),
  ),
  mealPrepBlocks: [],
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
    tags: Array.isArray(meal.tags) ? meal.tags.map(String).filter(Boolean) : [],
  };
}

export function normalizeState(candidate) {
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
