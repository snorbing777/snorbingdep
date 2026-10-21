import * as T from "./vendor/three.module.js";
import { buildWeapon } from "./weapons.js";
import { RoundedBoxGeometry } from "./vendor/RoundedBoxGeometry.js";
const boxGeo = new T.BoxGeometry(1, 1, 1),
  roundGeo = new RoundedBoxGeometry(1, 1, 1, 2, 0.08),
  sphereGeo = new T.SphereGeometry(1, 16, 10),
  cylinderGeo = new T.CylinderGeometry(1, 1, 1, 16),
  materials = new Map();
export function material(
  color,
  metalness = 0.15,
  roughness = 0.6,
  emissive = 0,
) {
  let key = [color, metalness, roughness, emissive].join();
  if (!materials.has(key))
    materials.set(
      key,
      new T.MeshStandardMaterial({
        color,
        metalness,
        roughness,
        emissive,
        emissiveIntensity: emissive ? 1.5 : 0,
      }),
    );
  return materials.get(key);
}
export function part(parent, x, y, z, w, h, d, mat, rounded = true) {
  let m = new T.Mesh(rounded ? roundGeo : boxGeo, mat);
  m.position.set(x, y, z);
  m.scale.set(w, h, d);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function sphere(parent, x, y, z, w, h, d, mat) {
  let m = new T.Mesh(sphereGeo, mat);
  m.position.set(x, y, z);
  m.scale.set(w, h, d);
  m.castShadow = true;
  parent.add(m);
  return m;
}
export function makeWeapon(type = "ar", color = 0x8a939b, variant = "") {
  return buildWeapon(type, color, variant);
}
export function makeCharacter(
  color = 0xb27954,
  hostile = false,
  heavy = false,
) {
  let root = new T.Group(),
    armor = material(color, 0.35, 0.48),
    dark = material(0x283340, 0.2, 0.8),
    joint = material(0x181f2a, 0.2, 0.65),
    trim = material(0x8c9ca7, 0.65, 0.28),
    visor = material(
      hostile ? 0xff755c : 0x64b7db,
      0.7,
      0.18,
      hostile ? 0x7d2418 : 0x14415a,
    );
  const rig = { root };
  let hips = new T.Group();
  hips.position.y = 0.91;
  root.add(hips);
  part(hips, 0, 0, 0, 0.4, 0.24, 0.25, dark);
  let torso = new T.Group();
  torso.position.y = 1.18;
  root.add(torso);
  part(torso, 0, 0.12, 0, 0.47, 0.48, 0.28, armor);
  part(torso, 0, 0.12, -0.16, 0.37, 0.26, 0.09, dark);
  part(torso, 0, 0.16, -0.22, 0.22, 0.05, 0.025, trim);
  part(torso, 0, 0.04, -0.22, 0.08, 0.06, 0.025, visor);
  part(torso, 0, 0.1, 0.21, 0.3, 0.32, 0.16, dark);
  for (let x of [-0.14, 0, 0.14])
    part(torso, x, -0.14, -0.17, 0.1, 0.13, 0.08, dark);
  let head = new T.Group();
  head.position.y = 1.64;
  root.add(head);
  sphere(head, 0, 0.02, 0, 0.18, 0.2, 0.17, armor);
  part(head, 0, 0.01, -0.135, 0.32, 0.12, 0.1, joint);
  part(head, 0, 0.025, -0.192, 0.26, 0.055, 0.025, visor);
  part(head, 0, -0.1, -0.1, 0.23, 0.1, 0.15, trim);
  part(head, -0.19, 0.01, 0, 0.06, 0.16, 0.1, dark);
  part(head, 0.19, 0.01, 0, 0.06, 0.16, 0.1, dark);
  part(head, 0.13, 0.18, 0.04, 0.018, 0.18, 0.018, trim, false);
  for (let side of [-1, 1]) {
    let arm = new T.Group();
    arm.position.set(side * 0.3, 1.42, 0);
    root.add(arm);
    sphere(arm, 0, -0.03, 0, 0.14, 0.13, 0.15, armor);
    part(arm, 0, -0.19, 0, 0.15, 0.3, 0.17, dark);
    let fore = new T.Group();
    fore.position.y = -0.33;
    arm.add(fore);
    fore.rotation.x = 1.05;
    part(fore, 0, -0.13, 0, 0.17, 0.26, 0.17, armor);
    sphere(fore, 0, -0.3, 0, 0.085, 0.09, 0.085, joint);
    arm.rotation.z = side * -0.12;
    rig[side < 0 ? "leftArm" : "rightArm"] = arm;
    let leg = new T.Group();
    leg.position.set(side * 0.14, 0.91, 0);
    root.add(leg);
    part(leg, 0, -0.2, 0, 0.19, 0.38, 0.2, dark);
    sphere(leg, 0, -0.4, -0.03, 0.11, 0.1, 0.11, armor);
    part(leg, 0, -0.58, 0, 0.17, 0.32, 0.18, armor);
    part(leg, 0, -0.79, -0.07, 0.2, 0.13, 0.32, joint);
    rig[side < 0 ? "leftLeg" : "rightLeg"] = leg;
  }
  let weapon = makeWeapon(heavy ? "lmg" : "ar", color);
  weapon.position.set(0.13, 1.03, -0.47);
  weapon.rotation.x = -0.05;
  weapon.scale.setScalar(0.7);
  root.add(weapon);
  rig.weapon = weapon;
  rig.torso = torso;
  rig.head = head;
  rig.animate = (t, moving = true) => {
    let a = moving ? Math.sin(t) * 0.48 : Math.sin(t * 0.3) * 0.025;
    rig.leftLeg.rotation.x = a;
    rig.rightLeg.rotation.x = -a;
    torso.position.y = 1.18 + Math.abs(Math.sin(t)) * (moving ? 0.025 : 0.008);
    rig.leftArm.rotation.x = -0.3 + (moving ? a * 0.15 : 0);
    rig.rightArm.rotation.x = -0.45;
    head.rotation.y = Math.sin(t * 0.17) * 0.05;
  };
  if (heavy) {
    root.scale.setScalar(1.15);
    part(torso, -0.29, 0.22, 0, 0.18, 0.22, 0.35, armor);
    part(torso, 0.29, 0.22, 0, 0.18, 0.22, 0.35, armor);
  }
  return rig;
}
export function makeHands(weaponDef, color, skinColor = 0x9c8370) {
  let g = new T.Group(),
    skin = material(skinColor, 0.05, 0.8),
    gloves = material(0x252e39, 0.05, 0.8),
    sleeve = material(color, 0.15, 0.65),
    weapon = makeWeapon(
      weaponDef.family || weaponDef.id,
      weaponDef.color,
      weaponDef.variant,
    );
  g.add(weapon);
  part(g, 0.11, -0.16, 0.1, 0.12, 0.16, 0.17, gloves);
  part(g, 0.15, -0.25, 0.22, 0.15, 0.25, 0.3, sleeve).rotation.x = 0.4;
  if (weaponDef.id !== "pistol") {
    part(g, -0.06, -0.14, -0.4, 0.12, 0.1, 0.16, gloves);
    part(g, -0.14, -0.23, -0.26, 0.14, 0.2, 0.35, sleeve).rotation.z = -0.35;
  }
  g.userData.weapon = weapon;
  return g;
}

// The supplied photos remain unmodified assets. UV transforms select their face
// regions for the modeled heads; body, hair, and clothing geometry is original.
const policeFaces = [];
export async function loadPoliceReferences() {
  const loader = new T.TextureLoader();
  const crops = [
    [0.403, 0.119, 0.184, 0.405],
    [0.423, 0.14, 0.145, 0.216],
  ];
  for (let i = 0; i < 2; i++) {
    const texture = await loader.loadAsync(
      `assets/police-0${i + 1}-reference.avif`,
    );
    texture.colorSpace = T.SRGBColorSpace;
    texture.anisotropy = 8;
    const [x, y, w, h] = crops[i];
    texture.repeat.set(w, h);
    texture.offset.set(x, 1 - y - h);
    policeFaces[i] = new T.MeshStandardMaterial({
      map: texture,
      roughness: 0.85,
      metalness: 0,
      side: T.DoubleSide,
    });
  }
}
function shirtMaterial(index) {
  let c = document.createElement("canvas");
  c.width = c.height = 512;
  let g = c.getContext("2d");
  g.fillStyle = index ? "#142c4d" : "#e3e4de";
  g.fillRect(0, 0, 512, 512);
  if (!index) {
    g.strokeStyle = "#536075";
    g.lineWidth = 2.2;
    for (let x = 0; x < 512; x += 24) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, 512);
      g.stroke();
    }
  }
  g.fillStyle = index ? "#233c5b" : "#f4f2e8";
  g.fillRect(247, 0, 18, 512);
  g.fillStyle = index ? "#111d30" : "#a3a39d";
  for (let y = 80; y < 512; y += 85) {
    g.beginPath();
    g.arc(256, y, 3.5, 0, TAU);
    g.fill();
  }
  if (!index) {
    g.fillStyle = "#202d45";
    g.font = "bold 70px serif";
    g.fillText("NY", 340, 320);
  }
  g.fillStyle = "#246aa5";
  g.fillRect(62, 148, 120, 50);
  g.fillStyle = "#e7f3ff";
  g.font = "bold 23px sans-serif";
  g.fillText("POLICE", 72, 181);
  let tx = new T.CanvasTexture(c);
  tx.colorSpace = T.SRGBColorSpace;
  return new T.MeshStandardMaterial({ map: tx, roughness: 0.95 });
}
const TAU = Math.PI * 2;
export function makePoliceCharacter(index = 0) {
  const root = new T.Group(),
    rig = { root },
    skin = material(index ? 0xd7a789 : 0xb98160, 0.02, 0.85),
    hair = material(index ? 0x30221d : 0x181617, 0.02, 0.95),
    pants = material(index ? 0x1d2633 : 0x263752, 0.05, 0.92),
    shoes = material(0x1d242c, 0.1, 0.7),
    shirt = shirtMaterial(index),
    cloth = material(index ? 0x182f4e : 0xe2e3dd, 0.02, 0.95),
    blue = material(0x3279bc, 0.15, 0.6),
    black = material(0x242a31, 0.1, 0.85);
  part(root, 0, 0.94, 0, 0.35, 0.2, 0.25, pants);
  part(root, 0, 1.01, 0, 0.36, 0.045, 0.27, black);
  part(
    root,
    0.02,
    1.01,
    -0.15,
    0.065,
    0.045,
    0.025,
    material(0xb9bec4, 0.7, 0.3),
  );
  const torso = new T.Group();
  torso.position.y = 1.24;
  root.add(torso);
  part(torso, 0, 0.02, 0, 0.46, 0.49, 0.28, cloth);
  let shirtFront = new T.Mesh(new T.PlaneGeometry(0.44, 0.47), shirt);
  shirtFront.position.set(0, 0.02, -0.149);
  shirtFront.rotation.y = Math.PI;
  torso.add(shirtFront);
  // Narrow shirt collars leave the reference faces unobstructed.
  part(torso, -0.055, 0.265, -0.1, 0.1, 0.09, 0.12, cloth).rotation.z = -0.35;
  part(torso, 0.055, 0.265, -0.1, 0.1, 0.09, 0.12, cloth).rotation.z = 0.35;
  let neck = new T.Mesh(cylinderGeo, skin);
  neck.position.set(0, 1.49, 0);
  neck.scale.set(0.073, 0.12, 0.073);
  root.add(neck);
  const head = new T.Group();
  head.position.y = 1.7;
  root.add(head);
  sphere(head, 0, 0, 0, 0.174, 0.223, 0.166, skin);
  sphere(head, -0.177, -0.005, 0, 0.031, 0.063, 0.038, skin);
  sphere(head, 0.177, -0.005, 0, 0.031, 0.063, 0.038, skin);
  const faceGeo = new T.PlaneGeometry(0.292, 0.37, 20, 24),
    v = faceGeo.attributes.position;
  for (let i = 0; i < v.count; i++) {
    let x = v.getX(i),
      y = v.getY(i),
      z = -0.169 * Math.sqrt(Math.max(0.15, 1 - (x / 0.195) ** 2));
    z -= 0.029 * Math.exp((-x * x) / 0.001 - (y * y) / 0.002);
    v.setZ(i, z - 0.008);
  }
  faceGeo.computeVertexNormals();
  let face = new T.Mesh(faceGeo, policeFaces[index] || skin);
  face.position.y = -0.003;
  head.add(face);
  if (index) {
    let rng = (i) => Math.sin(i * 47.13) * 0.5 + 0.5;
    for (let i = 0; i < 38; i++) {
      let a = i * 2.4,
        r = 0.14 * Math.sqrt(rng(i)),
        x = Math.cos(a) * r,
        z = Math.sin(a) * r;
      let curl = sphere(
        head,
        x,
        0.18 + Math.sqrt(Math.max(0, 0.024 - x * x - z * z)) * 0.25,
        z,
        0.043,
        0.044,
        0.043,
        hair,
      );
      curl.rotation.z = a;
    }
    sphere(head, -0.145, 0.09, 0.02, 0.035, 0.1, 0.08, hair);
    sphere(head, 0.145, 0.09, 0.02, 0.035, 0.1, 0.08, hair);
  } else {
    let cap = new T.Mesh(new T.SphereGeometry(1, 24, 12, 0, TAU, 0, 1.3), hair);
    cap.scale.set(0.177, 0.224, 0.169);
    cap.position.y = 0.01;
    head.add(cap);
    part(head, -0.153, 0.06, 0.015, 0.02, 0.12, 0.12, hair);
    part(head, 0.153, 0.06, 0.015, 0.02, 0.12, 0.12, hair);
  }
  for (let side of [-1, 1]) {
    let arm = new T.Group();
    arm.position.set(side * 0.275, 1.43, 0);
    root.add(arm);
    sphere(arm, 0, -0.04, 0, 0.115, 0.125, 0.13, cloth);
    part(arm, 0, -0.13, 0, 0.18, 0.2, 0.21, cloth);
    part(arm, 0, -0.23, 0, 0.137, 0.22, 0.15, skin);
    part(arm, 0, -0.17, 0, 0.185, 0.045, 0.215, blue);
    let fore = new T.Group();
    fore.position.y = -0.34;
    fore.rotation.x = 1.15;
    arm.add(fore);
    part(fore, 0, -0.14, 0, 0.135, 0.27, 0.14, skin);
    sphere(fore, 0, -0.3, 0, 0.075, 0.085, 0.07, skin);
    if (index && side < 0) {
      part(fore, 0, -0.23, 0, 0.15, 0.04, 0.15, black);
      part(
        fore,
        0,
        -0.23,
        -0.085,
        0.08,
        0.08,
        0.025,
        material(0x9dabb8, 0.6, 0.3),
      );
    }
    arm.rotation.z = side * -0.1;
    rig[side < 0 ? "leftArm" : "rightArm"] = arm;
    let leg = new T.Group();
    leg.position.set(side * 0.115, 0.91, 0);
    root.add(leg);
    part(leg, 0, -0.21, 0, 0.185, 0.42, 0.22, pants);
    part(leg, 0, -0.6, 0, 0.165, 0.38, 0.19, pants);
    part(leg, 0, -0.82, -0.075, 0.19, 0.13, 0.32, shoes);
    rig[side < 0 ? "leftLeg" : "rightLeg"] = leg;
  }
  let weapon = makeWeapon("ar", 0x557b99, "m4");
  weapon.position.set(0.13, 1.03, -0.48);
  weapon.scale.setScalar(0.68);
  root.add(weapon);
  rig.weapon = weapon;
  rig.torso = torso;
  rig.head = head;
  root.userData.team = "police";
  root.userData.reference = index;
  rig.animate = (t, moving = false) => {
    let a = moving ? Math.sin(t) * 0.46 : Math.sin(t * 0.3) * 0.018;
    rig.leftLeg.rotation.x = a;
    rig.rightLeg.rotation.x = -a;
    rig.leftArm.rotation.x = 0.1;
    rig.rightArm.rotation.x = 0.05;
    torso.position.y =
      1.24 +
      (moving ? Math.abs(Math.sin(t)) * 0.025 : Math.sin(t * 0.5) * 0.004);
    head.rotation.y = Math.sin(t * 0.18) * 0.05;
  };
  return rig;
}
const starMaterial = new T.MeshStandardMaterial({
  color: 0xc9ecff,
  emissive: 0x397fae,
  emissiveIntensity: 1.6,
  metalness: 0.45,
  roughness: 0.25,
});
function triangleRing(flipped = false) {
  let shape = new T.Shape(),
    radius = 0.22,
    inner = 0.155,
    points = Array.from({ length: 3 }, (_, i) => {
      let a = Math.PI / 2 + (flipped ? Math.PI : 0) + (i * TAU) / 3;
      return [Math.cos(a) * radius, Math.sin(a) * radius];
    });
  shape.moveTo(...points[0]);
  shape.lineTo(...points[1]);
  shape.lineTo(...points[2]);
  shape.closePath();
  let hole = new T.Path();
  let inside = Array.from({ length: 3 }, (_, i) => {
    let a = Math.PI / 2 + (flipped ? Math.PI : 0) - (i * TAU) / 3;
    return [Math.cos(a) * inner, Math.sin(a) * inner];
  });
  hole.moveTo(...inside[0]);
  hole.lineTo(...inside[1]);
  hole.lineTo(...inside[2]);
  hole.closePath();
  shape.holes.push(hole);
  return new T.ExtrudeGeometry(shape, {
    depth: 0.025,
    bevelEnabled: true,
    bevelThickness: 0.005,
    bevelSize: 0.005,
    bevelSegments: 1,
    steps: 1,
  });
}
const starTriangles = [triangleRing(), triangleRing(true)];
const hostileStarMaterial = new T.MeshStandardMaterial({
  color: 0xffc39b,
  emissive: 0xab4c22,
  emissiveIntensity: 1.6,
  metalness: 0.4,
  roughness: 0.3,
});
export function makeStarProjectile(hostile = false) {
  let group = new T.Group();
  for (let geo of starTriangles) {
    let mesh = new T.Mesh(geo, hostile ? hostileStarMaterial : starMaterial);
    group.add(mesh);
  }
  group.userData.kind = "star-of-david";
  return group;
}

