import { useEffect, useMemo, useRef, useState } from "react";
import { load as loadYaml } from "js-yaml";

const DEFAULT_START_DURATION = 10;
const DEFAULT_MOVE_DURATION = 45;
const DEFAULT_REST_DURATION = 30;

const EQUIPMENT_OPTIONS = [
  { id: "large_kettlebell", label: "Kettlebell (L)" },
  { id: "small_kettlebell", label: "Kettlebell (S)" },
  { id: "dumbbell", label: "Dumbbells" },
  { id: "olympic_bar", label: "Barbell" }
];

const STEP_TYPES = {
  start: "start",
  exercise: "exercise",
  rest: "rest"
};

function buildMovementGroups(raw) {
  return Object.entries(raw ?? {}).map(([id, value]) => {
    const entry = Array.isArray(value) ? value[0] : value;
    return {
      id,
      name: entry?.name ?? id,
      movements: entry?.movements ?? []
    };
  });
}

function buildRoutines(raw) {
  return Object.entries(raw ?? {}).map(([id, value]) => {
    const entry = Array.isArray(value) ? value[0] : value;
    return {
      id,
      name: entry?.name ?? id,
      movementGroups: entry?.movement_groups ?? [],
      rotations: Number(entry?.rotations ?? 1)
    };
  });
}

function randomPick(list) {
  if (!list || list.length === 0) return null;
  return list[Math.floor(Math.random() * list.length)];
}

function buildPlan(groupsById, groupOrder, equipmentSet) {
  return groupOrder.map((groupId) => {
    const group = groupsById[groupId];
    if (!group) {
      return {
        groupId,
        groupName: "Unknown group",
        movement: null,
        reason: "Group not found"
      };
    }

    const matching = (group.movements ?? []).filter((movement) => {
      const equipment = movement.equipment ?? [];
      return equipment.some((item) => equipmentSet.has(item));
    });

    if (matching.length === 0) {
      return {
        groupId,
        groupName: group.name,
        movement: null,
        reason: "No matching equipment"
      };
    }

    return {
      groupId,
      groupName: group.name,
      movement: randomPick(matching),
      reason: ""
    };
  });
}

function findNextExercise(steps, startIndex) {
  for (let i = startIndex + 1; i < steps.length; i += 1) {
    const step = steps[i];
    if (step.type === STEP_TYPES.exercise) {
      return step.headline;
    }
  }
  return "Finished";
}

