import { describe, expect, it } from "vitest";
import {
  addMealToSlot,
  appStateReducer,
  cloneDefaultState,
  addDaysToDateKey,
  deleteMealFromState,
  getBatchCoverage,
  getPrepOverview,
  getScheduledOccurrences,
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

  it("derives dated occurrences and slot times from the planning week", () => {
    const state = cloneDefaultState();
    state.weekStartDate = "2026-08-17";
    state.plan.Mon.Lunch.push("meal-1");
    state.plan.Thu.Dinner.push("meal-1");
    const occurrences = getScheduledOccurrences(state);
    expect(occurrences.map((item) => [item.date, item.scheduledAt])).toEqual([
      ["2026-08-17", "2026-08-17T12:00"],
      ["2026-08-20", "2026-08-20T18:00"],
    ]);
    expect(addDaysToDateKey("2026-08-17", 6)).toBe("2026-08-23");
  });

  it("counts batch coverage and reports freshness risk", () => {
    const state = cloneDefaultState();
    state.weekStartDate = "2026-08-17";
    state.plan.Mon.Dinner.push("meal-3");
    state.plan.Fri.Dinner.push("meal-3");
    const batch = { mealId: "meal-3", servings: 2, prepDate: "2026-08-17", storageMethod: "fridge" };
    const coverage = getBatchCoverage(batch, getScheduledOccurrences(state), state.mealLibrary[2]);
    expect(coverage.expirationDate).toBe("2026-08-19");
    expect(coverage.occurrences).toHaveLength(1);
    expect(coverage.atRisk).toBe(true);
    state.prepBatches.push(batch);
    const overview = getPrepOverview(state);
    expect(overview.scheduledServings).toBe(2);
    expect(overview.coveredServings).toBe(1);
    expect(overview.needsPrep).toBe(1);
    expect(overview.freshnessRisks).toBe(1);
  });

  it("preserves dated batch and meal freshness fields when normalizing", () => {
    const state = normalizeState({
      weekStartDate: "2026-08-17",
      mealLibrary: [{ id: "custom", name: "Soup", refrigeratedLifeDays: 2, frozenLifeDays: 30, freezerFriendly: false }],
      prepBatches: [{ id: "batch-1", mealId: "custom", servings: 3, prepDate: "2026-08-17", storageMethod: "fridge" }],
    });
    expect(state.weekStartDate).toBe("2026-08-17");
    expect(state.mealLibrary[0].refrigeratedLifeDays).toBe(2);
    expect(state.mealLibrary[0].freezerFriendly).toBe(false);
    expect(state.prepBatches[0]).toMatchObject({ id: "batch-1", prepDate: "2026-08-17", servings: 3 });
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
