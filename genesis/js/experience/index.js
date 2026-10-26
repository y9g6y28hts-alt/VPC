// Viva Lago Country — interactive architectural experience.
//
// createExperience() builds the scene inside a container and returns a small
// API used by the DOM layer (js/explorer.js). It never touches page UI itself;
// it reports state, loading progress, construction stages and hover targets
// through callbacks.
import * as THREE from 'three';
import { ExperienceMachine, State, Event } from '../core/experience-state.js';
import { ConstructionTimeline, CONSTRUCTION_STAGES, DEFAULT_DURATION_S } from '../core/timeline.js';
import { windowProgress, easeInOutSine } from '../core/easing.js';
import { LOTS, findLot } from '../data/viva-lago.js';
import { AssetLibrary } from './assets.js';
import { detectTier, tierSettings } from './quality.js';
import { SceneRenderer, isWebGL2Available } from './renderer.js';
import { Environment } from './world/environment.js';
import { TerrainModel, buildTerrain, buildRoads, buildLake, createTerrainMaterial } from './world/terrain.js';
import { LotLayer } from './world/lots.js';
import { Vegetation } from './world/vegetation.js';
import { createMaterials, disposeMaterials } from './materials.js';
import { buildResidence, installGlassGlow } from './house/residence.js';
import { ConstructionAnimator } from './house/construction.js';
import { CameraDirector, OVERVIEW_POSE, lotShots, sunnySide, lotPoint } from './camera-director.js';

export class WebGLUnavailableError extends Error {
  constructor() {
    super('WebGL 2 is not available on this device.');
    this.name = 'WebGLUnavailableError';
  }
}

/**
 * @param {HTMLElement} container
 * @param {{
 *   onState?: (state: string, ctx: object) => void,
 *   onProgress?: (fraction: number, label: string) => void,
 *   onStage?: (stage: object, index: number, progress: number) => void,
 *   onHover?: (lot: object|null, screen: {x:number,y:number}|null) => void,
 *   onError?: (error: Error, info?: { fatal?: boolean }) => void,
 *   reducedMotion?: boolean,
 *   tier?: 'high'|'low',
 *   duration?: number,
 * }} options
 */
