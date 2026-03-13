import { useEffect, useMemo, useRef, useState } from "react";
import { load as loadYaml } from "js-yaml";

const DEFAULT_START_DURATION = 10;
const DEFAULT_MOVE_DURATION = 45;
const DEFAULT_REST_DURATION = 30;
const DEFAULT_ROTATIONS = 3;

const STEP_TYPES = {
  start: "start",
  exercise: "exercise",
  rest: "rest"
};

function shuffleIds(ids) {
  const next = [...ids];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function buildRoutine(groups, selectedGroupIds, startWithStrength) {
  const selectedGroups = selectedGroupIds
    .map((id) => groups.find((group) => group.id === id))
    .filter(Boolean);

  const routine = [];
  let useStrength = startWithStrength;

  for (const group of selectedGroups) {
    const bucket = useStrength ? group.exercises.strength : group.exercises.stability;
    if (bucket && bucket.length > 0) {
      routine.push({
        name: bucket[0].name,
        cues: bucket[0].cues ?? ""
      });
    }
    useStrength = !useStrength;
  }

  return routine;
}

function formatUpNext(nextMovement) {
  if (!nextMovement) return "Up next: Finished!";
  return `Up next: ${nextMovement.name}`;
}

function formatCues(movement) {
  if (!movement || !movement.cues) return "Cues: move with control.";
  return movement.cues;
}

function buildSteps(routine, durations, rotations) {
  const steps = [];
  const startMessage =
    routine.length > 0 ? `Coming up: ${routine[0].name}` : "Coming up: Build your routine";

  steps.push({
    type: STEP_TYPES.start,
    headline: "Get Ready!",
    subMessage: startMessage,
    duration: durations.start
  });

  for (let rotation = 0; rotation < rotations; rotation += 1) {
    for (let i = 0; i < routine.length; i += 1) {
      const movement = routine[i];
      const nextMovement = routine[i + 1] ?? (rotation + 1 < rotations ? routine[0] : null);
      steps.push({
        type: STEP_TYPES.exercise,
        headline: movement.name,
        subMessage: formatCues(movement),
        duration: durations.move,
        movement
      });

      steps.push({
        type: STEP_TYPES.rest,
        headline: "Rest",
        subMessage: formatUpNext(nextMovement),
        duration: durations.rest
      });
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
  const [groups, setGroups] = useState([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState([]);
  const [availableGroupIds, setAvailableGroupIds] = useState([]);
  const [durations, setDurations] = useState({
    start: DEFAULT_START_DURATION,
    move: DEFAULT_MOVE_DURATION,
    rest: DEFAULT_REST_DURATION
  });
  const [rotations, setRotations] = useState(DEFAULT_ROTATIONS);
  const [startWithStrengthRandom, setStartWithStrengthRandom] = useState(() => Math.random() < 0.5);
  const [routine, setRoutine] = useState([]);
  const [steps, setSteps] = useState([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [status, setStatus] = useState("idle");
  const { shortBeep, longBeep, resume } = useBeep();
  const intervalRef = useRef(null);
  const advancePendingRef = useRef(false);
  const dragRef = useRef(null);
  const endTimeRef = useRef(null);
  const lastRemainingRef = useRef(null);

  useEffect(() => {
    fetch("/exercises.yml")
      .then((res) => res.text())
      .then((text) => {
        const parsed = loadYaml(text);
        const groupList = parsed?.groups ?? [];
        setGroups(groupList);
        setSelectedGroupIds(shuffleIds(groupList.map((group) => group.id)));
        setAvailableGroupIds([]);
        setStartWithStrengthRandom(Math.random() < 0.5);
      })
      .catch(() => {
        setGroups([]);
        setSelectedGroupIds([]);
        setAvailableGroupIds([]);
      });
  }, []);

  useEffect(() => {
    setRoutine(buildRoutine(groups, selectedGroupIds, startWithStrengthRandom));
  }, [groups, selectedGroupIds, startWithStrengthRandom]);

  const unselectedGroupIds = availableGroupIds;

  const currentStep = steps[stepIndex] ?? null;
  const isLocked = status === "running";
  const isRunning = status === "running";

  useEffect(() => {
    if (status === "running") return;
    const nextSteps = buildSteps(routine, durations, rotations);
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
  }, [routine, durations, rotations, status, stepIndex]);

  const clearIntervalTimer = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const initializeTimer = () => {
    const randomStart = Math.random() < 0.5;
    const nextRoutine = buildRoutine(groups, selectedGroupIds, randomStart);
    setStartWithStrengthRandom(randomStart);
    setRoutine(nextRoutine);
    const nextSteps = buildSteps(nextRoutine, durations, rotations);
    setSteps(nextSteps);
    setStepIndex(0);
    setTimeRemaining(nextSteps[0]?.duration ?? 0);
    setStatus("running");
    advancePendingRef.current = false;
    endTimeRef.current = performance.now() + (nextSteps[0]?.duration ?? 0) * 1000;
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
        const remaining = Math.max(
          0,
          Math.ceil((endTimeRef.current - now) / 1000)
        );
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
  const stepHeadline = currentStep?.headline ?? "Ready";
  const stepSub = currentStep?.subMessage ?? "Set your timing and target areas.";

  const backgroundClass = isRunning
    ? currentStep?.type === STEP_TYPES.exercise
      ? "panel exercise"
      : currentStep?.type === STEP_TYPES.rest
        ? "panel rest"
        : "panel idle"
    : "panel idle";

  const handleDragStart = (groupId, from) => {
    dragRef.current = { groupId, from };
  };

  const handleDrop = (to, index) => {
    if (!dragRef.current) return;
    const { groupId, from } = dragRef.current;
    dragRef.current = null;

    if (from === to) {
      const list = from === "selected" ? selectedGroupIds : availableGroupIds;
      const fromIndex = list.indexOf(groupId);
      if (fromIndex === -1) return;
      const next = [...list];
      next.splice(fromIndex, 1);
      const targetIndex = Math.min(Math.max(index, 0), next.length);
      next.splice(targetIndex, 0, groupId);
      if (to === "selected") {
        setSelectedGroupIds(next);
      } else {
        setAvailableGroupIds(next);
      }
      return;
    }

    if (to === "selected") {
      const nextSelected = [...selectedGroupIds];
      const targetIndex = Math.min(Math.max(index, 0), nextSelected.length);
      if (!nextSelected.includes(groupId)) {
        nextSelected.splice(targetIndex, 0, groupId);
        setSelectedGroupIds(nextSelected);
      }
      setAvailableGroupIds((prev) => prev.filter((id) => id !== groupId));
      return;
    }

    if (!availableGroupIds.includes(groupId)) {
      const nextAvailable = [...availableGroupIds];
      const targetIndex = Math.min(Math.max(index, 0), nextAvailable.length);
      nextAvailable.splice(targetIndex, 0, groupId);
      setAvailableGroupIds(nextAvailable);
    }
    setSelectedGroupIds((prev) => prev.filter((id) => id !== groupId));
  };

  const moveToSelected = (groupId) => {
    if (selectedGroupIds.includes(groupId)) return;
    setSelectedGroupIds((prev) => [...prev, groupId]);
    setAvailableGroupIds((prev) => prev.filter((id) => id !== groupId));
  };

  const moveToAvailable = (groupId) => {
    if (availableGroupIds.includes(groupId)) return;
    setAvailableGroupIds((prev) => [...prev, groupId]);
    setSelectedGroupIds((prev) => prev.filter((id) => id !== groupId));
  };

  const moveSelected = (groupId, direction) => {
    const index = selectedGroupIds.indexOf(groupId);
    if (index === -1) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= selectedGroupIds.length) return;
    const next = [...selectedGroupIds];
    const [item] = next.splice(index, 1);
    next.splice(nextIndex, 0, item);
    setSelectedGroupIds(next);
  };

  return (
    <div className="app">
      <header>
        <div>
          <p className="kicker">Interval Timer</p>
          <h1>Circuits</h1>
        </div>
        <div className="status">
          <span className={`status-pill ${status}`}>{status.toUpperCase()}</span>
          <span className="status-meta">{routine.length} moves</span>
        </div>
      </header>

      <main>
        <section className="top-grid">
          <div className={backgroundClass}>
            <div className="panel-content">
              {isRunning ? (
                <>
                  <h2>{stepHeadline}</h2>
                  <p className="sub-message">{stepSub}</p>
                  <div className="timer">{remainingDisplay}</div>
                </>
              ) : (
                <div className="planned">
                  <p className="label">Planned movements</p>
                  {routine.length > 0 ? (
                    <ol className="planned-list">
                      {routine.map((movement, index) => (
                        <li key={`${movement.name}-${index}`} className="planned-item">
                          {movement.name}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="planned-empty">Build your routine to see the movement list.</p>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="settings">
            <div className="card timing-card">
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
        </section>

        <section className="card">
          <h3>Target Areas</h3>
          <p className="hint">Drag groups between columns and reorder the circuit.</p>
          <div className="columns">
            <div
              className="column"
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => handleDrop("available", unselectedGroupIds.length)}
            >
              <p className="column-title">Available</p>
              <ul className="group-list">
                {unselectedGroupIds.map((id, index) => {
                  const group = groups.find((entry) => entry.id === id);
                  if (!group) return null;
                  return (
                    <li
                      key={id}
                      draggable
                      onDragStart={() => handleDragStart(id, "available")}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => handleDrop("available", index)}
                    >
                      <div className="group-info">
                        <div>
                          <p className="group-name">{group.name}</p>
                          <p className="group-desc">{group.description}</p>
                        </div>
                      </div>
                      <div className="group-actions">
                        <button
                          type="button"
                          className="mini-button"
                          onClick={() => moveToSelected(id)}
                          aria-label={`Add ${group.name} to selected`}
                        >
                          Add
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div
              className="column"
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => handleDrop("selected", selectedGroupIds.length)}
            >
              <p className="column-title">Selected</p>
              <ul className="group-list">
                {selectedGroupIds.map((id, index) => {
                  const group = groups.find((entry) => entry.id === id);
                  if (!group) return null;
                  return (
                    <li
                      key={id}
                      draggable
                      onDragStart={() => handleDragStart(id, "selected")}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => handleDrop("selected", index)}
                    >
                      <div className="group-info">
                        <div>
                          <p className="group-name">{group.name}</p>
                          <p className="group-desc">{group.description}</p>
                        </div>
                      </div>
                      <div className="group-actions">
                        <button
                          type="button"
                          className="mini-button"
                          onClick={() => moveSelected(id, -1)}
                          aria-label={`Move ${group.name} up`}
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          className="mini-button"
                          onClick={() => moveSelected(id, 1)}
                          aria-label={`Move ${group.name} down`}
                        >
                          Down
                        </button>
                        <button
                          type="button"
                          className="mini-button"
                          onClick={() => moveToAvailable(id)}
                          aria-label={`Remove ${group.name} from selected`}
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
