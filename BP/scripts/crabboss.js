import { world, system } from "@minecraft/server";
import * as MC from "@minecraft/server";

export const BOSS_ID = "yashh:crab_boss";
const PROP = "yashh:boss_attack";
const DIMS = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"];

const BOSS_HP = 160, BOSS_RESERVE = 200;
const DIE_ANIM_TICKS = 36;
const DIE_HOLD_TICKS = 60;
const DIE_TICKS = DIE_ANIM_TICKS + DIE_HOLD_TICKS;
const FOLLOW_RANGE = 50;

const CHASE_SPEED = 0.2;
const TURN_SPEED = 12;
const STOP_DISTANCE = 3.0;
const HALF_W = 2.5;
const BODY_ROWS = 3;
const BODY_H = 2.5;
const EPS = 0.001;
const GRAVITY = 0.08, DRAG = 0.98;
const FALL_MAX = 0.9;
const JUMP_MAX = 2.0;
const JUMP_MARGIN = 0.35;
const UNSTICK_RISE = 0.6;
const FLOAT_DEPTH = 1.5;
const SWIM_SPEED = 0.16;
const SWIM_RISE = 0.12, SWIM_SINK = 0.10;
const SWIM_EXIT_MAX = 4.2;
const SWIM_RISE_EXIT = 0.35;
const CLIMB_SPEED = 0.45;
const COLL_HALF = 1.5;
const UNSTICK_TICKS = 30;
const MOUNT_TICKS = 16;
const STUCK_WINDOW = 40;
const STUCK_MIN_MOVE = 1.2;
const FAR_WINDOW = 120;
const DETOUR_TICKS = 30;
const TELEPORT_MAX_R = 9;
const BLOCK_TTL = 10;
const SPAWN_IDLE_TICKS = 2;
const WALK_HOLD_TICKS = 10;
const STEP_INTERVAL = 14;

const TRIGGER_RANGE = 4.8;
const HEAVY_THRESHOLDS = [0.5, 0.3, 0.1];
const ATTACK_COOLDOWN_MIN = 25, ATTACK_COOLDOWN_MAX = 45;
const WANDER_MIN_TICKS = 0, WANDER_MAX_TICKS = 0;
const BAR_VIEW_RANGE = 64;
const ATTACKS = {
  1: { ticks: 20, weight: 50 },
  2: { ticks: 44, weight: 30 },
  3: { ticks: 42, weight: 8 },
  4: { ticks: 100, weight: 12 },
};
const CHAIN_GAP_TICKS = 4;

const A1 = { range: 6.5, dmg: 2, hitTicks: [8, 16], minDot: 0.0 };
const A2 = { range: HALF_W + 5.0, dmg: 10, hitTick: 33, minDot: 0.0 };
const A3 = { range: 7.0, dmg: 10, hitTick: 38 };
const A4 = { reach: 5.6, minDot: 0.3, dmgEvery: 20, dmg: 2, releaseHits: 3 };

const LAUNCH_BACK = 5.0, LAUNCH_UP = 3.5;
const LAUNCH_TICKS = 22;

const GRAB_FORWARD = 3.4, GRAB_SIDE = -1.0, GRAB_Y = 0.9;

const SOUND_ON = true, SHAKE_ON = true;
const SHAKE_RADIUS = 30;

const bosses = new Map();
const grabbed = new Map();
const wet = new Map();

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
function ok(e) { try { return !!e && e.isValid; } catch (err) { return false; } }
function hpShown(e) {
  try {
    const h = e.getComponent("minecraft:health");
    if (!h) return BOSS_HP;
    return Math.max(0, Math.min(BOSS_HP, h.currentValue - BOSS_RESERVE));
  } catch (err) { return BOSS_HP; }
}
function hpFrac(e) { return hpShown(e) / BOSS_HP; }
function alive(p) {
  try { const h = p.getComponent("minecraft:health"); return !h || h.currentValue > 0; } catch (err) { return false; }
}
function targetable(p) {
  try {
    const gm = p.getGameMode();
    return alive(p) && (gm === MC.GameMode.Survival || gm === MC.GameMode.Adventure);
  } catch (err) { return false; }
}
const ANIM_NAMES = { 0: "idle", 1: "attack1", 2: "attack2", 3: "attack3", 4: "attack4", 5: "walk", 6: "die" };
let warned = false, propBroken = false;

function setProp(e, v) {
  try {
    e.setProperty(PROP, v);
    if (e.getProperty(PROP) !== v) {
      propBroken = true;
      if (!warned) { warned = true; world.sendMessage("\u00a7c[boss] animation property did not change (wanted " + v + ", game says " + e.getProperty(PROP) + ")"); }
    }
  } catch (err) {
    propBroken = true;
    if (!warned) { warned = true; try { world.sendMessage("\u00a7c[boss] animation property error: " + err); } catch (e2) {  } }
  }
  try { e.triggerEvent("yashh:anim_" + v); } catch (err) {  }
  try {
    if (v === 6) e.runCommand('playanimation @s animation.yashh_crab_boss.die default 0 "0"');
    else if (propBroken) e.runCommand("playanimation @s animation.yashh_crab_boss." + (ANIM_NAMES[v] || "idle"));
  } catch (err) {  }
}
function root(e, ticks) { try { e.addEffect("slowness", Math.max(2, ticks), { amplifier: 255, showParticles: false }); } catch (err) {  } }
function unroot(e) { try { e.removeEffect("slowness"); } catch (err) {  } }
function face(e, loc) {
  try { e.teleport(e.location, { facingLocation: { x: loc.x, y: e.location.y, z: loc.z } }); } catch (err) {  }
}
function forward(e) {
  let yaw = 0;
  try { yaw = e.getRotation().y * Math.PI / 180; } catch (err) {  }
  return { x: -Math.sin(yaw), z: Math.cos(yaw) };
}
function playersNear(e, radius, maxDy) {
  if (maxDy === undefined) maxDy = 8;
  const out = [];
  let l;
  try { l = e.location; } catch (err) { return out; }
  for (const p of world.getAllPlayers()) {
    try {
      if (p.dimension.id !== e.dimension.id || !targetable(p)) continue;
      const pl = p.location;
      if (Math.abs(pl.y - l.y) > maxDy) continue;
      const dx = pl.x - l.x, dz = pl.z - l.z, d = Math.hypot(dx, dz);
      if (d <= radius) out.push({ p, d, dx, dz });
    } catch (err) {  }
  }
  out.sort((a, b) => a.d - b.d);
  return out;
}

function inFront(n, f, minDot) {
  if (n.d <= HALF_W + 0.5) return true;
  return (n.dx * f.x + n.dz * f.z) / Math.max(n.d, 0.01) >= minDot;
}

function hurt(p, amount, boss) {
  let peaceful = false;
  try { peaceful = world.getDifficulty() === MC.Difficulty.Peaceful; } catch (err) {  }
  try {
    if (peaceful) p.applyDamage(amount, { cause: MC.EntityDamageCause.override });
    else p.applyDamage(amount, { cause: MC.EntityDamageCause.entityAttack, damagingEntity: boss });
  } catch (e1) {
    try { p.applyDamage(amount); } catch (e2) {  }
  }
}
function hitFront(boss, radius, dmg, minDot) {
  const f = forward(boss);
  let any = false;
  for (const n of playersNear(boss, radius)) {
    if (!inFront(n, f, minDot)) continue;
    hurt(n.p, dmg, boss);
    any = true;
  }
  return any;
}

function fmt(v) { return (Math.round(v * 100) / 100).toString(); }