export async function createExperience(container, options = {}) {
  if (!isWebGL2Available()) throw new WebGLUnavailableError();
  const settings = tierSettings(detectTier({ force: options.tier }));
  const reducedMotion = Boolean(options.reducedMotion);
  const emit = (name, ...args) => {
    try {
      options[name]?.(...args);
    } catch (err) {
      console.error(err);
    }
  };

  const machine = new ExperienceMachine();
  const sceneRenderer = new SceneRenderer(container, settings);
  const renderer = sceneRenderer.renderer;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.5, 6000);
  sceneRenderer.attach(scene, camera);

  let disposed = false;
  let contextLost = false;
  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    contextLost = true;
    emit('onError', new Error('El contexto gráfico se perdió.'), { fatal: true });
  });

  // ---------------------------------------------------------------- loading
  const stagesWeight = { assets: 0.55, world: 0.15, vegetation: 0.25, house: 0.05 };
  const report = (phase, f, label) => {
    const order = ['assets', 'world', 'vegetation', 'house'];
    let base = 0;
    for (const p of order) {
      if (p === phase) break;
      base += stagesWeight[p];
    }
    emit('onProgress', Math.min(1, base + stagesWeight[phase] * f), label);
  };

  const assets = new AssetLibrary(renderer);
  await assets.load((f) => report('assets', f, 'Texturas y luz'));
  if (disposed) return null;
  if (assets.failures.length) console.warn('Assets that failed to load:', assets.failures);

  report('world', 0, 'Terreno');
  const env = new Environment(scene, renderer, assets, settings);
  const materials = createMaterials(assets);
  installGlassGlow(materials.glass);
  const terrainModel = new TerrainModel();
  const terrain = buildTerrain(terrainModel, assets, { segments: settings.tier === 'high' ? 380 : 260 });
  scene.add(terrain);
  const roads = buildRoads(terrainModel, assets, materials);
  scene.add(roads);
  const lake = buildLake(terrainModel, assets, env);
  scene.add(lake);
  const lots = new LotLayer(LOTS, materials, {
    groundMaterial: createTerrainMaterial(assets, { shared: terrain.material.userData.uniforms, lotTint: true }),
  });
  scene.add(lots.group);
  report('world', 1, 'Terreno');

  const vegetation = new Vegetation({ assets, renderer, settings, terrain: terrainModel, lots: LOTS, lake });
  await vegetation.build((f) => report('vegetation', f, 'Vegetación'));
  scene.add(vegetation.group);
  if (disposed) return null;

  report('house', 0, 'Residencia');
  const residence = buildResidence(materials, vegetation.plantKit(), { lawnDetail: settings.grassDetail });
  residence.group.visible = false;
  scene.add(residence.group);
  const animator = new ConstructionAnimator(residence, materials);
  const terrainUniforms = terrain.material.userData.uniforms;
  report('house', 1, 'Listo');

  // ---------------------------------------------------------------- camera
  const director = new CameraDirector(camera, renderer.domElement, { reducedMotion });
  let currentShots = null;
  let currentLot = null;

  // ---------------------------------------------------------------- timeline
  const timeline = new ConstructionTimeline({
    duration: options.duration || DEFAULT_DURATION_S,
    onStageChange: (stage, index) => emit('onStage', stage, index, timeline.progress),
    onComplete: () => {
      if (machine.state === State.BUILDING) machine.send(Event.BUILD_COMPLETE);
    },
  });

  function applyConstruction(t) {
    animator.apply(t);
    terrainUniforms.uSiteSoil.value = windowProgress(t, 0.0, 0.07, easeInOutSine);
    terrainUniforms.uSiteLawn.value = windowProgress(t, 0.84, 0.92, easeInOutSine);
    terrainUniforms.uHoleActive.value = t >= 0.165 ? 1 : 0;
    director.setDollyProgress(t);
  }

  function placeResidence(lot) {
    const g = residence.group;
    g.position.set(lot.frame.origin.x, 0, lot.frame.origin.z);
    g.rotation.set(0, lot.frame.rotationY, 0);
    residence.fitToLot(lot.houseScale);
    g.visible = true;
    terrainUniforms.uSiteOrigin.value.set(lot.frame.origin.x, lot.frame.origin.z);
    terrainUniforms.uSiteRight.value.set(lot.frame.right.x, lot.frame.right.z);
    terrainUniforms.uSiteIn.value.set(lot.frame.inward.x, lot.frame.inward.z);
    terrainUniforms.uSiteHalfWidthDepth.value.set(lot.frontage / 2 - 0.25, lot.depth - 0.25);
    const h = residence.terrainHole;
    const k = lot.houseScale;
    terrainUniforms.uHole.value.set(h.x0 * k.x, h.x1 * k.x, h.d0 * k.z, h.d1 * k.z);
  }

  // ---------------------------------------------------------------- state reactions
  machine.subscribe((state, previous, event, ctx) => {
    emit('onState', state, { ...ctx, lot: ctx.lotId ? findLot(ctx.lotId) : null, previous, event: event.type, stage: timeline.stage, stageIndex: timeline.stageIndex });
    invalidate(2);
  });

  async function beginApproach(lot) {
    currentLot = lot;
    lots.setSelected(lot.id);
    lots.setHover(null);
    placeResidence(lot);
    timeline.restart({ autoplay: false });
    applyConstruction(0);
    const aspect = sceneRenderer.width / sceneRenderer.height;
    currentShots = lotShots(lot, sunnySide(lot, env.sunDir), aspect);
    env.fitShadows(new THREE.Vector3(lot.centroid.x, 0, lot.centroid.z), 48);
    director.setMode('cinematic');
    director.userControl = false;
    const landed = await director.flyTo(currentShots.arrival, { duration: 3.6, arc: 0.12 });
    if (machine.state !== State.APPROACHING || currentLot !== lot) return;
    if (!landed) director.setMode('lot', { center: currentShots.orbitTarget });
    machine.send(Event.ARRIVED);
  }

  function startBuilding() {
    timeline.restart({ autoplay: true });
    lots.setSiteActive(true);
    // The slow construction dolly only runs if the visitor hasn't taken the camera.
    if (!director.userControl) director.startDolly(currentShots.buildStart, currentShots.buildEnd);
  }

  machine.subscribe((state, previous, event) => {
    if (state === State.APPROACHING && event.type === Event.SELECT) {
      beginApproach(findLot(machine.context.lotId));
    }
    if (state === State.BUILDING && (event.type === Event.ARRIVED || event.type === Event.REPLAY)) {
      if (event.type === Event.REPLAY) {
        director.userControl = false; // a replay restores the directed camera
        timeline.restart({ autoplay: false });
        applyConstruction(0);
        director.setMode('cinematic');
        director.flyTo(currentShots.buildStart, { duration: reducedMotion ? 0 : 1.8, arc: 0.04 }).then(() => {
          if (machine.state === State.BUILDING) startBuilding();
        });
      } else {
        startBuilding();
      }
    }
    if (event.type === Event.PAUSE) timeline.pause();
    if (event.type === Event.RESUME) timeline.play();
    if (state === State.COMPLETE) {
      if (event.type === Event.SKIP) timeline.skipToEnd();
      applyConstruction(1);
      // Final reveal: a restrained move to an eye-level three-quarter view.
      director.setMode('cinematic');
      director.flyTo(currentShots.hero, { duration: 5.2, arc: 0.02, ease: easeInOutSine }).then((landed) => {
        if (!landed || machine.state !== State.COMPLETE) return;
        director.setMode('lot', { center: currentShots.orbitTarget });
        machine.send(Event.EXPLORE);
      });
    }
    if (state === State.RETURNING) {
      timeline.pause();
      if (timeline.progress < 1) {
        // Leave the concept finished on its lot rather than as a half-built shell.
        timeline.skipToEnd();
        applyConstruction(1);
      }
      lots.setSiteActive(false);
      director.setMode('cinematic');
      env.fitShadows(new THREE.Vector3(18, 0, 0), 200);
      director.flyTo(OVERVIEW_POSE, { duration: 3.4, arc: 0.1 }).then(() => {
        if (machine.state === State.RETURNING) machine.send(Event.RETURNED);
      });
    }
    if (state === State.OVERVIEW) director.setMode('overview');
  });

  director.onInterrupt = () => {
    // The user grabbed the camera: hand over control without breaking the flow.
    if (machine.state === State.APPROACHING) {
      director.setMode('lot', { center: currentShots.orbitTarget });
      machine.send(Event.ARRIVED);
    } else if ([State.BUILDING, State.COMPLETE, State.EXPLORING].includes(machine.state)) {
      director.setMode('lot', { center: currentShots.orbitTarget });
      if (machine.state === State.COMPLETE) machine.send(Event.EXPLORE);
    } else if (machine.state === State.RETURNING) {
      director.setMode('overview');
      machine.send(Event.RETURNED);
    }
  };

  // ---------------------------------------------------------------- input
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let down = null;
  let hoverId = null;
  const canSelect = () => [State.OVERVIEW, State.APPROACHING, State.COMPLETE, State.EXPLORING, State.RETURNING].includes(machine.state);

  function pickAt(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    return lots.pick(raycaster);
  }

  function onPointerDown(e) {
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
    invalidate(1);
  }
  function onPointerUp(e) {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = performance.now() - down.t < 450;
    down = null;
    if (moved > 6 || !quick || !canSelect()) return;
    const id = pickAt(e.clientX, e.clientY);
    if (id && id !== machine.context.lotId) api.select(id);
    else if (id && id === machine.context.lotId && machine.state === State.OVERVIEW) api.select(id);
  }
  let hoverQueued = false;
  function onPointerMove(e) {
    invalidate(0.5);
    if (e.pointerType === 'touch' || hoverQueued) return;
    hoverQueued = true;
    requestAnimationFrame(() => {
      hoverQueued = false;
      if (!canSelect() || director.busy) return;
      const id = pickAt(e.clientX, e.clientY);
      if (id !== hoverId) {
        hoverId = id;
        lots.setHover(id);
        renderer.domElement.style.cursor = id ? 'pointer' : '';
        invalidate(0.6);
      }
      const lot = id ? findLot(id) : null;
      emit('onHover', lot, lot ? { x: e.clientX, y: e.clientY } : null);
    });
  }
  function onPointerLeave() {
    hoverId = null;
    lots.setHover(null);
    emit('onHover', null, null);
  }
  const el = renderer.domElement;
  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointerup', onPointerUp);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerleave', onPointerLeave);
  el.addEventListener('wheel', () => invalidate(1), { passive: true });

  // ---------------------------------------------------------------- loop
  let activeUntil = 0;
  let rafId = 0;
  let frozen = false; // capture mode: frames only render on explicit request
  let last = performance.now();
  let elapsed = 0;
  const slowFrames = [];
  const viewDir = new THREE.Vector3();

  function invalidate(seconds = 0.5) {
    activeUntil = Math.max(activeUntil, performance.now() + seconds * 1000);
    if (!rafId && !disposed && !frozen) {
      last = performance.now();
      rafId = requestAnimationFrame(frame);
    }
  }

  let halted = false; // set after an unrecoverable error inside the loop

  function frame(now) {
    rafId = 0;
    if (disposed || contextLost || halted) return;
    try {
      tick(now);
    } catch (err) {
      // Never leave a frozen canvas behind: report it so the UI can fall back.
      console.error(err);
      halted = true;
      emit('onError', err, { fatal: true });
    }
  }

  function tick(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    elapsed += dt;

    if (machine.state === State.BUILDING && timeline.playing) {
      timeline.update(dt);
      applyConstruction(timeline.progress);
      emit('onStage', timeline.stage, timeline.stageIndex, timeline.progress);
    }
    const moving = director.update(dt);
    updateView(dt);
    sceneRenderer.render();
    adaptResolution(dt);

    const busy = moving || director.busy || (machine.state === State.BUILDING && timeline.playing);
    if (busy) activeUntil = Math.max(activeUntil, now + 300);
    if (now < activeUntil) rafId = requestAnimationFrame(frame);
  }

  /** Per-frame view-dependent state: haze colour, boundary emphasis, water. */
  function updateView(dt) {
    camera.getWorldDirection(viewDir);
    env.updateFog(viewDir);
    lots.update(dt);
    lake.userData.tick(elapsed);
    if (materials.water.normalMap) materials.water.normalMap.offset.set(elapsed * 0.01, elapsed * 0.006);
    // Boundaries recede when the camera is close to a house.
    const dist = camera.position.distanceTo(director.controls.target);
    lots.setEmphasis(THREE.MathUtils.clamp((dist - 40) / 80, 0, 1));
  }

  function adaptResolution(dt) {
    // Drop the pixel ratio if frames stay slow for a while (never below 1).
    slowFrames.push(dt);
    if (slowFrames.length > 90) slowFrames.shift();
    if (slowFrames.length === 90) {
      const avg = slowFrames.reduce((a, b) => a + b, 0) / slowFrames.length;
      if (avg > 1 / 32 && sceneRenderer.pixelRatio > 1) {
        sceneRenderer.setPixelRatio(Math.max(1, sceneRenderer.pixelRatio - 0.25));
        lots.setResolution(sceneRenderer.width, sceneRenderer.height);
        slowFrames.length = 0;
      }
    }
  }

  // ---------------------------------------------------------------- resize
  function resize() {
    const r = container.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    sceneRenderer.setSize(r.width, r.height);
    director.fitLens(r.width / r.height);
    lots.setResolution(r.width, r.height);
    if (currentLot) currentShots = lotShots(currentLot, sunnySide(currentLot, env.sunDir), r.width / r.height);
    invalidate(0.3);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  const onVisibility = () => {
    if (document.hidden && machine.state === State.BUILDING && timeline.playing) {
      // Keep the clock honest while the tab is hidden.
      last = performance.now();
    } else if (!document.hidden) {
      last = performance.now();
      invalidate(0.5);
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  // ---------------------------------------------------------------- API
  const api = {
    machine,
    get state() {
      return machine.state;
    },
    get lot() {
      return machine.context.lotId ? findLot(machine.context.lotId) : null;
    },
    get progress() {
      return timeline.progress;
    },
    get playing() {
      return timeline.playing;
    },
    stages: CONSTRUCTION_STAGES,
    tier: settings.tier,
    assetFailures: assets.failures,
    select(lotId) {
      if (!findLot(lotId)) return false;
      const ok = machine.send(Event.SELECT, { lotId });
      invalidate(1);
      return ok;
    },
    exit() {
      return machine.send(Event.EXIT);
    },
    replay() {
      return machine.send(Event.REPLAY);
    },
    pause() {
      return machine.send(Event.PAUSE);
    },
    resume() {
      const ok = machine.send(Event.RESUME);
      invalidate(1);
      return ok;
    },
    togglePause() {
      return machine.context.paused ? api.resume() : api.pause();
    },
    skip() {
      return machine.send(Event.SKIP);
    },
    seek(p) {
      if (machine.state !== State.BUILDING) return false;
      timeline.seek(p);
      applyConstruction(timeline.progress);
      emit('onStage', timeline.stage, timeline.stageIndex, timeline.progress);
      invalidate(0.5);
      return true;
    },
    seekStage(index) {
      return api.seek(CONSTRUCTION_STAGES[index]?.start ?? 0);
    },
    view(name) {
      if (!currentShots || ![State.COMPLETE, State.EXPLORING].includes(machine.state)) return false;
      const pose = currentShots[name];
      if (!pose) return false;
      director.setMode('cinematic');
      director.userControl = false;
      director.flyTo(pose, { duration: 2.8, arc: name === 'aerial' ? 0.15 : 0.05 }).then((landed) => {
        if (landed) director.setMode('lot', { center: currentShots.orbitTarget });
      });
      if (machine.state === State.COMPLETE) machine.send(Event.EXPLORE);
      invalidate(1);
      return true;
    },
    invalidate,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(rafId);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerleave', onPointerLeave);
      director.dispose();
      animator.dispose();
      residence.dispose();
      vegetation.dispose();
      lots.dispose();
      scene.traverse((o) => {
        if (o.isMesh && o !== terrain) {
          // Geometries owned by world builders; materials disposed below.
          o.geometry?.dispose();
        }
      });
      terrain.geometry.dispose();
      terrain.material.dispose();
      lake.material.normalMap?.dispose();
      lake.material.dispose();
      disposeMaterials(materials);
      env.dispose();
      assets.dispose();
      sceneRenderer.dispose();
    },
  };

  // Hooks for automated visual checks and render capture (no UI exposure).
  api.debug = {
    setProgress(t) {
      timeline.pause();
      timeline.seek(t);
      applyConstruction(t);
      invalidate(0.2);
    },
    setCamera(position, target) {
      director.stop();
      camera.position.set(...position);
      director.controls.target.set(...target);
      camera.lookAt(director.controls.target);
      director.controls.update();
      return true;
    },
    /** Place the camera in the selected lot's design space (x, y, d). */
    setLotCamera(x, y, d, tx, ty, td) {
      const lot = currentLot;
      if (!lot) return false;
      const side = sunnySide(lot, env.sunDir);
      const p = lotPoint(lot, x * side, y, d);
      const t = lotPoint(lot, tx * side, ty, td);
      return api.debug.setCamera(p.toArray(), t.toArray());
    },
    setPose(name) {
      const pose = name === 'overview' ? OVERVIEW_POSE : currentShots?.[name];
      if (!pose) return false;
      director.stop();
      camera.position.copy(pose.position);
      director.controls.target.copy(pose.target);
      camera.lookAt(pose.target);
      director.controls.update();
      invalidate(0.2);
      return true;
    },
    renderNow() {
      director.update(0);
      updateView(1);
      sceneRenderer.render();
      // Block until the GPU has finished (lets capture tools time real frame cost).
      const gl = renderer.getContext();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    },
    /** Stop the frame loop so automated captures render one frame at a time. */
    freeze(on = true) {
      frozen = on;
      if (on) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      } else invalidate(1);
    },
    /** Advance the simulation by dt seconds without rendering (capture mode). */
    step(dt) {
      if (machine.state === State.BUILDING && timeline.playing) {
        timeline.update(dt);
        applyConstruction(timeline.progress);
      }
      director.update(dt);
    },
    /** Triangle budget per top-level group (instanced meshes count every instance). */
    sceneStats() {
      const stats = {};
      for (const child of scene.children) {
        let tris = 0;
        child.traverse((o) => {
          if (!o.isMesh || !o.geometry) return;
          const g = o.geometry;
          const n = (g.index ? g.index.count : g.attributes.position?.count || 0) / 3;
          tris += n * (o.isInstancedMesh ? o.count : 1);
        });
        const key = child.name || child.type;
        stats[key] = (stats[key] || 0) + Math.round(tris);
      }
      const veg = {};
      for (const m of vegetation.group.children) {
        const g = m.geometry;
        const n = (g.index ? g.index.count : g.attributes.position.count) / 3;
        veg[`${m.material.map ? 'tex' : 'col'}-${Math.round(n)}x${m.count}`] = Math.round(n * m.count);
      }
      return { stats, veg };
    },
    info() {
      return {
        camera: camera.position.toArray().map((v) => +v.toFixed(2)),
        target: director.controls.target.toArray().map((v) => +v.toFixed(2)),
        fov: +camera.fov.toFixed(1),
        state: machine.state, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries };
    },
    get timeline() {
      return timeline;
    },
    /** Average colour of the baked impostor textures (development aid). */
    impostorStats() {
      return (vegetation.impostors || []).map((imp) => {
        const rt = imp.target;
        const buf = new Uint16Array(rt.width * rt.height * 4);
        renderer.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, buf);
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < buf.length; i += 4) {
          const a = THREE.DataUtils.fromHalfFloat(buf[i + 3]);
          if (a > 0.4) {
            r += THREE.DataUtils.fromHalfFloat(buf[i]);
            g += THREE.DataUtils.fromHalfFloat(buf[i + 1]);
            b += THREE.DataUtils.fromHalfFloat(buf[i + 2]);
            n++;
          }
        }
        return { covered: n, r: +(r / n).toFixed(3), g: +(g / n).toFixed(3), b: +(b / n).toFixed(3) };
      });
    },
    /** Toggle shadow casting live (development aid). */
    setShadows(on) {
      env.sun.castShadow = on;
      renderer.shadowMap.needsUpdate = true;
      return true;
    },
    /** Tune ambient occlusion live (development aid). */
    setAO(blend, params) {
      if (!sceneRenderer.gtao) return false;
      if (blend != null) sceneRenderer.gtao.blendIntensity = blend;
      if (params) sceneRenderer.gtao.updateGtaoMaterial(params);
      return true;
    },
  };

  machine.send(Event.READY);
  invalidate(1.5);
  return api;
}

export { LOTS, State };
