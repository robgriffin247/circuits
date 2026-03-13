import { useEffect, useMemo, useRef, useState } from "react";
import { load as loadYaml } from "js-yaml";
import movementsYamlText from "../movements.yml?raw";
import routinesYamlText from "../routines.yml?raw";

const DEFAULT_START_DURATION = 10;
const DEFAULT_MOVE_DURATION = 45;
const DEFAULT_REST_DURATION = 30;
const SIDE_SWITCH_DURATION = 10;

const EQUIPMENT_OPTIONS = [
  { id: "kettlebell", label: "Kettlebell", defaultSelected: true },
  { id: "dumbbell", label: "Dumbbells", defaultSelected: true },
  { id: "olympic_bar", label: "Barbell", defaultSelected: false },
  { id: "resistance_band", label: "Resistance Band", defaultSelected: true },
  { id: "step_box", label: "Step/Box", defaultSelected: true }
];

const STEP_TYPES = {
  start: "start",
  exercise: "exercise",
  rest: "rest",
  switch: "switch"
};

const EQUIPMENT_LABELS = Object.fromEntries(EQUIPMENT_OPTIONS.map((item) => [item.id, item.label]));

function buildMovements(raw) {
  return Object.entries(raw ?? {}).map(([id, value]) => {
    const entry = Array.isArray(value) ? value[0] : value;
    return {
      id,
      name: entry?.name ?? id,
      category: entry?.category ?? "",
      categoryName: entry?.category_name ?? entry?.category ?? "",
      side: Boolean(entry?.side),
      requires: entry?.requires ?? [],
      cues: entry?.cues ?? ""
    };
  });
}

function buildRoutines(raw) {
  return Object.entries(raw ?? {}).map(([id, value]) => {
    const entry = Array.isArray(value) ? value[0] : value;
    const maxSidedMovements = Number(entry?.max_sided_movements);

    return {
      id,
      name: entry?.name ?? id,
      movements: (entry?.movements ?? []).map((slot) => (Array.isArray(slot) ? slot : [slot])),
      rotations: Number(entry?.rotations ?? 1),
      maxSidedMovements: Number.isFinite(maxSidedMovements) ? maxSidedMovements : Infinity
    };
  });
}

function randomPick(list) {
  if (!list || list.length === 0) return null;
  return list[Math.floor(Math.random() * list.length)];
}

function normalizeRequirementGroup(requirement) {
  return Array.isArray(requirement) ? requirement : [requirement];
}

function meetsRequirements(requirements, equipmentSet) {
  return (requirements ?? []).every((requirement) => {
    return normalizeRequirementGroup(requirement).some((item) => equipmentSet.has(item));
  });
}

function buildPlan(movementsById, movementSlots, equipmentSet, maxSidedMovements) {
  let sidedCount = 0;

  return movementSlots.map((movementIds, index) => {
    const candidates = movementIds.map((movementId) => movementsById[movementId]).filter(Boolean);

    if (candidates.length === 0) {
      return {
        groupId: `slot-${index}`,
        groupName: "Movement",
        movement: null,
        options: [],
        selectedIndex: -1,
        reason: "Movement not found"
      };
    }

    const matching = candidates.filter((movement) => meetsRequirements(movement.requires, equipmentSet));

    if (matching.length === 0) {
      return {
        groupId: `slot-${index}`,
        groupName: candidates[0].categoryName || "Movement",
        movement: null,
        options: [],
        selectedIndex: -1,
        reason: "No matching equipment"
      };
    }

    const available = sidedCount >= maxSidedMovements ? matching.filter((movement) => !movement.side) : matching;

    if (available.length === 0) {
      return {
        groupId: `slot-${index}`,
        groupName: candidates[0].categoryName || "Movement",
        movement: null,
        options: [],
        selectedIndex: -1,
        reason: "Sided movement limit reached"
      };
    }

    const selectedMovement = randomPick(available);
    const selectedIndex = matching.findIndex((movement) => movement.id === selectedMovement?.id);
    if (selectedMovement?.side) {
      sidedCount += 1;
    }

    return {
      groupId: `slot-${index}`,
      groupName: candidates[0].categoryName || "Movement",
      movement: selectedMovement,
      options: matching,
      selectedIndex,
      reason: ""
    };
  });
}

