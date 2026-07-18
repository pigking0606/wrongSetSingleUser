// Global timer state — persists across page navigation in Next.js client-side routing
// Tracks BOTH segment time (current session) and total time (task's accumulated time_spent)
type Listener = () => void;

// Segment = current continuous timing session (resets on endSegmentAndContinue)
let _segmentAccumulated = 0;  // accumulated segment time when paused
let _segmentStart = 0;        // timestamp when current segment started (0 if not running)

// Total = task's total time (initial time_spent + all completed segments + current segment)
let _initialTimeSpent = 0;    // task's time_spent when timer was started
let _savedSegmentTotal = 0;   // sum of completed segments (added when endSegmentAndContinue is called)

let _running = false;
let _paused = false;
let _autoSaveInterval: ReturnType<typeof setInterval> | null = null;
const _listeners = new Set<Listener>();

// Save callback — set by the page that owns the timer lifecycle
// Returns Promise<void> | void so callers can await sequential actions (e.g., stop → start)
let _onSave: ((taskId: number, action: "pause" | "stop" | "autosave" | "resume" | "start") => Promise<void> | void) | null = null;

function notify() {
  _listeners.forEach(fn => fn());
}

function getSegmentSeconds(): number {
  return _segmentAccumulated + (_segmentStart ? Math.floor((Date.now() - _segmentStart) / 1000) : 0);
}

function getTotalSeconds(): number {
  return _initialTimeSpent + _savedSegmentTotal + getSegmentSeconds();
}

function clearAutoSave() {
  if (_autoSaveInterval) { clearInterval(_autoSaveInterval); _autoSaveInterval = null; }
}

function startAutoSave() {
  clearAutoSave();
  _autoSaveInterval = setInterval(() => {
    if (_taskId !== null && _onSave) {
      _onSave(_taskId, "autosave");
    }
  }, 300000); // 5 minutes
}

function triggerSave(action: "pause" | "stop" | "autosave" | "resume" | "start"): Promise<void> | void {
  if (_taskId !== null && _onSave) {
    return _onSave(_taskId, action);
  }
}

// Which task is currently being timed (persists across navigation)
let _taskId: number | null = null;
let _taskTitle = "";

// Timer tick using recursive setTimeout to prevent callback stacking
let _tickTimeout: ReturnType<typeof setTimeout> | null = null;

function tick() {
  if (!_running) return;
  notify();
  _tickTimeout = setTimeout(tick, 200);
}

function clearTick() {
  if (_tickTimeout) { clearTimeout(_tickTimeout); _tickTimeout = null; }
}

export const globalTimer = {
  // Segment = current session time (resets on endSegmentAndContinue)
  get segmentElapsed() { return getSegmentSeconds(); },
  // Total = task's total time (initial + saved segments + current segment)
  get totalElapsed() { return getTotalSeconds(); },
  // Backward compat: elapsed = segment (for code that hasn't been updated)
  get elapsed() { return getSegmentSeconds(); },
  get running() { return _running; },
  get paused() { return _paused; },
  get taskId() { return _taskId; },
  get taskTitle() { return _taskTitle; },

  // start: begin a new timing session for a task
  // fromSec = task's existing time_spent (becomes the initial total)
  start(fromSec = 0) {
    if (_running) return;
    if (_paused) { this.resume(); return; }
    clearTick();
    _initialTimeSpent = fromSec;
    _savedSegmentTotal = 0;
    _segmentAccumulated = 0;
    _segmentStart = Date.now();
    _running = true;
    _paused = false;
    triggerSave("start"); // Notify backend to set timer_started_at=NOW()
    tick();
    startAutoSave();
    notify();
  },

  pause() {
    if (!_running) return;
    clearTick();
    _segmentAccumulated += Math.floor((Date.now() - _segmentStart) / 1000);
    _segmentStart = 0;
    _paused = true;
    _running = false;
    clearAutoSave();
    triggerSave("pause"); // Save on pause
    notify();
  },

  resume() {
    if (_running) return;
    if (!_paused) return;
    clearTick();
    _segmentStart = Date.now();
    _running = true;
    _paused = false;
    tick();
    startAutoSave();
    triggerSave("resume"); // Notify backend to set timer_started_at=NOW()
    notify();
  },

  // endSegmentAndContinue: save current segment to backend, immediately start a new segment
  // Use case: user clicks "结束本段" — saves current segment, starts a fresh segment timer
  // IMPORTANT: "stop" must complete before "start" on the backend, otherwise the new segment's
  // timer_started_at would be set before the old one is cleared, causing the race condition.
  // Returns the segment duration that was just saved (in seconds)
  async endSegmentAndContinue(): Promise<number> {
    if (!_running && !_paused) return 0;
    const segmentDuration = getSegmentSeconds();
    // Add this segment to the saved total
    _savedSegmentTotal += segmentDuration;
    // Save current segment to backend (time_spent += segment, timer_started_at = NULL)
    // Await to ensure "stop" completes before "start" — avoids race condition where
    // "start" executes first (no-op since timer_started_at is still set) then "stop" clears it,
    // leaving the new segment without an active timer_started_at.
    try { await triggerSave("stop"); } catch { /* ignore save errors, continue starting new segment */ }
    // Immediately start a new segment (backend sets timer_started_at = NOW())
    try { await triggerSave("start"); } catch { /* ignore */ }
    // Reset segment tracker
    _segmentAccumulated = 0;
    _segmentStart = Date.now();
    _running = true;
    _paused = false;
    clearTick();
    tick();
    startAutoSave();
    notify();
    return segmentDuration;
  },

  // stop: fully stop the timer and clear the task
  // Returns the total time (initial + all segments including current)
  stop(): number {
    if (!_running && !_paused && _initialTimeSpent === 0 && _savedSegmentTotal === 0 && _segmentStart === 0 && _segmentAccumulated === 0) return 0;
    clearTick();
    clearAutoSave();
    triggerSave("stop"); // Save on stop
    const total = getTotalSeconds();
    _segmentAccumulated = 0;
    _segmentStart = 0;
    _initialTimeSpent = 0;
    _savedSegmentTotal = 0;
    _running = false;
    _paused = false;
    _taskId = null;
    _taskTitle = "";
    notify();
    return total;
  },

  setTask(id: number, title: string) { _taskId = id; _taskTitle = title; notify(); },

  setSaveCallback(fn: ((taskId: number, action: "pause" | "stop" | "autosave" | "resume" | "start") => void) | null) { _onSave = fn; },

  subscribe(fn: Listener) {
    _listeners.add(fn);
    return () => { _listeners.delete(fn); };
  },
};
