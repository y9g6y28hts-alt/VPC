// Construction timeline: one continuous normalised clock (0..1) shared by every
// animated component of the residence. Stages are labels over that clock; they
// overlap slightly, as trades do on a real site.
import { clamp } from './easing.js';

export const CONSTRUCTION_STAGES = Object.freeze([
  { id: 'site', label: 'Terreno y replanteo', start: 0.0, end: 0.1 },
  { id: 'foundation', label: 'Fundaciones', start: 0.1, end: 0.22 },
  { id: 'structure', label: 'Estructura metálica', start: 0.22, end: 0.44 },
  { id: 'masonry', label: 'Mampostería y volúmenes', start: 0.4, end: 0.56 },
  { id: 'envelope', label: 'Fachadas y cubierta', start: 0.56, end: 0.71 },
  { id: 'openings', label: 'Aberturas y detalles', start: 0.7, end: 0.82 },
  { id: 'landscape', label: 'Paisajismo y exteriores', start: 0.82, end: 0.94 },
  { id: 'complete', label: 'Residencia terminada', start: 0.94, end: 1.0 },
]);

export const DEFAULT_DURATION_S = 26;

/** Index of the stage that is "current" at t: the last stage that has started. */
export function stageIndexAt(t, stages = CONSTRUCTION_STAGES) {
  let index = 0;
  for (let i = 0; i < stages.length; i++) {
    if (t >= stages[i].start) index = i;
  }
  return index;
}

export class ConstructionTimeline {
  /**
   * @param {{ duration?: number, stages?: typeof CONSTRUCTION_STAGES,
   *           onComplete?: () => void, onStageChange?: (stage: object, index: number) => void }} options
   */
  constructor({ duration = DEFAULT_DURATION_S, stages = CONSTRUCTION_STAGES, onComplete, onStageChange } = {}) {
    if (!(duration > 0)) throw new RangeError('duration must be positive');
    this.duration = duration;
    this.stages = stages;
    this.onComplete = onComplete;
    this.onStageChange = onStageChange;
    this.progress = 0;
    this.playing = false;
    this._completed = false;
    this._stageIndex = 0;
  }

  get stageIndex() {
    return this._stageIndex;
  }

  get stage() {
    return this.stages[this._stageIndex];
  }

  get complete() {
    return this.progress >= 1;
  }

  play() {
    if (this.complete) return;
    this.playing = true;
  }

  pause() {
    this.playing = false;
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
    return this.playing;
  }

  restart({ autoplay = true } = {}) {
    this._completed = false;
    this._setProgress(0);
    this.playing = autoplay;
  }

  /** Jump to a normalised position. Seeking back re-arms the completion callback. */
  seek(p) {
    const next = clamp(p);
    if (next < 1) this._completed = false;
    this._setProgress(next);
    if (next >= 1) this._finish();
  }

  /** Jump to the start of a stage by id or index. */
  seekStage(idOrIndex) {
    const index = typeof idOrIndex === 'number' ? idOrIndex : this.stages.findIndex((s) => s.id === idOrIndex);
    if (index < 0 || index >= this.stages.length) return;
    this.seek(this.stages[index].start);
  }

  skipToEnd() {
    this.seek(1);
  }

  /** Advance by dt seconds of wall time. Returns the current progress. */
  update(dt) {
    if (!this.playing || this.complete) return this.progress;
    this._setProgress(Math.min(1, this.progress + dt / this.duration));
    if (this.progress >= 1) this._finish();
    return this.progress;
  }

  _setProgress(p) {
    this.progress = p;
    const index = stageIndexAt(p, this.stages);
    if (index !== this._stageIndex) {
      this._stageIndex = index;
      this.onStageChange?.(this.stages[index], index);
    }
  }

  _finish() {
    this.playing = false;
    if (!this._completed) {
      this._completed = true;
      this.onComplete?.();
    }
  }
}
