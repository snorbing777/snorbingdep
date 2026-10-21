import { Game } from "./game.js";
import { loadPoliceReferences } from "./models.js";
import {
  DEFAULTS,
  WEAPONS,
  OPERATORS,
  RED_OPERATORS,
  MAP_INFO,
  readStored,
  saveStored,
} from "./data.js";
const $ = (id) => document.getElementById(id),
  settings = { ...DEFAULTS },
  stored = readStored("rift-settings-v3", {});
for (let key in DEFAULTS) {
  let v = stored[key];
  if (typeof v === typeof DEFAULTS[key]) settings[key] = v;
}
for (let [key, min, max] of [
  ["brightness", 0.7, 1.5],
  ["fov", 60, 100],
  ["sensitivity", 0.2, 2.5],
  ["master", 0, 1],
  ["sfx", 0, 1],
  ["ambient", 0, 1],
])
  settings[key] = Math.max(min, Math.min(max, settings[key]));
if (!["low", "medium", "high"].includes(settings.quality))
  settings.quality = "high";
if (!["recruit", "standard", "veteran"].includes(settings.difficulty))
  settings.difficulty = "standard";
let loadout = readStored(
  "darkness-loadout-v4",
  readStored("rift-loadout-v3", [0, 11]),
);
if (
  !Array.isArray(loadout) ||
  loadout.length !== 2 ||
  loadout.some(
    (i) =>
      !Number.isInteger(i) || !WEAPONS[i] || WEAPONS[i].team === "opposition",
  ) ||
  loadout[0] === loadout[1]
)
  loadout = [0, 11];
let weaponCategory = "all",
  activeSlot = 0,
  previewIndex = loadout[0],
  settingsTab = "display",
  currentPage = "play",
  settingsFromPause = false,
  game;
let teamDialogOpen = false,
  teamDialogSource = "menu",
  pendingTeam = "police";
