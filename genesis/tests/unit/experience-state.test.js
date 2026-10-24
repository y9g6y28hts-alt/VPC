import test from 'node:test';
import assert from 'node:assert/strict';
import { ExperienceMachine, State, Event, transition, initialContext } from '../../js/core/experience-state.js';

function ready() {
  const m = new ExperienceMachine();
  assert.ok(m.send(Event.READY));
  return m;
}

test('happy path: select → approach → build → complete → explore keeps the lot', () => {
  const m = ready();
  assert.equal(m.state, State.OVERVIEW);
  assert.ok(m.send(Event.SELECT, { lotId: 'A-03' }));
  assert.equal(m.state, State.APPROACHING);
  assert.ok(m.send(Event.ARRIVED));
  assert.equal(m.state, State.BUILDING);
  assert.equal(m.context.builds, 1);
  assert.ok(m.send(Event.BUILD_COMPLETE));
  assert.equal(m.state, State.COMPLETE);
  assert.ok(m.send(Event.EXPLORE));
  assert.equal(m.state, State.EXPLORING);
  assert.equal(m.context.lotId, 'A-03');
});

test('selection requires a lot id and can retarget during the approach', () => {
  const m = ready();
  assert.equal(m.send(Event.SELECT), false);
  m.send(Event.SELECT, { lotId: 'A-01' });
  assert.ok(m.send(Event.SELECT, { lotId: 'B-02' }));
  assert.equal(m.state, State.APPROACHING);
  assert.equal(m.context.lotId, 'B-02');
});

test('lots cannot be re-selected mid-construction (prevents accidental restarts)', () => {
  const m = ready();
  m.send(Event.SELECT, { lotId: 'A-01' });
  m.send(Event.ARRIVED);
  assert.equal(m.send(Event.SELECT, { lotId: 'A-02' }), false);
  assert.equal(m.context.lotId, 'A-01');
});

test('pause/resume only toggle while building and replay clears pause', () => {
  const m = ready();
  m.send(Event.SELECT, { lotId: 'C-04' });
  assert.equal(m.send(Event.PAUSE), false, 'not building yet');
  m.send(Event.ARRIVED);
  assert.ok(m.send(Event.PAUSE));
  assert.equal(m.context.paused, true);
  assert.equal(m.send(Event.PAUSE), false, 'already paused');
  assert.ok(m.send(Event.REPLAY));
  assert.equal(m.context.paused, false);
  assert.equal(m.context.builds, 2);
  assert.ok(m.send(Event.PAUSE));
  assert.ok(m.send(Event.RESUME));
  assert.equal(m.send(Event.RESUME), false);
});

test('skip completes immediately; replay from complete or exploring rebuilds', () => {
  const m = ready();
  m.send(Event.SELECT, { lotId: 'D-01' });
  m.send(Event.ARRIVED);
  assert.ok(m.send(Event.SKIP));
  assert.equal(m.state, State.COMPLETE);
  assert.ok(m.send(Event.REPLAY));
  assert.equal(m.state, State.BUILDING);
  m.send(Event.SKIP);
  m.send(Event.EXPLORE);
  assert.ok(m.send(Event.REPLAY));
  assert.equal(m.state, State.BUILDING);
});

test('exit from any lot state returns to the overview with the lot remembered', () => {
  for (const steps of [[], [Event.ARRIVED], [Event.ARRIVED, Event.SKIP], [Event.ARRIVED, Event.SKIP, Event.EXPLORE]]) {
    const m = ready();
    m.send(Event.SELECT, { lotId: 'B-05' });
    for (const s of steps) m.send(s);
    assert.ok(m.send(Event.EXIT), `exit after ${steps.join(',') || 'approach'}`);
    assert.equal(m.state, State.RETURNING);
    assert.ok(m.send(Event.RETURNED));
    assert.equal(m.state, State.OVERVIEW);
    assert.equal(m.context.lotId, 'B-05');
  }
});

test('selecting a different lot after completion starts a new approach', () => {
  const m = ready();
  m.send(Event.SELECT, { lotId: 'A-01' });
  m.send(Event.ARRIVED);
  m.send(Event.SKIP);
  assert.ok(m.send(Event.SELECT, { lotId: 'A-02' }));
  assert.equal(m.state, State.APPROACHING);
  assert.equal(m.context.lotId, 'A-02');
});

test('failures route to the fallback, which still accepts selections', () => {
  const m = new ExperienceMachine();
  assert.ok(m.send(Event.FAIL));
  assert.equal(m.state, State.FALLBACK);
  assert.ok(m.send(Event.SELECT, { lotId: 'A-09' }));
  assert.equal(m.state, State.FALLBACK);
  assert.equal(m.context.lotId, 'A-09');
});

test('subscribers receive transitions and can unsubscribe', () => {
  const m = new ExperienceMachine();
  const seen = [];
  const off = m.subscribe((state, prev) => seen.push(`${prev}->${state}`));
  m.send(Event.READY);
  off();
  m.send(Event.SELECT, { lotId: 'A-01' });
  assert.deepEqual(seen, ['loading->overview']);
});

test('pure transition ignores unknown events and never mutates the input context', () => {
  const ctx = initialContext();
  assert.equal(transition(State.OVERVIEW, { type: 'NOPE' }, ctx), null);
  const r = transition(State.OVERVIEW, { type: Event.SELECT, lotId: 'X' }, ctx);
  assert.equal(r.context.lotId, 'X');
  assert.equal(ctx.lotId, null);
});
