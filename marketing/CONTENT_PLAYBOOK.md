# Content Playbook: The 4th Call

How to turn real gameplay into short vertical videos for TikTok, Instagram Reels and YouTube Shorts without making
marketing a second job. Budget: about 3 hours a week. Companion files: [VIDEO_IDEAS.md](VIDEO_IDEAS.md),
[RECORDING_CHECKLIST.md](RECORDING_CHECKLIST.md), [REDDIT_PLAYBOOK.md](REDDIT_PLAYBOOK.md),
[WEEKLY_CONTENT_TRACKER.csv](WEEKLY_CONTENT_TRACKER.csv), end card in [assets/](assets/).

## 1. What the game actually offers on camera

Only claim what the footage shows. These are the features that exist today and read well in a short clip:

| Moment | Where it appears | Why it works on video |
|---|---|---|
| The brief: "From here, our simulated coach wins **28%** of the time. Can you do better?" | Start of every Daily, Survivor and Practice game | A ready-made hook with a real number |
| Scoreboard with clock, down and distance, and a live **WIN %** bar | Top of the game screen | Viewers understand the stakes in one glance |
| Play cards in tabs (Run, Short, Deep, RPO, Trick) and the defense tabs (Zone, Man, Blitz, Goal Line) | Call panel | Shows that the viewer would be choosing |
| Tapping a receiver to throw to him, and changing his route | Field | The most hands-on moment |
| Tempo and clock calls: No-huddle, Huddle, Milk it, Timeout, Spike, Kneel, Run it down | Between plays | The clock-management angle |
| The play animating on the field, including in rain, wind or snow | Field | Motion; weather is rare in normal games but can be chosen in Practice |
| The **result card**: Great call / Close / Costly / Big miss, a call grade out of 100, "Better call: X +N pts win chance", and a table of your call, the best call and the AI coach | After each call | The payoff, and what makes this game different |
| Coach mode in Practice: the win chance on every option **before** you call | Practice | Explains the grading in one shot |
| Replay of the last play | Result card | A second look at a big moment |
| End of game: Performance score, "coached like" archetype, the emoji-square share text, the live leaderboard | Daily | The daily ritual and the call to action |
| Survivor's 'Survived [N]' count (the share text adds a row of 🏈 and 💀) | Survivor end | A streak format |

The game has **no sound of its own**, so every video needs added sound (section 6).

**What makes it different, said honestly:** every call is graded against every option you had, by playing out the rest
of the game thousands of times in the game's own simulation, and a good call that fails still counts as good. Do not
call it "realistic", "the hardest" or "the only" anything. Say "the game's simulation", not "analytics" or "real odds".

**Fastest path from clip to play:** the homepage *is* today's game. One tap on "Take the headset" and you are calling
plays, with no sign-up. Every call to action should send people to the home page, not the how-to-play page.

## 2. The three content angles

1. **"What's your call?"** Freeze on a real situation (score, clock, down, WIN %), let the viewer decide, then reveal
   the call and the game's grade, including when the grade disagrees with the result. This is the game's core idea,
   and it invites comments.
2. **Clock-management puzzles.** 1:39 left, one timeout, down 3. Spike, timeout or no-huddle? Sideline or middle? This
   is what football fans argue about every Sunday, and the game models it directly.
3. **The Daily.** One game a day, the same for everyone. "Today's Daily: I lost. Can you beat 28%?" It is a recurring
   series that gives people a reason to come back tomorrow.

Developer commentary is a light seasoning on these, not its own angle: one in four videos at most.

## 3. Rights and branding rules for every video

- The game shows real team names and player names from public rosters. Marketing videos are advertising, which raises
  more trademark and likeness risk than the game itself. Until you decide otherwise (see the approval list in the
  final report), **prefer Career mode footage (every team and player is fictional) or keep real names small and
  incidental**. Never put a real player's or team's name in a title, hook or caption.
- Career mode limits: its drives use the same call panel, field and result card, but it skips the opening brief (no
  "simulated coach wins N%" line), you can't pick the situation, and it has no Daily, Survivor, Practice or weather
  builder. Videos v01–v06, v09 and v11 can be cut from Career footage when the situation comes up. v07, v08, v10 and
  v12 need Daily, Practice or Survivor, which use real rosters, so they wait for the names decision.
