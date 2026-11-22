import { CRYSTALS, DOORS, HAZARDS, MAP, PROPS, ROOMS, SIZE, HEIGHT, type CrystalKind, type EscapeWorld, type Prop, type Vec } from "./world.ts";
import { floorAt, stairsAt } from "./basement-map.ts";

export type MapReveal = "explored" | "near" | "fog";
export type MapTerrain = "floor" | "wall" | "outside";
export type MapDoor = { id: string; open: boolean; locked: boolean };
export type MapFeature = { id: string; kind: Prop["kind"] | "hazard" | `crystal-${CrystalKind}` };
export type MapTile = {
  x: number;
  z: number;
  index: number;
  reveal: MapReveal;
  terrain: MapTerrain;
  door?: MapDoor;
  feature?: MapFeature;
};
export type MapWindow = { x: number; z: number; columns: number; rows: number };

type ExploredData = EscapeWorld["data"] & { explored?: number[] };
const EXPANSION_FEATURE_IDS = new Set(["changing-drawer", "changing-hide", "boiler-note", "boiler-hide", "valve-cold", "valve-return", "valve-vent"]);

/** Map grid coordinates to the fixed whole-map view or player-centered 13x13 crop. */
export function mapWindow(player: Vec, compact = false, floor: 0 | -1 = floorAt(player)): MapWindow {
  if (!compact) return floor === -1 ? { x: 0, z: 24, columns: SIZE, rows: HEIGHT - 24 } : { x: 0, z: 0, columns: SIZE, rows: SIZE };
  const columns = 13;
  return {
    x: Math.floor(player.x) - Math.floor(columns / 2),
    z: Math.floor(player.z) - Math.floor(columns / 2),
    columns,
    rows: columns,
  };
}

/** Return display-safe map samples; unexplored doors and objects are never included. */
export function visibleTiles(world: EscapeWorld, compact = false, floor: 0 | -1 = floorAt(world.data.player)): MapTile[] {
  const d = world.data as ExploredData;
  const p = d.player;
  const window = mapWindow(p, compact, floor);
  const explored = new Set(Array.isArray(d.explored) ? d.explored : []);
  const playerX = Math.floor(p.x), playerZ = Math.floor(p.z);
  const result: MapTile[] = [];

  for (let row = 0; row < window.rows; row += 1) {
    for (let column = 0; column < window.columns; column += 1) {
      const x = window.x + column, z = window.z + row;
      const index = z * SIZE + x;
      const inBounds = x >= 0 && z >= 0 && x < SIZE && z < HEIGHT
        && (floor === floorAt({ x, z }) || stairsAt(p) && stairsAt({ x, z }));
      const seen = inBounds && (explored.has(index) || x === playerX && z === playerZ);
      const nearby = inBounds && Math.abs(x - playerX) <= 2 && Math.abs(z - playerZ) <= 2;
      const reveal: MapReveal = seen ? "explored" : nearby ? "near" : "fog";
      const terrain: MapTerrain = !inBounds ? "outside" : MAP[z][x] === 0 ? "floor" : "wall";
      const tile: MapTile = { x, z, index, reveal, terrain };

      if (reveal === "explored") {
        const door = DOORS.find(candidate => candidate.x === x && candidate.z === z);
        if (door) {
          tile.door = {
            id: door.id,
            open: d.opened.includes(door.id),
            locked: (!d.expansion?.enabled && ["changing", "boiler"].includes(door.id))
              || !!door.key && !d.unlocked.includes(door.id)
              || door.id === "cellar" && !d.power && !d.unlocked.includes(door.id),
          };
        }
        const feature = PROPS.find(candidate => Math.floor(candidate.x) === x && Math.floor(candidate.z) === z && (d.expansion?.enabled || !EXPANSION_FEATURE_IDS.has(candidate.id)));
        if (feature) tile.feature = { id: feature.id, kind: feature.kind };
        else {
          const crystal = CRYSTALS.find(c => Math.floor(c.x) === x && Math.floor(c.z) === z && !d.hunt?.collected.includes(c.id));
          if (crystal) tile.feature = { id: crystal.id, kind: `crystal-${crystal.kind}` };
        }
        if (!tile.feature && d.expansion?.enabled && HAZARDS.some(candidate => Math.floor(candidate.x) === x && Math.floor(candidate.z) === z)) tile.feature = { id: `glass-${x}`, kind: "hazard" };
      }
      result.push(tile);
    }
  }
  return result;
}