function buildSteps(plan, durations, rotations) {
  const baseMovements = plan.filter((item) => item.movement).map((item) => item.movement);
  const sequence = [];

  for (let rotation = 0; rotation < rotations; rotation += 1) {
    baseMovements.forEach((movement) => {
      sequence.push(movement);
    });
  }

  const steps = [];
  const firstMovement = sequence[0] ?? null;

  steps.push({
    type: STEP_TYPES.start,
    label: "Next",
    headline: firstMovement?.name ?? "Build your routine",
    cues: firstMovement?.cues ?? "Pick a routine to build your circuit.",
    duration: durations.start
  });

  sequence.forEach((movement, index) => {
    const nextMovement = sequence[index + 1] ?? null;

    steps.push({
      type: STEP_TYPES.exercise,
      label: movement.side ? "Now - First Side" : "Now",
      headline: movement.name,
      cues: movement.cues ?? "",
      duration: durations.move,
      movement
    });

    if (movement.side) {
      steps.push({
        type: STEP_TYPES.switch,
        label: "Swap Sides",
        headline: movement.name,
        cues: movement.cues ?? "",
        duration: SIDE_SWITCH_DURATION,
        movement
      });

      steps.push({
        type: STEP_TYPES.exercise,
        label: "Now - Second Side",
        headline: movement.name,
        cues: movement.cues ?? "",
        duration: durations.move,
        movement
      });
    }

    if (nextMovement) {
      steps.push({
        type: STEP_TYPES.rest,
        label: "Next",
        headline: nextMovement.name,
        cues: nextMovement.cues ?? "",
        duration: durations.rest,
        movement: nextMovement
      });
    }
  });

  return steps;
}

function useBeep() {
  const audioRef = useRef(null);

  useEffect(() => {
    audioRef.current = new (window.AudioContext || window.webkitAudioContext)();
    return () => {
      if (audioRef.current && audioRef.current.state !== "closed") {
        audioRef.current.close();
      }
    };
  }, []);

  const play = (durationMs, frequency = 880) => {
    const context = audioRef.current;
    if (!context) return;

    if (context.state === "suspended") {
      context.resume();
    }

    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.value = 0.0001;

    oscillator.connect(gain);
    gain.connect(context.destination);

    const now = context.currentTime;
    gain.gain.exponentialRampToValueAtTime(0.3, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);

    oscillator.start();
    oscillator.stop(now + durationMs / 1000 + 0.02);
  };

  return {
    shortBeep: () => play(120, 880),
    switchBeep: () => play(120, 1220),
    longBeep: () => play(450, 660),
    resume: () => {
      if (audioRef.current && audioRef.current.state === "suspended") {
        audioRef.current.resume();
      }
    }
  };
}

function formatDuration(value) {
  return String(value).padStart(2, "0");
}

function formatTotalDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export default function App() {
  const [movements, setMovements] = useState([]);
  const [routines, setRoutines] = useState([]);
  const [selectedRoutineId, setSelectedRoutineId] = useState("");
  const [equipment, setEquipment] = useState(() =>
    EQUIPMENT_OPTIONS.reduce(
      (acc, item) => ({
        ...acc,
        [item.id]: item.defaultSelected
      }),
      {}
    )
  );
  const [durations, setDurations] = useState({
    start: DEFAULT_START_DURATION,
    move: DEFAULT_MOVE_DURATION,
    rest: DEFAULT_REST_DURATION
  });
  const [rotations, setRotations] = useState(1);
  const [durationInputs, setDurationInputs] = useState({
    move: String(DEFAULT_MOVE_DURATION),
    rest: String(DEFAULT_REST_DURATION)
  });
  const [rotationInput, setRotationInput] = useState("1");
  const [plan, setPlan] = useState([]);
  const [steps, setSteps] = useState([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [status, setStatus] = useState("idle");
  const [hasFinished, setHasFinished] = useState(false);
  const { shortBeep, switchBeep, longBeep, resume } = useBeep();
  const intervalRef = useRef(null);
  const advancePendingRef = useRef(false);
  const endTimeRef = useRef(null);
  const lastRemainingRef = useRef(null);

  useEffect(() => {
    try {
      const movementList = buildMovements(loadYaml(movementsYamlText));
      const routinesList = buildRoutines(loadYaml(routinesYamlText));
      setMovements(movementList);
      setRoutines(routinesList);
      if (routinesList.length > 0) {
        setSelectedRoutineId(routinesList[0].id);
      }
    } catch {
      setMovements([]);
      setRoutines([]);
    }
  }, []);

  const routine = useMemo(
    () => routines.find((entry) => entry.id === selectedRoutineId) ?? null,
    [routines, selectedRoutineId]
  );

  const movementsById = useMemo(() => {
    return movements.reduce((acc, movement) => {
      acc[movement.id] = movement;
      return acc;
    }, {});
  }, [movements]);

  const equipmentSet = useMemo(() => {
    const selected = new Set(["bodyweight"]);
    Object.entries(equipment).forEach(([key, value]) => {
      if (value) selected.add(key);
    });
    return selected;
  }, [equipment]);

  const neededEquipment = useMemo(() => {
    const needed = new Set();

    plan.forEach((item) => {
      (item.movement?.requires ?? []).forEach((requirement) => {
        normalizeRequirementGroup(requirement).forEach((equipmentId) => {
          needed.add(equipmentId);
        });
      });
    });

    return needed;
  }, [plan]);

  useEffect(() => {
    if (!routine) return;
    setRotations(routine.rotations);
  }, [routine]);

  useEffect(() => {
    setDurationInputs({
      move: String(durations.move),
      rest: String(durations.rest)
    });
  }, [durations.move, durations.rest]);

  useEffect(() => {
    setRotationInput(String(rotations));
  }, [rotations]);

  const regeneratePlan = () => {
    if (!routine) {
      setPlan([]);
      return;
    }

    const nextPlan = buildPlan(
      movementsById,
      routine.movements,
      equipmentSet,
      routine.maxSidedMovements
    );
    setPlan(nextPlan);
  };

  useEffect(() => {
    if (status === "running") return;
    regeneratePlan();
  }, [routine, movementsById, equipmentSet, status]);

  useEffect(() => {
    if (status === "running") return;
    const nextSteps = buildSteps(plan, durations, rotations);
    const nextIndex = Math.min(stepIndex, Math.max(nextSteps.length - 1, 0));
    setSteps(nextSteps);

    if (nextIndex !== stepIndex) {
      setStepIndex(nextIndex);
      setTimeRemaining(nextSteps[nextIndex]?.duration ?? 0);
      return;
    }

    if (status !== "paused") {
      setTimeRemaining(nextSteps[nextIndex]?.duration ?? 0);
    }
  }, [plan, durations, rotations, status, stepIndex]);

  const clearIntervalTimer = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const initializeTimer = () => {
    if (plan.length === 0 || steps.length === 0) return;
    setStepIndex(0);
    setTimeRemaining(steps[0]?.duration ?? 0);
    setStatus("running");
    setHasFinished(false);
    advancePendingRef.current = false;
    endTimeRef.current = performance.now() + (steps[0]?.duration ?? 0) * 1000;
    lastRemainingRef.current = null;
  };

  const handleStart = () => {
    if (status === "running") return;
    resume();
    if (steps.length === 0 || status === "idle" || status === "stopped") {
      initializeTimer();
      return;
    }
    endTimeRef.current = performance.now() + timeRemaining * 1000;
    lastRemainingRef.current = null;
    setStatus("running");
  };

  const handlePause = () => {
    if (status !== "running") return;
    setStatus("paused");
    endTimeRef.current = null;
  };

  const handleToggle = () => {
    if (status === "running") {
      handlePause();
      return;
    }
    handleStart();
  };

  const handleStartOver = () => {
    clearIntervalTimer();
    setStatus("idle");
    setHasFinished(false);
    setTimeRemaining(0);
    setStepIndex(0);
    advancePendingRef.current = false;
    endTimeRef.current = null;
    lastRemainingRef.current = null;
    regeneratePlan();
  };

  const handleSkip = (direction) => {
    if (steps.length === 0) return;
    const nextIndex = Math.min(Math.max(stepIndex + direction, 0), steps.length - 1);
    setStepIndex(nextIndex);
    setTimeRemaining(steps[nextIndex]?.duration ?? 0);
    advancePendingRef.current = false;
    if (status === "running") {
      endTimeRef.current = performance.now() + (steps[nextIndex]?.duration ?? 0) * 1000;
      lastRemainingRef.current = null;
    }
  };

  const handleCyclePlannedMovement = (planIndex, direction) => {
    if (isLocked) return;

    setPlan((prev) =>
      prev.map((item, index) => {
        if (index !== planIndex || !item.options || item.options.length <= 1) {
          return item;
        }

        const nextSelectedIndex =
          (item.selectedIndex + direction + item.options.length) % item.options.length;

        return {
          ...item,
          selectedIndex: nextSelectedIndex,
          movement: item.options[nextSelectedIndex]
        };
      })
    );
  };

  const commitDurationInput = (key, min, max) => {
    setDurations((prev) => {
      const parsed = Number(durationInputs[key]);
      const nextValue = Number.isFinite(parsed) ? clamp(parsed, min, max) : prev[key];
      const nextDurations = { ...prev, [key]: nextValue };
      setDurationInputs({
        move: String(key === "move" ? nextValue : nextDurations.move),
        rest: String(key === "rest" ? nextValue : nextDurations.rest)
      });
      return nextDurations;
    });
  };

  const commitRotationInput = () => {
    setRotations((prev) => {
      const parsed = Number(rotationInput);
      const nextValue = Number.isFinite(parsed) ? clamp(parsed, 1, 20) : prev;
      setRotationInput(String(nextValue));
      return nextValue;
    });
  };

  const currentStep = steps[stepIndex] ?? null;

  useEffect(() => {
    clearIntervalTimer();

    if (status === "running") {
      if (!endTimeRef.current) {
        endTimeRef.current = performance.now() + timeRemaining * 1000;
        lastRemainingRef.current = null;
      }
      intervalRef.current = setInterval(() => {
        const now = performance.now();
        const remaining = Math.max(0, Math.ceil((endTimeRef.current - now) / 1000));
        if (lastRemainingRef.current !== remaining) {
          const useSwitchTone =
            currentStep?.type === STEP_TYPES.switch ||
            (currentStep?.type === STEP_TYPES.exercise && steps[stepIndex + 1]?.type === STEP_TYPES.switch);

          if ([3, 2, 1].includes(remaining)) {
            if (useSwitchTone) {
              switchBeep();
            } else {
              shortBeep();
            }
          }
          if (remaining === 0 && !advancePendingRef.current) {
            advancePendingRef.current = true;
            if (useSwitchTone) {
              switchBeep();
            } else {
              longBeep();
            }
            setStepIndex((prev) => {
              const nextIndex = prev + 1;
              if (nextIndex >= steps.length) {
                setStatus("stopped");
                setHasFinished(true);
                setTimeRemaining(0);
                endTimeRef.current = null;
                lastRemainingRef.current = null;
                return prev;
              }
              setTimeRemaining(steps[nextIndex]?.duration ?? 0);
              endTimeRef.current = performance.now() + (steps[nextIndex]?.duration ?? 0) * 1000;
              advancePendingRef.current = false;
              lastRemainingRef.current = null;
              return nextIndex;
            });
          }
          lastRemainingRef.current = remaining;
          setTimeRemaining(remaining);
        }
      }, 200);
    }

    return () => clearIntervalTimer();
  }, [status, steps, timeRemaining, currentStep, shortBeep, switchBeep, longBeep]);

  const remainingDisplay = formatDuration(timeRemaining);
  const isLocked = status === "running" || status === "paused";
  const isRoutineSelectorDisabled = isLocked || routines.length < 2;
  const isActive = status === "running" || status === "paused";
  const missingMovements = plan.filter((item) => !item.movement);
  const hasMovements = plan.some((item) => item.movement);
  const completedMovements = plan.filter((item) => item.movement).map((item) => item.movement.name);
  const totalDuration = steps.reduce((total, step) => total + (step.duration ?? 0), 0);
  const elapsedBeforeCurrent = steps
    .slice(0, stepIndex)
    .reduce((total, step) => total + (step.duration ?? 0), 0);
  const currentDuration = currentStep?.duration ?? 0;
  const currentElapsed = isActive ? Math.max(currentDuration - timeRemaining, 0) : 0;
  const progressValue =
    totalDuration > 0 ? (elapsedBeforeCurrent + currentElapsed) / totalDuration : 0;
  const projectedDuration = formatTotalDuration(totalDuration);

  const displayLabel =
    status === "paused" ? `Paused - ${currentStep?.label ?? "Now"}` : currentStep?.label ?? "Now";
  const displayHeadline = currentStep?.headline ?? "Ready";
  const displayCues = currentStep?.cues ?? "";

  const backgroundClass =
    hasFinished
      ? "panel finished"
      : status === "running"
      ? currentStep?.type === STEP_TYPES.exercise
        ? "panel exercise"
        : currentStep?.type === STEP_TYPES.switch
          ? "panel switch"
          : currentStep?.type === STEP_TYPES.rest
            ? "panel rest"
          : "panel idle"
      : status === "paused"
        ? currentStep?.type === STEP_TYPES.exercise
          ? "panel exercise"
          : currentStep?.type === STEP_TYPES.switch
            ? "panel switch"
            : currentStep?.type === STEP_TYPES.rest
              ? "panel rest"
              : "panel idle"
        : "panel idle";

  return (
    <div className="app">
      <header>
        <div>
          <h1>s3:kit</h1>
          <p className="kicker">Circuit Training App</p>
        </div>
        <div className="status" />
      </header>

      <main>
        <section className="top-grid">
          <div className="settings">
            <div className="card">
              <h3>Routine</h3>
              <div className="field">
                <label>
                  Choose routine
                  <span className="select-wrap">
                    <select
                      value={selectedRoutineId}
                      disabled={isRoutineSelectorDisabled}
                      onChange={(event) => setSelectedRoutineId(event.target.value)}
                    >
                      {routines.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name}
                        </option>
                      ))}
                    </select>
                    <span className="select-arrow" aria-hidden="true">
                      <svg viewBox="0 0 24 24">
                        <path d="m7 10 5 5 5-5" />
                      </svg>
                    </span>
                  </span>
                </label>
              </div>
            </div>

            <div className="card timing-card">
              <h3>Timing</h3>
              <div className="field-grid">
                <label>
                  Exercise (sec)
                  <input
                    type="number"
                    inputMode="numeric"
                    step="1"
                    value={durationInputs.move}
                    disabled={isLocked}
                    onChange={(event) =>
                      setDurationInputs((prev) => ({ ...prev, move: event.target.value }))
                    }
                    onBlur={() => commitDurationInput("move", 5, 90)}
                  />
                </label>
                <label>
                  Rest (sec)
                  <input
                    type="number"
                    inputMode="numeric"
                    step="1"
                    value={durationInputs.rest}
                    disabled={isLocked}
                    onChange={(event) =>
                      setDurationInputs((prev) => ({ ...prev, rest: event.target.value }))
                    }
                    onBlur={() => commitDurationInput("rest", 5, 90)}
                  />
                </label>
                <label>
                  Rotations
                  <input
                    type="number"
                    inputMode="numeric"
                    step="1"
                    value={rotationInput}
                    disabled={isLocked}
                    onChange={(event) => setRotationInput(event.target.value)}
                    onBlur={commitRotationInput}
                  />
                </label>
              </div>
            </div>

            <div className="card">
              <h3>Equipment</h3>
              <p className="hint">Select what you have available to filter movements.</p>
              <div className="equipment-grid">
                {EQUIPMENT_OPTIONS.map((item) => {
                  const pillClasses = ["pill"];
                  if (equipment[item.id]) pillClasses.push("active");

                  return (
                    <label key={item.id} className={pillClasses.join(" ")}>
                      <input
                        type="checkbox"
                        checked={equipment[item.id]}
                        disabled={isLocked}
                        onChange={() =>
                          setEquipment((prev) => ({
                            ...prev,
                            [item.id]: !prev[item.id]
                          }))
                        }
                      />
                      {item.label}
                      {neededEquipment.has(item.id) ? (
                        <span className="pill-required-indicator active" aria-hidden="true">
                          <svg viewBox="0 0 24 24">
                            <path d="M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" />
                            <path d="m8.5 12.5 2.2 2.2 4.8-5.2" />
                          </svg>
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          <div className={backgroundClass}>
            <div className="panel-controls">
              <button className="icon-button" onClick={() => handleSkip(-1)} aria-label="Skip back">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 5h2v14H5zM19 6v12l-8.5-6L19 6z" />
                </svg>
              </button>
              <button
                className="icon-button primary"
                onClick={handleToggle}
                aria-label={status === "running" ? "Pause" : "Play"}
                disabled={!hasMovements}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  {status === "running" ? (
                    <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
                  ) : (
                    <path d="M8 5v14l11-7-11-7z" />
                  )}
                </svg>
              </button>
              <button className="icon-button" onClick={() => handleSkip(1)} aria-label="Skip forward">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M17 5h2v14h-2zM5 6v12l8.5-6L5 6z" />
                </svg>
              </button>
            </div>

            {isActive ? (
              <div className="panel-content session-view">
                <div className="session-top">
                  <p className="label">{displayLabel}</p>
                </div>
                <div className="session-main">
                  <h2>{displayHeadline}</h2>
                  <div className="timer">{remainingDisplay}</div>
                  {displayCues ? <p className="sub-message cues">{displayCues}</p> : null}
                </div>
                {(status === "paused" || hasFinished) && (
                  <div className="session-action">
                    <button className="ghost-button" type="button" onClick={handleStartOver}>
                      Start over
                    </button>
                  </div>
                )}
                <div
                  className="progress"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={1}
                  aria-valuenow={progressValue}
                >
                  <div
                    className="progress-fill"
                    style={{ width: `${Math.min(Math.max(progressValue, 0), 1) * 100}%` }}
                  />
                </div>
              </div>
            ) : hasFinished ? (
              <div className="panel-content finished-view">
                <div className="flare flare-one" aria-hidden="true" />
                <div className="flare flare-two" aria-hidden="true" />
                <div className="flare flare-three" aria-hidden="true" />
                <p className="label">Finished</p>
                <h2>Finished!</h2>
                <p className="sub-message cues">Circuit complete. Here&apos;s what you just worked through.</p>
                <ol className="finished-list">
                  {completedMovements.map((movementName, index) => (
                    <li key={`${movementName}-${index}`}>{movementName}</li>
                  ))}
                </ol>
              </div>
            ) : (
              <div className="panel-content">
                <div className="planned">
                  <p className="label">Planned movements</p>
                  {plan.length > 0 ? (
                    <ol className="planned-list">
                      {plan.map((item, index) => (
                        <li key={`${item.groupId}-${index}`} className="planned-item">
                          {item.movement ? (
                            <div className="planned-row">
                              <button
                                type="button"
                                className="cycle-button"
                                aria-label={`Previous option for ${item.groupName}`}
                                onClick={() => handleCyclePlannedMovement(index, -1)}
                                disabled={isLocked || (item.options?.length ?? 0) <= 1}
                              >
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="M15.5 5 8.5 12l7 7" />
                                </svg>
                              </button>
                              <span className="planned-move">{item.movement.name}</span>
                              <button
                                type="button"
                                className="cycle-button"
                                aria-label={`Next option for ${item.groupName}`}
                                onClick={() => handleCyclePlannedMovement(index, 1)}
                                disabled={isLocked || (item.options?.length ?? 0) <= 1}
                              >
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="m8.5 5 7 7-7 7" />
                                </svg>
                              </button>
                            </div>
                          ) : (
                            item.reason
                          )}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="planned-empty">Pick a routine to build your circuit.</p>
                  )}
                  {plan.length > 0 ? (
                    <div className="planned-duration">
                      <p className="label">Projected duration</p>
                      <p className="planned-duration-value">{projectedDuration}</p>
                    </div>
                  ) : null}
                </div>
              </div>
            )}

            {!isActive && !hasFinished && (
              <div className="panel-footer">
                <button className="ghost-button" type="button" onClick={regeneratePlan}>
                  Shuffle circuit
                </button>
                {missingMovements.length > 0 && (
                  <p className="warning">Some routine slots could not be filled.</p>
                )}
              </div>
            )}

          </div>
        </section>
      </main>
    </div>
  );
}
