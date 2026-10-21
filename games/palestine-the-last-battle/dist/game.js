import * as T from "./vendor/three.module.js";
import {
  SCALE,
  OPERATORS,
  RED_OPERATORS,
  WEAPONS,
  MAP_INFO,
  saveStored,
  readStored,
} from "./data.js";
import {
  makeCharacter,
  makeRedCharacter,
  makePoliceCharacter,
  makeStarProjectile,
  makeHands,
  makeWeapon,
  material,
} from "./models.js";
import { createLobby } from "./lobby.js";
import { buildWorld } from "./world.js";
import { AudioEngine } from "./audio.js";
const TAU = Math.PI * 2,
  UP = new T.Vector3(0, 1, 0),
  dir = new T.Vector3(),
  tmp = new T.Vector3();
export class Game {
  constructor(canvas, settings, callbacks = {}) {
    this.canvas = canvas;
    this.settings = settings;
    this.callbacks = callbacks;
    this.audio = new AudioEngine(settings);
    this.state = "menu";
    this.page = "play";
    this.map = 0;
    this.op = 0;
    this.team = "police";
    this.equipped = [0, 5];
    this.keys = {};
    this.enemies = [];
    this.projectiles = [];
    this.pickups = [];
    this.particles = [];
    this.time = 0;
    this.clock = 0;
    this.last = 0;
    this.fireHeld = false;
    this.aiming = false;
    this.pointerLocked = false;
    this.touchMove = { x: 0, y: 0 };
    this.yaw = 0;
    this.pitch = 0;
    this.player = new T.Vector3(33.6, 0, 60.2);
    this.jumpY = 0;
    this.jumpV = 0;
    this.jumps = 0;
    this.noticeT = 0;
    this.walk = 0;
    this.recoil = 0;
    this.flash = 0;
    this.damageFlash = 0;
    this.hit = 0;
    this.slot = 0;
    this.ammo = [30, 12];
    this.cool = 0;
    this.reloadT = 0;
    this.boostT = 0;
    this.pulseT = 0;
    this.inv = 0;
    this.hp = 100;
    this.wave = 1;
    this.score = 0;
    this.kills = 0;
    this.spawnLeft = 0;
    this.spawnT = 0;
    this.clearT = 0;
    this.exit = false;
    this.pathT = 0;
    this.steps = 0;
    this.fps = 60;
    this.fpsCount = 0;
    this.fpsT = 0;
    this.frameCount = 0;
    this.renderer = new T.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
    this.renderer.setClearColor(0x8babc0);
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.scene = new T.Scene();
    this.camera = new T.PerspectiveCamera(
      settings.fov,
      innerWidth / innerHeight,
      0.06,
      230,
    );
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.camera);
    this.scene.add(new T.HemisphereLight(0xc8e4f2, 0x615a55, 2.3));
    this.sun = new T.DirectionalLight(0xffe6bf, 3.1);
    this.sun.position.set(6, 40, 8);
    this.sun.target.position.set(34, 0, 35);
    this.sun.castShadow = true;
    Object.assign(this.sun.shadow.camera, {
      left: -43,
      right: 43,
      top: 43,
      bottom: -43,
      near: 1,
      far: 100,
    });
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.06;
    this.scene.add(this.sun, this.sun.target);
    let fill = new T.DirectionalLight(0x88badd, 1.3);
    fill.position.set(50, 15, 60);
    this.scene.add(fill);
    this.fill = fill;
    this.worlds = [buildWorld(0), buildWorld(1)];
    for (let w of this.worlds) this.scene.add(w.group);
    const lobby = createLobby();
    this.lobbyScene = lobby.scene;
    this.lobbyCamera = lobby.camera;
    this.hero = makePoliceCharacter(0);
    this.lobbyScene.add(this.hero.root);
    this.weaponPreview = makeWeapon("ar", WEAPONS[0].color);
    this.lobbyScene.add(this.weaponPreview);
    this.weaponPreview.visible = false;
    this.previewLight = new T.PointLight(0xe8f4ff, 25, 18);
    this.previewLight.position.set(37, 4, 62);
    this.scene.add(this.previewLight);
    this.weaponScene = new T.Scene();
    this.weaponCamera = new T.PerspectiveCamera(
      65,
      innerWidth / innerHeight,
      0.01,
      10,
    );
    this.weaponScene.add(new T.HemisphereLight(0xd8e8f4, 0x4a4950, 3));
    let wkey = new T.DirectionalLight(0xffdfb5, 3);
    wkey.position.set(-1, 3, 2);
    this.weaponScene.add(wkey);
    this.weaponScene.add(new T.AmbientLight(0xd9e5ee, 1.4));
    this.hands = null;
    this.flashLight = new T.PointLight(0x8fcfff, 0, 5);
    this.weaponScene.add(this.flashLight);
    this.flashMesh = makeStarProjectile();
    this.flashMesh.scale.setScalar(0.4);
    this.weaponScene.add(this.flashMesh);
    this.selectMap(0);
    this.applySettings();
    this.bindInput();
    this.makeThumbnails();
    this.updatePreview();
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }
  applySettings() {
    let quality = this.settings.quality;
    this.renderer.setPixelRatio(
      quality === "high"
        ? Math.min(devicePixelRatio || 1, 1.5)
        : quality === "medium"
          ? 1
          : 0.7,
    );
    if (this.appliedQuality !== quality) {
      this.renderer.shadowMap.enabled = quality !== "low";
      this.sun.shadow.mapSize.setScalar(quality === "high" ? 2048 : 1024);
      if (this.sun.shadow.map) {
        this.sun.shadow.map.dispose();
        this.sun.shadow.map = null;
      }
      this.appliedQuality = quality;
    }
    this.renderer.toneMappingExposure = this.settings.brightness || 1.1;
    this.camera.fov = this.settings.fov;
    this.camera.updateProjectionMatrix();
    this.audio.apply();
    this.resize();
  }
  resize() {
    let w = innerWidth,
      h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = this.weaponCamera.aspect = w / h;
    this.lobbyCamera.aspect = w / h;
    this.lobbyCamera.updateProjectionMatrix();
    this.camera.updateProjectionMatrix();
    this.weaponCamera.updateProjectionMatrix();
    if (this.state === "menu" && this.hero) this.updatePreview();
  }
  sky(map) {
    let c = document.createElement("canvas");
    c.width = 1024;
    c.height = 512;
    let g = c.getContext("2d"),
      grad = g.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, map ? "#1d263c" : "#527f9d");
    grad.addColorStop(0.48, map ? "#8b7f92" : "#c0d5df");
    grad.addColorStop(0.65, map ? "#c8a5a0" : "#f2e0c8");
    grad.addColorStop(1, map ? "#39414d" : "#9eb2bd");
    g.fillStyle = grad;
    g.fillRect(0, 0, 1024, 512);
    if (!map) {
      g.globalAlpha = 0.13;
      g.fillStyle = "#fff";
      for (let i = 0; i < 30; i++) {
        g.beginPath();
        g.ellipse(
          (i * 173) % 1024,
          140 + (i % 4) * 18,
          100 + (i % 3) * 30,
          5,
          0,
          0,
          TAU,
        );
        g.fill();
      }
    }
    let tx = new T.CanvasTexture(c);
    tx.colorSpace = T.SRGBColorSpace;
    tx.mapping = T.EquirectangularReflectionMapping;
    return tx;
  }
  selectMap(id) {
    this.map = id;
    this.world = this.worlds[id];
    for (let [i, w] of this.worlds.entries()) w.group.visible = i === id;
    this.scene.background?.dispose?.();
    this.scene.background = this.sky(id);
    this.environments ??= [];
    if (!this.environments[id]) {
      const generator = new T.PMREMGenerator(this.renderer);
      this.environments[id] = generator.fromEquirectangular(
        this.scene.background,
      );
      generator.dispose();
    }
    this.scene.environment = this.environments[id].texture;
    this.scene.fog = new T.Fog(id ? 0x697083 : 0xb8c6cb, 55, 155);
    this.sun.color.set(id ? 0xd6ccf4 : 0xffe6bf);
    this.sun.intensity = id ? 1.6 : 3.1;
    this.fill.intensity = id ? 1 : 1.3;
    this.updatePreview();
  }
  getOperator() {
    return (this.team === "police" ? OPERATORS : RED_OPERATORS)[this.op];
  }
  selectTeam(team) {
    if (!["police", "opposition"].includes(team)) return;
    this.team = team;
    this.selectOperator(0);
    this.setLoadout(this.equipped);
  }
  selectOperator(id) {
    this.op = id === 1 ? 1 : 0;
    this.lobbyScene.remove(this.hero.root);
    this.hero =
      this.team === "police"
        ? makePoliceCharacter(this.op)
        : makeRedCharacter(this.op);
    this.lobbyScene.add(this.hero.root);
    this.updatePreview();
  }
  updatePreview() {
    if (!this.hero) return;
    this.hero.root.position.set(innerWidth < 700 ? 0.75 : 1.35, 0, 0);
    this.hero.root.scale.setScalar(1.4);
    this.hero.root.rotation.y = Math.PI - 0.24;
    this.hero.root.visible =
      this.state === "menu" && this.page === "play" && innerWidth >= 700;
    this.weaponPreview.visible =
      this.state === "menu" && this.page === "loadout";
    this.weaponPreview.position.set(innerWidth < 700 ? 0 : 0.65, 2.1, 0.15);
    this.weaponPreview.scale.setScalar(1.7);
  }
  showPage(page) {
    this.page = page;
    this.hero.root.visible = this.state === "menu" && page === "play";
    this.weaponPreview.visible = this.state === "menu" && page === "loadout";
    if (this.state === "menu") this.updatePreview();
  }
  previewWeapon(index) {
    this.lobbyScene.remove(this.weaponPreview);
    let w = WEAPONS[index];
    this.weaponPreview = makeWeapon(w.family || w.id, w.color, w.variant);
    this.lobbyScene.add(this.weaponPreview);
    this.updatePreview();
  }
  makeThumbnails() {
    let old = this.map;
    this.thumbnails = [];
    for (let id = 0; id < 2; id++) {
      this.selectMap(id);
      this.hero.root.visible = false;
      this.weaponPreview.visible = false;
      this.camera.position.set(33.6, 2.1, 60.2);
      this.camera.lookAt(id ? 29 : 31, 2, 40);
      this.renderer.render(this.scene, this.camera);
      this.thumbnails.push(this.canvas.toDataURL("image/jpeg", 0.8));
    }
    this.selectMap(old);
  }
  setLoadout(equipped) {
    this.equipped =
      equipped.length === 2 &&
      new Set(equipped).size === 2 &&
      equipped.every(
        (i) => WEAPONS[i] && ["all", this.team].includes(WEAPONS[i].team),
      )
        ? [...equipped]
        : [0, 5];
  }
  resetInput() {
    this.keys = {};
    this.fireHeld = false;
    this.aiming = false;
    this.touchMove = { x: 0, y: 0 };
    this.drag = null;
  }
  requestLock() {
    if (matchMedia("(pointer:coarse)").matches) return;
    try {
      let r = this.canvas.requestPointerLock?.();
      r?.catch?.(() =>
        this.notify(
          "MOUSE CAPTURE UNAVAILABLE",
          "Drag to look, or use the arrow keys.",
          3,
        ),
      );
    } catch {}
  }
  start() {
    this.audio.start();
    this.clearEntities();
    this.state = "play";
    this.difficulty = this.settings.difficulty;
    this.resetInput();
    this.player.set(33.6, 0, 60.2);
    this.yaw = this.pitch = 0;
    this.jumpY = this.jumpV = this.jumps = 0;
    this.hp = this.getOperator().hp;
    this.wave = 1;
    this.score = this.kills = 0;
    this.slot = 0;
    this.ammo = this.equipped.map((i) => WEAPONS[i].cap);
    this.clock = 0;
    this.cool =
      this.reloadT =
      this.boostT =
      this.pulseT =
      this.inv =
      this.damageFlash =
      this.recoil =
      this.flash =
      this.hit =
        0;
    this.exit = false;
    this.world.beacon.visible = false;
    this.hero.root.visible = this.weaponPreview.visible = false;
    this.makeViewWeapon();
    this.resetInput();
    this.pathField();
    this.startWave();
    this.callbacks.state?.("play");
    this.requestLock();
    if (!document.fullscreenElement)
      document.documentElement.requestFullscreen?.().catch(() => {});
  }
  clearEntities() {
    for (let e of this.enemies) this.scene.remove(e.rig.root);
    for (let a of [...this.projectiles, ...this.pickups, ...this.particles]) {
      this.scene.remove(a.mesh);
      a.mesh.geometry?.dispose();
      if (a.mesh.isLine || a.blast) a.mesh.material?.dispose();
    }
    this.enemies = [];
    this.projectiles = [];
    this.pickups = [];
    this.particles = [];
  }
  pause() {
    if (this.state !== "play") return;
    this.state = "pause";
    this.resetInput();
    document.exitPointerLock?.();
    this.callbacks.state?.("pause");
  }
  resume() {
    if (this.state !== "pause") return;
    this.audio.start();
    this.state = "play";
    this.resetInput();
    this.callbacks.state?.("play");
    this.requestLock();
  }
  toMenu() {
    this.state = "menu";
    document.exitPointerLock?.();
    this.resetInput();
    this.clearEntities();
    this.world.beacon.visible = false;
    this.page = "play";
    this.updatePreview();
    this.callbacks.state?.("menu");
  }
  finish(win) {
    this.state = win ? "win" : "dead";
    this.resetInput();
    document.exitPointerLock?.();
    let best = Math.max(this.score, readStored("rift-3d-best", 0));
    saveStored("rift-3d-best", best);
    this.audio.cue(win ? "win" : "lose");
    this.callbacks.state?.(this.state, {
      best,
      score: this.score,
      kills: this.kills,
      seconds: Math.floor(this.clock),
    });
  }
  startWave() {
    this.spawnLeft = 4 + this.wave * 2;
    this.spawnT = 0.8;
    this.clearT = 0;
    this.notify(
      "WAVE " + String(this.wave).padStart(2, "0"),
      "Find cover. Watch your approaches.",
      3,
    );
    this.audio.cue("wave");
  }
  notify(title, subtitle = "", duration = 2.5) {
    this.noticeT = duration;
    this.callbacks.notice?.(title, subtitle);
  }
  solid(x, z, r = 0.36) {
    return [
      [-r, -r],
      [r, -r],
      [-r, r],
      [r, r],
    ].some(
      ([a, b]) =>
        this.world.grid[Math.floor((z + b) / SCALE)]?.[
          Math.floor((x + a) / SCALE)
        ] !== 0,
    );
  }
  move(pos, dx, dz, r = 0.36) {
    if (!this.solid(pos.x + dx, pos.z, r)) pos.x += dx;
    if (!this.solid(pos.x, pos.z + dz, r)) pos.z += dz;
  }
  wallDistance(origin, direction, max = 200) {
    let ray = new T.Ray(origin, direction),
      best = max;
    for (let box of this.world.colliders) {
      let point = ray.intersectBox(box, tmp);
      if (point) best = Math.min(best, point.distanceTo(origin));
    }
    return best;
  }
  visible(a, b) {
    dir.subVectors(b, a);
    let length = dir.length();
    dir.normalize();
    return this.wallDistance(a, dir, length + 0.1) >= length - 0.12;
  }
  currentWeapon() {
    return WEAPONS[this.equipped[this.slot]];
  }
  makeViewWeapon() {
    if (this.hands) this.weaponScene.remove(this.hands);
    this.hands = makeHands(
      this.currentWeapon(),
      this.team === "police"
        ? this.op === 0
          ? 0xe2e3dd
          : 0x182f4e
        : this.getOperator().color,
      this.team === "police"
        ? this.op === 0
          ? 0xb98160
          : 0xd7a789
        : this.op === 0
          ? 0x80543f
          : 0xb88161,
    );
    this.hands.scale.setScalar(0.82);
    this.weaponScene.add(this.hands);
  }
  swap(slot = (this.slot + 1) % 2) {
    if (this.state !== "play") return;
    this.slot = slot;
    this.reloadT = 0;
    this.cool = 0.2;
    this.recoil = 0.15;
    this.makeViewWeapon();
    this.audio.cue("ready");
  }
  reload() {
    let w = this.currentWeapon();
    if (this.state !== "play" || this.reloadT || this.ammo[this.slot] === w.cap)
      return;
    this.reloadT = w.reload;
    this.audio.cue("reload");
  }
  jump() {
    if (this.state !== "play" || this.jumps >= 2) return;
    this.jumpV = this.jumps ? 5.6 : 6;
    this.jumps++;
    this.audio.cue("jump");
  }
  boost() {
    if (this.state !== "play" || this.boostT > 0) return;
    let f = (this.keys.w ? 1 : 0) - (this.keys.s ? 1 : 0) - this.touchMove.y,
      s = (this.keys.d ? 1 : 0) - (this.keys.a ? 1 : 0) + this.touchMove.x;
    if (!f && !s) f = 1;
    let l = Math.hypot(f, s),
      dx = (-Math.sin(this.yaw) * f + Math.cos(this.yaw) * s) / l,
      dz = (-Math.cos(this.yaw) * f - Math.sin(this.yaw) * s) / l;
    for (let i = 0; i < 22; i++) this.move(this.player, dx * 0.24, dz * 0.24);
    this.boostT = 2.5;
    this.inv = 0.35;
    this.audio.cue("boost");
  }
  bomb() {
    if (this.state !== "play" || this.pulseT > 0) return;
    this.pulseT = 7;
    this.audio.cue("bomb");
    for (let e of this.enemies)
      if (
        e.rig.root.position.distanceTo(this.player) < 12 &&
        this.visible(
          this.player.clone().setY(1),
          e.rig.root.position.clone().setY(1),
        )
      ) {
        e.hp -= 160;
        this.burst(e.rig.root.position.clone().setY(1), 0xf1ad61, 9);
      }
    for (let p of this.projectiles)
      if (p.mesh.position.distanceTo(this.player) < 12) p.life = 0;
    let mesh = new T.Mesh(
      new T.SphereGeometry(1, 24, 12),
      new T.MeshBasicMaterial({
        color: 0x9bcff2,
        wireframe: true,
        transparent: true,
        opacity: 0.5,
      }),
    );
    mesh.position.copy(this.player).y = 1;
    this.scene.add(mesh);
    this.particles.push({ mesh, life: 0.5, max: 0.5, blast: true });
    this.notify("PULSE DISCHARGED", "Nearby targets disrupted.", 1.5);
  }
  shoot() {
    if (this.state !== "play" || this.cool > 0 || this.reloadT) return;
    const w = this.currentWeapon();
    if (this.ammo[this.slot] <= 0) {
      this.reload();
      return;
    }
    this.ammo[this.slot]--;
    this.cool = w.rate;
    this.recoil = 1;
    this.flash = 0.055;
    this.audio.cue(w.family || w.id);
    this.camera.getWorldDirection(dir);
    const base = dir.clone(),
      origin = this.camera.position.clone(),
      spread = w.spread * (this.aiming ? 0.4 : 1);
    for (let i = 0; i < w.pellets; i++) {
      const direction = base
        .clone()
        .add(
          new T.Vector3(
            (Math.random() - 0.5) * spread,
            (Math.random() - 0.5) * spread,
            (Math.random() - 0.5) * spread,
          ),
        )
        .normalize();
      const mesh = makeStarProjectile();
      mesh.position.copy(origin).addScaledVector(direction, 0.45);
      mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), direction);
      this.scene.add(mesh);
      this.projectiles.push({
        mesh,
        velocity: direction.multiplyScalar(w.projectileSpeed || 38),
        life: w.range / (w.projectileSpeed || 38),
        remaining: w.range,
        friendly: true,
        damage: w.damage,
        spin: 8 + Math.random() * 5,
      });
    }
    if (w.semi) this.fireHeld = false;
    if (this.ammo[this.slot] === 0)
      this.notify("MAGAZINE EMPTY", "Press R to reload.", 1.5);
  }
  updateProjectiles(dt) {
    for (const p of this.projectiles) {
      if (p.life <= 0) continue;
      const old = p.mesh.position.clone(),
        direction = p.velocity.clone().normalize(),
        travel = Math.min(p.velocity.length() * dt, p.remaining ?? Infinity),
        wall = this.wallDistance(old, direction, travel + 0.1);
      let distance = Math.min(travel, wall),
        target = null,
        head = false;
      if (p.friendly) {
        const ray = new T.Ray(old, direction);
        for (const e of this.enemies) {
          if (e.hp <= 0) continue;
          for (const isHead of [false, true]) {
            const center = e.rig.root.position
              .clone()
              .setY(isHead ? (e.heavy ? 1.9 : 1.68) : e.heavy ? 1.25 : 1.05);
            const hit = ray.intersectSphere(
              new T.Sphere(
                center,
                isHead ? (e.heavy ? 0.31 : 0.25) : e.heavy ? 0.65 : 0.52,
              ),
              new T.Vector3(),
            );
            if (hit && hit.distanceTo(old) < distance) {
              target = e;
              head = isHead;
              distance = hit.distanceTo(old);
            }
          }
        }
      }
      p.mesh.position.copy(old).addScaledVector(direction, distance);
      p.life -= dt;
      if (p.remaining !== undefined) p.remaining -= distance;
      if (p.spin) p.mesh.rotateZ(p.spin * dt);
      if (target) {
        target.hp -= p.damage * (head ? 1.6 : 1);
        target.hit = 0.12;
        this.hit = 0.14;
        this.burst(p.mesh.position, 0xa4dfff, 4);
        this.audio.cue("hit");
        p.life = 0;
      } else if (wall <= travel) {
        p.life = 0;
        this.burst(p.mesh.position, p.friendly ? 0x99d2f2 : 0xe6b487, 2);
      } else if (!p.friendly) {
        const center = this.player.clone().setY(1 + this.jumpY);
        if (
          new T.Line3(old, p.mesh.position)
            .closestPointToPoint(center, true, tmp)
            .distanceTo(center) < 0.55
        ) {
          this.hurt(p.heavy ? 18 : 12, p.mesh.position);
          p.life = 0;
        }
      }
      if (p.remaining <= 0) p.life = 0;
    }
    this.projectiles = this.projectiles.filter((p) => {
      if (p.life > 0) return true;
      this.scene.remove(p.mesh);
      p.mesh.geometry?.dispose();
      return false;
    });
  }
  burst(pos, color, n = 4) {
    for (let i = 0; i < n; i++) {
      let mesh = new T.Mesh(
        new T.IcosahedronGeometry(0.035, 0),
        material(color, 0.1, 0.6),
      );
      mesh.position.copy(pos);
      this.scene.add(mesh);
      this.particles.push({
        mesh,
        life: 0.15 + Math.random() * 0.15,
        max: 0.3,
        velocity: new T.Vector3(
          (Math.random() - 0.5) * 3,
          Math.random() * 2,
          (Math.random() - 0.5) * 3,
        ),
      });
    }
  }
  spawn() {
    let options = [
      [2.5, 2],
      [12, 2],
      [21.5, 6],
      [2, 10],
      [21, 14],
      [3, 18],
      [20, 18],
      [12, 8],
    ]
      .map(([x, z]) => new T.Vector3(x * SCALE, 0, z * SCALE))
      .filter(
        (p) => !this.solid(p.x, p.z, 0.6) && p.distanceTo(this.player) > 12,
      );
    if (!options.length) options = [new T.Vector3(7, 0, 7)];
    let pos = options[Math.floor(Math.random() * options.length)],
      heavy = this.wave >= 3 && Math.random() < 0.22,
      rig =
        this.team === "police"
          ? makeRedCharacter(this.enemies.length % 2, heavy)
          : makePoliceCharacter(this.enemies.length % 2);
    rig.root.position.copy(pos);
    this.scene.add(rig.root);
    let mul =
        this.difficulty === "recruit"
          ? 0.8
          : this.difficulty === "veteran"
            ? 1.25
            : 1,
      max = (heavy ? 220 : 95 + this.wave * 12) * mul;
    this.enemies.push({
      rig,
      hp: max,
      max,
      heavy,
      cd: 1.5 + Math.random() * 2,
      phase: Math.random() * 6,
      speed: heavy ? 1.6 : 2.0 + this.wave * 0.12,
      hit: 0,
    });
  }
  pathField() {
    this.field = Array.from({ length: 24 }, () => new Int16Array(24).fill(999));
    let x = Math.floor(this.player.x / SCALE),
      z = Math.floor(this.player.z / SCALE);
    if (this.world.grid[z]?.[x] !== 0) return;
    this.field[z][x] = 0;
    let queue = [[x, z]],
      head = 0;
    while (head < queue.length) {
      let [a, b] = queue[head++];
      for (let [nx, nz] of [
        [a - 1, b],
        [a + 1, b],
        [a, b - 1],
        [a, b + 1],
      ])
        if (this.world.grid[nz]?.[nx] === 0 && this.field[nz][nx] === 999) {
          this.field[nz][nx] = this.field[b][a] + 1;
          queue.push([nx, nz]);
        }
    }
  }
  hurt(amount, origin) {
    if (this.inv > 0) return;
    let mul =
      this.difficulty === "recruit"
        ? 0.65
        : this.difficulty === "veteran"
          ? 1.35
          : 1;
    this.hp -= amount * mul;
    this.inv = 0.25;
    this.damageFlash = 0.85;
    this.audio.cue(
      "damage",
      origin
        ? Math.sin(
            Math.atan2(origin.x - this.player.x, origin.z - this.player.z) -
              this.yaw,
          )
        : 0,
    );
  }
  update(dt) {
    this.clock += dt;
    for (let key of [
      "cool",
      "boostT",
      "pulseT",
      "inv",
      "flash",
      "hit",
      "noticeT",
    ])
      this[key] = Math.max(0, this[key] - dt);
    this.recoil = Math.max(0, this.recoil - dt * 6);
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.6);
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        this.reloadT = 0;
        this.ammo[this.slot] = this.currentWeapon().cap;
        this.audio.cue("ready");
      }
    }
    this.yaw +=
      ((this.keys.arrowleft ? 1 : 0) - (this.keys.arrowright ? 1 : 0)) * dt * 2;
    let f =
        (this.keys.w || this.keys.arrowup ? 1 : 0) -
        (this.keys.s || this.keys.arrowdown ? 1 : 0) -
        this.touchMove.y,
      s = (this.keys.d ? 1 : 0) - (this.keys.a ? 1 : 0) + this.touchMove.x,
      l = Math.max(1, Math.hypot(f, s)),
      speed =
        this.getOperator().speed *
        (this.keys.shift && !this.aiming ? 1.45 : 1) *
        (this.aiming ? 0.65 : 1) *
        (this.currentWeapon().id === "lmg" ? 0.88 : 1);
    this.move(
      this.player,
      ((-Math.sin(this.yaw) * f + Math.cos(this.yaw) * s) * dt * speed) / l,
      ((-Math.cos(this.yaw) * f - Math.sin(this.yaw) * s) * dt * speed) / l,
    );
    if (Math.abs(f) + Math.abs(s) > 0.05) {
      this.walk += dt * (this.keys.shift ? 13 : 9);
      this.steps -= dt;
      if (this.steps <= 0 && this.jumpY < 0.05) {
        this.audio.cue("step");
        this.steps = this.keys.shift ? 0.26 : 0.36;
      }
    }
    this.jumpV -= dt * 17;
    this.jumpY += this.jumpV * dt;
    if (this.jumpY <= 0) {
      this.jumpY = this.jumpV = this.jumps = 0;
    }
    this.updateCamera(dt);
    if (this.fireHeld) this.shoot();
    this.spawnT -= dt;
    if (this.spawnLeft > 0 && this.spawnT <= 0 && this.enemies.length < 10) {
      this.spawn();
      this.spawnLeft--;
      this.spawnT = Math.max(0.8, 2 - this.wave * 0.18);
    }
    this.pathT -= dt;
    if (this.pathT <= 0) {
      this.pathField();
      this.pathT = 0.3;
    }
    for (let e of this.enemies) {
      let pos = e.rig.root.position,
        dx = this.player.x - pos.x,
        dz = this.player.z - pos.z,
        d = Math.hypot(dx, dz),
        from = pos.clone().setY(1.3),
        to = this.camera.position.clone(),
        visible = this.visible(from, to);
      e.rig.root.rotation.y = Math.atan2(dx, dz) + Math.PI;
      let moving = d > 8 || !visible;
      if (moving) {
        let tx = this.player.x,
          tz = this.player.z;
        if (!visible) {
          let x = Math.floor(pos.x / SCALE),
            z = Math.floor(pos.z / SCALE),
            best = this.field[z]?.[x] ?? 999;
          for (let [a, b] of [
            [x - 1, z],
            [x + 1, z],
            [x, z - 1],
            [x, z + 1],
          ])
            if ((this.field[b]?.[a] ?? 999) < best) {
              best = this.field[b][a];
              tx = (a + 0.5) * SCALE;
              tz = (b + 0.5) * SCALE;
            }
        }
        let a = Math.atan2(tz - pos.z, tx - pos.x);
        this.move(
          pos,
          Math.cos(a) * e.speed * dt,
          Math.sin(a) * e.speed * dt,
          0.42,
        );
      } else if (d < 3)
        this.move(
          pos,
          (-dx / d) * e.speed * dt,
          (-dz / d) * e.speed * dt,
          0.42,
        );
      e.phase += dt * (moving ? 7 : 2);
      e.rig.animate(e.phase, moving);
      e.cd -= dt;
      e.hit = Math.max(0, e.hit - dt);
      if (e.cd <= 0 && visible && d < 45) {
        e.cd = (e.heavy ? 2.7 : 3.3) - this.wave * 0.16;
        let direction = to.sub(from).normalize(),
          count = e.heavy ? 3 : 1;
        for (let i = 0; i < count; i++) {
          let dv = direction
            .clone()
            .applyAxisAngle(UP, (i - (count - 1) / 2) * 0.07);
          let mesh = makeStarProjectile(true);
          mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), dv);
          mesh.position.copy(from).addScaledVector(dv, 0.8);
          this.scene.add(mesh);
          this.projectiles.push({
            mesh,
            velocity: dv.multiplyScalar(13 + this.wave * 0.6),
            life: 5,
            heavy: e.heavy,
            spin: 8,
          });
        }
        this.audio.cue(
          "enemy",
          Math.sin(
            Math.atan2(pos.x - this.player.x, pos.z - this.player.z) - this.yaw,
          ),
        );
      }
      if (d < 1) this.hurt(12, pos);
    }
    this.updateProjectiles(dt);
    this.enemies = this.enemies.filter((e) => {
      if (e.hp > 0) return true;
      this.kills++;
      this.score += e.heavy ? 300 : 100;
      this.audio.cue("kill");
      this.burst(e.rig.root.position.clone().setY(1), 0xdbb282, 10);
      if (Math.random() < 0.4) this.drop(e.rig.root.position);
      this.scene.remove(e.rig.root);
      return false;
    });
    for (let p of this.pickups) {
      p.life -= dt;
      p.mesh.rotation.y += dt;
      p.mesh.position.y = 0.45 + Math.sin(this.time * 3) * 0.12;
      if (
        Math.hypot(
          p.mesh.position.x - this.player.x,
          p.mesh.position.z - this.player.z,
        ) < 1.2
      ) {
        this.hp = Math.min(this.getOperator().hp, this.hp + 35);
        p.life = 0;
        this.score += 25;
        this.audio.cue("heal");
        this.notify("ARMOR REPAIRED", "+35 vitality", 1.5);
      }
    }
    this.pickups = this.pickups.filter((p) => {
      if (p.life > 0) return true;
      this.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      return false;
    });
    for (let p of this.particles) {
      p.life -= dt;
      if (p.velocity) {
        p.mesh.position.addScaledVector(p.velocity, dt);
        p.velocity.y -= dt * 6;
      }
      if (p.blast) {
        p.mesh.scale.setScalar(1 + (1 - p.life / p.max) * 13);
        p.mesh.material.opacity = (p.life / p.max) * 0.4;
      }
    }
    this.particles = this.particles.filter((p) => {
      if (p.life > 0) return true;
      this.scene.remove(p.mesh);
      p.mesh.geometry?.dispose();
      if (p.mesh.isLine || p.blast) p.mesh.material.dispose();
      return false;
    });
    if (!this.spawnLeft && !this.enemies.length && !this.exit) {
      if (this.clearT === 0) {
        this.score += 150;
        this.notify(
          "SECTOR CLEAR",
          this.wave < 5
            ? "Armor and magazines replenished. Next wave incoming."
            : "Proceed to the blue extraction beacon.",
          3.5,
        );
        this.audio.cue("ready");
      }
      this.clearT += dt;
      if (this.clearT > 4) {
        if (this.wave < 5) {
          this.wave++;
          this.hp = Math.min(this.getOperator().hp, this.hp + 20);
          this.ammo = this.equipped.map((i) => WEAPONS[i].cap);
          this.reloadT = 0;
          this.startWave();
        } else {
          this.exit = true;
          this.world.beacon.visible = true;
          this.notify(
            "EXTRACTION ONLINE",
            "Return to the landing zone at the south end.",
            5,
          );
        }
      }
    }
    if (
      this.exit &&
      Math.hypot(this.player.x - 33.6, this.player.z - 60.2) < 2
    ) {
      this.score += 1000;
      this.finish(true);
    }
    if (this.hp <= 0) this.finish(false);
    this.callbacks.hud?.(this);
  }
  drop(pos) {
    let mesh = new T.Mesh(
      new T.BoxGeometry(0.55, 0.4, 0.4),
      material(0x7bb6cd, 0.45, 0.35, 0x194559),
    );
    mesh.position.copy(pos).y = 0.45;
    this.scene.add(mesh);
    this.pickups.push({ mesh, life: 30 });
  }
  updateCamera(dt) {
    this.camera.position.copy(this.player);
    this.camera.position.y =
      1.65 +
      this.jumpY +
      (this.settings.motion ? Math.sin(this.walk) * 0.035 : 0);
    this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
    let target =
      this.settings.fov *
      (this.aiming
        ? this.currentWeapon().family === "sniper" ||
          this.currentWeapon().family === "dmr"
          ? 0.5
          : 0.78
        : 1);
    this.camera.fov += (target - this.camera.fov) * Math.min(1, dt * 12);
    this.camera.updateProjectionMatrix();
  }
  render() {
    this.renderer.autoClear = true;
    if (this.state === "menu") {
      this.lobbyScene.environment = this.scene.environment;
      this.renderer.render(this.lobbyScene, this.lobbyCamera);
      return;
    }
    this.renderer.render(this.scene, this.camera);
    if (
      this.state !== "menu" &&
      this.hands &&
      !(
        this.aiming &&
        (this.currentWeapon().family === "sniper" ||
          this.currentWeapon().family === "dmr")
      )
    ) {
      let ads = this.aiming,
        weapon = this.currentWeapon(),
        motion = this.settings.motion;
      this.hands.position.set(ads ? 0 : 0.29, ads ? -0.12 : -0.28, -0.45);
      if (motion) this.hands.position.x += Math.cos(this.walk * 0.5) * 0.009;
      this.hands.position.y +=
        (motion ? Math.sin(this.walk) * 0.008 : 0) - this.recoil * 0.025;
      if (this.reloadT > 0) {
        let r = Math.sin((1 - this.reloadT / weapon.reload) * Math.PI);
        this.hands.position.y -= r * 0.34;
        this.hands.rotation.z = -r * 0.45;
      } else this.hands.rotation.z = 0;
      this.hands.position.z += this.recoil * 0.055;
      this.hands.rotation.x = this.recoil * 0.035;
      this.flashMesh.visible = this.flash > 0;
      this.flashMesh.position.set(
        ads ? 0 : 0.29,
        ads ? -0.05 : -0.2,
        -0.45 - 0.8 * (weapon.id === "pistol" ? 0.5 : 1),
      );
      this.flashMesh.rotation.z = Math.random() * TAU;
      this.flashLight.position.copy(this.flashMesh.position);
      this.flashLight.intensity = this.flash > 0 ? 3 : 0;
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.weaponScene, this.weaponCamera);
    }
  }
  animate(t) {
    let dt = Math.min(0.04, (t - this.last) / 1000 || 0.016);
    this.last = t;
    this.time += dt;
    this.frameCount++;
    this.fpsCount++;
    this.fpsT += dt;
    if (this.fpsT >= 0.5) {
      this.fps = Math.round(this.fpsCount / this.fpsT);
      this.fpsCount = 0;
      this.fpsT = 0;
    }
    if (this.state === "play") this.update(dt);
    else if (this.state === "menu") {
      this.hero.animate(this.time * 1.5, false);
      this.hero.root.rotation.y =
        Math.PI - 0.24 + Math.sin(this.time * 0.2) * 0.06;
      this.weaponPreview.rotation.set(
        0.12,
        Math.sin(this.time * 0.3) * 0.15 + 1.25,
        -0.12,
      );
    }
    if (!document.hidden) this.render();
    requestAnimationFrame(this.animate);
  }
  bindInput() {
    addEventListener("resize", () => this.resize());
    addEventListener("keydown", (e) => {
      let k = e.key.toLowerCase();
      if (
        [" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k) &&
        this.state === "play"
      )
        e.preventDefault();
      if (!e.repeat) {
        if (
          k === "n" &&
          !["INPUT", "SELECT", "TEXTAREA"].includes(
            document.activeElement?.tagName,
          )
        ) {
          e.preventDefault();
          this.callbacks.teamRequest?.();
          return;
        }
        if (k === "p" || k === "escape") {
          if (this.callbacks.escapeRequest?.()) return;
          if (this.state === "play") this.pause();
          else if (this.state === "pause") this.callbacks.resumeRequest?.();
        }
        if (
          k === "f" &&
          !["INPUT", "SELECT"].includes(document.activeElement?.tagName)
        )
          this.callbacks.fullscreen?.();
        if (this.state === "play") {
          if (k === " ") this.jump();
          if (k === "e") this.boost();
          if (k === "g") this.bomb();
          if (k === "r") this.reload();
          if (k === "q") this.swap();
          if (k === "1" || k === "2") this.swap(+k - 1);
        }
      }
      this.keys[k] = true;
    });
    addEventListener("keyup", (e) => (this.keys[e.key.toLowerCase()] = false));
    addEventListener("blur", () => this.pause());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.pause();
    });
    document.addEventListener("pointerlockchange", () => {
      if (
        !document.pointerLockElement &&
        this.pointerLocked &&
        this.state === "play"
      )
        this.pause();
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });
    addEventListener("mousemove", (e) => {
      if (this.state !== "play") return;
      if (document.pointerLockElement === this.canvas || this.drag) {
        this.yaw -= e.movementX * 0.0022 * this.settings.sensitivity;
        this.pitch = Math.max(
          -1.3,
          Math.min(
            1.3,
            this.pitch - e.movementY * 0.0022 * this.settings.sensitivity,
          ),
        );
      }
    });
    this.canvas.addEventListener("mousedown", (e) => {
      if (this.state !== "play") return;
      this.audio.start();
      if (e.button === 0) this.fireHeld = true;
      if (e.button === 2) this.aiming = true;
      this.drag = true;
      if (!document.pointerLockElement) this.requestLock();
    });
    addEventListener("mouseup", (e) => {
      if (e.button === 0) this.fireHeld = false;
      if (e.button === 2) this.aiming = false;
      this.drag = false;
    });
    this.canvas.oncontextmenu = (e) => e.preventDefault();
    this.canvas.addEventListener(
      "touchstart",
      (e) => {
        if (this.state !== "play") return;
        let t = e.changedTouches[0];
        this.touchLook = { id: t.identifier, x: t.clientX, y: t.clientY };
        e.preventDefault();
      },
      { passive: false },
    );
    this.canvas.addEventListener(
      "touchmove",
      (e) => {
        if (!this.touchLook || this.state !== "play") return;
        for (let t of e.changedTouches)
          if (t.identifier === this.touchLook.id) {
            this.yaw -=
              (t.clientX - this.touchLook.x) *
              0.005 *
              this.settings.sensitivity;
            this.pitch = Math.max(
              -1.3,
              Math.min(
                1.3,
                this.pitch -
                  (t.clientY - this.touchLook.y) *
                    0.004 *
                    this.settings.sensitivity,
              ),
            );
            this.touchLook.x = t.clientX;
            this.touchLook.y = t.clientY;
          }
        e.preventDefault();
      },
      { passive: false },
    );
    for (let event of ["touchend", "touchcancel"])
      this.canvas.addEventListener(event, () => (this.touchLook = null));
  }
}
