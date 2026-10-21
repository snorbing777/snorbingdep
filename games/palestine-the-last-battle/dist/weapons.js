import * as T from "./vendor/three.module.js";
import { RoundedBoxGeometry } from "./vendor/RoundedBoxGeometry.js";
const geos = {
    box: new RoundedBoxGeometry(1, 1, 1, 3, 0.06),
    cube: new T.BoxGeometry(1, 1, 1),
    cylinder: new T.CylinderGeometry(1, 1, 1, 28),
    ring: new T.TorusGeometry(1, 0.17, 10, 32),
    sphere: new T.SphereGeometry(1, 16, 10),
    disc: new T.CircleGeometry(1, 32),
  },
  templates = new Map(),
  mats = new Map();
function brushed() {
  let c = document.createElement("canvas");
  c.width = c.height = 512;
  let g = c.getContext("2d");
  g.fillStyle = "#858585";
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2200; i++) {
    let y = (i * 31.347) % 512;
    g.strokeStyle = i % 2 ? "#aaaaaa35" : "#49494925";
    g.lineWidth = 0.3;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(512, y + 0.4);
    g.stroke();
  }
  let t = new T.CanvasTexture(c);
  t.wrapS = t.wrapT = T.RepeatWrapping;
  t.repeat.set(3, 2);
  return t;
}
let finish;
function mat(color, metal = 0.7, rough = 0.35) {
  const key = [color, metal, rough].join();
  if (!mats.has(key)) {
    finish ??= brushed();
    mats.set(
      key,
      new T.MeshStandardMaterial({
        color,
        metalness: metal,
        roughness: rough,
        bumpMap: finish,
        bumpScale: 0.0007,
        envMapIntensity: 1.1,
      }),
    );
  }
  return mats.get(key);
}
function extruded(points, depth = 0.09) {
  let s = new T.Shape();
  points.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  let g = new T.ExtrudeGeometry(s, {
    depth,
    bevelEnabled: true,
    bevelSize: 0.005,
    bevelThickness: 0.005,
    bevelSegments: 2,
    steps: 1,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}
const magazineGeo = extruded(
    [
      [-0.055, 0],
      [0.055, 0],
      [0.065, -0.16],
      [0.1, -0.3],
      [0.015, -0.34],
      [-0.035, -0.18],
    ],
    0.085,
  ),
  gripGeo = extruded(
    [
      [-0.05, 0],
      [0.05, 0],
      [0.075, -0.22],
      [-0.035, -0.24],
    ],
    0.085,
  ),
  stockGeo = extruded(
    [
      [-0.06, 0.06],
      [0.18, 0.03],
      [0.32, 0.09],
      [0.33, -0.12],
      [0.21, -0.12],
      [0.12, -0.055],
      [-0.06, -0.03],
    ],
    0.1,
  );
export function buildWeapon(type = "ar", color = 0x8a939b, variant = "") {
  const key = [type, color, variant].join();
  if (templates.has(key)) return templates.get(key).clone(true);
  const root = new T.Group(),
    steel = mat(0x46525c, 0.88, 0.29),
    dark = mat(0x20272e, 0.65, 0.36),
    polymer = mat(0x252c30, 0.08, 0.83),
    accent = mat(color, 0.18, 0.65),
    silver = mat(0x87939b, 0.9, 0.26),
    black = mat(0x080d12, 0.1, 0.4),
    wood = mat(0x6f4730, 0.03, 0.54),
    lens = new T.MeshPhysicalMaterial({
      color: 0x263d47,
      metalness: 0.35,
      roughness: 0.06,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      envMapIntensity: 1.6,
    });
  function mesh(geo, x, y, z, w, h, d, material, rx = 0, ry = 0, rz = 0) {
    let m = new T.Mesh(geo, material);
    m.position.set(x, y, z);
    m.scale.set(w, h, d);
    m.rotation.set(rx, ry, rz);
    root.add(m);
    return m;
  }
  const box = (x, y, z, w, h, d, m = dark) =>
    mesh(geos.box, x, y, z, w, h, d, m);
  const barrel = (x, y, z, r, len, m = steel) =>
    mesh(geos.cylinder, x, y, z, r, len, r, m, Math.PI / 2);
  const ring = (x, y, z, r, m = steel) => mesh(geos.ring, x, y, z, r, r, r, m);
  const scoped = type === "sniper" || type === "dmr",
    pistol = type === "pistol",
    smg = type === "smg",
    shotgun = type === "sg",
    lmg = type === "lmg",
    ak = variant === "ak",
    bull = variant === "bullpup",
    p90 = variant === "p90",
    mp5 = variant === "mp5";
  const front = scoped
      ? -0.98
      : shotgun
        ? -0.89
        : pistol
          ? -0.42
          : smg
            ? -0.65
            : -0.81,
    bodyBack = pistol ? 0.08 : 0.18,
    bodyFront = pistol ? -0.34 : smg ? -0.37 : -0.48;
  box(
    0,
    0.015,
    (bodyBack + bodyFront) / 2,
    0.105,
    0.135,
    bodyBack - bodyFront,
    steel,
  );
  box(0, -0.045, -0.12, 0.11, 0.105, 0.3, dark);
  box(0.059, 0.03, -0.1, 0.006, 0.052, 0.12, black);
  box(0.064, 0.033, -0.1, 0.01, 0.027, 0.09, silver);
  box(-0.06, 0.017, 0.02, 0.025, 0.016, 0.09, steel);
  // Selector, pins, bolt-release, and magazine well.
  for (let z of [-0.22, -0.08, 0.06])
    mesh(
      geos.cylinder,
      0.059,
      -0.025,
      z,
      0.012,
      0.009,
      0.012,
      silver,
      0,
      0,
      Math.PI / 2,
    );
  box(0.064, -0.045, 0.025, 0.015, 0.017, 0.055, steel);
  barrel(-0.065, 0.055, -0.03, 0.012, 0.06, silver);
  if (!pistol) {
    box(0, 0.099, -0.17, 0.115, 0.022, 0.42, dark);
    for (let z = -0.37; z < 0.06; z += 0.027)
      box(0, 0.114, z, 0.112, 0.012, 0.011, steel);
    barrel(0, 0.027, (bodyFront + front) / 2, 0.018, bodyFront - front, steel);
    barrel(0, 0.027, front + 0.025, 0.03, 0.09, dark);
    mesh(
      geos.disc,
      0,
      0.027,
      front - 0.023,
      0.019,
      0.019,
      1,
      black,
      0,
      Math.PI,
    );
    ring(0, 0.027, front - 0.024, 0.025, steel);
    let guard = scoped ? 0.23 : smg ? 0.2 : 0.27,
      gz = bodyFront - 0.05;
    box(0, 0.008, gz, 0.117, 0.12, guard, ak ? wood : accent);
    for (
      let z = gz - guard / 2 + 0.035;
      z < gz + guard / 2 - 0.015;
      z += 0.034
    ) {
      box(0.061, 0.01, z, 0.009, 0.047, 0.018, black);
      box(-0.061, 0.01, z, 0.009, 0.047, 0.018, black);
    }
    if (!scoped) {
      box(0, 0.067, front + 0.1, 0.04, 0.085, 0.035, dark);
      box(0, 0.122, front + 0.1, 0.012, 0.032, 0.012, silver);
      box(0, 0.115, 0.012, 0.06, 0.07, 0.035, dark);
      ring(0, 0.144, -0.007, 0.022, dark);
    }
    // Separate trigger, guard, grip, and shaped stock.
    let grip = mesh(gripGeo, 0, -0.09, 0.015, 1, 1, 1, polymer, 0, Math.PI / 2);
    box(0, -0.109, -0.083, 0.014, 0.055, 0.014, steel);
    box(0, -0.148, -0.09, 0.09, 0.016, 0.11, dark);
    box(0, -0.108, -0.148, 0.09, 0.065, 0.015, dark);
    barrel(0, 0.015, 0.24, 0.028, 0.18, steel);
    let st = mesh(
      stockGeo,
      0,
      -0.01,
      0.28,
      1,
      1,
      1,
      ak ? wood : accent,
      0,
      -Math.PI / 2,
    );
    box(0, -0.03, 0.48, 0.12, 0.22, 0.035, polymer);
    for (let y = -0.11; y < 0.06; y += 0.022)
      box(0, y, 0.5, 0.095, 0.006, 0.006, dark);
    if (ak) {
      mesh(magazineGeo, 0, -0.085, -0.19, 1, 1, 1, steel, 0, Math.PI / 2);
      for (let y = -0.15; y > -0.34; y -= 0.04)
        box(0.049, y, -0.17, 0.006, 0.009, 0.075, steel);
    } else if (p90) {
      box(0, 0.16, -0.13, 0.165, 0.07, 0.48, mat(0x877b58, 0.15, 0.35));
      box(0, 0.17, -0.13, 0.11, 0.015, 0.4, mat(0xc6b680, 0.2, 0.45));
      box(0, -0.03, 0.1, 0.17, 0.22, 0.3, accent);
      box(0, -0.16, 0.13, 0.14, 0.045, 0.18, polymer);
    } else {
      let mz = bull ? 0.12 : -0.19;
      box(0, -0.19, mz, 0.087, lmg ? 0.27 : 0.22, 0.105, accent);
      box(0, -0.305, mz, 0.1, 0.023, 0.12, polymer);
      for (let z = mz - 0.035; z < mz + 0.05; z += 0.027)
        box(0.047, -0.2, z, 0.005, 0.14, 0.01, dark);
    }
    if (bull) {
      box(0, 0.19, -0.12, 0.11, 0.045, 0.4, dark);
      box(0, 0.135, -0.3, 0.08, 0.13, 0.035, dark);
      box(0, 0.13, 0.06, 0.08, 0.13, 0.035, dark);
    }
    if (mp5) {
      barrel(0, 0.01, -0.43, 0.055, 0.24, polymer);
      ring(0, 0.07, front + 0.08, 0.043, dark);
      barrel(0, 0.095, -0.25, 0.008, 0.21, steel);
    }
    if (shotgun) {
      barrel(0, -0.045, front + 0.19, 0.018, 0.45, steel);
      barrel(0, -0.035, -0.52, 0.049, 0.22, accent);
      for (let z = -0.62; z < -0.42; z += 0.025)
        ring(0, -0.035, z, 0.047, dark);
    }
    if (lmg) {
      box(0.025, -0.19, -0.15, 0.22, 0.22, 0.22, accent);
      box(0.025, -0.31, -0.15, 0.23, 0.025, 0.23, dark);
      box(0, 0.16, -0.21, 0.04, 0.1, 0.25, steel);
      box(0, 0.205, -0.21, 0.045, 0.035, 0.25, polymer);
    }
    if (scoped) {
      barrel(0, 0.225, -0.23, 0.061, 0.37, dark);
      barrel(0, 0.225, -0.43, 0.083, 0.1, dark);
      barrel(0, 0.225, -0.015, 0.072, 0.08, dark);
      ring(0, 0.225, -0.48, 0.079, steel);
      mesh(geos.disc, 0, 0.225, -0.487, 0.068, 0.068, 1, lens, 0, Math.PI);
      mesh(geos.disc, 0, 0.225, 0.029, 0.058, 0.058, 1, lens);
      for (let z of [-0.34, -0.13]) {
        box(0, 0.135, z, 0.04, 0.12, 0.045, steel);
        ring(0, 0.225, z, 0.066, steel);
      }
      mesh(geos.cylinder, 0, 0.315, -0.23, 0.031, 0.05, 0.031, steel);
      mesh(
        geos.cylinder,
        0.087,
        0.225,
        -0.23,
        0.03,
        0.05,
        0.03,
        dark,
        0,
        0,
        Math.PI / 2,
      );
      box(0.1, 0.044, 0.045, 0.12, 0.02, 0.026, steel);
      mesh(geos.sphere, 0.16, 0.044, 0.045, 0.027, 0.027, 0.027, polymer);
      for (let side of [-1, 1]) {
        let bipod = barrel(side * 0.067, -0.13, -0.67, 0.009, 0.25, steel);
        bipod.rotation.x = 0.25;
        bipod.rotation.z = side * 0.22;
      }
    }
  } else {
    box(0, 0.064, -0.14, 0.116, 0.1, 0.38, steel);
    box(0, 0.118, -0.14, 0.088, 0.012, 0.31, dark);
    barrel(0, 0.034, -0.34, 0.022, 0.14, steel);
    mesh(geos.disc, 0, 0.034, -0.412, 0.015, 0.015, 1, black, 0, Math.PI);
    mesh(gripGeo, 0, -0.05, 0.016, 1.15, 1.1, 1, polymer, 0, Math.PI / 2);
    box(0, -0.145, -0.073, 0.095, 0.015, 0.12, steel);
    box(0, -0.1, -0.13, 0.09, 0.09, 0.018, dark);
    box(0, 0.136, -0.3, 0.02, 0.024, 0.025, steel);
    box(0, 0.13, 0.025, 0.055, 0.025, 0.028, dark);
    for (let z = 0.015; z > -0.1; z -= 0.021)
      box(0.061, 0.075, z, 0.007, 0.055, 0.008, black);
  }
  const count = root.children.length,
    batches = new Map();
  for (let m of root.children) {
    m.updateMatrix();
    let k = m.geometry.uuid + m.material.uuid;
    if (!batches.has(k))
      batches.set(k, { geo: m.geometry, mat: m.material, matrices: [] });
    batches.get(k).matrices.push(m.matrix.clone());
  }
  root.clear();
  for (let b of batches.values()) {
    let inst = new T.InstancedMesh(b.geo, b.mat, b.matrices.length);
    b.matrices.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.castShadow = true;
    inst.receiveShadow = true;
    root.add(inst);
  }
  root.userData = {
    variant: variant || type,
    partCount: count,
    kind: "detailed-weapon",
  };
  templates.set(key, root);
  return root.clone(true);
}