export type ArrowPoint = { x: number; y: number };
export type ArrowTriangle = { tip: ArrowPoint; left: ArrowPoint; right: ArrowPoint };

/** Player angle 0 points east; positive angles descend toward south on the map. */
export function playerArrow(angle: number, length = 1): ArrowTriangle {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const sideX = -dy, sideY = dx;
  return {
    tip: { x: dx * length, y: dy * length },
    left: { x: -dx * length * .62 + sideX * length * .48,
      y: -dy * length * .62 + sideY * length * .48 },
    right: { x: -dx * length * .62 - sideX * length * .48,
      y: -dy * length * .62 - sideY * length * .48 },
  };
}

const ATLAS_COLUMNS = 4;
const ATLAS_ROWS = 2;

export class EscapeMap {
  private readonly art?: HTMLImageElement;

  constructor(art?: HTMLImageElement) {
    this.art = art;
  }

  draw(canvas: HTMLCanvasElement, world: EscapeWorld, compact = false, floor: 0 | -1 = floorAt(world.data.player)): void {
    const context = canvas.getContext("2d");
    if (!context || !canvas.width || !canvas.height) return;
    const ctx = context;
    const width = canvas.width, height = canvas.height;
    const panel = compact ? Math.min(width, height) : Math.min(width, height);
    const padding = compact ? Math.max(10, Math.round(panel * .075)) : Math.max(24, Math.round(panel * .06));
    const view = mapWindow(world.data.player, compact, floor);
    const cell = Math.floor(Math.min((panel - padding * 2) / view.columns,
      (panel - padding * 2) / view.rows));
    const mapWidth = cell * view.columns, mapHeight = cell * view.rows;
    const left = Math.floor((width - mapWidth) / 2), top = Math.floor((height - mapHeight) / 2);

    ctx.save();
    const previousSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    this.drawFrame(ctx, width, height, padding, compact);

    const tiles = visibleTiles(world, compact, floor);
    for (const tile of tiles) {
      const column = tile.x - view.x, row = tile.z - view.z;
      const x = left + column * cell, y = top + row * cell;
      if (tile.reveal === "fog" || tile.terrain === "outside") {
        this.drawFog(ctx, x, y, cell, tile.x, tile.z);
        continue;
      }
      if (tile.reveal === "near") {
        this.drawVeil(ctx, x, y, cell, tile.x, tile.z);
        continue;
      }
      this.drawTerrain(ctx, x, y, cell, tile.terrain, tile.x, tile.z);
      if (tile.door) this.drawDoor(ctx, x, y, cell, tile.door);
      if (tile.feature) this.drawFeature(ctx, x, y, cell, tile.feature);
    }

    this.drawRoomLabels(ctx, world, view, left, top, cell, floor, compact);

    const playerX = Math.floor(world.data.player.x), playerZ = Math.floor(world.data.player.z);
    const arrowX = left + (playerX - view.x + .5) * cell;
    const arrowY = top + (playerZ - view.z + .5) * cell;
    if (floorAt(world.data.player) === floor) this.drawPlayer(ctx, arrowX, arrowY, cell, world.data.player.angle);
    if ((world.data.hunt?.reveal ?? 0) > 0 && floorAt(world.data.hunter) === floor) {
      const hunterX = Math.floor(world.data.hunter.x), hunterZ = Math.floor(world.data.hunter.z);
      const hx = left + (hunterX - view.x + .5) * cell, hy = top + (hunterZ - view.z + .5) * cell;
      if (compact && (hx < left || hx > left + mapWidth || hy < top || hy > top + mapHeight)) {
        const cx = left + mapWidth / 2, cy = top + mapHeight / 2, angle = Math.atan2(hy - cy, hx - cx), r = mapWidth * .43;
        ctx.save(); ctx.translate(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r); ctx.rotate(angle); ctx.fillStyle = "#f49cff"; ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -4); ctx.lineTo(-4, 4); ctx.closePath(); ctx.fill(); ctx.restore();
      } else if (hx >= left && hx <= left + mapWidth && hy >= top && hy <= top + mapHeight) {
        ctx.fillStyle = "#ff85f4"; ctx.shadowColor = "#e14cff"; ctx.shadowBlur = compact ? 7 : 14; ctx.beginPath(); ctx.arc(hx, hy, Math.max(3, cell * .28), 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
      }
    }
    this.drawCompass(ctx, width, height, compact, padding);
    ctx.imageSmoothingEnabled = previousSmoothing;
    ctx.restore();
  }