function sfx(e, id, vol, pitch, at) {
  if (!SOUND_ON) return;
  try {
    const l = at || e.location;
    e.dimension.runCommand("playsound " + id + " @a " + fmt(l.x) + " " + fmt(l.y) + " " + fmt(l.z) + " " + fmt(vol) + " " + fmt(pitch));
  } catch (err) {  }
}

function shake(e, intensity, secs, radius, type) {
  if (!SHAKE_ON) return;
  let l, dimId;
  try { l = e.location; dimId = e.dimension.id; } catch (err) { return; }
  for (const p of world.getAllPlayers()) {
    try {
      if (p.dimension.id !== dimId) continue;
      const pl = p.location;
      const d = Math.hypot(pl.x - l.x, pl.y - l.y, pl.z - l.z);
      if (d > radius) continue;
      const k = intensity * (1 - 0.65 * d / radius);
      if (k < 0.02) continue;
      p.runCommand("camerashake add @s " + fmt(k) + " " + fmt(secs) + " " + (type || "positional"));
    } catch (err) {  }
  }
}
function shakeOne(p, intensity, secs, type) {
  if (!SHAKE_ON) return;
  try { p.runCommand("camerashake add @s " + fmt(intensity) + " " + fmt(secs) + " " + (type || "positional")); } catch (err) {  }
}
function dust(e, id) {
  try { e.dimension.spawnParticle(id, e.location); } catch (err) {  }
}

function bigShake(e, k) {
  shake(e, 1.25 * k, 0.5, SHAKE_RADIUS);
  shake(e, 0.35 * k, 0.9, SHAKE_RADIUS, "rotational");
  system.runTimeout(() => { if (ok(e)) shake(e, 0.7 * k, 0.5, SHAKE_RADIUS); }, 8);
  system.runTimeout(() => { if (ok(e)) shake(e, 0.3 * k, 0.6, SHAKE_RADIUS); }, 17);
}

const flights = new Map();
function clearAt(dim, x, y, z) {
  try {
    return passable(dim.getBlock({ x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) })) &&
           passable(dim.getBlock({ x: Math.floor(x), y: Math.floor(y) + 1, z: Math.floor(z) }));
  } catch (err) { return false; }
}
function launchPlayer(p, dx, dz, back, up) {
  let start, dim;
  try { start = p.location; dim = p.dimension; } catch (err) { return; }
  const tok = (flights.get(p.id) || 0) + 1;
  flights.set(p.id, tok);
  let px = start.x, py = start.y, pz = start.z, t = 0;
  const run = system.runInterval(() => {
    try {
      if (flights.get(p.id) !== tok || !p.isValid || !alive(p) || p.dimension.id !== dim.id) { system.clearRun(run); return; }
      t++;
      const s = Math.min(1, t / LAUNCH_TICKS);
      const k = 1 - (1 - s) * (1 - s);
      const nx = start.x + dx * back * k, nz = start.z + dz * back * k;
      const ny = start.y + 4 * up * s * (1 - s);
      let tx = px, tz = pz, ty = py, moved = false;
      if (clearAt(dim, nx, ny, nz)) { tx = nx; tz = nz; ty = ny; moved = true; }
      else if (clearAt(dim, px, ny, pz)) { ty = ny; moved = true; }
      else if (clearAt(dim, nx, py, nz)) { tx = nx; tz = nz; moved = true; }
      if (moved) {
        try { p.teleport({ x: tx, y: ty, z: tz }, { keepVelocity: false }); } catch (err) { system.clearRun(run); return; }
        px = tx; py = ty; pz = tz;
      }
      if (s >= 1 || (!moved && t > 3)) { system.clearRun(run); if (flights.get(p.id) === tok) flights.delete(p.id); }
    } catch (err) { system.clearRun(run); }
  }, 1);
}
function slam(boss) {
  const f = forward(boss);
  for (const n of playersNear(boss, A3.range)) {
    hurt(n.p, A3.dmg, boss);
    if (!alive(n.p)) continue;
    let dx = n.dx, dz = n.dz, d = n.d;
    if (d < 0.2) { dx = f.x; dz = f.z; d = 1; }
    launchPlayer(n.p, dx / d, dz / d, LAUNCH_BACK, LAUNCH_UP);
    shakeOne(n.p, 1.4, 0.8, "rotational");
  }
  sfx(boss, "random.explode", 3.5, 0.55);
  sfx(boss, "random.anvil_land", 3.0, 0.5);
  sfx(boss, "mob.ravager.stun", 2.5, 0.5);
  dust(boss, "minecraft:huge_explosion_emitter");
  bigShake(boss, 1.0);
}

function grabPoint(e) {
  const l = e.location, f = forward(e);

  return { x: l.x + f.x * GRAB_FORWARD + (-f.z) * GRAB_SIDE, y: l.y + GRAB_Y, z: l.z + f.z * GRAB_FORWARD + f.x * GRAB_SIDE };
}

const PLANT_IDS = new Set([
  "short_grass", "tall_grass", "tallgrass", "fern", "large_fern", "double_plant", "short_dry_grass", "tall_dry_grass", "deadbush", "dead_bush",
  "seagrass", "tall_seagrass", "kelp", "sea_pickle", "vine", "weeping_vines", "twisting_vines", "cave_vines", "cave_vines_head_with_berries",
  "cave_vines_body_with_berries", "glow_lichen", "hanging_roots", "spore_blossom", "pink_petals", "wildflowers", "leaf_litter", "bush", "firefly_bush",
  "sweet_berry_bush", "dandelion", "poppy", "blue_orchid", "allium", "azure_bluet", "red_tulip", "orange_tulip", "white_tulip", "pink_tulip",
  "oxeye_daisy", "cornflower", "lily_of_the_valley", "wither_rose", "torchflower", "sunflower", "lilac", "rose_bush", "peony", "pitcher_plant",
  "open_eyeblossom", "closed_eyeblossom", "red_flower", "yellow_flower", "brown_mushroom", "red_mushroom", "crimson_roots", "warped_roots",
  "nether_sprouts", "crimson_fungus", "warped_fungus", "wheat", "carrots", "potatoes", "beetroot", "melon_stem", "pumpkin_stem", "reeds", "bamboo_sapling",
  "snow_layer", "web", "redstone_wire", "tripwire", "tripwire_hook", "lever", "flower_pot", "waterlily", "fire", "soul_fire", "moss_carpet",
  "pale_moss_carpet", "pale_hanging_moss", "light_block", "structure_void", "frog_spawn", "sculk_vein", "resin_clump", "cocoa", "torchflower_crop",
]);
const SOFT_SUFFIX = ["_sapling", "_torch", "torch", "_button", "_pressure_plate", "_rail", "rail", "_carpet", "carpet", "_sign", "_banner", "_candle",
  "candle", "_tulip", "_vines", "_roots", "_sprouts", "_coral_fan", "coral_fan", "_wall_fan"];
const BARRIER_SUFFIX = ["fence", "fence_gate", "_wall", "iron_bars", "glass_pane", "_pane"];
function passable(b) {
  if (!b) return false;
  if (b.isAir || b.isLiquid) return true;
  let id = "";
  try { id = b.typeId || ""; } catch (err) {  }
  if (id.startsWith("minecraft:")) id = id.slice(10);
  if (PLANT_IDS.has(id)) return true;
  for (const t of SOFT_SUFFIX) if (id.endsWith(t)) return true;
  for (const t of BARRIER_SUFFIX) if (id.endsWith(t)) return false;
  return b.isSolid === false;
}

