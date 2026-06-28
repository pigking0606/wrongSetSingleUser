// Global timer state — persists across page navigation in Next.js client-side routing
type Listener = () => void;

let _elapsed = 0;
let _running = false;
let _paused = false;
let _startTime = 0;
let _accumulated = 0;
let _interval: ReturnType<typeof setInterval> | null = null;
let _autoSaveInterval: ReturnType<typeof setInterval> | null = null;
const _listeners = new Set<Listener>();

// Save callback — set by the page that owns the timer lifecycle
let _onSave: ((taskId: number, seconds: number) => void) | null = null;

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
      const sec = getCurrentSeconds();
      _onSave(_taskId, sec);
    }
  }, 300000); // 5 minutes
}

function triggerSave() {
  if (_taskId !== null && _onSave) {
    const sec = getCurrentSeconds();
    _onSave(_taskId, sec);
  }
}

// Which task is currently being timed (persists across navigation)
let _taskId: number | null = null;
let _taskTitle = "";

export const globalTimer = {
  get elapsed() { return _elapsed; },
  get running() { return _running; },
  get paused() { return _paused; },
  get taskId() { return _taskId; },
  get taskTitle() { return _taskTitle; },

  start(fromSec = 0) {
    if (_interval) clearInterval(_interval);
    _startTime = Date.now();
    _accumulated = fromSec;
    _elapsed = fromSec;
    _running = true;
    _paused = false;
    _interval = setInterval(() => {
      _elapsed = Math.floor((Date.now() - _startTime) / 1000) + _accumulated;
      notify();
    }, 200);
    startAutoSave();
  },

  pause() {
    if (_interval) clearInterval(_interval);
    _interval = null;
    _accumulated += Math.floor((Date.now() - _startTime) / 1000);
    _elapsed = _accumulated;
    _paused = true;
    _running = false;
    clearAutoSave();
    triggerSave(); // Save on pause
    notify();
  },

  resume() {
    if (_interval) clearInterval(_interval);
    _startTime = Date.now();
    _running = true;
    _paused = false;
    _interval = setInterval(() => {
      _elapsed = Math.floor((Date.now() - _startTime) / 1000) + _accumulated;
      notify();
    }, 200);
    startAutoSave();
  },

  stop(): number {
    // Guard against double-stop: if timer is already stopped, return 0
    if (!_running && !_paused && _accumulated === 0 && _startTime === 0) return 0;
    if (_interval) clearInterval(_interval);
    _interval = null;
    clearAutoSave();
    triggerSave(); // Save on stop
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

  setSaveCallback(fn: ((taskId: number, seconds: number) => void) | null) { _onSave = fn; },

  subscribe(fn: Listener) {
    _listeners.add(fn);
    return () => { _listeners.delete(fn); };
  },
};