- No NFL logos, shields, team logos, game broadcasts or league footage. No "official", "NFL game" or "NFL approved".
- Put "Independent fan game. Not affiliated with the NFL." in each profile bio.
- Hashtags: avoid league and team hashtags (#NFL, #Chiefs). They imply affiliation and attract the wrong audience.
- This is a risk flag, not legal advice. A short consult with an IP lawyer is worth it before any paid promotion.

## 4. Recording

Full checklist: [RECORDING_CHECKLIST.md](RECORDING_CHECKLIST.md). The decisions:

- **Record vertically.** The game already has a phone layout (scoreboard, field and call panel stacked), so capture it
  natively instead of cropping a wide screen. Use OBS Studio (free) with a **1080×1920 canvas at 30 fps**, capturing a
  portrait Chrome window or Chrome DevTools' device mode. 30 fps is plenty for this game and keeps files small.
  Use 60 fps only if you notice stutter in the play animation.
- **Fallback, landscape:** record 1920×1080 at 30 fps. In CapCut, on a 9:16 canvas, scale the clip so the field fills
  the width. Then either crop to the scoreboard and field and add the call panel as a second layer, or split the clip:
  top half for the scoreboard and field, bottom half for the call panel. Keep the score, clock and WIN % visible
  in every frame.
- Record long, clean sessions (20–30 minutes of play) with no edits or narration. One session feeds 4–6 videos.
- Note the timestamps of good moments as they happen (a notepad next to you): "12:40 4th & 1 go, Big miss but worked".

## 5. CapCut setup (free version)

**Essential (free):**
- Project canvas **9:16, 1080×1920**, 30 fps.
- Split, trim, speed (1.5–2× for dead time), freeze frame, zoom (keyframe scale), text, stickers off.
- Export **1080p, 30 fps, recommended bitrate**. Export with the end card included and no CapCut outro.

**Optional (may be Pro in your region or version, so check before relying on them):** auto captions, background
removal, AI voices, premium fonts, premium effects. Every video below works without them: captions are typed text.

**Template project:** build one project called `4thCall_TEMPLATE` and duplicate it for each video:
1. Track 1: gameplay.
2. Track 2: a hook caption box, top third.
3. Track 3: a lower caption, at the bottom third above the platform UI zone.
4. Last 2.5 s: the end card PNG from [assets/end-card.png](assets/end-card.png).
5. Saved text style: **Barlow Condensed** (or CapCut's closest bold condensed font), white, all caps for hooks, sentence
   case for body; the key number in yellow **#F5C518**; a dark **#0A0E0C** box at about 85% opacity behind text.

## 6. Editing rules

- **Safe zones:** keep text inside the middle 80% horizontally and out of the top 10% and bottom 20% of the frame,
  where TikTok, Reels and Shorts put their buttons and captions.
- **Font size:** hooks about 70–90 px high on the 1080-wide canvas (fills about half the width); body captions about
  48–56 px. If you can't read it on your phone at arm's length, it's too small.
- **Pacing:** something changes every 1.5–3 s (a cut, a zoom, a new caption). Speed through menus at 2×. Never show
  more than 2 s of nothing happening. Freeze on the decision so the viewer can think.
- **Hook:** the first frame already shows the situation (scoreboard visible) plus a 3–7 word question. No logo intro,
  no "hey guys".
- **Transitions:** hard cuts. A quick zoom-in on the result card is the only "effect" you need.
- **Sound:** the game is silent, so add (a) a low crowd bed, (b) a whistle on the snap, (c) a short tick for the clock
  and (d) a hit or "ding" on the result card. Use only sounds licensed for commercial use: CapCut's library items
  marked for commercial use, the YouTube Audio Library, or freesound.org files under CC0. Trending songs added inside
  TikTok or Instagram are licensed for use on that platform only, so add them in-app, not in CapCut, and never
  in the master file you upload everywhere.
- **Voice-over:** optional. Your own voice, recorded in CapCut or on your phone, beats an AI voice for trust.
- **Ending:** 2–2.5 s end card: "The 4th Call · Free in your browser · Link in bio". End on the result or the open
  question, not on a sales pitch.

## 7. One master file, three platforms

- Export one clean master per video (no platform watermark, no in-app music) and keep it in a `masters/` folder.
- Upload the master natively to each platform. Do not download a TikTok and re-upload it to Reels or Shorts: Instagram
  has said it shows watermarked reposts less, and a clean upload looks better everywhere.
- Add platform music, if any, inside each app.
- Caption and hashtags differ per platform (see [VIDEO_IDEAS.md](VIDEO_IDEAS.md)).

## 8. Links and tracking

TikTok and Instagram captions don't have clickable links. Put one tagged link in each profile bio and change its
`utm_content` when you change the featured video. YouTube Shorts can link to a related video, not to a site, so put
the tagged link in the channel's links and the description.

```
https://nfl-2min-drill.com/?utm_source=tiktok&utm_medium=social&utm_campaign=shorts&utm_content=v01
https://nfl-2min-drill.com/?utm_source=instagram&utm_medium=social&utm_campaign=shorts&utm_content=v01
https://nfl-2min-drill.com/?utm_source=youtube&utm_medium=social&utm_campaign=shorts&utm_content=v01
https://nfl-2min-drill.com/?utm_source=reddit&utm_medium=community&utm_campaign=<subreddit>&utm_content=<post-type>
```

Parameter meanings, the funnel and the weekly review are in section 10 below.

## 9. A schedule one person can keep

- **Sunday (90 min):** record one session; mark timestamps.
- **Monday (90 min):** edit three videos from it, export masters.
- **Posting:** three videos a week (Tue, Thu, Sat), each to all three platforms. Posting takes 10 minutes per video.
- **Daily (15 min):** reply to comments for the first hour after posting. Comments are where players come from.
- **Monday (20 min, before editing):** fill in the tracker and do the weekly review, covering only videos posted at
  least 48 hours earlier. Week 1 has no review: the first one is the Monday after week 1, when all three week-1 videos
  have 48 hours of data.

Keep this for 4 weeks (12 videos) before judging any format. Add a fourth weekly video only once the three feel easy.

## 10. Measurement and weekly review

The question is not "how many views" but "how many people started a game, and did they come back". Everything below
uses analytics that already exist. No new events or tracking code are needed to start.

### What already exists (do not rename)

GA4 property `G-WVFFZZWS61` receives these events from the game, among others (full list in `src/game/analytics.ts`):

| Event | Means | Use it for |
|---|---|---|
| `page_view` | Someone loaded the site (GA4 default) | Visits per source |
| `screen_view` (param `mode`) | Switched mode: daily, survivor, practice, career | Which modes people try |
| `brief_shown` | The pre-game brief is on screen | Saw the game |
| `game_start` (params `mode`, `resumed`) | Pressed "Take the headset" | **The main conversion** |
| `call_made` | Made a call | Engagement depth |
| `spot_complete` (params `mode`, `win`, `calls`) | Finished a game | **Finished**; the game has no per-drive event, so this is the closest "finished a drive" |
| `play_again` (params `from`, `to`; no `mode`) | Chose another game after finishing one | Did one game lead to another |
| `daily_complete` (params `win`, `performance`), `leaderboard_submit`, `share` | Ritual and virality signals | Retention and word of mouth |

Shared results already carry `?ref=share`, which shows up in GA4's page location.

### UTM scheme (links you control)

| Parameter | Meaning | Values |
|---|---|---|
| `utm_source` | The platform the visitor came from | `tiktok`, `instagram`, `youtube`, `reddit` |
| `utm_medium` | The kind of channel | `social` for your video profiles, `community` for Reddit |
| `utm_campaign` | The series or community | `shorts` for videos, the subreddit name for Reddit (`webgames`) |
| `utm_content` | The specific video or post | Video ID from the tracker (`v01`…`v12`), or Reddit post type (`feedback`, `challenge`, `devupdate`) |

Rules: lowercase, no spaces, never put personal data in a UTM. UTMs don't affect search: the canonical tag already
points every variant at the clean homepage URL.

**Honest limit:** TikTok and Instagram captions can't hold links, so per-video attribution is approximate. The bio
link's `utm_content` names the featured video, and the rest is timing: compare `game_start` from each source in the
48 hours after each post. Reddit links can be tagged per post, so Reddit attribution is exact.

### One-time GA4 setup (15 minutes)

1. **Isolate the site.** In every report or exploration, add the filter **Hostname exactly matches
   `nfl-2min-drill.com`**. That excludes other sites, localhost and previews.
2. **Register custom dimensions** (Admin → Custom definitions → Create): event-scoped `mode` and `win` (needed);
   `from` and `to` for `play_again` (useful). Optional: user-scoped `days_played` and `device_class`, which the game
   already sets as user properties. Registering only adds reporting going forward and changes no event or historical
   data. `win` is sent as a true/false value; check how it appears in Realtime before building reports on it.
3. **Mark `game_start` as a key event** (Admin → Events). Optionally mark `spot_complete` too.
4. **Build one funnel exploration**, saved as "Social funnel": steps `session_start` → `game_start` →
   `spot_complete` → `play_again`, broken down by **Session source / medium**, with the hostname filter.
5. Cross-check volumes in **Cloudflare Web Analytics** (filter to the nfl-2min-drill.com site). It counts visits
   without cookies but doesn't report UTMs, so use it as a sanity check, not for attribution.
6. In **Search Console**, select the nfl-2min-drill.com property only (not a property for another site) and watch
   Performance → Queries and Pages monthly. Search is slow; don't review it weekly.

### The five questions and where the answers are

| Question | Where |
|---|---|
| Which platform brings actual players? | Funnel exploration: `game_start` by Session source |
| Which videos bring visits? | Session manual ad content (`utm_content`) plus the 48-hour window after each post |
| Which landing pages convert? | Landing page + `game_start` rate. Expect `/` to win; `/how-to-play/` should hand people to `/` |
| How many start and finish? | Funnel: `game_start` ÷ sessions, then `spot_complete` ÷ `game_start` |
| Who returns? | GA4 "New / established" and a cohort exploration on `game_start`. **Unreliable for social traffic:** TikTok's and Instagram's in-app browsers keep separate cookies, so a returning player who opens the game in Safari or Chrome counts as new. Treat this as a lower bound. |

### Weekly review (Monday, 20 minutes, from week 2)

1. Fill in the tracker's numbers for every video posted at least 48 hours ago. Views, watch time, completion, the 3-second hold and
   engagement come from each platform's analytics. `link_clicks` comes from the platform's profile or link stats, where
   offered. `sessions_48h` and `game_starts_48h` come from GA4, filtered by hostname and Session source (and
   `utm_content` where it identifies the video), for the 48 hours after publishing. Leave a cell empty rather than guess.
2. For each video, mark the **hook result**: the share of viewers still watching at 3 seconds (TikTok and YouTube show
   it; Instagram shows a retention graph). A hook "won" if that rate is clearly above your own median.
3. For each platform, note `game_start` from GA4 for the week.
4. Write one line: what to repeat, what to change, what to drop.

### Reading the numbers without fooling yourself

- **Judge formats, not single videos.** One video is noise. Compare a format only after 3 or more videos of it.
- **Use your own median as the baseline**, not other creators' numbers.
- **Ignore anything under about 500 views** for retention, and under about 30 sessions for conversion rates.
- **Repeat a format** when, over 3+ videos, it beats your median on both 3-second hold and link clicks or game starts.
- **Stop a format** after 4 videos that sit below your median on both watch-through and game starts. Change the hook
  once before you drop it, because the hook is usually the problem.
- **Views without game starts** are the most common trap. A format that gets views but no game starts brings the wrong
  audience. Keep the format only if comments show genuine interest in the game.
- **Signs of real interest:** comments about a specific call or rule, questions about modes, people posting their
  Daily score, `play_again` and `daily_complete` from that source. **Signs of low-quality traffic:** a high bounce
  rate, near-zero `game_start` rate, sessions under 10 seconds, or spikes from countries or sources you didn't target.

### Optional later (needs approval, not implemented)

If the questions above can't be answered after 4 weeks, the smallest useful addition would be a `utm_content` value
on the share link (for example `?ref=share&utm_source=share&utm_medium=player`). That keeps `?ref=share` and adds
source attribution in standard GA4 reports. It is a one-line change in `src/game/share.ts`, and the existing event names
stay as they are. Nothing else is recommended.
