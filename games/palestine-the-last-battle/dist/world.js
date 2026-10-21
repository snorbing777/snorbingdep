import * as T from "./vendor/three.module.js";
import { MAPS, SCALE } from "./data.js";
import { material, part } from "./models.js";
const unitBox = new T.BoxGeometry(1, 1, 1),
  matrix = new T.Matrix4(),
  quat = new T.Quaternion();
function seeded(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
function texture(kind) {
  const c = document.createElement("canvas");
  c.width = c.height = 1024;
  const g = c.getContext("2d"),
    r = seeded(83 + kind.length),
    size = 1024;
  const colors = {
    plaster: "#d0c4af",
    stone: "#89828a",
    paving: "#a69f93",
    road: "#626a70",
    metal: "#6a7a89",
  };
  g.fillStyle = colors[kind];
  g.fillRect(0, 0, size, size);
  // Smooth, layered weathering avoids enlarged pixel noise.
  for (let i = 0; i < 130; i++) {
    let x = r() * size,
      y = r() * size,
      rad = 25 + r() * 170,
      grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(
      0,
      i % 2 ? "rgba(49,42,35,.055)" : "rgba(255,250,234,.08)",
    );
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  if (kind === "stone" || kind === "paving") {
    const rh = kind === "stone" ? 128 : 256,
      cw = kind === "stone" ? 256 : 256;
    for (let y = 0; y < size; y += rh)
      for (let x = (((y / rh) % 2) * cw) / 2 - cw; x < size; x += cw) {
        let shade = Math.floor(110 + r() * 30);
        g.fillStyle = `rgba(${shade},${shade - 3},${shade - 5},.12)`;
        g.fillRect(x + 3, y + 3, cw - 5, rh - 5);
        g.strokeStyle = "rgba(30,28,32,.45)";
        g.lineWidth = 3;
        g.strokeRect(x + 1, y + 1, cw - 2, rh - 2);
        g.strokeStyle = "rgba(245,234,218,.25)";
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x + 5, y + rh - 5);
        g.lineTo(x + 5, y + 5);
        g.lineTo(x + cw - 5, y + 5);
        g.stroke();
        if (r() > 0.65) {
          g.strokeStyle = "rgba(45,39,36,.2)";
          g.lineWidth = 0.8;
          g.beginPath();
          let px = x + r() * cw,
            py = y + 5;
          g.moveTo(px, py);
          for (let j = 0; j < 4; j++) {
            px += (r() - 0.5) * 30;
            py += rh / 5;
            g.lineTo(px, py);
          }
          g.stroke();
        }
      }
  }
  if (kind === "plaster") {
    for (let i = 0; i < 35; i++) {
      g.strokeStyle = "rgba(75,65,50,.13)";
      g.lineWidth = 1 + r() * 3;
      let x = r() * size,
        y = r() * size;
      g.beginPath();
      g.moveTo(x, y);
      for (let j = 0; j < 5; j++) {
        x += (r() - 0.5) * 22;
        y += r() * 20;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  }
  if (kind === "road") {
    for (let i = 0; i < 60; i++) {
      g.strokeStyle = "rgba(20,25,30,.22)";
      g.lineWidth = 0.7 + r();
      let x = r() * size,
        y = r() * size;
      g.beginPath();
      g.moveTo(x, y);
      for (let j = 0; j < 8; j++) {
        x += (r() - 0.5) * 45;
        y += r() * 24;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  }
  for (let i = 0; i < 65000; i++) {
    g.fillStyle = r() > 0.5 ? "rgba(255,255,255,.05)" : "rgba(0,0,0,.06)";
    g.fillRect(r() * size, r() * size, 0.7 + r() * 1.5, 0.7 + r() * 1.5);
  }
  const t = new T.CanvasTexture(c);
  t.wrapS = t.wrapT = T.RepeatWrapping;
  t.colorSpace = T.SRGBColorSpace;
  t.anisotropy = 16;
  t.minFilter = T.LinearMipmapLinearFilter;
  t.magFilter = T.LinearFilter;
  return t;
}
export function buildWorld(map) {
  let group = new T.Group(),
    grid = MAPS[map].map((r) => [...r].map(Number)),
    colliders = [],
    batches = new Map();
  function box(x, y, z, w, h, d, mat, shadow = true) {
    let key = mat.uuid + (shadow ? "1" : "0");
    if (!batches.has(key)) batches.set(key, { mat, shadow, items: [] });
    batches.get(key).items.push({ x, y, z, w, h, d });
  }
  let plaster = texture(map ? "stone" : "plaster"),
    paving = texture("paving"),
    road = texture("road");
  paving.repeat.set(34, 34);
  road.repeat.set(16, 16);
  plaster.repeat.set(2, 1.5);
  let wallMat = new T.MeshStandardMaterial({
      map: plaster,
      color: map ? 0x9a94a6 : 0xffffff,
      roughness: 0.88,
      bumpMap: plaster,
      bumpScale: 0.055,
    }),
    floorMat = new T.MeshStandardMaterial({
      map: paving,
      color: map ? 0x85818d : 0xd8cfbf,
      roughness: 0.9,
      bumpMap: paving,
      bumpScale: 0.035,
    }),
    roadMat = new T.MeshStandardMaterial({
      map: road,
      bumpMap: road,
      bumpScale: 0.024,
      roughness: 0.82,
    }),
    glass = material(map ? 0x303549 : 0x577b8b, 0.75, 0.16),
    frame = material(map ? 0x8e8791 : 0xe1dacb, 0.1, 0.72),
    roof = material(map ? 0x575061 : 0x9b7561, 0.1, 0.8),
    trim = material(map ? 0x484251 : 0x7e8e99, 0.2, 0.6),
    dark = material(0x303b49, 0.1, 0.8),
    light = material(0xe3bc82, 0.2, 0.4, 0x7c5424),
    blue = material(0x6eacc6, 0.35, 0.4, 0x184357);
  box(33.6, -0.18, 33.6, 140, 0.3, 140, floorMat, false);
  if (!map) {
    box(33.6, 0.002, 33.6, 6, 0.035, 61, roadMat, false);
    box(33.6, 0.01, 17.6, 61, 0.035, 5.5, roadMat, false);
    for (let z = 4; z < 65; z += 4)
      box(33.6, 0.045, z, 0.12, 0.025, 1.8, frame, false);
    for (let x = 5; x < 65; x += 4)
      box(x, 0.05, 17.6, 1.8, 0.02, 0.12, frame, false);
  }
  if (!map) {
    for (let z = 4; z < 65; z += 5) {
      box(30.45, 0.035, z, 0.2, 0.07, 4.9, frame, false);
      box(36.75, 0.035, z, 0.2, 0.07, 4.9, frame, false);
    }
    for (let z of [11, 25, 47, 58]) {
      box(30.8, 0.055, z, 0.5, 0.025, 0.75, dark, false);
      for (let j = -0.3; j < 0.4; j += 0.12)
        box(30.8, 0.075, z + j, 0.4, 0.015, 0.025, trim, false);
    }
  }
  let visited = new Set(),
    r = seeded(82 + map);
  for (let y = 0; y < 24; y++)
    for (let x = 0; x < 24; x++) {
      let type = grid[y][x];
      if (!type || visited.has(x + "," + y)) continue;
      let w = 1,
        h = 1;
      while (
        x + w < 24 &&
        grid[y][x + w] === type &&
        !visited.has(x + w + "," + y)
      )
        w++;
      outer: while (y + h < 24) {
        for (let xx = x; xx < x + w; xx++)
          if (grid[y + h][xx] !== type || visited.has(xx + "," + (y + h)))
            break outer;
        h++;
      }
      for (let yy = y; yy < y + h; yy++)
        for (let xx = x; xx < x + w; xx++) visited.add(xx + "," + yy);
      let bx = (x + w / 2) * SCALE,
        bz = (y + h / 2) * SCALE,
        bw = w * SCALE,
        bd = h * SCALE,
        bh = (type === 1 ? 7.8 : 4.5 + type * 0.6) + (r() - 0.5) * 1.1;
      let center = type === (map ? 5 : 6);
      if (center) bh = 1.05;
      box(bx, bh / 2, bz, bw, bh, bd, wallMat);
      colliders.push(
        new T.Box3(
          new T.Vector3(x * SCALE, 0, y * SCALE),
          new T.Vector3((x + w) * SCALE, bh, (y + h) * SCALE),
        ),
      );
      box(bx, bh + 0.1, bz, bw + 0.2, 0.2, bd + 0.2, frame);
      box(bx, bh + 0.27, bz, bw + 0.1, 0.16, bd + 0.1, roof);
      box(bx, 0.25, bz, bw + 0.08, 0.5, bd + 0.08, trim);
      if (center) {
        let feature = new T.Group();
        feature.position.set(bx, bh + 0.25, bz);
        if (map) {
          part(feature, 0, 1.1, 0, 0.65, 2.2, 0.65, trim);
          part(feature, 0, 2.4, 0, 1.2, 0.3, 1.2, frame);
          let crystal = new T.Mesh(new T.OctahedronGeometry(0.8), blue);
          crystal.position.y = 3;
          feature.add(crystal);
        } else {
          let torus = new T.Mesh(new T.TorusGeometry(1.4, 0.13, 10, 48), trim);
          torus.position.y = 1.6;
          torus.rotation.y = 0.65;
          feature.add(torus);
          let orb = new T.Mesh(new T.SphereGeometry(0.55, 24, 16), blue);
          orb.position.y = 1.6;
          feature.add(orb);
        }
        group.add(feature);
        continue;
      }
      for (let side = 0; side < 4; side++) {
        let along = side < 2 ? bw : bd,
          depth = side < 2 ? bd : bw;
        for (let a = -along / 2 + 1; a < along / 2 - 0.6; a += 1.8)
          for (let yy = 1.65; yy < bh - 1; yy += 2.35) {
            let xx =
                side < 2
                  ? bx + a
                  : bx + (side === 2 ? -bw / 2 - 0.04 : bw / 2 + 0.04),
              zz =
                side < 2
                  ? bz + (side === 0 ? -bd / 2 - 0.04 : bd / 2 + 0.04)
                  : bz + a;
            let horiz = side < 2;
            box(
              xx,
              yy,
              zz,
              horiz ? 0.9 : 0.06,
              1.3,
              horiz ? 0.06 : 0.9,
              glass,
              false,
            );
            box(
              xx,
              yy - 0.7,
              zz,
              horiz ? 1.12 : 0.17,
              0.11,
              horiz ? 0.17 : 1.12,
              frame,
            );
            box(
              xx,
              yy + 0.7,
              zz,
              horiz ? 1.12 : 0.15,
              0.12,
              horiz ? 0.15 : 1.12,
              frame,
            );
            if (!map) {
              box(
                xx,
                yy,
                zz,
                horiz ? 0.045 : 0.08,
                1.3,
                horiz ? 0.08 : 0.045,
                frame,
                false,
              );
              if (((type + a) | 0) % 3 === 0 && yy < 2) {
                box(
                  xx,
                  yy + 0.87,
                  zz,
                  horiz ? 1.35 : 0.7,
                  0.12,
                  horiz ? 0.7 : 1.35,
                  trim,
                );
              }
            } else {
              box(
                xx + (horiz ? -0.55 : 0),
                yy,
                zz + (horiz ? 0 : -0.55),
                horiz ? 0.12 : 0.2,
                1.5,
                horiz ? 0.2 : 0.12,
                frame,
              );
              box(
                xx + (horiz ? 0.55 : 0),
                yy,
                zz + (horiz ? 0 : 0.55),
                horiz ? 0.12 : 0.2,
                1.5,
                horiz ? 0.2 : 0.12,
                frame,
              );
            }
          }
      }
      for (let side = 0; side < 4; side++) {
        const along = side < 2 ? bw : bd,
          horiz = side < 2,
          nx = side === 2 ? -1 : side === 3 ? 1 : 0,
          nz = side === 0 ? -1 : side === 1 ? 1 : 0;
        const fx = bx + nx * (bw / 2 + 0.07),
          fz = bz + nz * (bd / 2 + 0.07);
        // Recessed entryway, lintel, and shallow steps.
        box(
          fx,
          1.05,
          fz,
          horiz ? 1.15 : 0.08,
          2.1,
          horiz ? 0.08 : 1.15,
          dark,
          false,
        );
        box(
          fx,
          2.18,
          fz,
          horiz ? 1.38 : 0.17,
          0.16,
          horiz ? 0.17 : 1.38,
          frame,
        );
        box(
          fx,
          1.02,
          fz,
          horiz ? 0.05 : 0.12,
          1.95,
          horiz ? 0.12 : 0.05,
          trim,
          false,
        );
        for (
          let a = -along / 2 + 0.22;
          a < along / 2;
          a += Math.max(3, along / 3)
        ) {
          const px = horiz ? bx + a : fx,
            pz = horiz ? fz : bz + a;
          box(
            px,
            bh / 2,
            pz,
            horiz ? 0.14 : 0.18,
            bh,
            horiz ? 0.18 : 0.14,
            frame,
          );
        }
        if (!map && along > 5) {
          for (let q = -1; q <= 1; q += 2) {
            let px = horiz ? bx + q * 1.8 : fx,
              pz = horiz ? fz : bz + q * 1.8;
            box(px, 3.3, pz, horiz ? 1.3 : 0.7, 0.13, horiz ? 0.7 : 1.3, trim);
            box(
              px + nx * 0.28,
              3.7,
              pz + nz * 0.28,
              horiz ? 1.3 : 0.035,
              0.035,
              horiz ? 0.035 : 1.3,
              dark,
            );
            for (let rail = -0.5; rail <= 0.5; rail += 0.25)
              box(
                px + (horiz ? rail : 0) + nx * 0.28,
                3.5,
                pz + (horiz ? 0 : rail) + nz * 0.28,
                0.025,
                0.4,
                0.025,
                dark,
                false,
              );
          }
        }
      }
      if (map) {
        for (let a = -bw / 2 + 0.4; a < bw / 2; a += 1.1) {
          box(bx + a, bh + 0.55, bz - bd / 2, 0.58, 0.65, 0.55, wallMat);
          box(bx + a, bh + 0.55, bz + bd / 2, 0.58, 0.65, 0.55, wallMat);
        }
      } else if (w > 1 && h > 1) {
        box(bx + bw * 0.25, bh + 0.6, bz, 1, 0.65, 1.3, trim);
        for (let a = -0.4; a < 0.5; a += 0.17)
          box(bx + bw * 0.25 + a, bh + 0.95, bz, 0.06, 0.04, 1.2, dark, false);
      }
    }
  // Courtyard furniture, lamps, planters, and cover.
  const props = [
    [5.7, 5.4],
    [18.6, 5.3],
    [6.1, 14],
    [17.3, 14],
    [3.2, 21.4],
    [20.7, 21.5],
    [7.2, 9.2],
    [16.8, 9.3],
  ];
  for (let [x, z] of props) {
    x *= SCALE;
    z *= SCALE;
    if (map) {
      box(x, 1.3, z, 0.22, 2.6, 0.22, trim);
      box(x, 2.55, z, 0.52, 0.18, 0.52, roof);
      let lamp = new T.Mesh(new T.SphereGeometry(0.19, 12, 8), light);
      lamp.position.set(x, 2.8, z);
      group.add(lamp);
      let point = new T.PointLight(0xffa75b, 5, 6, 2);
      point.position.set(x, 2.9, z);
      group.add(point);
    } else {
      box(x, 0.34, z, 1, 0.68, 1, frame);
      box(x, 0.72, z, 0.8, 0.12, 0.8, trim);
      for (let i = 0; i < 4; i++) {
        let leaf = new T.Mesh(
          new T.IcosahedronGeometry(0.35, 1),
          material(0x697563, 0.05, 0.9),
        );
        leaf.scale.y = 1.8;
        leaf.position.set(
          x + ((i % 2) - 0.5) * 0.3,
          1.1 + Math.floor(i / 2) * 0.25,
          z,
        );
        group.add(leaf);
      }
    }
  }
  // Distant skyline gives the arenas a setting beyond their playable boundary.
  for (let i = 0; i < 26; i++) {
    let a = (i / 26) * Math.PI * 2,
      rad = 65 + r() * 30,
      hh = 10 + r() * 25;
    box(
      33 + Math.cos(a) * rad,
      hh / 2 - 2,
      33 + Math.sin(a) * rad,
      5 + r() * 9,
      hh,
      5 + r() * 7,
      material(map ? 0x373946 : 0x7d929f, 0.05, 0.9),
      false,
    );
  }
  // Street cables add depth without placing obstacles in the navigable lanes.
  if (!map) {
    for (let z of [16, 41]) {
      let points = [];
      for (let j = 0; j <= 24; j++)
        points.push(
          new T.Vector3(
            17 + j * 1.35,
            7 - Math.sin((j / 24) * Math.PI) * 1.1,
            z,
          ),
        );
      let cable = new T.Mesh(
        new T.TubeGeometry(new T.CatmullRomCurve3(points), 36, 0.016, 5, false),
        dark,
      );
      group.add(cable);
    }
  }
  for (let batch of batches.values()) {
    let mesh = new T.InstancedMesh(unitBox, batch.mat, batch.items.length);
    mesh.castShadow = batch.shadow;
    mesh.receiveShadow = true;
    for (let [i, o] of batch.items.entries()) {
      matrix.compose(
        new T.Vector3(o.x, o.y, o.z),
        quat,
        new T.Vector3(o.w, o.h, o.d),
      );
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }
  let beacon = new T.Group();
  beacon.position.set(12 * SCALE, 0, 21.5 * SCALE);
  let ring = new T.Mesh(new T.TorusGeometry(1.3, 0.05, 8, 48), blue);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  beacon.add(ring);
  let beam = new T.Mesh(
    new T.CylinderGeometry(0.8, 0.8, 7, 24, 1, true),
    new T.MeshBasicMaterial({
      color: 0x77c5ee,
      transparent: true,
      opacity: 0.17,
      side: T.DoubleSide,
      depthWrite: false,
    }),
  );
  beam.position.y = 3.5;
  beacon.add(beam);
  beacon.visible = false;
  group.add(beacon);
  return { group, grid, colliders, beacon, map };
}