function safeGrabPoint(e) {
  const gp = grabPoint(e), l = e.location, dim = e.dimension;
  const free = (x, y, z) => {
    try {
      return passable(dim.getBlock({ x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) })) &&
             passable(dim.getBlock({ x: Math.floor(x), y: Math.floor(y) + 1, z: Math.floor(z) }));
    } catch (err) { return false; }
  };
  for (const t of [0, 0.25, 0.5, 0.75]) {
    const x = gp.x + (l.x - gp.x) * t, z = gp.z + (l.z - gp.z) * t;
    for (const up of [0, 1, 2]) if (free(x, gp.y + up, z)) return { x, y: gp.y + up, z };
  }
  return null;
}

function register(e) {
  if (!ok(e) || bosses.has(e.id)) return;
  const now = system.currentTick;
  const st = { e, phase: "spawn", until: now + SPAWN_IDLE_TICKS, fired: new Set(), pending: 0, grab: null, token: 0,
               walking: false, tgt: null, blocked: 0, wdir: null,
               lastAtk: 0, steerSide: 0, sideUntil: 0, cool: 0, lastMove: -99, walkSince: 0, stepTick: 0, vy: 0, grounded: false, swimming: false, diveY: undefined, bc: new Map(), bcT: 0, lastHurtSfx: 0 };
  const f = hpFrac(e);
  for (const th of HEAVY_THRESHOLDS) if (f <= th) st.fired.add(th);
  bosses.set(e.id, st);
  st.walking = true; st.walkSince = now; st.lastMove = now;
  setProp(e, 5);
  root(e, SPAWN_IDLE_TICKS + 4);
  let fresh = false;
  try { fresh = !e.getDynamicProperty("yashh:seen"); e.setDynamicProperty("yashh:seen", true); } catch (err) {  }
  if (fresh) {
    sfx(e, "mob.ravager.roar", 4.0, 0.55);
    shake(e, 0.5, 1.2, SHAKE_RADIUS);
  }
}

function clearSpot(dim, x, y, z) {
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  const r = Math.ceil(HALF_W);
  for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) for (let dy = 0; dy < BODY_ROWS; dy++) {
    const b = dim.getBlock({ x: bx + dx, y: by + dy, z: bz + dz });
    if (!b) return false;
    if (!passable(b)) return false;
  }
  return true;
}
function findSpawnSpot(dim, loc) {
  for (let r = 0; r <= 7; r++) {
    const n = r === 0 ? 1 : 10 + r * 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = loc.x + Math.cos(a) * r, z = loc.z + Math.sin(a) * r;
      try { if (clearSpot(dim, x, loc.y, z)) return { x, y: loc.y, z }; } catch (err) {  }
    }
  }
  return { x: loc.x, y: loc.y, z: loc.z };
}

export function spawnCrabBoss(dimension, loc) {
  try {
    const spot = findSpawnSpot(dimension, loc);
    const e = dimension.spawnEntity(BOSS_ID, spot);
    register(e);
    return e;
  } catch (err) { return undefined; }
}

function toFree(st) {
  const e = st.e;
  unroot(e);
  startWalking(st, system.currentTick);
  st.phase = "free";
}

function startWalking(st, now) {
  st.walking = true; st.walkSince = now; st.stepTick = now + 7; st.lastMove = now;
  setProp(st.e, 5);
}

function endAttack(st, now) {
  const e = st.e;
  unroot(e);
  startWalking(st, now);

  if (st.lastAtk === 1 || st.lastAtk === 2) st.cool = now + CHAIN_GAP_TICKS;
  else st.cool = now + rnd(ATTACK_COOLDOWN_MIN, ATTACK_COOLDOWN_MAX);
  const w = rnd(WANDER_MIN_TICKS, WANDER_MAX_TICKS);
  if (w <= 0) { toFree(st); return; }
  const a = Math.random() * Math.PI * 2;
  st.wdir = { x: Math.cos(a), z: Math.sin(a) };
  st.phase = "wander";
  st.until = now + w;
}

function startAttack(st, n, target) {
  const e = st.e, tok = ++st.token;
  st.lastAtk = n;
  st.walking = false;
  st.phase = "attack";
  st.until = system.currentTick + ATTACKS[n].ticks;
  setProp(e, n);
  root(e, ATTACKS[n].ticks + 6);
  if (target) face(e, target.location);
  const later = (ticks, fn) => system.runTimeout(() => {
    try { if (ok(e) && st.phase === "attack" && st.token === tok) fn(); } catch (err) {  }
  }, ticks);
  const refaceNearest = (range) => { const t = playersNear(e, range)[0]; if (t) face(e, t.p.location); };
  if (n === 1) {
    sfx(e, "mob.ravager.roar", 1.6, 0.9);
    later(4, () => refaceNearest(A1.range));
    for (const t of A1.hitTicks) later(t, () => {
      hitFront(e, A1.range, A1.dmg, A1.minDot);
      sfx(e, "mob.ravager.bite", 2.2, 0.7);
      shake(e, 0.22, 0.25, 16);
    });
  } else if (n === 2) {
    sfx(e, "mob.ravager.roar", 1.8, 0.7);
    later(4, () => refaceNearest(A2.range));
    later(A2.hitTick - 7, () => sfx(e, "mob.irongolem.throw", 2.0, 0.5));
    later(A2.hitTick, () => {
      hitFront(e, A2.range, A2.dmg, A2.minDot);
      sfx(e, "mob.irongolem.hit", 2.5, 0.55);
      shake(e, 0.5, 0.4, 20);
    });
  } else if (n === 3) {
    sfx(e, "mob.ravager.roar", 4.0, 0.5);
    shake(e, 0.25, 0.8, SHAKE_RADIUS, "rotational");
    later(A3.hitTick - 8, () => shake(e, 0.2, 0.5, SHAKE_RADIUS));
    later(A3.hitTick, () => slam(e));
  }
}

function startGrab(st, p) {
  const e = st.e, now = system.currentTick;
  st.lastAtk = 4;
  st.walking = false;
  st.phase = "grab";
  setProp(e, 4);
  root(e, ATTACKS[4].ticks + 10);
  face(e, p.location);
  st.grab = { p, pid: p.id, start: now, end: now + ATTACKS[4].ticks, next: now + A4.dmgEvery, hits: 0 };
  grabbed.set(p.id, { start: now, end: null });
  sfx(e, "mob.ravager.stun", 2.5, 0.6);
  shake(e, 0.4, 0.5, 18);
}

function releaseGrab(st, now) {
  const g = st.grab;
  st.grab = null;
  if (g) { const b = grabbed.get(g.pid); if (b) b.end = now; }
  endAttack(st, now);
}

function stepGrab(st, now) {
  const g = st.grab, e = st.e;
  if (!g) { endAttack(st, now); return; }
  let good = false;
  try { good = g.p.isValid && alive(g.p) && g.p.dimension.id === e.dimension.id; } catch (err) { good = false; }
  if (!good) { releaseGrab(st, now); return; }
  try { if (e.getProperty(PROP) !== 4) setProp(e, 4); } catch (err) {  }
  const sp = safeGrabPoint(e);
  if (sp) { try { g.p.teleport(sp, { keepVelocity: false }); } catch (err) {  } }
  if (now >= g.next && g.next <= g.end) {
    g.next += A4.dmgEvery;
    hurt(g.p, A4.dmg, e);
    sfx(e, "mob.irongolem.hit", 2.0, 0.6);
    shakeOne(g.p, 0.5, 0.35);
    shake(e, 0.15, 0.3, 14);
  }
  if (now >= g.end) releaseGrab(st, now);
}