  private drawRoomLabels(ctx: CanvasRenderingContext2D, world: EscapeWorld, view: MapWindow,
    left: number, top: number, cell: number, floor: 0 | -1, compact: boolean) {
    const data = world.data as ExploredData;
    const explored = new Set(Array.isArray(data.explored) ? data.explored : []);
    const playerX = Math.floor(data.player.x), playerZ = Math.floor(data.player.z);
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Full map: room names scale with the cell size and use the bundled game serif.
    ctx.font = `bold ${Math.max(7, Math.min(compact ? 9 : 26, Math.floor(cell * (compact ? .78 : .95))))}px 'Escape Serif', 'Songti SC', 'SimSun', serif`;
    for (const room of ROOMS) {
      const centerX = Math.floor(room.x + room.w / 2), centerZ = Math.floor(room.z + room.h / 2);
      if (floorAt({ x: centerX, z: centerZ }) !== floor) continue;
      let anchor: {x:number;z:number;distance:number}|undefined;
      for(let z=Math.max(room.z,view.z);z<Math.min(room.z+room.h,view.z+view.rows);z++)for(let x=Math.max(room.x,view.x);x<Math.min(room.x+room.w,view.x+view.columns);x++){
        if(!explored.has(z*SIZE+x)&&!(x===playerX&&z===playerZ))continue;
        const distance=(x-centerX)**2+(z-centerZ)**2;if(!anchor||distance<anchor.distance)anchor={x,z,distance};
      }
      if(!anchor)continue;
      const x = left + (anchor.x - view.x + .5) * cell;
      const y = top + (anchor.z - view.z + .5) * cell;
      ctx.lineWidth = Math.max(2, cell * .2);
      ctx.strokeStyle = "#071012d9";
      ctx.fillStyle = "#f0dfb2";
      ctx.strokeText(room.name, x, y, Math.max(cell * 2, room.w * cell - 2));
      ctx.fillText(room.name, x, y, Math.max(cell * 2, room.w * cell - 2));
    }
    ctx.restore();
  }

