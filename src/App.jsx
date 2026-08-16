import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useReducer,
  useState,
} from "react";
import { apiFetch } from "./api";
import {
  DAYS,
  MACROS,
  SLOTS,
  addMealToSlot,
  appStateReducer,
  cloneDefaultState,
  deleteMealFromState,
  formatMacros,
  getMealById,
  loadLocalState,
  loadSession,
  macroProgress,
  mealMatchesFilter,
  moveScheduledMeal,
  normalizeState,
  removeScheduledMeal,
  saveLocalState,
  saveSession,
  sumDayMacros,
} from "./state";

const AppContext = createContext(null);

function useMacroFlow() {
  const value = useContext(AppContext);
  if (!value) throw new Error("useMacroFlow must be used inside AppProvider");
  return value;
}

function useHashRoute() {
  const getRoute = () => {
    const route = window.location.hash.replace(/^#\/?/, "");
    return ["planner", "meals", "prep"].includes(route) ? route : "planner";
  };
  const [route, setRoute] = useState(getRoute);

  useEffect(() => {
    const onHashChange = () => setRoute(getRoute());
    window.addEventListener("hashchange", onHashChange);
    if (!window.location.hash) window.history.replaceState(null, "", "#/planner");
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return route;
}

function AppProvider({ children }) {
  const initialState = useMemo(() => loadLocalState(), []);
  const initialSession = useMemo(() => loadSession(), []);
  const [state, dispatch] = useReducer(appStateReducer, initialState);
  const [session, setSessionState] = useState(initialSession);
  const [sync, setSync] = useState(
    initialSession?.token
      ? { kind: "syncing", label: "Syncing…" }
      : { kind: "local", label: "Local mode" },
  );
  const stateRef = useRef(initialState);
  const sessionRef = useRef(initialSession);
  const syncQueueRef = useRef(Promise.resolve());
  const hydratedRef = useRef(false);

  const applyLocal = useCallback((nextState) => {
    const normalized = normalizeState(nextState);
    stateRef.current = normalized;
    dispatch({ type: "replace", state: normalized });
    saveLocalState(normalized);
    return normalized;
  }, []);

  const queueStateSync = useCallback((nextState, sessionToUse = sessionRef.current) => {
    if (!sessionToUse?.token) {
      setSync({ kind: "local", label: "Local mode" });
      return;
    }

    setSync({ kind: "saving", label: "Saving…" });
    syncQueueRef.current = syncQueueRef.current
      .catch(() => null)
      .then(() =>
        apiFetch(
          "/api/state",
          {
            method: "PUT",
            body: JSON.stringify({ state: normalizeState(nextState) }),
          },
          sessionToUse,
        ),
      )
      .then(() => {
        if (sessionRef.current?.token === sessionToUse.token) {
          setSync({ kind: "synced", label: "Synced" });
        }
      })
      .catch(() => {
        if (sessionRef.current?.token === sessionToUse.token) {
          setSync({ kind: "local", label: "Saved locally · sync unavailable" });
        }
      });
  }, []);

  const commit = useCallback(
    (updater) => {
      const next = typeof updater === "function" ? updater(stateRef.current) : updater;
      const normalized = applyLocal(next);
      queueStateSync(normalized);
      return normalized;
    },
    [applyLocal, queueStateSync],
  );

  const runMealRequest = useCallback(
    (request, nextState, sessionToUse = sessionRef.current) => {
      if (!sessionToUse?.token) return;
      setSync({ kind: "saving", label: "Saving…" });
      request(sessionToUse)
        .then(() =>
          apiFetch(
            "/api/state",
            {
              method: "PUT",
              body: JSON.stringify({ state: normalizeState(nextState) }),
            },
            sessionToUse,
          ),
        )
        .then(() => {
          if (sessionRef.current?.token === sessionToUse.token) {
            setSync({ kind: "synced", label: "Synced" });
          }
        })
        .catch(() => {
          if (sessionRef.current?.token === sessionToUse.token) {
            setSync({ kind: "local", label: "Saved locally · sync unavailable" });
          }
        });
    },
    [],
  );

  const setMacroTarget = useCallback(
    (key, value) => {
      commit((current) => ({
        ...current,
        macroTargets: {
          ...current.macroTargets,
          [key]: Math.max(0, Number(value) || 0),
        },
      }));
    },
    [commit],
  );

  const scheduleMeal = useCallback(
    (mealId, day, slot) => commit((current) => addMealToSlot(current, mealId, day, slot)),
    [commit],
  );

  const moveMeal = useCallback(
    (source, target) => commit((current) => moveScheduledMeal(current, source, target)),
    [commit],
  );

  const removeMealFromPlan = useCallback(
    (day, slot, index) =>
      commit((current) => removeScheduledMeal(current, day, slot, index)),
    [commit],
  );

  const addMeal = useCallback(
    (mealInput) => {
      const meal = {
        id: `meal-${crypto.randomUUID()}`,
        name: mealInput.name.trim(),
        protein: Number(mealInput.protein) || 0,
        carbs: Number(mealInput.carbs) || 0,
        fat: Number(mealInput.fat) || 0,
        tags: mealInput.tags,
      };
      const next = applyLocal({
        ...stateRef.current,
        mealLibrary: [meal, ...stateRef.current.mealLibrary],
      });
      runMealRequest(
        (authSession) =>
          apiFetch("/api/meals", {
            method: "POST",
            body: JSON.stringify(meal),
          }, authSession),
        next,
      );
      return meal;
    },
    [applyLocal, runMealRequest],
  );

  const updateMeal = useCallback(
    (mealId, mealInput) => {
      const next = applyLocal({
        ...stateRef.current,
        mealLibrary: stateRef.current.mealLibrary.map((meal) =>
          meal.id === mealId
            ? {
                ...meal,
                name: mealInput.name.trim(),
                protein: Number(mealInput.protein) || 0,
                carbs: Number(mealInput.carbs) || 0,
                fat: Number(mealInput.fat) || 0,
                tags: mealInput.tags,
              }
            : meal,
        ),
      });
      const updated = getMealById(next, mealId);
      runMealRequest(
        (authSession) =>
          apiFetch(`/api/meals/${mealId}`, {
            method: "PUT",
            body: JSON.stringify(updated),
          }, authSession),
        next,
      );
    },
    [applyLocal, runMealRequest],
  );

  const deleteMeal = useCallback(
    (mealId) => {
      const next = applyLocal(deleteMealFromState(stateRef.current, mealId));
      runMealRequest(
        (authSession) => apiFetch(`/api/meals/${mealId}`, { method: "DELETE" }, authSession),
        next,
      );
    },
    [applyLocal, runMealRequest],
  );

  const addPrepBlock = useCallback(
    (mealId, servings, days) =>
      commit((current) => ({
        ...current,
        mealPrepBlocks: [
          ...current.mealPrepBlocks,
          { mealId, servings: Math.max(1, Number(servings) || 1), days },
        ],
      })),
    [commit],
  );

  const removePrepBlock = useCallback(
    (index) =>
      commit((current) => ({
        ...current,
        mealPrepBlocks: current.mealPrepBlocks.filter((_, blockIndex) => blockIndex !== index),
      })),
    [commit],
  );

  const resetDemo = useCallback(() => {
    commit(cloneDefaultState());
  }, [commit]);

  const authenticate = useCallback(
    async (mode, email, password) => {
      setSync({ kind: "saving", label: "Connecting…" });
      const endpoint = mode === "register" ? "/api/auth/register" : "/api/auth/login";
      const response = await apiFetch(endpoint, {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      const nextSession = { token: response.token, user: response.user };
      sessionRef.current = nextSession;
      setSessionState(nextSession);
      saveSession(nextSession);

      const serverState = await apiFetch("/api/state", {}, nextSession);
      if (serverState.state) {
        applyLocal(serverState.state);
      } else {
        queueStateSync(stateRef.current, nextSession);
      }
      setSync({ kind: "synced", label: "Synced" });
      return nextSession;
    },
    [applyLocal, queueStateSync],
  );

  const logout = useCallback(() => {
    sessionRef.current = null;
    setSessionState(null);
    saveSession(null);
    setSync({ kind: "local", label: "Local mode" });
  }, []);

  useEffect(() => {
    if (!initialSession?.token || hydratedRef.current) return;
    hydratedRef.current = true;
    apiFetch("/api/state", {}, initialSession)
      .then((response) => {
        if (response.state) applyLocal(response.state);
        setSync({ kind: "synced", label: "Synced" });
      })
      .catch(() => setSync({ kind: "local", label: "Local mode · sync unavailable" }));
  }, [applyLocal, initialSession]);

  const value = {
    state,
    session,
    sync,
    setMacroTarget,
    scheduleMeal,
    moveMeal,
    removeMealFromPlan,
    addMeal,
    updateMeal,
    deleteMeal,
    addPrepBlock,
    removePrepBlock,
    resetDemo,
    authenticate,
    logout,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

function ProgressBar({ macro, progress, compact = false }) {
  return (
    <div className={`progress-row ${compact ? "progress-row-compact" : ""}`}>
      <span className={`macro-dot macro-${macro}`} aria-hidden="true" />
      <span className="progress-label">{macro === "protein" ? "P" : macro === "carbs" ? "C" : "F"}</span>
      <span className="progress-track" aria-hidden="true">
        <span
          className={`progress-fill macro-${macro}`}
          style={{ width: `${Math.min(100, Math.max(0, progress.percent))}%` }}
        />
      </span>
      <span className="progress-value">
        {progress.current}/{progress.target}g
      </span>
    </div>
  );
}

function MacroGoalStrip() {
  const { state, setMacroTarget } = useMacroFlow();
  return (
    <div className="macro-goal-grid">
      {MACROS.map((macro) => (
        <label className={`goal-card macro-card-${macro}`} key={macro}>
          <span className="goal-card-top">
            <span className="goal-label">{macro === "protein" ? "Protein" : macro === "carbs" ? "Carbs" : "Fat"}</span>
            <span className="goal-unit">daily goal</span>
          </span>
          <span className="goal-input-wrap">
            <input
              data-macro-key={macro}
              aria-label={`${macro} daily goal in grams`}
              type="number"
              min="0"
              value={state.macroTargets[macro]}
              onChange={(event) => setMacroTarget(macro, event.target.value)}
            />
            <span>g</span>
          </span>
        </label>
      ))}
    </div>
  );
}

function MealCard({ meal, compact = false, onEdit, onDelete, onSchedule }) {
  const handleDragStart = (event) => {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/json", JSON.stringify({ kind: "library", mealId: meal.id }));
  };

  return (
    <article className={`meal-card ${compact ? "meal-card-compact" : ""}`} draggable onDragStart={handleDragStart}>
      <div className="meal-card-heading">
        <div>
          <h3>{meal.name}</h3>
          <p className="macro-line">{formatMacros(meal)}</p>
        </div>
        <span className="drag-hint" aria-hidden="true">⋮⋮</span>
      </div>
      <div className="tag-list">
        {meal.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}
      </div>
      <div className="card-actions">
        {onSchedule && <button className="button button-primary button-small" type="button" onClick={() => onSchedule(meal.id)}>Schedule</button>}
        {onEdit && <button className="button button-quiet button-small" type="button" onClick={() => onEdit(meal)}>Edit</button>}
        {onDelete && <button className="button button-danger-quiet button-small" type="button" onClick={() => onDelete(meal)}>Delete</button>}
      </div>
    </article>
  );
}

function MealDock({ onSchedule }) {
  const { state } = useMacroFlow();
  const [query, setQuery] = useState("");
  const meals = state.mealLibrary.filter((meal) => mealMatchesFilter(meal, query));

  return (
    <section className="meal-dock panel">
      <div className="dock-heading">
        <div>
          <p className="eyebrow">Quick scheduling</p>
          <h2>Meal dock</h2>
        </div>
        <label className="sr-only" htmlFor="dockSearch">Search meals to schedule</label>
        <input id="dockSearch" className="compact-input" type="search" placeholder="Search meals" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className="dock-meals">
        {meals.length ? meals.map((meal) => <MealCard compact meal={meal} key={meal.id} onSchedule={onSchedule} />) : <p className="empty-state">No matching meals.</p>}
      </div>
    </section>
  );
}

function parseDrop(event) {
  try {
    return JSON.parse(event.dataTransfer.getData("application/json"));
  } catch {
    return null;
  }
}

function ScheduledMeal({ meal, day, slot, index, onMove, onRemove }) {
  const handleDragStart = (event) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/json", JSON.stringify({ kind: "scheduled", day, slot, index }));
  };

  return (
    <div className="scheduled-meal" draggable onDragStart={handleDragStart}>
      <div>
        <strong>{meal.name}</strong>
        <span>{formatMacros(meal)}</span>
      </div>
      <div className="scheduled-actions">
        <button className="text-button" type="button" onClick={onMove}>Move</button>
        <button className="text-button text-button-danger" type="button" onClick={onRemove}>Remove</button>
      </div>
    </div>
  );
}

function DropCell({ day, slot, mobile = false, onSchedule, onMove }) {
  const { state, scheduleMeal, moveMeal, removeMealFromPlan } = useMacroFlow();
  const [over, setOver] = useState(false);
  const meals = state.plan[day][slot];

  const handleDrop = (event) => {
    event.preventDefault();
    setOver(false);
    const payload = parseDrop(event);
    if (!payload) return;
    if (payload.kind === "library") scheduleMeal(payload.mealId, day, slot);
    if (payload.kind === "scheduled") moveMeal(payload, { day, slot });
  };

  return (
    <div
      className={`drop-cell ${over ? "drop-cell-over" : ""} ${mobile ? "drop-cell-mobile" : ""}`}
      data-day={day}
      data-slot={slot}
      onDragOver={(event) => { event.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={handleDrop}
    >
      <div className="drop-cell-title">
        <span>{slot}</span>
        <button className="add-slot-button" type="button" aria-label={`Add meal to ${day} ${slot}`} onClick={() => onSchedule({ day, slot })}>+</button>
      </div>
      <div className="scheduled-list">
        {meals.map((mealId, index) => {
          const meal = getMealById(state, mealId);
          if (!meal) return null;
          return (
            <ScheduledMeal
              key={`${mealId}-${index}`}
              meal={meal}
              day={day}
              slot={slot}
              index={index}
              onMove={() => onMove({ day, slot, index })}
              onRemove={() => removeMealFromPlan(day, slot, index)}
            />
          );
        })}
        {!meals.length && <span className="slot-empty">Drop or add a meal</span>}
      </div>
    </div>
  );
}

function DaySummary({ day }) {
  const { state } = useMacroFlow();
  const totals = sumDayMacros(state, day);
  return (
    <div className="day-summary">
      <div className="day-title"><strong>{day}</strong><span>{totals.protein + totals.carbs + totals.fat}g total</span></div>
      {MACROS.map((macro) => <ProgressBar macro={macro} progress={macroProgress(state, day, macro)} compact key={macro} />)}
    </div>
  );
}

function WeeklyCalendar({ onSchedule, onMove }) {

  return (
    <div className="calendar-scroll">
      <div className="week-board">
        <div className="calendar-corner">Meal time</div>
        {DAYS.map((day) => <div className="day-header-cell" key={day}><DaySummary day={day} /></div>)}
        {SLOTS.map((slot) => (
          <div className="calendar-row" key={slot}>
            <div className="slot-label">{slot}</div>
            {DAYS.map((day) => (
              <DropCell day={day} slot={slot} onSchedule={onSchedule} onMove={onMove} key={`${day}-${slot}`} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function MobileCalendar({ selectedDay, setSelectedDay, onSchedule, onMove }) {
  return (
    <div className="mobile-calendar">
      <div className="day-tabs" role="tablist" aria-label="Choose planner day">
        {DAYS.map((day) => <button className={selectedDay === day ? "day-tab active" : "day-tab"} type="button" role="tab" aria-selected={selectedDay === day} onClick={() => setSelectedDay(day)} key={day}>{day}</button>)}
      </div>
      <div className="mobile-day-heading"><DaySummary day={selectedDay} /></div>
      <div className="mobile-slots">
        {SLOTS.map((slot) => <DropCell mobile day={selectedDay} slot={slot} onSchedule={onSchedule} onMove={onMove} key={slot} />)}
      </div>
    </div>
  );
}

function ScheduleDialog({ request, onClose }) {
  const { state, scheduleMeal, moveMeal } = useMacroFlow();
  const [mealId, setMealId] = useState(request?.mealId || state.mealLibrary[0]?.id || "");
  const [day, setDay] = useState(request?.day || DAYS[0]);
  const [slot, setSlot] = useState(request?.slot || SLOTS[0]);

  useEffect(() => {
    setMealId(request?.mealId || state.mealLibrary[0]?.id || "");
    setDay(request?.day || DAYS[0]);
    setSlot(request?.slot || SLOTS[0]);
  }, [request, state.mealLibrary]);

  if (!request) return null;
  const isMoving = request.source;

  return (
    <Modal open title={isMoving ? "Move scheduled meal" : "Schedule a meal"} onClose={onClose}>
      <form className="form-stack" onSubmit={(event) => {
        event.preventDefault();
        if (isMoving) {
          moveMeal(request.source, { day, slot });
        } else if (mealId) {
          scheduleMeal(mealId, day, slot);
        }
        onClose();
      }}>
        {!isMoving && <label>Meal<select value={mealId} onChange={(event) => setMealId(event.target.value)}>{state.mealLibrary.map((meal) => <option value={meal.id} key={meal.id}>{meal.name}</option>)}</select></label>}
        <label>Day<select value={day} onChange={(event) => setDay(event.target.value)}>{DAYS.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Meal time<select value={slot} onChange={(event) => setSlot(event.target.value)}>{SLOTS.map((item) => <option key={item}>{item}</option>)}</select></label>
        <div className="modal-actions"><button className="button button-quiet" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit">{isMoving ? "Move meal" : "Schedule meal"}</button></div>
      </form>
    </Modal>
  );
}

function PlannerPage() {
  const [dockOpen, setDockOpen] = useState(true);
  const [selectedDay, setSelectedDay] = useState(DAYS[0]);
  const [scheduleRequest, setScheduleRequest] = useState(null);

  return (
    <section className="page-section">
      <div className="page-heading">
        <div><p className="eyebrow">This week</p><h1>Plan with intention.</h1><p className="page-subtitle">Build a week that makes your targets feel automatic.</p></div>
        <button className="button button-quiet" type="button" onClick={() => setDockOpen((open) => !open)}>{dockOpen ? "Hide meal dock" : "Show meal dock"}</button>
      </div>
      <MacroGoalStrip />
      {dockOpen && <MealDock onSchedule={(mealId) => setScheduleRequest({ mealId })} />}
      <div className="planner-panel panel">
        <div className="section-heading"><div><p className="eyebrow">Weekly planner</p><h2>Seven days, one clear view</h2></div><span className="helper-text">Drag to move · use + to schedule</span></div>
        <WeeklyCalendar onSchedule={setScheduleRequest} onMove={(source) => setScheduleRequest({ source })} />
        <MobileCalendar selectedDay={selectedDay} setSelectedDay={setSelectedDay} onSchedule={setScheduleRequest} onMove={(source) => setScheduleRequest({ source })} />
      </div>
      <ScheduleDialog request={scheduleRequest} onClose={() => setScheduleRequest(null)} />
    </section>
  );
}

function MealEditorDialog({ meal, onClose }) {
  const { addMeal, updateMeal } = useMacroFlow();
  const [form, setForm] = useState({ name: "", protein: "", carbs: "", fat: "", tags: "" });

  useEffect(() => {
    setForm(meal ? { ...meal, tags: meal.tags.join(", ") } : { name: "", protein: "", carbs: "", fat: "", tags: "" });
  }, [meal]);

  if (meal === undefined) return null;
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  return (
    <Modal open title={meal ? "Edit meal" : "Add meal"} onClose={onClose}>
      <form className="form-stack" onSubmit={(event) => {
        event.preventDefault();
        const name = form.name.trim();
        if (!name) return;
        const payload = { ...form, name, tags: form.tags.split(",").map((tag) => tag.trim()).filter(Boolean) };
        if (meal) updateMeal(meal.id, payload);
        else addMeal(payload);
        onClose();
      }}>
        <label>Meal name<input name="name" required value={form.name} onChange={(event) => update("name", event.target.value)} autoFocus /></label>
        <div className="macro-form-grid">
          {MACROS.map((macro) => <label key={macro}>{macro === "protein" ? "Protein (g)" : macro === "carbs" ? "Carbs (g)" : "Fat (g)"}<input name={macro} type="number" min="0" required value={form[macro]} onChange={(event) => update(macro, event.target.value)} /></label>)}
        </div>
        <label>Tags <span className="label-note">comma separated key:value</span><input name="tags" placeholder="protein:chicken, meal-time:lunch" value={form.tags} onChange={(event) => update("tags", event.target.value)} /></label>
        <div className="modal-actions"><button className="button button-quiet" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit">Save meal</button></div>
      </form>
    </Modal>
  );
}

function MealsPage() {
  const { state, deleteMeal } = useMacroFlow();
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState(undefined);
  const [scheduleRequest, setScheduleRequest] = useState(null);
  const [deleteRequest, setDeleteRequest] = useState(null);
  const meals = state.mealLibrary.filter((meal) => mealMatchesFilter(meal, query));

  return (
    <section className="page-section">
      <div className="page-heading">
        <div><p className="eyebrow">Meal library</p><h1>Make your defaults delicious.</h1><p className="page-subtitle">Keep your repeatable wins close and your week easier to execute.</p></div>
        <button className="button button-primary" type="button" onClick={() => setEditor(null)}>+ New meal</button>
      </div>
      <div className="library-toolbar panel">
        <label className="search-field"><span>Search meals or tags</span><input id="mealSearch" type="search" placeholder="Try “chicken” or “prep:fast”" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <span className="result-count">{meals.length} of {state.mealLibrary.length} meals</span>
      </div>
      {meals.length ? <div className="meal-grid">{meals.map((meal) => <MealCard meal={meal} key={meal.id} onSchedule={(mealId) => setScheduleRequest({ mealId })} onEdit={setEditor} onDelete={setDeleteRequest} />)}</div> : <div className="empty-panel panel"><span className="empty-icon">⌕</span><h2>{state.mealLibrary.length ? "No meals match that search" : "Your library is ready for its first meal"}</h2><p>{state.mealLibrary.length ? "Try a different meal name or tag." : "Add a meal once and make planning it effortless."}</p></div>}
      <MealEditorDialog meal={editor} onClose={() => setEditor(undefined)} />
      <ScheduleDialog request={scheduleRequest} onClose={() => setScheduleRequest(null)} />
      <ConfirmDialog request={deleteRequest ? { title: "Delete this meal?", body: "Every scheduled occurrence and prep block using this meal will also be removed.", confirmLabel: "Delete meal", danger: true, onConfirm: () => { deleteMeal(deleteRequest.id); setDeleteRequest(null); } } : null} onClose={() => setDeleteRequest(null)} />
    </section>
  );
}

function PrepPage() {
  const { state, addPrepBlock, removePrepBlock } = useMacroFlow();
  const [mealId, setMealId] = useState(state.mealLibrary[0]?.id || "");
  const [servings, setServings] = useState(4);
  const [days, setDays] = useState([]);
  const [error, setError] = useState("");
  const toggleDay = (day) => setDays((current) => current.includes(day) ? current.filter((item) => item !== day) : [...current, day]);

  useEffect(() => {
    if (!state.mealLibrary.some((meal) => meal.id === mealId)) setMealId(state.mealLibrary[0]?.id || "");
  }, [mealId, state.mealLibrary]);

  return (
    <section className="page-section">
      <div className="page-heading"><div><p className="eyebrow">Meal prep</p><h1>Make the week easier.</h1><p className="page-subtitle">Batch the work once, then let the plan do its job.</p></div></div>
      <div className="prep-layout">
        <form className="prep-form panel" onSubmit={(event) => {
          event.preventDefault();
          if (!mealId || !days.length) { setError("Choose a meal and at least one day."); return; }
          addPrepBlock(mealId, servings, days);
          setDays([]);
          setServings(4);
          setError("");
        }}>
          <div className="section-heading"><div><p className="eyebrow">New prep block</p><h2>Set a repeatable rhythm</h2></div></div>
          <label>Meal<select value={mealId} onChange={(event) => setMealId(event.target.value)}>{state.mealLibrary.map((meal) => <option value={meal.id} key={meal.id}>{meal.name}</option>)}</select></label>
          <label>Servings to cook<input type="number" min="1" value={servings} onChange={(event) => setServings(event.target.value)} /></label>
          <fieldset className="day-picker"><legend>Prep days</legend><div className="day-chip-grid">{DAYS.map((day) => <label className={days.includes(day) ? "day-chip selected" : "day-chip"} key={day}><input type="checkbox" checked={days.includes(day)} onChange={() => toggleDay(day)} />{day}</label>)}</div></fieldset>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button-primary button-wide" type="submit">Add prep block</button>
        </form>
        <section className="prep-list-panel panel">
          <div className="section-heading"><div><p className="eyebrow">Your rhythm</p><h2>Prep blocks</h2></div><span className="result-count">{state.mealPrepBlocks.length} active</span></div>
          {state.mealPrepBlocks.length ? <div className="prep-items">{state.mealPrepBlocks.map((block, index) => { const meal = getMealById(state, block.mealId); if (!meal) return null; return <article className="prep-item" key={`${block.mealId}-${index}`}><div><strong>{meal.name}</strong><p>Cook {block.servings} servings on {block.days.join(", ")}.</p></div><button className="button button-danger-quiet button-small" type="button" onClick={() => removePrepBlock(index)}>Remove</button></article>; })}</div> : <div className="empty-state empty-state-large"><span className="empty-icon">◷</span><h3>No prep blocks yet</h3><p>Add a block to see your batch-cooking rhythm here.</p></div>}
        </section>
      </div>
    </section>
  );
}

function Modal({ open, title, onClose, children, size = "" }) {
  const dialogRef = useRef(null);
  const titleId = useMemo(() => `dialog-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, [title]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={dialogRef} className={`modal-dialog ${size}`} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-surface">
        <div className="modal-heading"><div><p className="eyebrow">MacroFlow</p><h2 id={titleId}>{title}</h2></div><button className="icon-button" type="button" aria-label="Close dialog" onClick={onClose}>×</button></div>
        {children}
      </div>
    </dialog>
  );
}

function ConfirmDialog({ request, onClose }) {
  if (!request) return null;
  return (
    <Modal open title={request.title} onClose={onClose} size="modal-small">
      <div className="confirm-copy"><p>{request.body}</p></div>
      <div className="modal-actions"><button className="button button-quiet" type="button" onClick={onClose}>Cancel</button><button className={request.danger ? "button button-danger" : "button button-primary"} type="button" onClick={request.onConfirm}>{request.confirmLabel || "Confirm"}</button></div>
    </Modal>
  );
}

function AccountDialog({ open, onClose }) {
  const { session, sync, authenticate, logout } = useMacroFlow();
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { if (open) setError(""); }, [open]);

  if (!open) return null;
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    try {
      await authenticate(mode, email.trim(), password);
      onClose();
    } catch (authError) {
      setError(authError.message);
    }
  };

  return (
    <Modal open title={session ? "Account" : mode === "login" ? "Welcome back" : "Create your account"} onClose={onClose}>
      {session ? <div className="account-summary"><div className="avatar">{session.user.email[0].toUpperCase()}</div><div><strong>{session.user.email}</strong><p>{sync.label}</p></div><button id="logoutBtn" className="button button-quiet" type="button" onClick={() => { logout(); onClose(); }}>Log out</button></div> : <form className="form-stack" onSubmit={submit}><div className="auth-tabs" role="tablist"><button className={mode === "login" ? "auth-tab active" : "auth-tab"} type="button" role="tab" aria-selected={mode === "login"} onClick={() => setMode("login")}>Log in</button><button className={mode === "register" ? "auth-tab active" : "auth-tab"} type="button" role="tab" aria-selected={mode === "register"} onClick={() => setMode("register")}>Register</button></div><label>Email<input id="authEmail" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Password<input id="authPassword" type="password" minLength="8" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>{error && <p id="authError" className="form-error" role="alert" aria-live="polite">{error}</p>}<p id="authStatus" className="form-hint" aria-live="polite">Your data stays local until you sign in.</p><button id={mode === "login" ? "loginBtn" : "registerBtn"} className="button button-primary button-wide" type="submit">{mode === "login" ? "Log in" : "Create account"}</button></form>}
    </Modal>
  );
}

function AppShell() {
  const route = useHashRoute();
  const { session, sync, resetDemo } = useMacroFlow();
  const [accountOpen, setAccountOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const title = route === "planner" ? "Planner" : route === "meals" ? "Meals" : "Prep";

  return (
    <div className="app-shell">
      <aside className="side-rail">
        <a className="brand" href="#/planner"><span className="brand-mark">M</span><span><strong>MacroFlow</strong><small>Plan with intention</small></span></a>
        <nav className="primary-nav" aria-label="Primary navigation">
          {[["planner", "Planner", "⌁"], ["meals", "Meals", "◈"], ["prep", "Prep", "◷"]].map(([key, label, icon]) => <a className={route === key ? "nav-link active" : "nav-link"} href={`#/${key}`} aria-current={route === key ? "page" : undefined} key={key}><span aria-hidden="true">{icon}</span>{label}</a>)}
        </nav>
        <div className="rail-footer"><p className="rail-note">Small choices.<br />Steady progress.</p><button className="profile-button" type="button" onClick={() => setAccountOpen(true)}><span className="avatar avatar-small">{session?.user?.email?.[0]?.toUpperCase() || "?"}</span><span><strong>{session?.user?.email || "Local mode"}</strong><small>{session ? "Synced account" : "Saved on this device"}</small></span></button></div>
      </aside>
      <div className="main-column">
        <header className="topbar"><div><span className="topbar-kicker">MacroFlow workspace</span><strong>{title}</strong></div><div className="topbar-actions"><span className={`sync-pill sync-${sync.kind}`}><span className="status-dot" aria-hidden="true" />{sync.label}</span><button className="topbar-account" type="button" onClick={() => setAccountOpen(true)}><span className="avatar avatar-small">{session?.user?.email?.[0]?.toUpperCase() || "?"}</span><span className="topbar-account-label">{session?.user?.email || "Account"}</span></button><div className="settings-wrap"><button className="icon-button" type="button" aria-label="Open settings" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((open) => !open)}>•••</button>{settingsOpen && <div className="settings-menu"><button type="button" onClick={() => { setResetOpen(true); setSettingsOpen(false); }}>Reset demo data</button></div>}</div></div></header>
        <main className="main-content">{route === "planner" && <PlannerPage />}{route === "meals" && <MealsPage />}{route === "prep" && <PrepPage />}</main>
      </div>
      <nav className="mobile-nav" aria-label="Mobile navigation">{[["planner", "Plan"], ["meals", "Meals"], ["prep", "Prep"]].map(([key, label]) => <a className={route === key ? "mobile-nav-link active" : "mobile-nav-link"} href={`#/${key}`} aria-current={route === key ? "page" : undefined} key={key}><span aria-hidden="true">{key === "planner" ? "⌁" : key === "meals" ? "◈" : "◷"}</span>{label}</a>)}<button className="mobile-nav-link" type="button" onClick={() => setAccountOpen(true)}><span aria-hidden="true">○</span>Account</button></nav>
      <AccountDialog open={accountOpen} onClose={() => setAccountOpen(false)} />
      <ConfirmDialog request={resetOpen ? { title: "Reset demo data?", body: "This restores the default meals and targets and clears the current planner and prep blocks. Your account stays signed in.", confirmLabel: "Reset data", danger: true, onConfirm: () => { resetDemo(); setResetOpen(false); } } : null} onClose={() => setResetOpen(false)} />
    </div>
  );
}

export function App() {
  return <AppProvider><AppShell /></AppProvider>;
}