function startDying(st, now) {
  const e = st.e;
  st.token++;
  if (st.grab) { const b = grabbed.get(st.grab.pid); if (b && b.end === null) b.end = now; st.grab = null; }
  st.phase = "dying";
  st.until = now + DIE_TICKS;
  st.walking = false;
  setProp(e, 6);
  root(e, DIE_TICKS + 20);
  try { e.addEffect("resistance", DIE_TICKS + 20, { amplifier: 255, showParticles: false }); } catch (err) {  }
  sfx(e, "mob.ravager.death", 4.0, 0.5);
  shake(e, 0.35, 1.0, SHAKE_RADIUS);
  system.runTimeout(() => {
    if (!ok(e) || st.phase !== "dying") return;
    sfx(e, "random.anvil_land", 3.0, 0.45);
    sfx(e, "mob.irongolem.death", 3.0, 0.5);
    dust(e, "minecraft:large_explosion");
    bigShake(e, 0.9);
  }, 28);
}
function finishDying(st, now) {
  const e = st.e;
  let loc, dim;
  try { loc = e.location; dim = e.dimension; } catch (err) { forget(e.id, st, now); return; }
  try {
    dim.spawnItem(new MC.ItemStack("yashh:boos_meat", 1), { x: loc.x, y: loc.y + 1.5, z: loc.z });
    e.remove();
  } catch (err) {
    try { e.kill(); } catch (err2) {  }
  }
  forget(e.id, st, now);
}

const K_AIR = 0, K_LIQ = 1, K_SOLID = 2;
function blockKind(st, dim, now, bx, by, bz) {
  const key = bx + "," + by + "," + bz;
  const c = st.bc.get(key);
  if (c !== undefined && now - Math.floor(c / 4) < BLOCK_TTL) return c % 4;
  let k = K_SOLID;
  try {
    const b = dim.getBlock({ x: bx, y: by, z: bz });
    if (b) k = b.isLiquid ? K_LIQ : (passable(b) ? K_AIR : K_SOLID);
  } catch (err) { k = K_SOLID; }
  st.bc.set(key, now * 4 + k);
  return k;
}

function boxFree(st, dim, now, x, y, z) {
  const x0 = Math.floor(x - COLL_HALF + EPS), x1 = Math.floor(x + COLL_HALF - EPS);
  const z0 = Math.floor(z - COLL_HALF + EPS), z1 = Math.floor(z + COLL_HALF - EPS);
  const y0 = Math.floor(y + EPS), y1 = Math.floor(y + BODY_H - EPS);
  for (let by = y0; by <= y1; by++) for (let bx = x0; bx <= x1; bx++) for (let bz = z0; bz <= z1; bz++) {
    if (blockKind(st, dim, now, bx, by, bz) === K_SOLID) return false;
  }
  return true;
}

function surfaceY(st, dim, now, x, y, z) {
  let sy = Math.floor(y + 1.0);
  for (let i = 0; i < 24 && blockKind(st, dim, now, Math.floor(x), sy, Math.floor(z)) === K_LIQ; i++) sy++;
  return sy;
}

function floatY(st, dim, now, x, y, z, diveY) {
  const surf = surfaceY(st, dim, now, x, y, z);
  let ty = surf - FLOAT_DEPTH;
  if (diveY !== undefined) ty = Math.min(ty, Math.max(diveY, surf - 12));
  if (boxFree(st, dim, now, x, ty, z)) return ty;
  let w = Math.ceil(ty);
  for (let i = 0; i < 16 && !boxFree(st, dim, now, x, w, z); i++) w++;
  return w;
}

const jumpCache = new Map();
function jumpVy(h) {
  const key = Math.round(h * 20);
  if (jumpCache.has(key)) return jumpCache.get(key);
  let v0 = 0.3;
  for (; v0 < 1.6; v0 += 0.005) {
    let v = v0, y = 0, peak = 0;
    for (let i = 0; i < 80; i++) { v = (v - GRAVITY) * DRAG; if (v <= 0) break; y += v; peak = y; }
    if (peak >= h + JUMP_MARGIN) break;
  }
  jumpCache.set(key, v0);
  return v0;
}
const STEER = [0, 35, -35, 70, -70, 110, -110];
const approach = (v, target, up, down) => (v < target ? Math.min(target, v + up) : Math.max(target, v - down));

function findFreeSpot(st, dim, now, x, y, z, dx, dz) {
  let best = null, bestScore = -1e9;
  for (const r of [1.5, 2.5, 3.5, 5.0]) {
    for (let i = 0; i < 16; i++) {
      const a = i * Math.PI / 8, ox = Math.cos(a) * r, oz = Math.sin(a) * r;
      for (const dy of [0, 1, 2, 3, -1]) {
        const ty = Math.round(y) + dy, tx = x + ox, tz = z + oz;
        if (!boxFree(st, dim, now, tx, ty, tz) || boxFree(st, dim, now, tx, ty - 0.06, tz)) continue;
        const score = (ox * dx + oz * dz) - Math.abs(dy) * 0.6 - r * 0.3;
        if (score > bestScore) { bestScore = score; best = { x: tx, y: ty, z: tz }; }
      }
    }
    if (best) return best;
  }
  return null;
}

function findSpotToward(st, dim, now, x, y, z, tx, tz) {
  const d0 = Math.hypot(tx - x, tz - z);
  let best = null, bestScore = 1e9;
  for (const r of [2.5, 4, 5.5, 7, TELEPORT_MAX_R]) {
    for (let i = 0; i < 24; i++) {
      const a = i * Math.PI / 12, ox = Math.cos(a) * r, oz = Math.sin(a) * r;
      const px = x + ox, pz = z + oz;
      const dn = Math.hypot(tx - px, tz - pz);
      if (dn > d0 - 1.0) continue;
      for (const dy of [0, 1, 2, 3, 4, 5, 6, 7, 8, -1, -2, -3, -4]) {
        const py = Math.round(y) + dy;
        if (!boxFree(st, dim, now, px, py, pz) || boxFree(st, dim, now, px, py - 0.06, pz)) continue;
        const score = dn + Math.abs(dy) * 0.4;
        if (score < bestScore) { bestScore = score; best = { x: px, y: py, z: pz }; }
        break;
      }
    }
    if (best) return best;
  }
  return null;
}