// Entirely fictional red-team operatives: no supplied political likenesses or
// photo textures are used for these characters.
export function makeRedCharacter(index = 0, heavy = false) {
  const suitColor = index ? 0x222c40 : 0x333238,
    rig = makeCharacter(suitColor, true, heavy),
    suit = material(suitColor, 0.02, 0.92),
    skin = material(index ? 0xb88161 : 0x80543f, 0.02, 0.88),
    white = material(0xe4e1d9, 0.02, 0.9),
    red = material(0x9b3238, 0.05, 0.8),
    hair = material(0x251e1b, 0.02, 0.95),
    black = material(0x171b20, 0.02, 0.9);
  rig.root.traverse((m) => {
    if (m.isMesh && m !== rig.weapon) {
      m.material = suit;
    }
  });
  rig.torso.clear();
  part(rig.torso, 0, 0.1, 0, 0.47, 0.48, 0.28, suit);
  part(rig.torso, 0, 0.14, -0.155, 0.18, 0.38, 0.02, white);
  part(rig.torso, -0.13, 0.19, -0.17, 0.12, 0.34, 0.04, suit).rotation.z =
    -0.23;
  part(rig.torso, 0.13, 0.19, -0.17, 0.12, 0.34, 0.04, suit).rotation.z = 0.23;
  let tie = part(
    rig.torso,
    0,
    0.15,
    -0.185,
    0.055,
    0.31,
    0.025,
    index ? material(0x6d8398, 0.05, 0.7) : red,
  );
  tie.rotation.z = 0.02;
  part(rig.torso, 0, 0.33, -0.18, 0.075, 0.055, 0.03, white);
  for (let y of [-0.03, -0.13])
    part(rig.torso, 0.035, y, -0.16, 0.017, 0.017, 0.015, black);
  part(rig.torso, -0.16, 0.19, -0.19, 0.085, 0.035, 0.012, red);
  rig.head.clear();
  sphere(rig.head, 0, 0.015, 0, 0.175, 0.224, 0.162, skin);
  sphere(rig.head, -0.176, -0.005, 0, 0.031, 0.059, 0.04, skin);
  sphere(rig.head, 0.176, -0.005, 0, 0.031, 0.059, 0.04, skin);
  sphere(rig.head, 0, -0.015, -0.157, 0.036, 0.058, 0.04, skin);
  for (let side of [-1, 1]) {
    sphere(rig.head, side * 0.071, 0.055, -0.143, 0.043, 0.019, 0.012, white);
    sphere(rig.head, side * 0.071, 0.055, -0.155, 0.016, 0.017, 0.009, black);
    let brow = part(
      rig.head,
      side * 0.074,
      0.095,
      -0.144,
      0.082,
      0.014,
      0.014,
      hair,
    );
    brow.rotation.z = side * 0.06;
  }
  part(
    rig.head,
    0,
    -0.107,
    -0.139,
    0.092,
    0.012,
    0.012,
    material(index ? 0x775444 : 0x4e352d, 0.02, 0.9),
  );
  if (index) {
    for (let i = 0; i < 22; i++) {
      let a = i * 2.4,
        r = 0.13 * Math.sqrt((i + 0.5) / 22);
      sphere(
        rig.head,
        Math.cos(a) * r,
        0.207,
        Math.sin(a) * r,
        0.047,
        0.038,
        0.045,
        hair,
      );
    }
  } else {
    // Bald scalp and dark glasses distinguish this fictional face from either reference.
    for (let side of [-1, 1]) {
      part(rig.head, side * 0.075, 0.055, -0.164, 0.11, 0.065, 0.016, black);
      part(
        rig.head,
        side * 0.075,
        0.055,
        -0.175,
        0.087,
        0.043,
        0.009,
        material(0x384a55, 0.3, 0.25),
      );
    }
    part(rig.head, 0, 0.055, -0.173, 0.035, 0.012, 0.01, black);
  }
  for (let arm of [rig.leftArm, rig.rightArm]) {
    let fore = arm.children.find((c) => c.isGroup);
    if (fore) {
      let hand = fore.children[fore.children.length - 1];
      if (hand) hand.material = skin;
    }
  }
  const band = red;
  part(rig.leftArm, 0, -0.18, 0, 0.165, 0.05, 0.19, band);
  part(rig.rightArm, 0, -0.18, 0, 0.165, 0.05, 0.19, band);
  rig.root.remove(rig.weapon);
  rig.weapon = makeWeapon(
    "ar",
    index ? 0x6d7180 : 0x9b7359,
    index ? "m4" : "ak",
  );
  rig.weapon.position.set(0.13, 1.03, -0.47);
  rig.weapon.scale.setScalar(0.7);
  rig.root.add(rig.weapon);
  rig.root.userData.team = "red";
  rig.root.userData.fictional = true;
  rig.root.userData.character = index ? "Rook" : "Vesper";
  return rig;
}
