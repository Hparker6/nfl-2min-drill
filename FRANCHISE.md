# Franchise mode: plan

Status: **planning, nothing built yet.** This is the spec to agree on before any code. Decisions still open are in
[Decisions](#decisions-to-make), each with a recommended default.

## The pitch

Pick an NFL team and play a full 17-game, 18-week season, then the playoffs and the Super Bowl. For every game,
choose how much to play:

- **Play the moments.** The game sims while you watch a live drive tracker, and hands you the call when the game is
  on the line: the end of each half, big 4th downs, red-zone trips in a close game, and overtime.
- **Play full game.** Every snap, on offense and defense, with quarters from 2 to 12 minutes (2 is the default).
- **Sim game.** Instant result and full box score.

Around you, the other 15 games each week are simmed on the same engine. The standings, the playoff picture and the
league leaders (passing, rushing, receiving, tackles, sacks, interceptions) move every week.

**Why it fits:** every franchise game comes down to the thing The 4th Call already does best, which is the call at
the end. The Daily brings players in; Franchise gives them a reason to come back every day for weeks.

## The rule for all three modes: one engine

All three modes run **one game engine**: the same play-by-play sim (`src/engine/sim.ts`). The only difference is who
calls each snap:

| Mode | Who calls the snaps |
|---|---|
| Sim game | AI on both sides, no animation, runs in a worker |
| Play the moments | AI until a moment triggers; then you, until the moment ends |
| Play full game | You, for every snap of your team, offense and defense |

This means simmed games, played games and AI-vs-AI games all produce the same kinds of stats and scores. That keeps
league leaders honest and makes "keep simming" and "take over" possible at any snap.

## What the engine needs (Milestone 0)

Today `State` is fourth-quarter-only: `t` is seconds left in the game. Franchise needs a whole game. None of this
changes the Daily, Survivor or Practice, and existing saved games must replay identically (see Guardrails).

1. **Quarters and halves.** Add `q` (1–4, 5 for OT) and `qLen` (seconds per quarter). Add an end of quarter, which
   switches ends with the same down and ball. Add halftime, with a kickoff to the team that deferred and timeouts reset
   to 3 each. Add a two-minute warning in each half. All existing modes run as `q: 4, qLen: 900` and behave exactly as
   today.
2. **Opening kickoff and coin toss.** The kickoff path already exists (`kickStage`, `kicks.ts`); it just needs a
   first-half start.
3. **Real overtime.** Today OT is a weighted coin flip (`otProb`). Franchise plays it out under the NFL's current
   rules: a 10-minute regular-season period, both teams get a possession unless the first drive ends in a safety, and
   ties are possible. In the playoffs, OT periods repeat until someone wins.
4. **AI that plays a whole game.** `aiOffPlay`, `aiOffClock` and `aiDefLook` are tuned for the last minutes, so add
   early-game behavior:
   - normal run/pass mixes by down and distance;
   - punting and field goals on 4th down (by field position, score and quarter);
   - end-of-half clock management.

   With short quarters, the AI reads the clock **scaled to a 15-minute game** for "normal vs hurry-up" decisions.
   Without that, a 2-minute quarter would put every drive in hurry-up. The real clock still drives the final-2:00 logic.
5. **Player stat attribution.** `PlayResult` already says who carried the ball, who was targeted, whether the pass was
   completed and the yards gained. Franchise adds a seeded **tackler / sacker / interceptor** pick, weighted by
   position, alignment, the play's direction and ratings. When a play is animated, `timeline.ts` uses the same
   defender, so the tackler you see is the one credited.
6. **Calibration.** A test sims a few thousand AI-vs-AI games and checks league-wide averages against the real
   2025 NFL season (from nflverse): points, pass and rush yards, completion %, sacks, interceptions, punts, field goal
   %, plays per game and time per drive. It also checks the win spread: good teams win about 11–13 games, bad ones 3–6.
   Ratings are tuned until it passes. **This is what makes it feel real**, so it gates Milestone 1.

## The season (Milestone 1)

### League
- 32 teams, 2 conferences × 4 divisions (static table in `src/franchise/league.ts`).
- Rosters from `src/data/nfl-rosters.json`, which has 24 starters per team with ratings.
- Refresh the roster build (`npm run rosters`) to current 2026 rosters before launch (the file is labeled season 2025).

### Schedule
- **The real 2026 NFL schedule** (week, home and away, byes), built into a data file from nflverse schedule data by a
  script next to `build-rosters.mjs`.
- The NFL formula (6 division games, 4 against a division in the same conference, 4 against a division in the other
  conference, and 3 against teams that finished in the same place) is the fallback if the real schedule isn't usable.
- **"Start from this week" (optional, recommended).** Begin the season at the current real NFL week, with every team's
  real record and results so far, then play the rest. It's a strong marketing hook: "Can you save the Jets' season?"

### Week flow
- Your game: Play the moments / Play full game / Sim.
- All other games sim in a Web Worker (16 games × ~130 snaps is milliseconds).
- **Sim to:** next week, the trade deadline (later), the end of the regular season, or the playoffs.
- Every game is seeded from the season seed, the week and the game id, so a season replays the same.

### Standings and playoffs
- Division, conference and league tables with W-L-T, PCT, PF, PA, DIFF, home/away, division and conference records,
  and streak.
- Playoff picture with **clinch markers**: x clinched playoff, y division, z bye, e eliminated.
- 7 seeds per conference: 4 division winners plus 3 wild cards. The #1 seed gets the bye.
- Wild Card weekend (6 games), Divisional (4), Conference Championships (2) and the Super Bowl (neutral site).
- **Tiebreakers**, in this order (simplified from the NFL's list; we leave out the points-based steps near the bottom
  of the NFL's list):
  - **Division:** head-to-head, division record, common games, conference record, strength of victory, strength of
    schedule, then a seeded coin flip.
  - **Wild card:** head-to-head (with a sweep required for three or more teams), conference record, common games
    (minimum 4), strength of victory, strength of schedule, then a coin flip.

### Stats
Every snap writes to a box score. Season totals come from adding up the box scores.

| Category | Stats |
|---|---|
| Passing | Comp/Att, yards, TD, INT, sacks, passer rating, yards per attempt |
| Rushing | Attempts, yards, TD, yards per carry, long, fumbles |
| Receiving | Targets, receptions, yards, TD, long |
| Defense | Tackles, sacks, TFL, INT, pass breakups, forced fumbles, defensive TD |
| Kicking | FG made/att by distance, XP, punts and average |
| Team | Points, total yards, turnovers, 3rd-down %, red-zone %, time of possession |

### League leaders
Top 10 in each category, plus team leaders on each team page. Short quarters mean fewer stats in played games (see
[Decisions](#decisions-to-make)).

### Saves
- **IndexedDB** in the browser, not localStorage: a season of box scores is too big for localStorage's ~5 MB.
- 3 save slots; autosave after every game.
- **Export / import a save code** to move devices. No accounts.
- Each player has their own franchise in their own browser, the same as the Daily.

## Play full game (Milestone 2)

- Settings when you start the franchise: **quarter length 2–12 minutes** (default 2), difficulty, and the default
  mode for each game (you can still choose each week).
- The current game screen runs the whole game. The scoreboard shows Q1–Q4 and OT, there's a halftime screen with a
  box score, kickoffs at the start of each half and after scores, and the play caller on both sides of the ball.
- **Accelerated clock** (on by default with short quarters): the play clock runs before each snap so a 2-minute
  quarter still has a realistic number of plays per drive. Without it, a 2-minute quarter is about 3 possessions per game.
- **Grading:** Performance grades stay on for the 4th quarter and OT, where the current evaluator measures win chance
  well. Earlier calls aren't graded at first. A full-game grade based on an expected-points model can come later.
- **Pause and resume:** leaving mid-game saves the snap, and you pick up where you left off.

## Play the moments + the live drive tracker (Milestone 3)

### The live drive tracker (the screen while the sim runs)
- **Scorebug:** teams, score, quarter, clock, timeouts and who has the ball.
- **Field strip:** a horizontal field in team colors with the ball marker, the line to gain, and the current drive
  drawn as an arrow from where it started. Past drives show as faint arrows.
- **Play-by-play feed:** one line per snap, written the way the game already writes plays (`describe.ts`), e.g.
  "2nd & 7 · KC 38 · Mahomes pass deep left to Kelce for 21". Big plays and scores are highlighted.
- **Drive summary** when each drive ends: plays, yards, time and result ("Touchdown · 8 plays, 75 yds, 4:12").
- **Speed:** 1×, 2×, 4×, or skip to the next moment.

### Moments
- A banner when a moment triggers: **"Your moment: 2nd & 7 at the OPP 38, 1:52 Q2, down 3"**, with
  **Take over** and **Keep simming**.
- Default triggers:
  - your offense or defense in the final 2:00 of either half when within 8 points;
  - a 4th down past midfield;
  - a red-zone trip when within 8 points in the second half;
  - overtime;
  - the final drive of a one-score game.
- **Moments setting:** Few, Normal or Lots. Normal is about 3–5 moments per game.
- A moment lasts until your team loses or gains possession, then the tracker resumes.
- The moment plays on the existing game screen, so routes, play cards, the clock and the AI defense all work as they
  do today.

## Screens

1. **New franchise:**
   - pick a team, from a grid with logos, colors and overall ratings;
   - pick a start (Week 1, or this real week);
   - settings (quarter length, difficulty, moments and the default mode).
2. **Hub:**
   - next-game card (opponent, records, the matchup's key ratings, kickoff weather);
   - three buttons: Play the moments, Play full game, Sim;
   - Sim to…;
   - your division mini-table;
   - the top leaders;
   - a league news ticker (upsets, big games, clinches).
3. **Schedule:** your 18 weeks with results; tap a game for its box score. Also the league's games for any week.
4. **Standings:** tabs for Division, Conference and Playoff picture.
5. **League leaders:** category tabs, top 10, tap through to the player.
6. **Team:** roster by position with ratings and stats; team stats and ranks.
7. **Box score:** scoring summary, team stats, and passing, rushing, receiving and defense tables.
8. **Playoff bracket.**
9. **Champion screen + share card:** "Super Bowl LXI Champions: Detroit Lions, 14-3", made with the existing share-image
   tech (`shareImage.ts`). Season-end share cards are a free growth loop.

## Build order

| Milestone | What's done when it ships |
|---|---|
| **M0 Engine** | Quarters, halves, OT, whole-game AI, stat attribution and calibration tests pass. The Daily is unchanged. |
| **M1 Season (sim only)** | New franchise, real schedule, sim weeks, standings, tiebreakers, playoffs, leaders, box scores, saves. Hidden behind `?franchise` for testing. |
| **M2 Play full game** | Quarter lengths, halftime, kickoffs, both sides of the ball, accelerated clock, resume mid-game. |
| **M3 Play the moments** | The live drive tracker, moment triggers and the take-over hand-off. |
| **M4 Launch** | Champion share card, a `/franchise/` page for search ("NFL franchise mode game, free in your browser"), sitemap entry, and a link in the app's menu. Launch as **Franchise (beta)**. |
| **Phase 2 Roster** | Backups added to the roster data (about 46 per team), depth chart, injuries, a trade deadline with AI trade logic, signing free agents mid-season, progression in-season. |
| **Phase 3 Dynasty** | More seasons, aging, contracts and the salary cap, the draft and offseason free agency. |

Code lives in `src/franchise/` (league, schedule, game sim, stats, standings, playoffs, save) and
`src/ui/franchise/`. The engine changes stay in `src/engine/`.

## Guardrails

- **The Daily must not change.** Every existing test passes, and a new test replays saved Daily, Survivor and Practice
  games and checks they're identical to before.
- **Determinism:** every franchise game is reproducible from its seed. Saves store results and box scores, so they
  don't depend on re-simming.
- **Performance:** simming a full week takes under 1 s on a mid-range phone, and runs in a worker so the UI never
  freezes.
- **Mobile first:** every screen is checked at phone width (390) and desktop (1400), in dark and light.

## Decisions to make

| # | Question | Recommended default |
|---|---|---|
| 1 | Real 2026 schedule, plus "start from this week" with real records? | Yes, both |
| 2 | Stats from short-quarter full games: count as played, or scale up to 15-minute quarters? | Count as played (the honest way). Leaders show totals and per-game. |
| 3 | Default quarter length for Play full game | 2 minutes, adjustable 2–12 |
| 4 | Difficulty levels | Rookie, Pro, All-Pro: they change how sharp the AI's play-calling is, not the players' ratings |
| 5 | Saves | Browser only, 3 slots, with an export code |
| 6 | Free or premium | **Agreed:** free while in beta. Later, sell **ad-free play** and/or **extra seasons** (the Dynasty phase). |
| 7 | Player names | Get a legal review **before** monetizing anything. Misspelled "parody" names (e.g. "Bejawn Robinson") are **not** a safe option: same team, number, position and ratings still identify the player. Options to bring to the lawyer: an NFLPA group license; fictional players with editable names; real names only in the free modes. |