function drive(st, now, dx, dz, speed, lookX, lookZ) {
  const e = st.e;
  let l, dim, yaw = 0;
  try { l = e.location; dim = e.dimension; yaw = e.getRotation().y; } catch (err) { return false; }

  if (speed <= 0 && lookX === undefined && st.grounded && st.vy === 0 && now % 4 !== 0) return false;
  if (now - st.bcT > 100) { st.bc.clear(); st.bcT = now; }
  let x = l.x, y = l.y, z = l.z;
  const free = (px, py, pz) => boxFree(st, dim, now, px, py, pz);
  const put = (nx, ny, nz, nyaw) => {
    if (nx === l.x && ny === l.y && nz === l.z && Math.abs(nyaw - yaw) < 0.4) return;
    try { e.teleport({ x: nx, y: ny, z: nz }, { rotation: { x: 0, y: nyaw }, keepVelocity: false }); } catch (err) {  }
  };
  const turn = (hx, hz, moved) => {
    let want = yaw;
    if (moved) want = Math.atan2(-hx, hz) * 180 / Math.PI;
    else if (lookX !== undefined) want = Math.atan2(-(lookX - x), lookZ - z) * 180 / Math.PI;
    const diff = ((want - yaw + 540) % 360) - 180;
    return yaw + Math.max(-TURN_SPEED, Math.min(TURN_SPEED, diff));
  };

  if (!free(x, y, z)) {
    st.vy = 0; st.grounded = false;
    let up = null;
    for (let d = 0.5; d <= 40; d += 0.5) { if (free(x, y + d, z)) { up = y + d; break; } }
    if (up !== null) put(x, Math.min(up, y + UNSTICK_RISE), z, yaw);
    return false;
  }

  const sd = st.steerSide || 1;
  const order = [0, sd * 35, sd * 70, sd * 110, -sd * 35, -sd * 70, -sd * 110];
  let tries = order.length;
  if (st.blocked > 3 && now % 4 !== 0) tries = 1;
  if (now > st.sideUntil) st.steerSide = 0;
  const pick = (ang) => { if (ang !== 0) { st.steerSide = ang > 0 ? 1 : -1; st.sideUntil = now + 60; } };

  const stepsFor = (ang, sp) => {
    const a = ang * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
    const ux = dx * c - dz * sn, uz = dx * sn + dz * c;
    const out = [[ux, uz, ux * sp, uz * sp]];
    if (ang === 0 && st.steerSide !== 0) return out;
    if (Math.abs(ux) > 0.15) out.push([ux, uz, ux * sp, 0]);
    if (Math.abs(uz) > 0.15) out.push([ux, uz, 0, uz * sp]);
    return out;
  };

  const wetAt = (py) => blockKind(st, dim, now, Math.floor(x), Math.floor(py), Math.floor(z)) === K_LIQ;
  const swimming = wetAt(y + 1.0) || (st.swimming && (wetAt(y + 0.5) || wetAt(y - 0.1)));
  st.swimming = swimming;
  if (swimming) {
    st.vy = 0; st.grounded = false; st.climb = undefined; st.mount = 0;
    const cur = floatY(st, dim, now, x, y, z, st.diveY);
    let nx = x, nz = z, ny = approach(y, cur, SWIM_RISE, SWIM_SINK), moved = false, rising = false, hx = dx, hz = dz;
    if (speed > 0) {
      const sp = Math.min(speed, SWIM_SPEED);
      swimLoop: for (let i = 0; i < tries; i++) {
        const ang = order[i];
        for (const [ux, uz, mx, mz] of stepsFor(ang, sp)) {
          const tx = x + mx, tz = z + mz;
          const ahead = Math.max(floatY(st, dim, now, tx, y, tz, st.diveY),
                                 floatY(st, dim, now, tx + ux * HALF_W, y, tz + uz * HALF_W, st.diveY));
          if (ahead - cur > SWIM_EXIT_MAX) continue;
          const wy = Math.max(cur, ahead), wny = approach(y, wy, (wy - y > 0.6) ? SWIM_RISE_EXIT : SWIM_RISE, SWIM_SINK);
          if (free(tx, wny, tz)) { nx = tx; nz = tz; ny = wny; moved = true; hx = ux; hz = uz; pick(ang); break swimLoop; }
          if (wy > y + 0.01 && free(x, wny, z)) { ny = wny; rising = true; hx = ux; hz = uz; pick(ang); break swimLoop; }
        }
      }
      if (moved || rising) st.blocked = 0; else st.blocked++;
    }
    if (!free(nx, ny, nz)) { ny = y; nx = x; nz = z; moved = false; }
    if (st.blocked >= UNSTICK_TICKS) {
      st.blocked = 0;
      const sp = findFreeSpot(st, dim, now, x, y, z, dx, dz);
      if (sp) { put(sp.x, sp.y, sp.z, turn(dx, dz, true)); st.vy = 0; return true; }
    }
    put(nx, ny, nz, turn(hx, hz, moved));
    return speed > 0 && (moved || rising);
  }

  const grounded = !free(x, y - 0.06, z);
  let jumpTo = null, nx = x, nz = z, hx = dx, hz = dz, walk = false;
  if (speed > 0) {
    landLoop: for (let i = 0; i < tries; i++) {
      const ang = order[i];
      for (const [ux, uz, mx, mz] of stepsFor(ang, speed)) {
        const tx = x + mx, tz = z + mz;
        if (free(tx, y, tz)) { nx = tx; nz = tz; hx = ux; hz = uz; walk = true; pick(ang); break landLoop; }
        if (grounded && mx !== 0 && mz !== 0) {
          const base = Math.ceil(y - EPS);
          for (let k = 0; k <= 2; k++) {
            const ty = base + k, h = ty - y;
            if (h < 0.05 || h > JUMP_MAX + 0.05) continue;
            if (free(tx, ty, tz) && free(x, ty, z)) { jumpTo = ty; hx = ux; hz = uz; break; }
          }
          if (jumpTo !== null) { pick(ang); break landLoop; }
        }
      }
    }
  }

  if (jumpTo !== null) { st.climb = jumpTo; st.mount = 0; }
  let vy = st.vy, ny;
  let climbing = false;
  if (st.climb !== undefined) {
    const top = st.climb;
    const up = Math.min(top, y + CLIMB_SPEED);
    if (up > y + 0.0005 && free(x, up, z)) { ny = up; vy = 0; climbing = true; if (up >= top - 0.0005) { st.climb = undefined; st.mount = MOUNT_TICKS; } }
    else st.climb = undefined;
  }
  if (!climbing) {
    if (st.mount > 0) {
      st.mount--;
      if (grounded || speed <= 0) st.mount = 0;
    }
    if (st.mount > 0) { vy = 0; ny = y; }
    else {
      vy = (vy - GRAVITY) * DRAG;
      if (vy < -FALL_MAX) vy = -FALL_MAX;
      ny = y + vy;
      if (vy > 0) {
        if (!free(x, ny, z)) { vy = 0; ny = y; }
      } else if (!free(x, ny, z)) {
        const land = Math.min(y, Math.floor(ny + EPS) + 1);
        ny = free(x, land, z) ? land : y;
        vy = 0;
      }
    }
  }
  st.vy = vy;
  if (walk && !free(nx, ny, nz)) { nx = x; nz = z; walk = false; }
  const moved = walk && (nx !== x || nz !== z);
  const airborne = jumpTo !== null || climbing || st.mount > 0;
  st.grounded = vy === 0 && jumpTo === null && !climbing && !(st.mount > 0);
  if (speed > 0 && (grounded || st.mount > 0) && !moved && jumpTo === null && !climbing) st.blocked++;
  else if (speed > 0) st.blocked = 0;
  if (st.blocked >= UNSTICK_TICKS) {
    st.blocked = 0;
    const sp = findFreeSpot(st, dim, now, x, y, z, dx, dz);
    if (sp) { put(sp.x, sp.y, sp.z, turn(dx, dz, true)); st.vy = 0; st.climb = undefined; return true; }
  }
  put(nx, ny, nz, turn(hx, hz, moved));
  return speed > 0 && (moved || airborne);
}

