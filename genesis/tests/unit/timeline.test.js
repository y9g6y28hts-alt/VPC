import test from 'node:test';
import assert from 'node:assert/strict';
import { CONSTRUCTION_STAGES, ConstructionTimeline, stageIndexAt } from '../../js/core/timeline.js';
import { windowProgress, easeInOutCubic, damp } from '../../js/core/easing.js';

test('stages are ordered, well formed and cover the whole clock', () => {
  assert.equal(CONSTRUCTION_STAGES[0].start, 0);
  assert.equal(CONSTRUCTION_STAGES.at(-1).end, 1);
  for (let i = 0; i < CONSTRUCTION_STAGES.length; i++) {
    const s = CONSTRUCTION_STAGES[i];
    assert.ok(s.start < s.end, `${s.id} has positive length`);
    if (i > 0) {
      const prev = CONSTRUCTION_STAGES[i - 1];
      assert.ok(s.start >= prev.start, 'sorted by start');
      assert.ok(s.start <= prev.end, `no gap between ${prev.id} and ${s.id}`);
    }
  }
  assert.equal(new Set(CONSTRUCTION_STAGES.map((s) => s.id)).size, CONSTRUCTION_STAGES.length);
});

test('stageIndexAt returns the latest stage that has started', () => {
  assert.equal(stageIndexAt(0), 0);
  assert.equal(CONSTRUCTION_STAGES[stageIndexAt(0.15)].id, 'foundation');
  assert.equal(CONSTRUCTION_STAGES[stageIndexAt(0.41)].id, 'masonry');
  assert.equal(CONSTRUCTION_STAGES[stageIndexAt(1)].id, 'complete');
});

test('timeline advances only while playing and completes exactly once', () => {
  let completions = 0;
  const changes = [];
  const tl = new ConstructionTimeline({ duration: 10, onComplete: () => completions++, onStageChange: (s) => changes.push(s.id) });
  tl.update(5);
  assert.equal(tl.progress, 0, 'not playing yet');
  tl.play();
  tl.update(2.5);
  assert.equal(tl.progress, 0.25);
  assert.equal(tl.stage.id, 'structure');
  tl.pause();
  tl.update(3);
  assert.equal(tl.progress, 0.25, 'paused');
  tl.play();
  tl.update(100);
  assert.equal(tl.progress, 1);
  assert.equal(tl.playing, false);
  tl.update(1);
  assert.equal(completions, 1);
  // A single large step reports the stage it lands in, not the ones it skipped.
  assert.deepEqual(changes, ['structure', 'complete']);
});

test('restart and seek re-arm completion', () => {
  let completions = 0;
  const tl = new ConstructionTimeline({ duration: 4, onComplete: () => completions++ });
  tl.skipToEnd();
  assert.equal(completions, 1);
  tl.restart();
  assert.equal(tl.progress, 0);
  assert.equal(tl.playing, true);
  tl.update(4);
  assert.equal(completions, 2);
  tl.seek(0.5);
  assert.equal(tl.complete, false);
  tl.seekStage('openings');
  assert.equal(tl.progress, CONSTRUCTION_STAGES.find((s) => s.id === 'openings').start);
  tl.seek(5);
  assert.equal(tl.progress, 1, 'seek clamps');
  assert.equal(completions, 3);
});

test('timeline rejects non-positive durations', () => {
  assert.throws(() => new ConstructionTimeline({ duration: 0 }), RangeError);
});

test('windowProgress clamps and eases', () => {
  assert.equal(windowProgress(0.1, 0.2, 0.4), 0);
  assert.equal(windowProgress(0.5, 0.2, 0.4), 1);
  assert.ok(Math.abs(windowProgress(0.3, 0.2, 0.4) - 0.5) < 1e-9);
  assert.ok(Math.abs(windowProgress(0.3, 0.2, 0.4, easeInOutCubic) - 0.5) < 1e-9);
  assert.equal(windowProgress(0.5, 0.5, 0.5), 1, 'zero-length window is a step');
});

test('damp is frame-rate independent', () => {
  const twoHalfSteps = 1 - (1 - damp(0.3, 0.05)) ** 2;
  assert.ok(Math.abs(twoHalfSteps - damp(0.3, 0.1)) < 1e-12);
});
