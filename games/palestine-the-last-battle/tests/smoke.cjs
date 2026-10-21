// Run against a local static server: GAME_URL=http://127.0.0.1:4173 npm test
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [
      "--no-sandbox",
      "--enable-unsafe-swiftshader",
      "--use-angle=swiftshader",
    ],
  });
  const page = await browser.newPage({
      viewport: { width: 1100, height: 760 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.GAME_URL || "http://127.0.0.1:4173");
  await page.waitForFunction(() => !!window.absoluteDarkness, {
    timeout: 60000,
  });
  await page.click('nav [data-page="settings"]');
  await page.selectOption("#setting-quality", "low");
  await page.locator("#setting-fov").fill("92");
  await page.locator("#setting-fov").dispatchEvent("input");
  await page.click('[data-settings-tab="audio"]');
  await page.locator("#setting-master").fill("0.35");
  await page.locator("#setting-master").dispatchEvent("input");
  await page.reload();
  await page.waitForFunction(() => !!window.absoluteDarkness);
  assert.equal(await page.evaluate(() => absoluteDarkness.settings.fov), 92);
  assert.equal(
    await page.evaluate(() => absoluteDarkness.settings.master),
    0.35,
  );
  await page.click('[data-op="1"]');
  assert.equal(
    await page.evaluate(
      () => absoluteDarkness.game.hero.root.userData.reference,
    ),
    1,
  );
  await page.click('nav [data-page="loadout"]');
  await page.click('[data-category="smg"]');
  assert.equal(await page.locator("[data-weapon]").count(), 3);
  await page.click('[data-category="ar"]');
  assert.equal(await page.locator("[data-weapon]").count(), 4);
  await page.click('[data-category="sniper"]');
  await page.click('[data-weapon="12"]');
  assert.equal(await page.locator("#equip").isDisabled(), true);
  await page.click('[data-category="all"]');
  await page.click('[data-weapon="4"]');
  await page.click("#equip");
  assert.equal(await page.evaluate(() => absoluteDarkness.game.equipped[0]), 4);
  await page.click('[data-slot="1"]');
  await page.click('[data-weapon="4"]');
  await page.click("#equip");
  assert.equal(
    await page.evaluate(() => new Set(absoluteDarkness.game.equipped).size),
    2,
    "swapping slots must not duplicate a weapon",
  );
  await page.click('nav [data-page="play"]');
  await page.click("#deploy");
  await page.keyboard.press("p");
  let frozen = await page.evaluate(() => absoluteDarkness.game.clock);
  await page.waitForTimeout(200);
  assert.equal(
    await page.evaluate(() => absoluteDarkness.game.clock),
    frozen,
    "pause freezes simulation",
  );
  await page.click("#pauseSettings");
  await page.click('[data-settings-tab="gameplay"]');
  await page.selectOption("#setting-difficulty", "veteran");
  await page.click("#settingsBack");
  await page.click("#resume");
  const combat = await page.evaluate(() => {
    let g = absoluteDarkness.game,
      results = [],
      check = (v, m) => {
        if (!v) throw Error(m);
      };
    g.audio.settings.master = 0;
    g.spawnLeft = 0;
    g.player.set(33.6, 0, 60.2);
    g.yaw = 0;
    g.pitch = -0.075;
    g.updateCamera(0.1);
    for (let i = 0; i < absoluteDarkness.WEAPONS.length; i++) {
      if (absoluteDarkness.WEAPONS[i].team === "opposition") continue;
      g.clearEntities();
      g.equipped = [i, (i + 1) % 6];
      g.slot = 0;
      g.ammo = [absoluteDarkness.WEAPONS[i].cap, 10];
      g.reloadT = g.cool = 0;
      g.spawn();
      let e = g.enemies[0];
      e.rig.root.position.set(33.6, 0, 52.2);
      e.hp = 2000;
      e.heavy = false;
      g.fireHeld = true;
      g.shoot();
      check(e.hp === 2000, "damage must wait for projectile travel");
      check(
        g.projectiles[0].mesh.userData.kind === "star-of-david",
        "shots use star geometry",
      );
      for (let step = 0; step < 120; step++) g.updateProjectiles(0.01);
      let damage = 2000 - e.hp;
      check(damage > 0, "weapon " + i + " must damage visible target");
      check(
        g.ammo[0] === absoluteDarkness.WEAPONS[i].cap - 1,
        "weapon must consume ammunition",
      );
      results.push({ weapon: absoluteDarkness.WEAPONS[i].id, damage });
      e.rig.root.position.set(33.6, 0, 20);
      e.hp = 2000;
      g.cool = 0;
      g.shoot();
      for (let step = 0; step < 300; step++) g.updateProjectiles(0.01);
      check(e.hp === 2000, "walls must block " + i);
      g.reload();
      check(g.reloadT > 0, "reload starts");
      g.reloadT = 0.001;
      g.update(0.005);
      check(g.ammo[0] === absoluteDarkness.WEAPONS[i].cap, "reload completes");
    }
    g.jump();
    g.jump();
    g.jump();
    check(g.jumps === 2, "double jump has a limit");
    g.boostT = 0;
    g.boost();
    check(g.boostT > 0, "boost cooldown");
    g.pulseT = 0;
    g.bomb();
    check(g.pulseT > 0, "pulse cooldown");
    g.jumpY = g.jumpV = g.jumps = 0;
    g.clearEntities();
    g.spawnLeft = 0;
    g.wave = 1;
    g.clearT = 0;
    for (let i = 0; i < 410; i++) g.update(0.01);
    check(g.wave === 2, "waves advance");
    return results;
  });
  await page.evaluate(() => {
    let g = absoluteDarkness.game;
    g.clearEntities();
    g.spawnLeft = 0;
    g.exit = true;
    g.player.set(33.6, 0, 60.2);
    g.update(0.01);
  });
  assert.match(await page.locator("#pauseTitle").textContent(), /EXTRACTED/);
  await page.click("#returnMenu");
  await page.click('[data-map="1"]');
  await page.click("#deploy");
  assert.equal(
    await page.evaluate(() => absoluteDarkness.game.difficulty),
    "veteran",
  );
  await page.evaluate(() => {
    let g = absoluteDarkness.game;
    g.hp = 0;
    g.update(0.01);
  });
  assert.match(await page.locator("#pauseTitle").textContent(), /SIGNAL LOST/);
  await page.click("#returnMenu");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: process.env.MOBILE_SCREENSHOT || "/tmp/neon-rift-mobile.png",
  });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      weapons: combat,
      persistence: true,
      pause: true,
      extraction: true,
      death: true,
      bothMaps: true,
    }),
  );
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