function onStuck(st, e, now, l, pl, d, why) {
  const sinceLast = now - (st.stuckAt || -9999);
  st.stuckAt = now;
  if (sinceLast > 200 && why === "move") {
    st.detSide = -(st.detSide || (Math.random() < 0.5 ? 1 : -1));
    const ux = (pl.x - l.x) / d, uz = (pl.z - l.z) / d;
    st.detour = { x: -uz * st.detSide, z: ux * st.detSide, until: now + DETOUR_TICKS };
    st.blocked = 0; st.climb = undefined; st.mount = 0;
    return;
  }
  let sp = null;
  try { sp = findSpotToward(st, e.dimension, now, l.x, l.y, l.z, pl.x, pl.z); } catch (err) { sp = null; }
  if (sp) {
    try { e.teleport(sp, { rotation: { x: 0, y: Math.atan2(-(pl.x - sp.x), pl.z - sp.z) * 180 / Math.PI }, keepVelocity: false }); } catch (err) {  }
    st.vy = 0; st.climb = undefined; st.mount = 0; st.blocked = 0; st.detour = null; st.steerSide = 0;
    st.lastMove = now;
  } else {
    st.detSide = -(st.detSide || 1);
    const ux = (pl.x - l.x) / d, uz = (pl.z - l.z) / d;
    st.detour = { x: -uz * st.detSide, z: ux * st.detSide, until: now + DETOUR_TICKS * 2 };
    st.blocked = 0; st.climb = undefined; st.mount = 0;
  }
}
function watchdog(st, e, now, l, pl, d) {
  if (st.wdT === undefined || now - st.wdT > STUCK_WINDOW * 3) {
    st.wdT = now; st.wdX = l.x; st.wdY = l.y; st.wdZ = l.z; st.wdN = 0;
    st.bestD = d; st.bestT = now; st.bestPx = pl.x; st.bestPz = pl.z;
    return;
  }
  st.wdN++;
  if (now - st.wdT >= STUCK_WINDOW) {
    const moved = Math.hypot(l.x - st.wdX, l.z - st.wdZ) + Math.abs(l.y - st.wdY) * 0.5;
    const trying = st.wdN >= STUCK_WINDOW * 0.9;
    st.wdT = now; st.wdX = l.x; st.wdY = l.y; st.wdZ = l.z; st.wdN = 0;
    if (trying && moved < STUCK_MIN_MOVE) { onStuck(st, e, now, l, pl, d, "move"); return; }
  }

  if (Math.hypot(pl.x - st.bestPx, pl.z - st.bestPz) > 4 || d < st.bestD - 1.0) {
    st.bestD = d; st.bestT = now; st.bestPx = pl.x; st.bestPz = pl.z;
  } else if (now - st.bestT >= FAR_WINDOW && d > STOP_DISTANCE + 2) {
    st.bestD = d; st.bestT = now;
    onStuck(st, e, now, l, pl, d, "far");
  }
}

function chase(st, now) {
  const e = st.e;
  if (now % 5 === 0 || !st.tgt) st.tgt = playersNear(e, FOLLOW_RANGE, 40)[0] || null;
  const t = st.tgt;
  if (!t) { st.diveY = undefined; st.wdT = undefined; wanderWalk(st, now); return; }
  try {
    if (!t.p.isValid || !targetable(t.p) || t.p.dimension.id !== e.dimension.id) { st.tgt = null; st.wdT = undefined; wanderWalk(st, now); return; }
    const l = e.location, pl = t.p.location;
    const dx = pl.x - l.x, dz = pl.z - l.z, d = Math.hypot(dx, dz);
    if (d > FOLLOW_RANGE) { st.tgt = null; st.wdT = undefined; wanderWalk(st, now); return; }
    let wet2 = false; try { wet2 = !!t.p.isInWater; } catch (err2) {  }
    st.diveY = wet2 ? pl.y - 0.3 : undefined;
    if (d <= STOP_DISTANCE) { st.wdT = undefined; orbitWalk(st, now, dx, dz, d, pl); return; }
    st.intent = now;
    watchdog(st, e, now, l, pl, d);
    let ux = dx / d, uz = dz / d;
    if (st.detour) {
      if (now < st.detour.until) { ux = st.detour.x; uz = st.detour.z; } else st.detour = null;
    }
    if (drive(st, now, ux, uz, CHASE_SPEED, pl.x, pl.z)) st.lastMove = now;
  } catch (err) { st.tgt = null; }
}

const WANDER_SPEED = CHASE_SPEED * 0.6;
const ORBIT_SPEED = CHASE_SPEED * 0.45;
const WANDER_TURN_MIN = 50, WANDER_TURN_MAX = 120;

function safeAhead(st, dim, now, x, y, z, ux, uz) {
  const by = Math.round(y);
  for (const r of [2.5, 4.5, 6.5]) {
    const px = x + ux * r, pz = z + uz * r;
    let good = false;
    for (const dy of [0, 1, -1, -2]) {
      const py = by + dy;
      if (!boxFree(st, dim, now, px, py, pz)) continue;
      if (blockKind(st, dim, now, Math.floor(px), py, Math.floor(pz)) === K_LIQ) continue;
      if (blockKind(st, dim, now, Math.floor(px), py - 1, Math.floor(pz)) === K_SOLID) { good = true; break; }
    }
    if (!good) return false;
  }
  return true;
}

function landAhead(st, dim, now, x, y, z, ux, uz) {
  const by = Math.round(y);
  for (const r of [3, 5, 7, 9]) {
    const px = x + ux * r, pz = z + uz * r;
    for (const dy of [0, 1, 2, 3]) {
      const py = by + dy;
      if (boxFree(st, dim, now, px, py, pz) && blockKind(st, dim, now, Math.floor(px), py, Math.floor(pz)) !== K_LIQ
          && blockKind(st, dim, now, Math.floor(px), py - 1, Math.floor(pz)) === K_SOLID) return true;
    }
  }
  return false;
}
function pickWanderDir(st, now) {
  const e = st.e;
  let l, dim; try { l = e.location; dim = e.dimension; } catch (err) { return; }
  const prev = st.rw;
  let chosen = null;
  for (let i = 0; i < 16 && !chosen; i++) {
    const a = Math.random() * Math.PI * 2, ux = Math.cos(a), uz = Math.sin(a);
    const okDir = st.swimming ? landAhead(st, dim, now, l.x, l.y, l.z, ux, uz) : safeAhead(st, dim, now, l.x, l.y, l.z, ux, uz);
    if (okDir) chosen = { x: ux, z: uz };
  }
  if (!chosen) chosen = prev ? { x: -prev.x, z: -prev.z } : { x: 1, z: 0 };
  st.rw = { x: chosen.x, z: chosen.z, until: now + (chosen === prev ? 20 : rnd(WANDER_TURN_MIN, WANDER_TURN_MAX)), safe: true };
  st.blocked = 0;
}
function wanderWalk(st, now) {
  const e = st.e;
  const w = st.rw;
  let danger = false;
  if (w && !st.swimming && now % 5 === 0) {
    try { const l = e.location; danger = !safeAhead(st, e.dimension, now, l.x, l.y, l.z, w.x, w.z); } catch (err) { danger = false; }
  }
  if (!w || now >= w.until || st.blocked > 8 || danger) pickWanderDir(st, now);
  const r = st.rw;
  st.intent = now;
  if (drive(st, now, r.x, r.z, WANDER_SPEED)) st.lastMove = now;
}
function orbitWalk(st, now, dx, dz, d, pl) {
  if (!st.orbSide || now >= (st.orbUntil || 0)) { st.orbSide = Math.random() < 0.5 ? 1 : -1; st.orbUntil = now + rnd(40, 90); }
  if (st.blocked > 6) { st.orbSide = -st.orbSide; st.orbUntil = now + rnd(40, 90); st.blocked = 0; }
  const ux = dx / Math.max(d, 0.01), uz = dz / Math.max(d, 0.01);
  const tx = -uz * st.orbSide, tz = ux * st.orbSide;

  const toward = d > 1.2 ? 0.35 : 0;
  let mx = tx * 0.75 + ux * toward, mz = tz * 0.75 + uz * toward;
  const m = Math.hypot(mx, mz) || 1; mx /= m; mz /= m;
  st.intent = now;
  if (drive(st, now, mx, mz, ORBIT_SPEED, pl.x, pl.z)) st.lastMove = now;
}

