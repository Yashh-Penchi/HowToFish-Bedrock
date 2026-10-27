import { world, system, ItemStack } from "@minecraft/server";

export const MUSSEL_GROUND = "yashh:mussels_ground";
const MUSSEL_ITEM = "yashh:mussels";
const DROP_TAG = "yashh_mussel_drop";

const FIRST_MIN_TICKS = 20 * 3, FIRST_MAX_TICKS = 20 * 6;
const DROP_MIN_TICKS = 20 * 8, DROP_MAX_TICKS = 20 * 14;
const SPAWN_MIN_DIST = 3, SPAWN_MAX_DIST = 40;
const SHORE_RADIUS = 3;
const DROP_CHANCE = 0;
const DROP_HEIGHT = 8;
const MAX_NEAR = 14, NEAR_RADIUS = 48;
const DROP_LIFETIME_MS = 5 * 60 * 1000;
const TRIES = 60;
const DIM_ID = "minecraft:overworld";

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const nextAt = new Map();

function free(b) { try { return !!b && !b.isLiquid && (b.isAir || b.isSolid === false); } catch (e) { return false; } }
function solid(b) {
  try {
    if (!b || b.isLiquid || b.isAir || (b.typeId || "").indexOf("leaves") >= 0) return false;
    return b.isSolid === undefined ? true : b.isSolid === true;
  } catch (e) { return false; }
}
function isSand(b) { try { const id = b.typeId || ""; return id === "minecraft:sand" || id === "minecraft:red_sand"; } catch (e) { return false; } }
function water(b) {
  try {
    if (!b) return false;
    const id = b.typeId || "";
    return id.indexOf("lava") < 0 && (b.isLiquid || id.indexOf("water") >= 0);
  } catch (e) { return false; }
}

function groundAt(dim, x, z, y0) {
  const bx = Math.floor(x), bz = Math.floor(z);
  for (let y = Math.floor(y0) + 16; y >= Math.floor(y0) - 40; y--) {
    let feet, below;
    try { feet = dim.getBlock({ x: bx, y, z: bz }); below = dim.getBlock({ x: bx, y: y - 1, z: bz }); } catch (e) { return null; }
    if (!feet || !below) return null;
    if (free(feet) && solid(below)) return isSand(below) ? y : null;
    if (water(feet)) return null;
  }
  return null;
}

function nearWater(dim, x, y, z) {
  const bx = Math.floor(x), bz = Math.floor(z);
  for (let dx = -SHORE_RADIUS; dx <= SHORE_RADIUS; dx++) for (let dz = -SHORE_RADIUS; dz <= SHORE_RADIUS; dz++) {
    if (dx * dx + dz * dz > SHORE_RADIUS * SHORE_RADIUS) continue;
    for (let dy = -1; dy <= 0; dy++) {
      let b;
      try { b = dim.getBlock({ x: bx + dx, y: y + dy, z: bz + dz }); } catch (e) { return false; }
      if (water(b)) return true;
    }
  }
  return false;
}
function shoreSpot(dim, p) {
  const l = p.location;
  for (let i = 0; i < TRIES; i++) {
    const ang = Math.random() * Math.PI * 2, d = SPAWN_MIN_DIST + Math.random() * (SPAWN_MAX_DIST - SPAWN_MIN_DIST);
    const x = l.x + Math.cos(ang) * d, z = l.z + Math.sin(ang) * d;
    const y = groundAt(dim, x, z, l.y);
    if (y === null) continue;
    if (nearWater(dim, x, y, z)) return { x: Math.floor(x) + 0.5, y, z: Math.floor(z) + 0.5 };
  }
  return null;
}
function spawnMussel(dim, x, y, z, temporary) {
  try {
    const e = dim.spawnEntity(MUSSEL_GROUND, { x, y, z });
    try { e.teleport({ x, y, z }, { rotation: { x: 0, y: rnd(0, 359) } }); } catch (err) {  }
    if (temporary) {
      e.addTag(DROP_TAG);
      try { e.setDynamicProperty("yashh:born", Date.now()); } catch (err) {  }
    }
    return e;
  } catch (err) { return undefined; }
}

