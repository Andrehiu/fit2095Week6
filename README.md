# Meme Library (FIT2095 Week 6) + OVERDUE!

An Express + Mongoose library app (books & authors CRUD). It also includes **OVERDUE! — Night Shift at the Meme Library**, a browser arcade game built on the library's own data.

## Run it

```bash
npm install
npm start            # http://localhost:8080   (PORT and MONGO_URL env vars are optional)
npm test             # API + game-logic unit tests (no MongoDB needed)
```

MongoDB is optional. Without it, the CRUD pages won't load data, but the game still works: it uses a built-in catalogue of meme book titles and keeps the leaderboard in memory.

Play at **http://localhost:8080/game** (also linked from the nav bar). Add `?debug=1` for an FPS counter and test hooks.

## The game

You're the night librarian, and the library has come alive. Throw books, dash through danger and **SHHH!** the chaos back into silence.

| | Keyboard / mouse | Gamepad | Touch |
|---|---|---|---|
| Move | WASD / arrows | Left stick | Drag left side |
| Throw books | Aim + hold click | Right stick / RT | Tap right side (auto-aims) |
| Dash (invulnerable) | Space / Shift | A / RB | DASH button |
| SHHH! shockwave | E / Q / right-click | B / LB | SHHH button |
| Pause | P / Esc | Start | ❚❚ |

Other keys: **F** toggles auto-fire and **M** mutes.

**How it uses the library app**
- The books you throw are **real titles from your MongoDB `Books` collection**, with the author populated. The current one is shown at the bottom of the screen.
- Every 5th wave, a boss called a **Rogue Author** appears, named after an author in your database.
- Scores are saved through a new `Score` Mongoose model and appear in the **Hall of Fame**.

**Gameplay systems**
- Six enemy types plus a three-phase boss with bullet patterns, summons and charges.
- Enemies find their way around the shelves using a **Dijkstra flow field** (one search from the player, shared by every enemy) and switch to a straight line when they have line of sight.
- **Procedurally generated, mirror-symmetric library layouts** for each wave, flood-fill checked so every cell can be reached.
- A **budget-based wave composer**: enemy types unlock over time, and every run is reproducible from its seed.
- **Roguelite perks** between waves (12 perks, stackable): ricochet, pierce, homing, multishot, orbiting books, crits…
- **Combo multiplier** up to ×4 and a flawless-wave bonus.
- **Dynamic lighting** (a darkness layer with lights cut into it, plus coloured glows), particles, screen shake, hit-stop and slow-motion.
- **Fully procedural audio** made with the Web Audio API: synthesised sound effects and an adaptive soundtrack. The soundtrack gets more intense in boss fights and is muffled when you pause.
- **Input**: keyboard and mouse, Gamepad API, and touch with a virtual stick. Menus can be navigated with a gamepad.
- **Accessibility**: auto-fire, a reduced-motion toggle (no shake or flashes), the game auto-pauses when the tab loses focus, and settings persist.

### Code map

```
public/game/
  main.js       game loop (fixed 120 Hz step), entities, AI, rendering, lighting, input, UI
  arena.js      procedural shelf layouts + connectivity check          (pure, unit-tested)
  flowfield.js  Dijkstra flow field + grid line-of-sight              (pure, unit-tested)
  waves.js      budget-based seeded wave composer                       (pure, unit-tested)
  upgrades.js   perk definitions + weighted roller                     (pure, unit-tested)
  util.js       seeded RNG, hashing, collision helpers                 (pure, unit-tested)
  audio.js      Web Audio synth: sound effects + look-ahead music sequencer
  game.css      menus / HUD overlay styles
views/game.html game page
routes/game.js  /game, /api/game/content, /api/scores (validation, plausibility check, rate limit, in-memory fallback)
models/score.js Score schema
test/           node:test suites (API via supertest, game logic)
```

### API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/game/content` | `{source: "db"\|"fallback", books:[{title,isbn,author}], authors:[{name,numBooks}]}` |
| GET | `/api/scores?limit=10` | Top scores (limit is clamped to 1–50) |
| POST | `/api/scores` | `{name, score, wave, kills, durationMs}` returns `201 {entry, rank}`. Errors: `400` invalid input, `422` implausible score, `429` too many posts (10/min per IP) |

## Fixes to the original app

- `POST /newAuthor` never sent a response; it now redirects (or shows the error page).
- `POST /newBook` redirected before the save finished and added to the author's book count even when the save failed. It now updates the count and redirects only after a successful save.
- The 404 page now returns HTTP 404.
- The server no longer crashes when MongoDB is unavailable.
- Added a `package.json`, which was missing.
