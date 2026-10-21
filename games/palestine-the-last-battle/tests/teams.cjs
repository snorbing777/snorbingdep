const { chromium } = require("playwright"),
  assert = require("node:assert/strict");
(async () => {
  let b = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [
      "--no-sandbox",
      "--enable-unsafe-swiftshader",
      "--use-angle=swiftshader",
    ],
  });
  let p = await b.newPage({ viewport: { width: 1440, height: 900 } }),
    errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await p.addInitScript(() =>
    localStorage.setItem(
      "rift-settings-v3",
      JSON.stringify({ quality: "medium" }),
    ),
  );
  await p.goto(process.env.GAME_URL || "http://127.0.0.1:4173");
  await p.waitForFunction(() => !!window.absoluteDarkness, null, {
    timeout: 90000,
  });
  await p.click('nav [data-page="loadout"]');
  await p.click('[data-category="sniper"]');
  await p.click('[data-weapon="11"]');
  await p.keyboard.press("n");
  await p.waitForSelector("#teamDialog:not(.hidden)");
  await p.click('[data-team-option="opposition"]');
  await p.click("#confirmTeam");
  assert.equal(
    await p.evaluate(() => absoluteDarkness.game.team),
    "opposition",
  );
  await p.click('nav [data-page="loadout"]');
  await p.click('[data-category="sniper"]');
  await p.click('[data-weapon="12"]');
  await p.click("#equip");
  assert.equal(await p.locator("#equip").isDisabled(), true);
  assert.match(await p.locator("#equip").textContent(), /EQUIPPED/);
  await p.click('[data-weapon="11"]');
  assert.match(await p.locator("#equip").textContent(), /OTHER TEAM/);
  await p.click('nav [data-page="play"]');
  await p.click("#deploy");
  await p.keyboard.press("n");
  let frozen = await p.evaluate(() => absoluteDarkness.game.clock);
  await p.waitForTimeout(150);
  assert.equal(await p.evaluate(() => absoluteDarkness.game.clock), frozen);
  await p.click("#cancelTeam");
  await p.waitForFunction(() => absoluteDarkness.game.state === "play");
  await p.keyboard.press("n");
  await p.click('[data-team-option="police"]');
  await p.click("#confirmTeam");
  assert.equal(await p.evaluate(() => absoluteDarkness.game.team), "police");
  assert.equal(await p.evaluate(() => absoluteDarkness.game.wave), 1);
  assert.equal(await p.evaluate(() => absoluteDarkness.game.score), 0);
  await p.keyboard.press("p");
  await p.click("#returnMenu");
  await p.setViewportSize({ width: 390, height: 844 });
  let info = await p.evaluate(() => ({
    weaponParts: absoluteDarkness.game.weaponPreview.userData.partCount,
    team: absoluteDarkness.game.team,
    starRounds: absoluteDarkness.WEAPONS.length,
  }));
  console.log(
    JSON.stringify({
      info,
      errors,
      teamSwitch: true,
      cancelPreservesRun: true,
    }),
  );
  await b.close();
  assert.deepEqual(errors, []);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