system.runInterval(() => {
  const now = system.currentTick;
  for (const p of world.getAllPlayers()) {
    try {
      if (p.dimension.id !== DIM_ID) continue;
      const due = nextAt.get(p.id);
      if (due === undefined) { nextAt.set(p.id, now + rnd(FIRST_MIN_TICKS, FIRST_MAX_TICKS)); continue; }
      if (now < due) continue;
      nextAt.set(p.id, now + rnd(DROP_MIN_TICKS, DROP_MAX_TICKS));
      const dim = p.dimension;
      if (dim.getEntities({ type: MUSSEL_GROUND, location: p.location, maxDistance: NEAR_RADIUS }).length >= MAX_NEAR) continue;
      const s = shoreSpot(dim, p);
      if (!s) continue;
      if (Math.random() < DROP_CHANCE) spawnMussel(dim, s.x, s.y + DROP_HEIGHT, s.z, true);
      else spawnMussel(dim, s.x, s.y, s.z, false);
    } catch (err) {  }
  }
}, 20);
world.afterEvents.playerLeave.subscribe((ev) => { nextAt.delete(ev.playerId); });

system.runInterval(() => {
  try {
    const dim = world.getDimension(DIM_ID);
    for (const e of dim.getEntities({ type: MUSSEL_GROUND, tags: [DROP_TAG] })) {
      let born = 0;
      try { born = e.getDynamicProperty("yashh:born") || 0; } catch (err) {  }
      if (!born) { try { e.setDynamicProperty("yashh:born", Date.now()); } catch (err) {  } continue; }
      if (Date.now() - born > DROP_LIFETIME_MS) e.remove();
    }
  } catch (err) {  }
}, 200);

world.beforeEvents.playerInteractWithEntity.subscribe((ev) => {
  if (!ev.target || ev.target.typeId !== MUSSEL_GROUND) return;
  ev.cancel = true;
  const player = ev.player, target = ev.target;
  system.run(() => {
    try {
      if (!target.isValid) return;
      const c = player.getComponent("minecraft:inventory").container;
      const left = c.addItem(new ItemStack(MUSSEL_ITEM, 1));
      if (left) player.dimension.spawnItem(left, player.location);
      target.remove();
      try { player.playSound("random.pop", { volume: 0.8, pitch: 1.1 }); } catch (e) {  }
    } catch (err) {  }
  });
});

system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (ev.id !== "yashh:mussels") return;
  const who = ev.sourceEntity;
  const msg = String(ev.message || "").trim().toLowerCase();
  try {
    if (msg === "clear") {
      let n = 0;
      for (const id of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"]) {
        try { for (const e of world.getDimension(id).getEntities({ type: MUSSEL_GROUND })) { e.remove(); n++; } } catch (e) {  }
      }
      if (who) who.sendMessage("\u00a7e[mussels] removed " + n);
    } else if (msg === "spawn" && who) {
      const dim = who.dimension;
      const sp = shoreSpot(dim, who);
      if (!sp) { who.sendMessage("\u00a7c[mussels] no shore spot found within " + SPAWN_MAX_DIST + " blocks (needs ground with water within " + SHORE_RADIUS + " blocks). Walk closer to a beach and try again."); return; }
      const drop = Math.random() < DROP_CHANCE;
      const e = drop ? spawnMussel(dim, sp.x, sp.y + DROP_HEIGHT, sp.z, true) : spawnMussel(dim, sp.x, sp.y, sp.z, false);
      who.sendMessage(e ? "\u00a7a[mussels] " + (drop ? "DROP" : "PLACE") + " at " + Math.floor(sp.x) + " " + sp.y + " " + Math.floor(sp.z)
                        : "\u00a7c[mussels] a spot was found but yashh:mussels_ground could not be spawned (check the content log)");
    } else if (msg === "here" && who) {
      const l = who.location;
      spawnMussel(who.dimension, l.x, l.y, l.z, false);
      who.sendMessage("\u00a7e[mussels] placed one here (stays until picked up)");
    } else if (who) {
      who.sendMessage("\u00a7e[mussels] use:  /scriptevent yashh:mussels spawn | here | clear");
    }
  } catch (err) {  }
});