function buildSteps(plan, durations, rotations) {
  const movements = plan.filter((item) => item.movement).map((item) => item.movement);
  const steps = [];
  const startMessage =
    movements.length > 0 ? `Coming up: ${movements[0].name}` : "Coming up: Build your routine";

  steps.push({
    type: STEP_TYPES.start,
    headline: "Get Ready!",
    subMessage: startMessage,
    duration: durations.start
  });

  for (let rotation = 0; rotation < rotations; rotation += 1) {
    for (let i = 0; i < movements.length; i += 1) {
      const movement = movements[i];
      const isLastMovement = rotation === rotations - 1 && i === movements.length - 1;
      const nextMovement = movements[i + 1] ?? (rotation + 1 < rotations ? movements[0] : null);
      steps.push({
        type: STEP_TYPES.exercise,
        headline: movement.name,
        subMessage: movement.cues ?? "",
        duration: durations.move,
        movement
      });

      if (!isLastMovement) {
        steps.push({
          type: STEP_TYPES.rest,
          headline: "Rest",
          subMessage: nextMovement ? `Up next: ${nextMovement.name}` : "Up next: Finished!",
          duration: durations.rest
        });
      }
    }
  }

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

export default function App() {
  const [movementGroups, setMovementGroups] = useState([]);
  const [routines, setRoutines] = useState([]);
  const [selectedRoutineId, setSelectedRoutineId] = useState("");
  const [equipment, setEquipment] = useState(() =>
    EQUIPMENT_OPTIONS.reduce(
      (acc, item) => ({
        ...acc,
        [item.id]: item.id !== "olympic_bar"
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
  const [plan, setPlan] = useState([]);
  const [steps, setSteps] = useState([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [status, setStatus] = useState("idle");
  const { shortBeep, longBeep, resume } = useBeep();
  const intervalRef = useRef(null);
  const advancePendingRef = useRef(false);
  const endTimeRef = useRef(null);
  const lastRemainingRef = useRef(null);

  useEffect(() => {
    Promise.all([fetch("/movements.yml"), fetch("/routines.yml")])
      .then(async ([movementsRes, routinesRes]) => {
        const movementsText = await movementsRes.text();
        const routinesText = await routinesRes.text();
        const movementGroupsList = buildMovementGroups(loadYaml(movementsText));
        const routinesList = buildRoutines(loadYaml(routinesText));
        setMovementGroups(movementGroupsList);
        setRoutines(routinesList);
        if (routinesList.length > 0) {
          setSelectedRoutineId(routinesList[0].id);
        }
      })
      .catch(() => {
        setMovementGroups([]);
        setRoutines([]);
      });
  }, []);

  const routine = useMemo(
    () => routines.find((entry) => entry.id === selectedRoutineId) ?? null,
    [routines, selectedRoutineId]
  );

  const groupsById = useMemo(() => {
    return movementGroups.reduce((acc, group) => {
      acc[group.id] = group;
      return acc;
    }, {});
  }, [movementGroups]);

  const equipmentSet = useMemo(() => {
    const selected = new Set(["bodyweight"]);
    Object.entries(equipment).forEach(([key, value]) => {
      if (value) selected.add(key);
    });
    return selected;
  }, [equipment]);

  useEffect(() => {
    if (!routine) return;
    setRotations(routine.rotations);
  }, [routine]);

  const regeneratePlan = () => {
    if (!routine) {
      setPlan([]);
      return;
    }
    const nextPlan = buildPlan(groupsById, routine.movementGroups, equipmentSet);
    setPlan(nextPlan);
  };

  useEffect(() => {
    if (status === "running") return;
    regeneratePlan();
  }, [routine, groupsById, equipmentSet, status]);

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

  const handleStop = () => {
    clearIntervalTimer();
    setStatus("stopped");
    setTimeRemaining(0);
    setStepIndex(0);
    advancePendingRef.current = false;
    endTimeRef.current = null;
    lastRemainingRef.current = null;
  };

  const handleRestart = () => {
    clearIntervalTimer();
    initializeTimer();
  };

  const handleStartOver = () => {
    clearIntervalTimer();
    setStatus("idle");
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
          if ([3, 2, 1].includes(remaining)) {
            shortBeep();
          }
          if (remaining === 0 && !advancePendingRef.current) {
            advancePendingRef.current = true;
            longBeep();
            setStepIndex((prev) => {
              const nextIndex = prev + 1;
              if (nextIndex >= steps.length) {
                setStatus("stopped");
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
  }, [status, steps, timeRemaining, shortBeep, longBeep]);

  const remainingDisplay = formatDuration(timeRemaining);
  const currentStep = steps[stepIndex] ?? null;
  const stepHeadline = currentStep?.headline ?? "Ready";
  const isLocked = status === "running" || status === "paused";
  const isRunning = status === "running";
  const missingMovements = plan.filter((item) => !item.movement);
  const hasMovements = plan.some((item) => item.movement);
  const nextExerciseName = isRunning ? findNextExercise(steps, stepIndex) : "";
  const runningSubMessage =
    currentStep?.type === STEP_TYPES.exercise
      ? currentStep?.subMessage
      : `Next: ${nextExerciseName}`;
  const totalDuration = steps.reduce((total, step) => total + (step.duration ?? 0), 0);
  const elapsedBeforeCurrent = steps
    .slice(0, stepIndex)
    .reduce((total, step) => total + (step.duration ?? 0), 0);
  const currentDuration = currentStep?.duration ?? 0;
  const isActive = status === "running" || status === "paused";
  const currentElapsed = isActive ? Math.max(currentDuration - timeRemaining, 0) : 0;
  const progressValue =
    totalDuration > 0 ? (elapsedBeforeCurrent + currentElapsed) / totalDuration : 0;

  const backgroundClass = isRunning
    ? currentStep?.type === STEP_TYPES.exercise
      ? "panel exercise"
      : currentStep?.type === STEP_TYPES.rest
        ? "panel rest"
        : "panel idle"
    : "panel idle";

  return (
    <div className="app">
      <header>
        <div>
          <h1>Circuits</h1>
          <p className="kicker">Interval Timer</p>
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
                  <select
                    value={selectedRoutineId}
                    disabled={isLocked}
                    onChange={(event) => setSelectedRoutineId(event.target.value)}
                  >
                    {routines.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div className="card">
              <h3>Equipment</h3>
              <p className="hint">Select what you have available to filter movements.</p>
              <div className="equipment-grid">
                {EQUIPMENT_OPTIONS.map((item) => (
                  <label key={item.id} className={`pill ${equipment[item.id] ? "active" : ""}`}>
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
                  </label>
                ))}
              </div>
            </div>

            <div className="card timing-card">
              <h3>Timing</h3>
              <div className="field-grid">
                <label>
                  Exercise (sec)
                  <input
                    type="number"
                    min="1"
                    value={durations.move}
                    disabled={isLocked}
                    onChange={(event) =>
                      setDurations((prev) => ({
                        ...prev,
                        move: Number(event.target.value)
                      }))
                    }
                  />
                </label>
                <label>
                  Rest (sec)
                  <input
                    type="number"
                    min="1"
                    value={durations.rest}
                    disabled={isLocked}
                    onChange={(event) =>
                      setDurations((prev) => ({
                        ...prev,
                        rest: Number(event.target.value)
                      }))
                    }
                  />
                </label>
                <label>
                  Rotations
                  <input
                    type="number"
                    min="1"
                    value={rotations}
                    disabled={isLocked}
                    onChange={(event) => setRotations(Number(event.target.value))}
                  />
                </label>
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
            <div className="panel-content">
              {isRunning ? (
                <>
                  <p className="label">Now</p>
                  <h2>{stepHeadline}</h2>
                  {runningSubMessage ? <p className="sub-message">{runningSubMessage}</p> : null}
                  <div className="timer">{remainingDisplay}</div>
                  <div
                    className="progress"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={1}
                    aria-valuenow={progressValue}
                  >
                    <div className="progress-fill" style={{ width: `${Math.min(Math.max(progressValue, 0), 1) * 100}%` }} />
                  </div>
                </>
              ) : (
                <div className="planned">
                  <p className="label">Planned movements</p>
                  {plan.length > 0 ? (
                    <ol className="planned-list">
                      {plan.map((item, index) => (
                        <li key={`${item.groupId}-${index}`} className="planned-item">
                          {item.movement?.name ?? item.reason}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="planned-empty">Pick a routine to build your circuit.</p>
                  )}
                </div>
              )}
            </div>
            {!isRunning && (
              <div className="panel-footer">
                {status === "paused" ? (
                  <button className="ghost-button" type="button" onClick={handleStartOver}>
                    Start over
                  </button>
                ) : (
                  <button className="ghost-button" type="button" onClick={regeneratePlan}>
                    Shuffle circuit
                  </button>
                )}
                {missingMovements.length > 0 && (
                  <p className="warning">Some groups have no matching equipment.</p>
                )}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