function full() {
  if (!document.fullscreenElement)
    document.documentElement.requestFullscreen?.().catch(() => {});
  else document.exitFullscreen?.();
}
function showPage(page) {
  if (game.state === "pause" && page !== "settings") {
    closePauseSettings();
    return;
  }
  currentPage = page;
  document
    .querySelectorAll(".page")
    .forEach((p) => p.classList.toggle("hidden", p.id !== page));
  document
    .querySelectorAll("nav [data-page]")
    .forEach((b) => b.classList.toggle("active", b.dataset.page === page));
  game.showPage(page);
  game.audio.cue("ui");
  if (page === "loadout") renderLoadout();
  if (page === "settings") renderSettings();
}
function handleState(state, result) {
  let playing = state === "play",
    menu = state === "menu";
  $("shell").classList.toggle("hidden", !menu);
  $("pauseScreen").classList.toggle("hidden", playing || menu);
  $("hud").classList.toggle("hidden", menu);
  $("shade").classList.toggle("playing", !menu);
  $("touch").classList.toggle(
    "hidden",
    !playing || !matchMedia("(pointer:coarse)").matches,
  );
  settingsFromPause = false;
  if (menu) {
    showPage("play");
    return;
  }
  if (state === "pause") {
    $("pauseKicker").textContent = "MISSION ON HOLD";
    $("pauseTitle").textContent = "PAUSED.";
    $("pauseSummary").textContent =
      `${MAP_INFO[game.map].name} · Wave ${game.wave} / 5 · ${game.score.toLocaleString()} points. Your mission is frozen until you resume.`;
    $("resume").innerHTML = "RESUME OPERATION <span>→</span>";
    $("pauseSettings").classList.remove("hidden");
  } else if (state === "dead" || state === "win") {
    $("pauseKicker").textContent =
      state === "win" ? "MISSION ACCOMPLISHED" : "OPERATOR OFFLINE";
    $("pauseTitle").textContent =
      state === "win" ? "EXTRACTED." : "SIGNAL LOST.";
    $("pauseSummary").textContent =
      `${result.score.toLocaleString()} points · ${result.kills} eliminations · ${result.seconds}s. Personal best: ${result.best.toLocaleString()}. ${state === "win" ? "Choose another arena or drop in again." : "Reposition with boost and use cover to break sightlines."}`;
    $("resume").innerHTML = "REDEPLOY <span>→</span>";
    $("pauseSettings").classList.add("hidden");
  }
}
function updateHUD(g) {
  $("zone").textContent =
    MAP_INFO[g.map].name + " / " + MAP_INFO[g.map].sub.toUpperCase();
  $("wave").textContent = g.exit
    ? "EXTRACT NOW"
    : "WAVE " + String(g.wave).padStart(2, "0") + " / 05";
  $("remaining").textContent = g.exit
    ? "BLUE BEACON / SOUTH LANDING ZONE"
    : g.spawnLeft + g.enemies.length + " HOSTILES REMAIN";
  $("opName").textContent = "VITALS / " + g.getOperator().name.toUpperCase();
  $("hudTeam").textContent =
    g.team === "police" ? "COUNTER-TERRORISTS" : "TERRORISTS";
  $("hp").textContent = Math.max(0, Math.ceil(g.hp));
  $("hpBar").style.width = Math.max(0, (g.hp / g.getOperator().hp) * 100) + "%";
  $("gunName").textContent =
    g.reloadT > 0 ? "RELOADING…" : g.currentWeapon().name.toUpperCase();
  $("ammo").textContent = String(g.ammo[g.slot]).padStart(2, "0");
  $("reserve").textContent = "/ " + g.currentWeapon().cap;
  $("score").textContent = g.score.toLocaleString() + " PTS";
  $("boost").textContent = g.boostT > 0 ? g.boostT.toFixed(1) + "s" : "READY";
  $("pulse").textContent = g.pulseT > 0 ? g.pulseT.toFixed(1) + "s" : "READY";
  $("damage").style.opacity = g.damageFlash * 0.75;
  $("hitmarker").style.opacity = g.hit > 0 ? "1" : "0";
  $("notice").style.opacity = g.noticeT > 0 ? "1" : "0";
  $("crosshair").classList.toggle("ads", g.aiming);
  $("scope").classList.toggle(
    "hidden",
    !(g.aiming && ["sniper", "dmr"].includes(g.currentWeapon().family)),
  );
  $("fps").textContent = settings.fps ? g.fps + " FPS" : "";
}
function renderMaps() {
  $("maps").innerHTML = MAP_INFO.map(
    (m, i) =>
      `<button class="map-card ${i === game.map ? "active" : ""}" data-map="${i}" aria-pressed="${i === game.map}"><img alt="${m.sub}" src="${game.thumbnails[i]}"><span class="map-caption"><b>${m.name}</b><small>${m.tag}</small></span><span class="check">${i === game.map ? "◈" : ""}</span></button>`,
  ).join("");
  document.querySelectorAll("[data-map]").forEach(
    (b) =>
      (b.onclick = () => {
        game.selectMap(+b.dataset.map);
        renderMaps();
        game.audio.start();
        game.audio.cue("ui");
      }),
  );
}
function renderOperators() {
  const roster = game.team === "police" ? OPERATORS : RED_OPERATORS;
  $("operators").innerHTML = roster
    .map(
      (o, i) =>
        `<button data-op="${i}" class="${i === game.op ? "active" : ""}" aria-pressed="${i === game.op}">${o.reference ? `<img src="${o.reference}" alt="${o.name} portrait">` : `<i class="operator-monogram">${o.name.slice(0, 2).toUpperCase()}</i>`}<span>${o.name.toUpperCase()}</span></button>`,
    )
    .join("");
  let o = game.getOperator();
  $("activeTeamLabel").textContent =
    game.team === "police"
      ? "COUNTER-TERRORISTS / BLUE TEAM"
      : "TERRORISTS / RED TEAM";
  $("teamShortcutLabel").textContent =
    game.team === "police" ? "COUNTER-TERRORISTS" : "TERRORISTS";
  document.body.dataset.team = game.team;
  $("operatorName").textContent = o.name.toUpperCase();
  $("operatorRole").textContent = o.role;
  $("operatorDesc").textContent = o.desc;
  $("opHp").textContent = o.hp;
  $("opSpeed").textContent = game.op === 1 ? "HIGH" : "BALANCED";
  document.querySelectorAll("[data-op]").forEach(
    (b) =>
      (b.onclick = () => {
        game.selectOperator(+b.dataset.op);
        saveStored("palestine-operator-" + game.team, game.op);
        renderOperators();
        game.audio.cue("ui");
      }),
  );
}
function renderLoadout() {
  $("armoryLabel").textContent =
    (game.team === "police" ? "COUNTER-TERRORIST" : "TERRORIST") + " ARMORY";
  $("primaryName").textContent = WEAPONS[loadout[0]].name;
  $("secondaryName").textContent = WEAPONS[loadout[1]].name;
  document
    .querySelectorAll("[data-slot]")
    .forEach((b) =>
      b.classList.toggle("active", +b.dataset.slot === activeSlot),
    );
  document
    .querySelectorAll("[data-category]")
    .forEach((b) =>
      b.classList.toggle("active", b.dataset.category === weaponCategory),
    );
  const visibleWeapons = WEAPONS.map((w, i) => ({ w, i })).filter(
    ({ w }) => weaponCategory === "all" || w.category === weaponCategory,
  );
  $("weaponList").innerHTML = visibleWeapons
    .map(
      ({ w, i }) =>
        `<button class="weapon-row ${i === previewIndex ? "active" : ""}" data-weapon="${i}"><span class="num">${String(i + 1).padStart(2, "0")}</span><div><b>${w.name}</b><small>${w.type.toUpperCase()}</small></div><span class="badge">${w.team !== "all" && w.team !== game.team ? "OTHER TEAM" : loadout.includes(i) ? (loadout[0] === i ? "PRIMARY" : "SECONDARY") : ""}</span></button>`,
    )
    .join("");
  let w = WEAPONS[previewIndex];
  $("weaponType").textContent = w.label;
  $("weaponTitle").textContent = w.name.toUpperCase();
  $("weaponDescription").textContent = w.desc;
  let stats = [
    [
      "DAMAGE",
      Math.min(100, w.damage * w.pellets),
      w.pellets > 1 ? w.damage + " × " + w.pellets : w.damage,
    ],
    ["FIRE RATE", Math.min(100, 7 / w.rate), Math.round(60 / w.rate)],
    ["MOBILITY", w.mobility, w.mobility],
    ["MAGAZINE", (w.cap / 60) * 100, w.cap],
  ];
  $("weaponStats").innerHTML = stats
    .map(
      ([label, value, text]) =>
        `<div class="stat-row"><span>${label}</span><span class="stat-bar"><i style="width:${value}%"></i></span><b>${text}</b></div>`,
    )
    .join("");
  const equipped = loadout[activeSlot] === previewIndex,
    reserved = w.team !== "all" && w.team !== game.team;
  $("equip").disabled = equipped || reserved;
  $("equip").innerHTML =
    (reserved
      ? "AVAILABLE TO OTHER TEAM"
      : equipped
        ? "EQUIPPED"
        : activeSlot === 0
          ? "EQUIP PRIMARY"
          : "EQUIP SECONDARY") +
    " <span>" +
    (reserved ? "—" : equipped ? "✓" : "+") +
    "</span>";
  game.previewWeapon(previewIndex);
  document.querySelectorAll("[data-weapon]").forEach(
    (b) =>
      (b.onclick = () => {
        previewIndex = +b.dataset.weapon;
        renderLoadout();
        game.audio.cue("ui");
      }),
  );
}
const settingDefs = {
  display: [
    {
      key: "quality",
      name: "Graphics quality",
      desc: "Resolution and dynamic shadow quality.",
      type: "select",
      options: [
        ["low", "Performance"],
        ["medium", "Balanced"],
        ["high", "High fidelity"],
      ],
    },
    {
      key: "brightness",
      name: "Brightness",
      desc: "Adjust overall scene exposure.",
      min: 0.7,
      max: 1.5,
      step: 0.05,
      percent: true,
    },
    {
      key: "fov",
      name: "Field of view",
      desc: "Wider values show more of your surroundings.",
      min: 60,
      max: 100,
      step: 1,
      unit: "°",
    },
    {
      key: "motion",
      name: "Camera motion",
      desc: "Weapon sway and movement bob. Turn off for a steadier view.",
      type: "toggle",
    },
    {
      key: "fps",
      name: "FPS counter",
      desc: "Show rendering performance during gameplay.",
      type: "toggle",
    },
  ],
  audio: [
    {
      key: "master",
      name: "Master volume",
      desc: "Overall volume for all game audio.",
      min: 0,
      max: 1,
      step: 0.05,
      percent: true,
    },
    {
      key: "sfx",
      name: "Effects volume",
      desc: "Weapons, impacts, footsteps, and interface cues.",
      min: 0,
      max: 1,
      step: 0.05,
      percent: true,
    },
    {
      key: "ambient",
      name: "Atmosphere volume",
      desc: "The underlying ambient soundscape.",
      min: 0,
      max: 1,
      step: 0.05,
      percent: true,
    },
  ],
  gameplay: [
    {
      key: "sensitivity",
      name: "Mouse sensitivity",
      desc: "Adjust mouse and touch look speed.",
      min: 0.2,
      max: 2.5,
      step: 0.1,
      unit: "×",
    },
    {
      key: "difficulty",
      name: "Combat difficulty",
      desc: "Enemy armor and incoming damage. Applies on next deployment.",
      type: "select",
      options: [
        ["recruit", "Recruit"],
        ["standard", "Standard"],
        ["veteran", "Veteran"],
      ],
    },
  ],
};
function formatted(def) {
  return def.percent
    ? Math.round(settings[def.key] * 100) + "%"
    : (def.key === "sensitivity"
        ? settings[def.key].toFixed(1)
        : settings[def.key]) + (def.unit || "");
}
function updateSetting(def, value) {
  settings[def.key] = value;
  saveStored("rift-settings-v3", settings);
  game.applySettings();
  let out = document.querySelector(`output[for="setting-${def.key}"]`);
  if (out) out.textContent = formatted(def);
  $("savedStatus").textContent = "ALL CHANGES SAVED LOCALLY";
  if (def.type === "toggle") renderSettings();
}
function renderSettings() {
  document
    .querySelectorAll("[data-settings-tab]")
    .forEach((b) =>
      b.classList.toggle("active", b.dataset.settingsTab === settingsTab),
    );
  $("settingsControls").innerHTML = settingDefs[settingsTab]
    .map(
      (d) =>
        `<div class="setting"><label class="setting-name" for="setting-${d.key}">${d.name}<small>${d.desc}</small></label><div class="setting-control">${d.type === "select" ? `<select id="setting-${d.key}">${d.options.map(([v, n]) => `<option value="${v}" ${settings[d.key] === v ? "selected" : ""}>${n}</option>`).join("")}</select>` : d.type === "toggle" ? `<button id="setting-${d.key}" class="toggle" role="switch" aria-checked="${settings[d.key]}">${settings[d.key] ? "ON" : "OFF"}</button>` : `<button class="adjust" data-adjust="${d.key}" data-delta="-1" aria-label="Decrease ${d.name}">−</button><input aria-label="${d.name}" id="setting-${d.key}" type="range" min="${d.min}" max="${d.max}" step="${d.step}" value="${settings[d.key]}"><button class="adjust" data-adjust="${d.key}" data-delta="1" aria-label="Increase ${d.name}">＋</button><output for="setting-${d.key}">${formatted(d)}</output>`}</div></div>`,
    )
    .join("");
  for (let d of settingDefs[settingsTab]) {
    let el = $("setting-" + d.key);
    if (d.type === "toggle")
      el.onclick = () => {
        game.audio.start();
        updateSetting(d, !settings[d.key]);
        game.audio.cue("ui");
      };
    else
      el.addEventListener(d.type === "select" ? "change" : "input", () => {
        game.audio.start();
        updateSetting(d, d.type === "select" ? el.value : +el.value);
      });
  }
  document.querySelectorAll("[data-adjust]").forEach(
    (b) =>
      (b.onclick = () => {
        let d = settingDefs[settingsTab].find(
            (x) => x.key === b.dataset.adjust,
          ),
          v = Math.max(
            d.min,
            Math.min(
              d.max,
              Math.round((settings[d.key] + d.step * +b.dataset.delta) * 100) /
                100,
            ),
          );
        $("setting-" + d.key).value = v;
        game.audio.start();
        updateSetting(d, v);
        game.audio.cue("ui");
      }),
  );
}
function openPauseSettings() {
  settingsFromPause = true;
  $("pauseScreen").classList.add("hidden");
  $("hud").classList.add("hidden");
  $("shell").classList.remove("hidden");
  $("shade").classList.remove("playing");
  showPage("settings");
}
function closePauseSettings() {
  settingsFromPause = false;
  $("shell").classList.add("hidden");
  $("pauseScreen").classList.remove("hidden");
  $("hud").classList.remove("hidden");
  $("shade").classList.add("playing");
}
function validLoadout(value, team) {
  return Array.isArray(value) &&
    value.length === 2 &&
    new Set(value).size === 2 &&
    value.every(
      (i) =>
        Number.isInteger(i) &&
        WEAPONS[i] &&
        ["all", team].includes(WEAPONS[i].team),
    )
    ? value
    : [0, team === "police" ? 11 : 12];
}
function renderTeamDialog() {
  document.querySelectorAll("[data-team-option]").forEach((b) => {
    const active = b.dataset.teamOption === pendingTeam;
    b.classList.toggle("active", active);
    b.setAttribute("aria-pressed", active);
  });
  const changed = pendingTeam !== game.team,
    activeRun = ["play", "pause"].includes(teamDialogSource);
  $("teamDialogNote").textContent =
    changed && activeRun
      ? "Changing teams starts a fresh run. Your current run will end."
      : activeRun
        ? "Your mission is paused. Keep your team to continue this run."
        : "Choose a faction. Characters and your team-specific loadout are saved independently.";
  $("confirmTeam").textContent =
    changed && activeRun
      ? "SWITCH TEAM & RESTART"
      : pendingTeam === game.team
        ? "KEEP CURRENT TEAM"
        : "CONFIRM TEAM";
}
function openTeamDialog() {
  if (teamDialogOpen) return;
  teamDialogSource = game.state;
  pendingTeam = game.team;
  if (game.state === "play") game.pause();
  game.resetInput();
  teamDialogOpen = true;
  $("teamDialog").classList.remove("hidden");
  renderTeamDialog();
  $("cancelTeam").focus();
  game.audio.start();
  game.audio.cue("ui");
}
function closeTeamDialog() {
  if (!teamDialogOpen) return;
  teamDialogOpen = false;
  $("teamDialog").classList.add("hidden");
  game.resetInput();
  if (teamDialogSource === "play") game.resume();
  else if (game.state === "menu") $("chooseTeam").focus();
}
function confirmTeam() {
  const changed = pendingTeam !== game.team,
    activeRun = ["play", "pause"].includes(teamDialogSource);
  if (!changed) {
    closeTeamDialog();
    return;
  }
  saveStored("palestine-loadout-" + game.team, loadout);
  game.selectTeam(pendingTeam);
  saveStored("palestine-team-v6", pendingTeam);
  loadout = validLoadout(
    readStored("palestine-loadout-" + pendingTeam, null),
    pendingTeam,
  );
  game.setLoadout(loadout);
  const op = readStored("palestine-operator-" + pendingTeam, 0);
  game.selectOperator(op === 1 ? 1 : 0);
  previewIndex = loadout[0];
  activeSlot = 0;
  weaponCategory = "all";
  if (window.absoluteDarkness) window.absoluteDarkness.loadout = loadout;
  teamDialogOpen = false;
  $("teamDialog").classList.add("hidden");
  renderOperators();
  renderLoadout();
  if (activeRun) {
    game.start();
    updateHUD(game);
  } else {
    game.toMenu();
  }
}
async function boot() {
  try {
    await new Promise((r) => setTimeout(r, 30));
    await loadPoliceReferences();
    game = new Game($("world"), settings, {
      state: handleState,
      hud: updateHUD,
      notice: (title, sub) => {
        $("notice").children[0].textContent = title;
        $("notice").children[1].textContent = sub;
      },
      fullscreen: full,
      teamRequest: () =>
        teamDialogOpen ? closeTeamDialog() : openTeamDialog(),
      escapeRequest: () => {
        if (teamDialogOpen) {
          closeTeamDialog();
          return true;
        }
        return false;
      },
      resumeRequest: () => {
        if (settingsFromPause) closePauseSettings();
        else game.resume();
      },
    });
    const savedTeam = readStored("palestine-team-v6", "police");
    game.selectTeam(savedTeam === "opposition" ? "opposition" : "police");
    loadout = validLoadout(
      readStored(
        "palestine-loadout-" + game.team,
        game.team === "police" ? loadout : [6, 12],
      ),
      game.team,
    );
    game.setLoadout(loadout);
    const savedOp = readStored(
      "palestine-operator-" + game.team,
      game.team === "police" ? readStored("darkness-police-operator", 0) : 0,
    );
    game.selectOperator(savedOp === 1 ? 1 : 0);
    window.neonRift = window.absoluteDarkness = {
      game,
      settings,
      WEAPONS,
      loadout,
    };
    renderMaps();
    renderOperators();
    renderLoadout();
    game.showPage("play");
    $("shell").classList.remove("hidden");
    $("loading").classList.add("hidden");
    document.querySelectorAll("[data-page]").forEach(
      (b) =>
        (b.onclick = () => {
          game.audio.start();
          showPage(b.dataset.page);
        }),
    );
    $("deploy").onclick = () => {
      game.setLoadout(loadout);
      game.start();
      updateHUD(game);
    };
    document.querySelectorAll("[data-slot]").forEach(
      (b) =>
        (b.onclick = () => {
          activeSlot = +b.dataset.slot;
          previewIndex = loadout[activeSlot];
          renderLoadout();
          game.audio.cue("ui");
        }),
    );
    document.querySelectorAll("[data-category]").forEach(
      (b) =>
        (b.onclick = () => {
          weaponCategory = b.dataset.category;
          renderLoadout();
          game.audio.cue("ui");
        }),
    );
    $("equip").onclick = () => {
      if (!["all", game.team].includes(WEAPONS[previewIndex].team)) return;
      let other = 1 - activeSlot;
      if (loadout[other] === previewIndex) loadout[other] = loadout[activeSlot];
      loadout[activeSlot] = previewIndex;
      saveStored("palestine-loadout-" + game.team, loadout);
      game.setLoadout(loadout);
      renderLoadout();
      game.audio.cue("ready");
    };
    document.querySelectorAll("[data-settings-tab]").forEach(
      (b) =>
        (b.onclick = () => {
          settingsTab = b.dataset.settingsTab;
          renderSettings();
          game.audio.cue("ui");
        }),
    );
    $("resetSettings").onclick = () => {
      Object.assign(settings, DEFAULTS);
      saveStored("rift-settings-v3", settings);
      game.applySettings();
      renderSettings();
      game.audio.cue("ui");
    };
    $("settingsBack").onclick = () =>
      settingsFromPause ? closePauseSettings() : showPage("play");
    $("pauseSettings").onclick = openPauseSettings;
    $("pauseBtn").onclick = () => game.pause();
    $("resume").onclick = () =>
      game.state === "pause" ? game.resume() : game.start();
    $("returnMenu").onclick = () => game.toMenu();
    $("menuFull").onclick = full;
    $("chooseTeam").onclick = openTeamDialog;
    $("pauseTeam").onclick = openTeamDialog;
    $("hudTeamButton").onclick = openTeamDialog;
    $("cancelTeam").onclick = closeTeamDialog;
    $("confirmTeam").onclick = confirmTeam;
    document.querySelectorAll("[data-team-option]").forEach(
      (b) =>
        (b.onclick = () => {
          pendingTeam = b.dataset.teamOption;
          renderTeamDialog();
          game.audio.cue("ui");
        }),
    );
    $("teamDialog").addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        const nodes = [...$("teamDialog").querySelectorAll("button")];
        let i = nodes.indexOf(document.activeElement);
        if (
          (!e.shiftKey && i === nodes.length - 1) ||
          (e.shiftKey && i === 0)
        ) {
          e.preventDefault();
          nodes[e.shiftKey ? nodes.length - 1 : 0].focus();
        }
      }
    });
    bindTouch();
  } catch (error) {
    console.error(error);
    $("loadingText").textContent =
      "3D rendering could not start. Enable WebGL / hardware acceleration, then reload.";
    $("loading").querySelector("p").textContent = "RENDERER UNAVAILABLE";
  }
}
function bindTouch() {
  let stick = $("stick");
  function move(e) {
    let r = stick.getBoundingClientRect();
    game.touchMove = {
      x: Math.max(
        -1,
        Math.min(1, (e.clientX - r.left - r.width / 2) / (r.width * 0.35)),
      ),
      y: Math.max(
        -1,
        Math.min(1, (e.clientY - r.top - r.height / 2) / (r.height * 0.35)),
      ),
    };
    stick.querySelector("i").style.transform =
      `translate(${game.touchMove.x * 25}px,${game.touchMove.y * 25}px)`;
  }
  stick.onpointerdown = (e) => {
    stick.setPointerCapture(e.pointerId);
    move(e);
  };
  stick.onpointermove = (e) => {
    if (stick.hasPointerCapture(e.pointerId)) move(e);
  };
  stick.onpointerup = stick.onpointercancel = () => {
    game.touchMove = { x: 0, y: 0 };
    stick.querySelector("i").style.transform = "none";
  };
  document.querySelectorAll("[data-action]").forEach((b) => {
    b.onpointerdown = (e) => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      game.audio.start();
      let action = b.dataset.action;
      if (action === "fire") game.fireHeld = true;
      else if (action === "aim") game.aiming = true;
      else game[action === "swap" ? "swap" : action]?.();
    };
    b.onpointerup = b.onpointercancel = () => {
      if (b.dataset.action === "fire") game.fireHeld = false;
      if (b.dataset.action === "aim") game.aiming = false;
    };
  });
}
boot();
