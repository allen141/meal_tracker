import { describe, expect, it } from "vitest";
import {
  addMealToSlot,
  appStateReducer,
  cloneDefaultState,
  deleteMealFromState,
  macroProgress,
  moveScheduledMeal,
  normalizeState,
  removeScheduledMeal,
  sumDayMacros,
} from "../../src/state";

describe("MacroFlow state helpers", () => {
  it("normalizes partial saved state without changing persisted day and slot keys", () => {
    const state = normalizeState({ macroTargets: { protein: 190 }, mealLibrary: [] });
    expect(state.macroTargets).toEqual({ protein: 190, carbs: 210, fat: 65 });
    expect(Object.keys(state.plan)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(Object.keys(state.plan.Mon)).toEqual(["Breakfast", "Lunch", "Dinner", "Snack"]);
  });

  it("sums scheduled meal macros and reports capped progress separately from actual percentage", () => {
    const state = cloneDefaultState();
    state.plan.Mon.Lunch.push("meal-1", "meal-2");
    expect(sumDayMacros(state, "Mon")).toEqual({ protein: 70, carbs: 94, fat: 20 });
    const progress = macroProgress(state, "Mon", "protein");
    expect(progress.current).toBe(70);
    expect(progress.target).toBe(170);
    expect(progress.percent).toBe(41);
  });

  it("adds, moves, removes, and cascades meal references", () => {
    let state = cloneDefaultState();
    state = addMealToSlot(state, "meal-1", "Mon", "Breakfast");
    state = addMealToSlot(state, "meal-1", "Tue", "Dinner");
    state = moveScheduledMeal(state, { day: "Mon", slot: "Breakfast", index: 0 }, { day: "Wed", slot: "Snack" });
    expect(state.plan.Mon.Breakfast).toEqual([]);
    expect(state.plan.Wed.Snack).toEqual(["meal-1"]);

    state = removeScheduledMeal(state, "Wed", "Snack", 0);
    expect(state.plan.Wed.Snack).toEqual([]);

    state.plan.Thu.Lunch.push("meal-1");
    state.mealPrepBlocks.push({ mealId: "meal-1", servings: 3, days: ["Fri"] });
    state = deleteMealFromState(state, "meal-1");
    expect(state.mealLibrary.some((meal) => meal.id === "meal-1")).toBe(false);
    expect(state.plan.Tue.Dinner).toEqual([]);
    expect(state.plan.Thu.Lunch).toEqual([]);
    expect(state.mealPrepBlocks).toEqual([]);
  });
});


describe("appStateReducer", () => {
  it("replaces and updates normalized state through explicit actions", () => {
    const initial = cloneDefaultState();
    const replaced = appStateReducer(initial, { type: "replace", state: { macroTargets: { protein: 200 } } });
    expect(replaced.macroTargets).toEqual({ protein: 200, carbs: 210, fat: 65 });
    const updated = appStateReducer(replaced, { type: "update", updater: (current) => ({ ...current, macroTargets: { ...current.macroTargets, fat: 70 } }) });
    expect(updated.macroTargets.fat).toBe(70);
  });
});
