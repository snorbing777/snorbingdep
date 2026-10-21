import * as T from "./vendor/three.module.js";
export function createLobby() {
  const scene = new T.Scene();
  scene.background = new T.Color(0x10151d);
  scene.fog = new T.Fog(0x10151d, 9, 24);
  const camera = new T.PerspectiveCamera(
    42,
    innerWidth / innerHeight,
    0.06,
    50,
  );
  camera.position.set(0, 1.55, 5.2);
  camera.lookAt(0, 1.45, 0);
  scene.add(new T.HemisphereLight(0x9fb8cf, 0x252832, 1.3));
  let key = new T.SpotLight(0xe9f0f5, 65, 20, 0.65, 0.75, 1.5);
  key.position.set(-0.3, 5.5, 3.5);
  key.target.position.set(1.4, 1.2, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.001;
  scene.add(key, key.target);
  let rim = new T.PointLight(0x619bd2, 28, 10, 1.6);
  rim.position.set(3, 2, -2);
  scene.add(rim);
  let warm = new T.PointLight(0xf2c6a0, 12, 8, 1.7);
  warm.position.set(-2, 2.5, 1);
  scene.add(warm);
  const metal = new T.MeshStandardMaterial({
      color: 0x303943,
      metalness: 0.65,
      roughness: 0.46,
    }),
    floor = new T.MeshStandardMaterial({
      color: 0x1a222c,
      metalness: 0.35,
      roughness: 0.4,
    }),
    edge = new T.MeshStandardMaterial({
      color: 0x50708d,
      metalness: 0.4,
      roughness: 0.4,
    });
  let ground = new T.Mesh(new T.PlaneGeometry(35, 35), floor);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  function box(x, y, z, w, h, d, mat) {
    let m = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  }
  box(1.45, 0.055, 0, 3.5, 0.1, 2.9, metal);
  for (let x = -0.2; x < 3.2; x += 0.17)
    box(x, 0.111, 0, 0.004, 0.004, 2.8, edge);
  const glow = new T.MeshBasicMaterial({ color: 0x79a9d3 });
  box(1.45, 0.12, 1.45, 3.5, 0.012, 0.012, glow);
  box(3.2, 0.12, 0, 0.012, 0.012, 2.9, glow);
  for (let x = -7; x < 9; x += 1.2) {
    box(x, 2.5, -4, 0.5, 5, 0.25, metal);
    box(
      x + 0.34,
      2.5,
      -4.12,
      0.02,
      4.2,
      0.03,
      new T.MeshBasicMaterial({ color: 0x253e56 }),
    );
  }
  for (let y = 0.3; y < 4.8; y += 0.34) box(1, y, -4.15, 18, 0.006, 0.02, edge);
  let soft = new T.Mesh(
    new T.PlaneGeometry(14, 8),
    new T.MeshBasicMaterial({
      color: 0x152334,
      transparent: true,
      opacity: 0.3,
    }),
  );
  soft.position.set(1.5, 2, -4.2);
  scene.add(soft);
  return { scene, camera };
}