function walkFx(st, now) {
  const e = st.e;
  if (st.phase !== "free" && st.phase !== "wander") return;
  try {
    const l = e.location;
    if (st.px !== undefined && Math.abs(l.x - st.px) + Math.abs(l.z - st.pz) + Math.abs(l.y - st.py) > 0.02) st.lastMove = now;
    st.px = l.x; st.py = l.y; st.pz = l.z;
  } catch (err) {  }

  if (!st.walking) startWalking(st, now);
  else if (now % 20 === 0) { try { if (e.getProperty(PROP) !== 5) setProp(e, 5); } catch (err) {  } }
  const moving = (now - st.lastMove <= 5) || (st.intent !== undefined && now - st.intent <= 1);
  if (moving && now >= st.stepTick) {
    st.stepTick = now + STEP_INTERVAL;
    let inW = false; try { inW = !!e.isInWater; } catch (err) {  }
    if (inW) sfx(e, "random.splash", 1.6, 0.55);
    else sfx(e, "mob.ravager.step", 2.0, 0.55);
    shake(e, 0.07, 0.25, 16);
  }
}

function pickAttack(near, f) {
  const opts = [];
  if (near.some((n) => n.d <= A3.range)) opts.push([3, ATTACKS[3].weight]);
  const front = near.find((n) => n.d <= A4.reach && (n.dx * f.x + n.dz * f.z) / Math.max(n.d, 0.01) >= A4.minDot);
  if (front) opts.push([4, ATTACKS[4].weight]);
  if (near.some((n) => n.d <= A2.range && inFront(n, f, A2.minDot))) opts.push([2, ATTACKS[2].weight]);
  if (near.some((n) => n.d <= A1.range && inFront(n, f, A1.minDot))) opts.push([1, ATTACKS[1].weight]);
  if (!opts.length) return { n: 0 };
  let total = 0;
  for (const o of opts) total += o[1];
  let r = Math.random() * total;
  for (const o of opts) { r -= o[1]; if (r <= 0) return { n: o[0], front }; }
  return { n: opts[0][0], front };
}

function decide(st, now) {
  const e = st.e;
  if (st.pending > 0) {
    st.pending--;
    const t = playersNear(e, FOLLOW_RANGE)[0];
    startAttack(st, 3, t ? t.p : undefined);
    return;
  }
  if (now < st.cool) return;
  const near = playersNear(e, 10.5);
  if (!near.length || near[0].d > TRIGGER_RANGE) return;
  const pick = pickAttack(near, forward(e));
  if (pick.n === 4) startGrab(st, pick.front.p);
  else if (pick.n > 0) startAttack(st, pick.n, near[0].p);
}

export function bossKnockback(boss, from, blocks, ticks) {
  try {
    const st = bosses.get(boss.id);
    if (!st || st.phase === "dying" || st.phase === "grab") return false;
    const l = boss.location;
    let dx = l.x - from.x, dz = l.z - from.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return false;
    const n = Math.max(1, ticks | 0);
    st.kb = { dx: dx / len, dz: dz / len, left: n, per: blocks / n };
    return true;
  } catch (err) { return false; }
}
function kbStep(st, now) {
  const kb = st.kb;
  if (!kb || kb.left <= 0 || st.phase === "dying" || st.phase === "grab") { st.kb = null; return; }
  kb.left--;
  try {
    const e = st.e, l = e.location;
    const nx = l.x + kb.dx * kb.per, nz = l.z + kb.dz * kb.per;
    if (boxFree(st, e.dimension, now, nx, l.y, nz)) e.teleport({ x: nx, y: l.y, z: nz }, { keepVelocity: false });
    else st.kb = null;
  } catch (err) { st.kb = null; }
}

function step(st, now) {
  const e = st.e;
  if (st.phase === "dying") { drive(st, now, 0, 0, 0); if (now >= st.until) finishDying(st, now); return; }
  if (hpShown(e) <= 0) { startDying(st, now); return; }
  if (st.kb) kbStep(st, now);
  const f = hpFrac(e);
  for (const th of HEAVY_THRESHOLDS) {
    if (!st.fired.has(th) && f <= th) { st.fired.add(th); st.pending++; }
  }
  if (st.phase === "spawn") { drive(st, now, 0, 0, 0); if (now >= st.until) toFree(st); return; }
  if (st.phase === "grab") { drive(st, now, 0, 0, 0); stepGrab(st, now); return; }
  if (st.phase === "attack") { drive(st, now, 0, 0, 0); if (now >= st.until) endAttack(st, now); return; }
  if (st.phase === "wander") {
    if (now >= st.until) { toFree(st); return; }
    if (st.wdir) { if (drive(st, now, st.wdir.x, st.wdir.z, CHASE_SPEED * 0.8)) st.lastMove = now; } else drive(st, now, 0, 0, 0);
    walkFx(st, now);
    return;
  }
  chase(st, now);
  walkFx(st, now);
  if (now % 2 === 0) decide(st, now);
}

function forget(id, st, now) {
  if (st && st.grab) { const b = grabbed.get(st.grab.pid); if (b && b.end === null) b.end = now; st.grab = null; }
  bosses.delete(id);
}

function sweep() {
  for (const id of DIMS) {
    try {
      for (const e of world.getDimension(id).getEntities({ type: BOSS_ID })) register(e);
    } catch (err) {  }
  }
}

system.runInterval(() => {
  const now = system.currentTick;
  if (now % 20 === 0) sweep();
  if (!bosses.size) return;
  for (const [id, st] of [...bosses.entries()]) {
    try {
      if (!ok(st.e)) { forget(id, st, now); continue; }
      step(st, now);
    } catch (err) {  }
  }
}, 1);

world.afterEvents.entitySpawn.subscribe((ev) => {
  try { if (ev.entity && ev.entity.typeId === BOSS_ID) register(ev.entity); } catch (err) {  }
});
world.afterEvents.entityDie.subscribe((ev) => {
  try {
    const e = ev.deadEntity;
    if (!e || e.typeId !== BOSS_ID) return;
    forget(e.id, bosses.get(e.id), system.currentTick);
  } catch (err) {  }
});

function hitSparks(e, attacker) {
  try {
    const b = e.location;
    let x = b.x, y = b.y + 2.0, z = b.z;
    if (attacker && attacker.location) {
      const a = attacker.location;
      const dx = a.x - b.x, dz = a.z - b.z, d = Math.hypot(dx, dz) || 1;
      const reach = Math.min(d, HALF_W + 0.3);
      x = b.x + (dx / d) * reach; z = b.z + (dz / d) * reach;
      y = Math.max(b.y + 0.5, a.y + 1.4);
    }
    const dim = e.dimension;
    dim.spawnParticle("minecraft:critical_hit_emitter", { x, y, z });
    for (let i = 0; i < 4; i++) {
      dim.spawnParticle("minecraft:blue_flame_particle", { x: x + (Math.random() - 0.5) * 0.9, y: y + (Math.random() - 0.5) * 0.7, z: z + (Math.random() - 0.5) * 0.9 });
    }
  } catch (err) {  }
}

if (world.afterEvents.entityHurt) {
  world.afterEvents.entityHurt.subscribe((ev) => {
    try {
      const e = ev.hurtEntity;
      if (!e || e.typeId !== BOSS_ID) return;
      hitSparks(e, ev.damageSource ? ev.damageSource.damagingEntity : undefined);
      const st = bosses.get(e.id), now = system.currentTick;
      if (!st || st.phase === "dying" || now - st.lastHurtSfx < 12) return;
      st.lastHurtSfx = now;
      sfx(e, "mob.ravager.hurt", 2.0, 0.6);
    } catch (err) {  }
  });
}
world.afterEvents.playerLeave.subscribe((ev) => { grabbed.delete(ev.playerId); wet.delete(ev.playerId); });

if (world.afterEvents.entityHitEntity) {
  world.afterEvents.entityHitEntity.subscribe((ev) => {
    try {
      const boss = ev.hitEntity, p = ev.damagingEntity;
      if (!boss || boss.typeId !== BOSS_ID || !p || p.typeId !== "minecraft:player") return;
      const st = bosses.get(boss.id);
      if (!st || st.phase !== "grab" || !st.grab || p.id === st.grab.pid || !p.isSneaking) return;
      st.grab.hits++;
      if (st.grab.hits >= A4.releaseHits) releaseGrab(st, system.currentTick);
    } catch (err) {  }
  });
}

