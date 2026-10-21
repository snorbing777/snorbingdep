# Palestine: The Last Battle

Version 0.6 is a playable single-player alpha. Its WebGL renderer replaces the earlier raycaster and sprite characters. It is not a production-ready release.

## Run and verify

Serve `dist/` over HTTP (ES modules require HTTP):

```sh
python3 -m http.server 4173 --directory dist
```

Open http://localhost:4173. Run syntax checks with `npm run check`. Install development dependencies with `npm install`, install the Playwright Chromium browser with `npx playwright install chromium`, then run `npm test` while the server is active. `CHROMIUM_PATH` selects an installed Chromium executable; `GAME_URL` selects a different local server.

The browser smoke test checks settings persistence, loadout slot swapping, pause preservation, the three-SMG/four-assault-rifle counts, opposing-team equipment restriction, physical star projectile travel, every available weapon's damage and wall occlusion, ammunition and reloads, jump and ability limits, wave advancement, extraction, death, and both maps.

## Structure

- `dist/game.js`: scene setup, simulation, collision, navigation, combat, and input.
- `dist/world.js`: procedural architecture, materials, lighting props, and collider generation.
- `dist/models.js`: modeled operators, enemies, weapons, and first-person hands.
- `dist/ui.js` and `style.css`: menus, loadout, settings, pause, and HUD.
- `dist/data.js`: weapon balance, operators, arena layouts, and settings defaults.
- `dist/audio.js`: browser-generated sound cues and ambient audio.
- `dist/vendor/`: pinned Three.js 0.160.1 and its MIT license. No runtime CDN dependency.

## Current scope

Thirteen weapon entries (three SMGs, four assault rifles, a Counter-Terrorist AWP and a Terrorist AWP, plus four existing platforms), two equipped slots, two Police operators, two original maps, five-wave extraction missions, aim-down-sights, jump/double jump, directional boost, pulse blast, and local high scores. Settings and loadouts persist in browser localStorage; no data leaves the device. Browser storage may be unavailable or cleared, in which case defaults are used.

Fullscreen, pointer capture, and audio require a user gesture and browser permission. Keyboard turning and drag-to-look are fallbacks. Touch controls are present; landscape orientation is recommended. Performance depends on WebGL support and the device; graphics presets adjust render resolution and shadows.

## Before release

The art is procedural placeholder art, not final production assets. Remaining production work includes broader device and accessibility testing, profiling on real phones, animation and audio production, balancing, polished level design, and platform packaging. Multiplayer, wall-running, progression, and native iOS distribution are not implemented. Any App Store build requires its own iOS integration, device QA, privacy disclosures, age rating, and App Review. The layouts are original rather than copied Call of Duty maps. Police character likenesses use the two user-supplied photo references with modeled hair and clothing. These are stylized approximations, not full 3D scans. The original Police reference AVIFs are kept under `dist/assets/`; face texture UVs select the visible face region without changing those source files. No real identities or biographies are assigned to the characters.

## Police team development pass

Blue team is named Police, with two selectable photo-referenced characters. Red-team enemies are two entirely fictional suited operatives: Vesper and Rook. No political likenesses or photo textures are used for them. Each team has an equipable AWP and independent loadouts; this build remains a single-player wave mission, not multiplayer.

Gunfire now uses spinning, extruded two-triangle Star of David projectiles. Swept ray/sphere and wall tests process each travelled segment to prevent tunneling at sniper speeds. Friendly and enemy stars use separate colors. Damage occurs at impact, not at trigger pull. Existing local settings and valid loadouts migrate from the earlier build.

## Environment pass

Version 0.6 adds 1024px procedural materials with layered weathering and bump depth, filtered mipmaps, anisotropic filtering, environment reflections, drainage, curb detailing, recessed entries, balconies, facade pilasters, and overhead cables. The maps remain stylized rather than photorealistic. Decorative geometry does not replace the grid navigation/collision system.

## Version 0.6 — lobby, weapons, and factions

The lobby now uses its own lit 3D showroom, self-hosted Rajdhani typography, and a consistent menu system. Weapons use detailed component geometry, shaped stocks and magazines, cylindrical barrels, optics, receiver hardware, and brushed PBR surface detail. They remain procedural models rather than photogrammetry assets.

Press **N** in the lobby or during gameplay to open faction selection. Counter-Terrorists use the original Police references; Terrorists use the fictional Vesper/Rook roster. Cancelling preserves a mission. Confirming a different faction during a mission explicitly restarts it; scores, enemies, and rounds reset. Operator choices and loadouts persist separately for each faction. The active faction determines opponents, player stats, and allowed AWP.

Run `npm run test:teams` against the local server to verify N-key selection, cancellation, mission restart, and team equipment restrictions. The original AVIF Police references are unchanged. No political figure likenesses are used for red-team characters.

All weapon projectiles and muzzle effects use the same extruded Star of David geometry: two overlapping triangular outlines, with visible travel and swept collision.