  private drawAtlas(ctx: CanvasRenderingContext2D, slot: number, x: number, y: number,
    width: number, height: number, fallback: () => void) {
    const art = this.art;
    if (!art || !art.complete || art.naturalWidth < ATLAS_COLUMNS || art.naturalHeight < ATLAS_ROWS) {
      fallback();
      return;
    }
    const sourceWidth = art.naturalWidth / ATLAS_COLUMNS;
    const sourceHeight = art.naturalHeight / ATLAS_ROWS;
    const sourceX = slot % ATLAS_COLUMNS * sourceWidth;
    const sourceY = Math.floor(slot / ATLAS_COLUMNS) * sourceHeight;
    ctx.drawImage(art, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
  }

  private drawTerrain(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number,
    terrain: Exclude<MapTerrain, "outside">, mapX: number, mapZ: number) {
    const fallback = () => terrain === "wall"
      ? this.drawStoneWall(ctx, x, y, cell, mapX, mapZ)
      : this.drawStoneFloor(ctx, x, y, cell, mapX, mapZ);
    this.drawAtlas(ctx, terrain === "wall" ? 0 : 1, x, y, cell, cell, fallback);
  }

  private drawVeil(ctx: CanvasRenderingContext2D, x: number, y: number,
    cell: number, mapX: number, mapZ: number) {
    const seed = tileHash(mapX, mapZ);
    ctx.fillStyle = "#0a1012";
    ctx.fillRect(x, y, cell, cell);
    ctx.fillStyle = "rgba(107, 120, 113, .12)";
    for (let bit = 0; bit < 2; bit += 1) {
      const dx = (seed >>> (bit * 7) & 15) / 16;
      const dy = (seed >>> (bit * 9 + 3) & 15) / 16;
      ctx.fillRect(x + dx * cell, y + dy * cell,
        Math.max(1, cell * .06), Math.max(1, cell * .06));
    }
  }

  private drawStoneFloor(ctx: CanvasRenderingContext2D, x: number, y: number,
    cell: number, mapX: number, mapZ: number) {
    const seed = tileHash(mapX, mapZ);
    ctx.fillStyle = (seed & 1) ? "#263438" : "#202d31";
    ctx.fillRect(x, y, cell, cell);
    const inset = Math.max(1, Math.floor(cell * .12));
    ctx.fillStyle = "rgba(124, 136, 119, .15)";
    ctx.fillRect(x + inset, y + inset, Math.max(1, cell * .34), Math.max(1, cell * .13));
    ctx.fillStyle = "rgba(3, 9, 12, .35)";
    ctx.fillRect(x + cell * .57, y + cell * .55, Math.max(1, cell * .29), Math.max(1, cell * .23));
    ctx.fillStyle = "rgba(166, 151, 112, .13)";
    ctx.fillRect(x + cell * ((seed >>> 3) % 55) / 100, y + cell * .77,
      Math.max(1, cell * .12), Math.max(1, cell * .07));
  }

  private drawStoneWall(ctx: CanvasRenderingContext2D, x: number, y: number,
    cell: number, mapX: number, mapZ: number) {
    const seed = tileHash(mapX, mapZ);
    ctx.fillStyle = (seed & 1) ? "#10191b" : "#172124";
    ctx.fillRect(x, y, cell, cell);
    const joint = Math.max(1, Math.floor(cell * .08));
    const half = Math.floor(cell / 2);
    ctx.fillStyle = "rgba(2, 7, 9, .8)";
    ctx.fillRect(x, y + half, cell, joint);
    ctx.fillRect(x + ((seed & 2) ? half : Math.floor(cell * .28)), y, joint, half);
    ctx.fillRect(x + ((seed & 4) ? Math.floor(cell * .24) : half), y + half, joint, cell - half);
    ctx.fillStyle = "rgba(132, 146, 133, .19)";
    ctx.fillRect(x + joint * 2, y + joint * 2, Math.max(1, half - joint * 3), joint);
    ctx.fillRect(x + half + joint * 2, y + half + joint, Math.max(1, half - joint * 3), joint);
  }

  private drawFog(ctx: CanvasRenderingContext2D, x: number, y: number,
    cell: number, mapX: number, mapZ: number) {
    this.drawAtlas(ctx, 5, x, y, cell, cell, () => {
      const seed = tileHash(mapX, mapZ);
      ctx.fillStyle = "#070c0f";
      ctx.fillRect(x, y, cell, cell);
      ctx.fillStyle = "rgba(83, 101, 97, .11)";
      for (let bit = 0; bit < 4; bit += 1) {
        const dx = (seed >>> (bit * 3) & 7) / 8;
        const dy = (seed >>> (bit * 4 + 2) & 7) / 8;
        ctx.fillRect(x + dx * cell, y + dy * cell, Math.max(1, cell * .08), Math.max(1, cell * .08));
      }
    });
    ctx.fillStyle = "rgba(0, 4, 7, .78)";
    ctx.fillRect(x, y, cell, cell);
  }

  private drawFrame(ctx: CanvasRenderingContext2D, width: number, height: number,
    padding: number, compact: boolean) {
    ctx.fillStyle = "#120f0c";
    ctx.fillRect(0, 0, width, height);
    const band = Math.max(2, Math.floor(padding * .2));
    this.drawAtlas(ctx, 2, 0, 0, width, height, () => {
      ctx.fillStyle = "#24190f";
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "#59402a";
      for (let y = 2; y < height; y += Math.max(8, band * 3)) {
        ctx.fillRect(0, y, width, Math.max(1, band * .25));
      }
      for (let x = 3; x < width; x += Math.max(12, band * 4)) {
        ctx.fillStyle = "#39291c";
        ctx.fillRect(x, 0, Math.max(1, band * .25), height);
      }
    });
    ctx.fillStyle = "rgba(5, 8, 10, .68)";
    ctx.fillRect(padding - band, padding - band,
      width - (padding - band) * 2, height - (padding - band) * 2);
    ctx.strokeStyle = compact ? "#88704a" : "#9a7443";
    ctx.lineWidth = Math.max(1, Math.floor(band * .45));
    ctx.strokeRect(band / 2, band / 2, width - band, height - band);
  }

  private drawDoor(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number, door: MapDoor) {
    const edge = Math.max(1, Math.floor(cell * .13));
    ctx.fillStyle = "#764d2d";
    ctx.fillRect(x + edge, y + edge, cell - edge * 2, cell - edge * 2);
    if (door.open) {
      ctx.fillStyle = "#080e10";
      ctx.fillRect(x + edge * 2, y + edge * 2, cell - edge * 4, cell - edge * 4);
      ctx.fillStyle = "#a47948";
      ctx.fillRect(x + edge, y + edge, edge, cell - edge * 2);
      ctx.fillRect(x + cell - edge * 2, y + edge, edge, cell - edge * 2);
    } else {
      ctx.fillStyle = "#573922";
      ctx.fillRect(x + edge * 2, y + edge * 2, cell - edge * 4, cell - edge * 4);
      ctx.fillStyle = "#956b3d";
      const plank = Math.max(1, Math.floor((cell - edge * 4) / 4));
      for (let line = 1; line <= 3; line += 1) {
        ctx.fillRect(x + edge * 2 + plank * line, y + edge * 2,
          Math.max(1, Math.floor(cell * .035)), cell - edge * 4);
      }
      ctx.fillStyle = "#b1884d";
      ctx.fillRect(x + cell * .68, y + cell * .48, Math.max(1, cell * .07), Math.max(1, cell * .07));
    }
    if (door.locked) this.drawLock(ctx, x + cell * .5, y + cell * .5, cell);
  }

  private drawLock(ctx: CanvasRenderingContext2D, centerX: number, centerY: number, cell: number) {
    const size = Math.max(2, cell * .28);
    ctx.save();
    ctx.strokeStyle = "#ddb76d";
    ctx.lineWidth = Math.max(1, cell * .07);
    ctx.beginPath();
    ctx.arc(centerX, centerY - size * .1, size * .31, Math.PI, 0);
    ctx.stroke();
    ctx.fillStyle = "#c19450";
    ctx.fillRect(centerX - size * .42, centerY - size * .08, size * .84, size * .62);
    ctx.fillStyle = "#241d17";
    ctx.fillRect(centerX - size * .055, centerY + size * .12, size * .11, size * .2);
    ctx.restore();
  }

  private drawFeature(ctx: CanvasRenderingContext2D, x: number, y: number,
    cell: number, feature: MapFeature) {
    const centerX = x + cell / 2, centerY = y + cell / 2;
    const inset = Math.max(2, cell * .2);
    const size = cell - inset * 2;
    if (feature.kind === "hazard") {
      ctx.fillStyle = "#a9d5ce"; ctx.strokeStyle = "#354b4b"; ctx.lineWidth = Math.max(1, cell * .045);
      ctx.beginPath(); ctx.moveTo(centerX, y + inset); ctx.lineTo(x + cell - inset, centerY + inset / 2);
      ctx.lineTo(centerX + inset / 3, y + cell - inset); ctx.lineTo(x + inset, centerY - inset / 3); ctx.closePath(); ctx.fill(); ctx.stroke();
      return;
    }
    if (feature.kind === "crystal-freeze" || feature.kind === "crystal-reveal" || feature.kind === "crystal-ward") {
      ctx.fillStyle = feature.kind === "crystal-freeze" ? "#8be5ff" : feature.kind === "crystal-reveal" ? "#e49aff" : "#a5e0a2"; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 7;
      ctx.beginPath(); ctx.moveTo(centerX, y + inset); ctx.lineTo(x + cell - inset, centerY); ctx.lineTo(centerX, y + cell - inset); ctx.lineTo(x + inset, centerY); ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0; return;
    }
    if (feature.kind === "note") {
      this.drawAtlas(ctx, 3, x + inset, y + inset, size, size, () => {
        ctx.fillStyle = "#c5b98b";
        ctx.fillRect(x + inset, y + inset, size, size);
        ctx.fillStyle = "#6a6049";
        ctx.fillRect(x + inset * 1.5, centerY, size * .55, Math.max(1, cell * .05));
      });
      return;
    }
    if (feature.kind === "exit") {
      this.drawAtlas(ctx, 7, x + inset * .7, y + inset * .7, size * 1.4, size * 1.4, () => {
        ctx.fillStyle = "#a3322c";
        ctx.fillRect(x + inset * .7, y + inset * .7, size * 1.4, size * 1.4);
        ctx.fillStyle = "#111416";
        ctx.fillRect(x + inset * 1.1, y + inset * 1.1, size * .6, size * .6);
      });
      return;
    }
    if (feature.kind === "wardrobe") {
      ctx.fillStyle = "#734a2a";
      ctx.fillRect(x + inset, y + inset * .7, size, size * 1.25);
      ctx.strokeStyle = "#bd9860";
      ctx.lineWidth = Math.max(1, cell * .06);
      ctx.strokeRect(x + inset, y + inset * .7, size, size * 1.25);
      ctx.fillStyle = "#d4b674";
      ctx.fillRect(centerX - cell * .025, y + cell * .43, Math.max(1, cell * .05), Math.max(1, cell * .09));
      return;
    }
    if (feature.kind === "drawer") {
      ctx.fillStyle = "#765033";
      ctx.fillRect(x + inset, y + inset, size, size);
      ctx.strokeStyle = "#c0985d";
      ctx.lineWidth = Math.max(1, cell * .05);
      ctx.strokeRect(x + inset, y + inset, size, size);
      ctx.fillStyle = "#d3b577";
      ctx.fillRect(centerX - cell * .08, centerY - cell * .02, cell * .16, Math.max(1, cell * .05));
      return;
    }
    if (feature.kind === "power") {
      ctx.fillStyle = "#59645c";
      ctx.fillRect(x + inset, y + inset * .65, size, size * 1.2);
      ctx.strokeStyle = "#a9814f";
      ctx.lineWidth = Math.max(1, cell * .06);
      ctx.strokeRect(x + inset, y + inset * .65, size, size * 1.2);
      ctx.fillStyle = "#8fbd68";
      ctx.fillRect(centerX - cell * .045, y + cell * .28, cell * .09, cell * .09);
      return;
    }
    if (feature.kind === "valve") {
      ctx.strokeStyle = "#b87542";
      ctx.lineWidth = Math.max(1, cell * .08);
      ctx.beginPath();
      ctx.arc(centerX, centerY, cell * .27, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(centerX - cell * .27, centerY);
      ctx.lineTo(centerX + cell * .27, centerY);
      ctx.moveTo(centerX, centerY - cell * .27);
      ctx.lineTo(centerX, centerY + cell * .27);
      ctx.stroke();
    }
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number, angle: number) {
    const radius = Math.max(3, cell * .32);
    ctx.fillStyle = "rgba(0, 0, 0, .65)";
    ctx.beginPath();
    ctx.arc(x + 1, y + 1, radius * 1.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ead283";
    ctx.strokeStyle = "#34291a";
    ctx.lineWidth = Math.max(1, cell * .07);
    ctx.beginPath();
    ctx.arc(x, y, radius * 1.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const arrow = playerArrow(angle, radius * 1.65);
    ctx.fillStyle = "#fff1b6";
    ctx.strokeStyle = "#483817";
    ctx.beginPath();
    ctx.moveTo(x + arrow.tip.x, y + arrow.tip.y);
    ctx.lineTo(x + arrow.left.x, y + arrow.left.y);
    ctx.lineTo(x + arrow.right.x, y + arrow.right.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  private drawCompass(ctx: CanvasRenderingContext2D, width: number, height: number,
    compact: boolean, padding: number) {
    const font = Math.max(8, Math.floor((compact ? padding : padding * .6) * .62));
    ctx.font = `bold ${font}px 'Escape Serif', 'Songti SC', 'SimSun', serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#d8c28d";
    const offset = Math.max(font, Math.floor(padding * .48));
    ctx.fillText("北", width / 2, offset);
    ctx.fillText("南", width / 2, height - offset);
    ctx.fillText("西", offset, height / 2);
    ctx.fillText("东", width - offset, height / 2);
  }
}

function tileHash(x: number, z: number): number {
  let value = Math.imul(x + 37, 0x45d9f3b) ^ Math.imul(z + 91, 0x119de1f3);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return (value ^ (value >>> 16)) >>> 0;
}