const EMPTY_BAR = "e".repeat(50);

function inWaterNow(p) {
  try {
    if (p.hasTag("yashh_unlock")) return false;
    const gm = p.getGameMode();
    if (gm !== MC.GameMode.Survival && gm !== MC.GameMode.Adventure) return false;
    return !!p.isInWater;
  } catch (err) { return false; }
}

function bloodAlpha(m, id, g, now) {
  if (g.end === null) {
    const t = now - g.start;
    return Math.min(1, t / 10) * (0.82 + 0.18 * Math.sin(t * 0.35));
  }
  const a = Math.max(0, 0.82 * (1 - (now - g.end) / 36));
  if (a <= 0) m.delete(id);
  return a;
}
function bloodChar(p, now) {
  let a = 0;
  const g = grabbed.get(p.id);
  if (g) a = bloodAlpha(grabbed, p.id, g, now);

  const inW = inWaterNow(p);
  let w = wet.get(p.id);
  if (inW) { if (!w || w.end !== null) { w = { start: now, end: null }; wet.set(p.id, w); } }
  else if (w && w.end === null) w.end = now;
  if (w) a = Math.max(a, bloodAlpha(wet, p.id, w, now));
  const lv = Math.max(0, Math.min(4, Math.ceil(a * 4)));
  return lv === 0 ? "z" : "abcd"[lv - 1];
}
export function bossHudChars(player) {
  const now = system.currentTick;
  const blood = bloodChar(player, now);
  let best, bd = BAR_VIEW_RANGE * BAR_VIEW_RANGE;
  for (const st of bosses.values()) {
    try {
      const e = st.e;
      if (!ok(e) || e.dimension.id !== player.dimension.id) continue;
      const l = e.location, pl = player.location;
      const d2 = (l.x - pl.x) ** 2 + (l.y - pl.y) ** 2 + (l.z - pl.z) ** 2;
      if (d2 < bd) { bd = d2; best = e; }
    } catch (err) {  }
  }
  if (!best) return blood + "z" + EMPTY_BAR;
  const n = Math.max(0, Math.min(50, Math.ceil(hpFrac(best) * 50 - 1e-6)));
  return blood + "v" + "f".repeat(n) + "e".repeat(50 - n);
}

system.afterEvents.scriptEventReceive.subscribe((ev) => {
  const who = ev.sourceEntity;
  if (ev.id === "yashh:launch") {
    try {
      const parts = String(ev.message || "").trim().split(/\s+/);
      const h = parseFloat(parts[0]) || LAUNCH_BACK, v = parseFloat(parts[1]) || LAUNCH_UP;
      const vd = who.getViewDirection(), m = Math.hypot(vd.x, vd.z) || 1;
      launchPlayer(who, -vd.x / m, -vd.z / m, h, v);
      who.sendMessage("\u00a7e[boss] launch back=" + h + " up=" + v);
    } catch (err) { try { who.sendMessage("\u00a7c[boss] launch failed: " + err); } catch (e2) {  } }
    return;
  }
  if (ev.id !== "yashh:boss") return;
  if (!/^\d+$/.test(String(ev.message).trim())) return;
  try {
    const n = Math.max(0, Math.min(6, parseInt(ev.message, 10) || 0));
    let best = null, bd = 1e9;
    for (const st of bosses.values()) {
      if (!ok(st.e) || !who || st.e.dimension.id !== who.dimension.id) continue;
      const d = Math.hypot(st.e.location.x - who.location.x, st.e.location.z - who.location.z);
      if (d < bd) { bd = d; best = st; }
    }
    if (!best) { who.sendMessage("\u00a7c[boss] no boss in this dimension"); return; }
    setProp(best.e, n);
    let back = "?";
    try { back = best.e.getProperty(PROP); } catch (err) { back = "error: " + err; }
    who.sendMessage("\u00a7e[boss] animation switch set to " + n + ", game reads back " + back + " (phase " + best.phase + ")");
    system.runTimeout(() => { if (ok(best.e) && best.phase === "free") setProp(best.e, 5); }, 60);
  } catch (err) { try { who.sendMessage("\u00a7c[boss] test failed: " + err); } catch (e2) {  } }
});

const dbgPlayers = new Set();
system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (ev.id !== "yashh:boss" || !ev.sourceEntity) return;
  const p = ev.sourceEntity;
  if (String(ev.message).trim().toLowerCase() !== "debug") { try { p.sendMessage("\u00a7e[boss] use: /scriptevent yashh:boss debug"); } catch (e) {  } return; }
  if (dbgPlayers.has(p.id)) { dbgPlayers.delete(p.id); try { p.sendMessage("\u00a7e[boss] debug off"); } catch (e) {  } }
  else { dbgPlayers.add(p.id); try { p.sendMessage("\u00a7e[boss] debug on (action bar)"); } catch (e) {  } }
});
system.runInterval(() => {
  if (!dbgPlayers.size) return;
  const now = system.currentTick;
  for (const p of world.getAllPlayers()) {
    if (!dbgPlayers.has(p.id)) continue;
    try {
      let best, bd = 1e9;
      for (const st of bosses.values()) {
        if (!ok(st.e) || st.e.dimension.id !== p.dimension.id) continue;
        const d = Math.hypot(st.e.location.x - p.location.x, st.e.location.z - p.location.z);
        if (d < bd) { bd = d; best = st; }
      }
      if (!best) { p.onScreenDisplay.setActionBar("[boss] none near"); continue; }
      const g = best.grab ? Math.max(0, (best.grab.end - now) / 20).toFixed(1) + "s" : "-";
      p.onScreenDisplay.setActionBar("phase=" + best.phase + " prop=" + best.e.getProperty(PROP) + " walking=" + best.walking +
        " moved " + (now - best.lastMove) + "t ago, grab left " + g + ", dist " + bd.toFixed(1));
    } catch (e) {  }
  }
}, 4);

system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (ev.id !== "yashh:boss" || String(ev.message).trim().toLowerCase() !== "blocks" || !ev.sourceEntity) return;
  const p = ev.sourceEntity;
  try {
    let best = null, bd = 1e9;
    for (const st of bosses.values()) {
      if (!ok(st.e) || st.e.dimension.id !== p.dimension.id) continue;
      const d = Math.hypot(st.e.location.x - p.location.x, st.e.location.z - p.location.z);
      if (d < bd) { bd = d; best = st; }
    }
    if (!best) { p.sendMessage("\u00a7c[boss] no boss in this dimension"); return; }
    const l = best.e.location, dim = best.e.dimension, seen = new Map();
    for (let dy = -1; dy <= 3; dy++) for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
      const b = dim.getBlock({ x: Math.floor(l.x) + dx, y: Math.floor(l.y) + dy, z: Math.floor(l.z) + dz });
      if (!b || b.isAir) continue;
      const k = b.typeId + "  isSolid=" + b.isSolid + "  boss: " + (b.isLiquid ? "water" : (passable(b) ? "walks through" : "SOLID"));
      seen.set(k, (seen.get(k) || 0) + 1);
    }
    const lines = [...seen.entries()].slice(0, 14).map(([k, n]) => "\u00a77" + k + " x" + n);
    p.sendMessage("\u00a7e[boss] blocks around the boss:\n" + (lines.join("\n") || "(only air)"));
  } catch (err) { try { p.sendMessage("\u00a7c[boss] blocks failed: " + err); } catch (e2) {  } }
});
