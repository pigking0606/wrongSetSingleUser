// Global timer state — persists across page navigation in Next.js client-side routing
type Listener = () => void;

let _elapsed = 0;
let _running = false;
let _paused = false;
let _startTime = 0;
let _accumulated = 0;
let _autoSaveInterval: ReturnType<typeof setInterval> | null = null;
const _listeners = new Set<Listener>();

// Save callback — set by the page that owns the timer lifecycle
let _onSave: ((taskId: number, action: "pause" | "stop" | "autosave" | "resume") => void) | null = null;

function notify() {
  _listeners.forEach(fn => fn());
}

function getCurrentSeconds(): number {
  return _accumulated + (_startTime ? Math.floor((Date.now() - _startTime) / 1000) : 0);
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

function triggerSave(action: "pause" | "stop" | "autosave" | "resume") {
  if (_taskId !== null && _onSave) {
    _onSave(_taskId, action);
  }
}

// Which task is currently being timed (persists across navigation)
let _taskId: number | null = null;
let _taskTitle = "";

// Timer tick using recursive setTimeout to prevent callback stacking
let _tickTimeout: ReturnType<typeof setTimeout> | null = null;

function tick() {
  if (!_running) return;
  _elapsed = Math.floor((Date.now() - _startTime) / 1000) + _accumulated;
  notify();
  _tickTimeout = setTimeout(tick, 200);
}

function clearTick() {
  if (_tickTimeout) { clearTimeout(_tickTimeout); _tickTimeout = null; }
}

export const globalTimer = {
  get elapsed() { return _elapsed; },
  get running() { return _running; },
  get paused() { return _paused; },
  get taskId() { return _taskId; },
  get taskTitle() { return _taskTitle; },

  start(fromSec = 0) {
    // Guard against double-start
    if (_running) return;
    if (_paused) { this.resume(); return; }
    clearTick();
    _startTime = Date.now();
    _accumulated = fromSec;
    _elapsed = fromSec;
    _running = true;
    _paused = false;
    tick();
    startAutoSave();
  },

  pause() {
    if (!_running) return;
    clearTick();
    _accumulated += Math.floor((Date.now() - _startTime) / 1000);
    _elapsed = _accumulated;
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
    _startTime = Date.now();
    _running = true;
    _paused = false;
    tick();
    startAutoSave();
    triggerSave("resume"); // Notify backend to set timer_started_at=NOW() — without this, stop() computes TIMESTAMPDIFF(NULL, NOW())=NULL and time_spent is lost
  },

  stop(): number {
    // Guard against double-stop: if timer is already stopped, return 0
    if (!_running && !_paused && _accumulated === 0 && _startTime === 0) return 0;
    clearTick();
    clearAutoSave();
    triggerSave("stop"); // Save on stop
    const total = _accumulated + (_startTime ? Math.floor((Date.now() - _startTime) / 1000) : 0);
    _elapsed = 0;
    _running = false;
    _paused = false;
    _accumulated = 0;
    _startTime = 0;
    _taskId = null;
    _taskTitle = "";
    notify();
    return total;
  },

  setTask(id: number, title: string) { _taskId = id; _taskTitle = title; notify(); },

  setSaveCallback(fn: ((taskId: number, action: "pause" | "stop" | "autosave" | "resume") => void) | null) { _onSave = fn; },

  subscribe(fn: Listener) {
    _listeners.add(fn);
    return () => { _listeners.delete(fn); };
  },
};
