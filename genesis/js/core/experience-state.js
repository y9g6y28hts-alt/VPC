// State machine for the lot → construction → reveal flow. Pure and synchronous so
// it can be tested without WebGL; the 3D layer subscribes and reacts to changes.

export const State = Object.freeze({
  LOADING: 'loading',
  OVERVIEW: 'overview',
  APPROACHING: 'approaching',
  BUILDING: 'building',
  COMPLETE: 'complete',
  EXPLORING: 'exploring',
  RETURNING: 'returning',
  FALLBACK: 'fallback',
});

export const Event = Object.freeze({
  READY: 'READY',
  FAIL: 'FAIL',
  SELECT: 'SELECT',
  ARRIVED: 'ARRIVED',
  BUILD_COMPLETE: 'BUILD_COMPLETE',
  SKIP: 'SKIP',
  REPLAY: 'REPLAY',
  EXPLORE: 'EXPLORE',
  PAUSE: 'PAUSE',
  RESUME: 'RESUME',
  EXIT: 'EXIT',
  RETURNED: 'RETURNED',
});

const S = State;
const E = Event;

// state -> event -> next state. Events not listed for a state are ignored.
const TABLE = {
  [S.LOADING]: { [E.READY]: S.OVERVIEW, [E.FAIL]: S.FALLBACK },
  [S.OVERVIEW]: { [E.SELECT]: S.APPROACHING, [E.FAIL]: S.FALLBACK },
  [S.APPROACHING]: { [E.SELECT]: S.APPROACHING, [E.ARRIVED]: S.BUILDING, [E.EXIT]: S.RETURNING, [E.FAIL]: S.FALLBACK },
  [S.BUILDING]: {
    [E.BUILD_COMPLETE]: S.COMPLETE,
    [E.SKIP]: S.COMPLETE,
    [E.REPLAY]: S.BUILDING,
    [E.PAUSE]: S.BUILDING,
    [E.RESUME]: S.BUILDING,
    [E.EXIT]: S.RETURNING,
    [E.FAIL]: S.FALLBACK,
  },
  [S.COMPLETE]: { [E.EXPLORE]: S.EXPLORING, [E.REPLAY]: S.BUILDING, [E.SELECT]: S.APPROACHING, [E.EXIT]: S.RETURNING, [E.FAIL]: S.FALLBACK },
  [S.EXPLORING]: { [E.REPLAY]: S.BUILDING, [E.SELECT]: S.APPROACHING, [E.EXIT]: S.RETURNING, [E.FAIL]: S.FALLBACK },
  [S.RETURNING]: { [E.RETURNED]: S.OVERVIEW, [E.SELECT]: S.APPROACHING, [E.FAIL]: S.FALLBACK },
  [S.FALLBACK]: { [E.SELECT]: S.FALLBACK, [E.EXIT]: S.FALLBACK },
};

export function initialContext() {
  return { lotId: null, paused: false, builds: 0 };
}

/**
 * Pure transition. Returns null when the event does not apply to the state.
 * @param {string} state
 * @param {{ type: string, lotId?: string }} event
 * @param {ReturnType<typeof initialContext>} context
 */
export function transition(state, event, context) {
  const next = TABLE[state]?.[event.type];
  if (!next) return null;
  const ctx = { ...context };

  switch (event.type) {
    case E.SELECT:
      if (!event.lotId) return null;
      ctx.lotId = event.lotId;
      ctx.paused = false;
      break;
    case E.ARRIVED:
    case E.REPLAY:
      ctx.paused = false;
      ctx.builds += 1;
      break;
    case E.PAUSE:
      if (ctx.paused) return null;
      ctx.paused = true;
      break;
    case E.RESUME:
      if (!ctx.paused) return null;
      ctx.paused = false;
      break;
    case E.SKIP:
    case E.BUILD_COMPLETE:
    case E.EXIT:
      ctx.paused = false;
      break;
    default:
      break;
  }
  return { state: next, context: ctx };
}

export class ExperienceMachine {
  constructor(initial = S.LOADING) {
    this.state = initial;
    this.context = initialContext();
    this._listeners = new Set();
  }

  /** Dispatch an event; returns true when it changed the machine. */
  send(type, payload = {}) {
    const result = transition(this.state, { type, ...payload }, this.context);
    if (!result) return false;
    const previous = this.state;
    this.state = result.state;
    this.context = result.context;
    for (const fn of this._listeners) fn(this.state, previous, { type, ...payload }, this.context);
    return true;
  }

  can(type) {
    return Boolean(TABLE[this.state]?.[type]);
  }

  /** Subscribe to transitions; returns an unsubscribe function. */
  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }
}
