# Recording Checklist

One clean session of 20–30 minutes feeds 4–6 videos. Go through this list before each session.

## Once (first time only, about 20 minutes)

- [ ] Install **OBS Studio** (free, obsproject.com).
- [ ] In OBS: Settings → Video → Base and Output resolution **1080×1920**, FPS **30**.
- [ ] Settings → Output → Recording format **MP4** (or MKV, then File → Remux to MP4), encoder **hardware (NVENC, AMF or
      QSV) if listed**, quality "High Quality, Medium File Size".
- [ ] Make a **separate Chrome profile** named "Recording" with no bookmarks bar, no extensions, no saved logins and no
      signed-in Google account. Nothing personal then shows in a frame.
- [ ] In OBS, add a **Window Capture** source for that Chrome window (Windows 10/11 capture method), and **turn off
      "Capture cursor"** unless a video needs to show taps.
- [ ] Choose a layout:
  - **Vertical (recommended):** in the Recording profile, open DevTools (F12) → Toggle device toolbar (Ctrl+Shift+M) →
    Dimensions **Responsive 432 × 768**. Undock DevTools to a separate window so only the page shows. Crop the OBS
    source to the page area and scale it to fill the 1080×1920 canvas. The game's phone layout then fills the frame.
  - **Landscape (fallback):** a second OBS scene at 1920×1080 capturing a normal maximized window; crop in CapCut later.

## Every session (5 minutes)

- [ ] Turn on Windows **Do Not Disturb** (Focus) so no notifications appear.
- [ ] Close Discord, email and anything else that pops up.
- [ ] Open `https://nfl-2min-drill.com/` in the Recording profile. Use the live site, not a local build, so footage
      matches what viewers will play.
- [ ] Game **Settings**: Theme **Dark** (matches the brand), Play speed **Normal** (you can speed up in CapCut, but you
      can't slow down a fast recording). **Coach mode is on by default** (Settings → "Coach mode in Practice"): turn
      it off for every Practice recording except v08. In Career, keep the default Pro difficulty, because Rookie
      shows win chances on every call.
- [ ] Leaderboard nickname: use your public creator name or leave it empty. Never use your real full name or email.
- [ ] Decide on names: real team and player names appear on the field. Until that's decided, record **Career mode**
      (fictional league) or keep names out of close-ups. See CONTENT_PLAYBOOK.md section 3 for which videos Career
      footage can cover.
- [ ] Check the clock in the corner of your screen isn't captured, and no other tabs are visible.
- [ ] Open a notepad for timestamps.

## While recording

- [ ] Start OBS recording **before** opening the game screen, and stop well after the result. Trimming is easy; missing
      the start isn't.
- [ ] **Pause 2 seconds** on each decision before clicking, so you have a still frame for the "your call?" freeze.
- [ ] After each result, **wait 3 seconds** on the result card so the grade and "Better call" line are readable.
- [ ] Use **Replay** on any interesting play to capture a second angle of the same moment.
- [ ] Mark timestamps as moments happen:
  - `mm:ss` situation (e.g. "4th & 1 down 3")
  - your call and the grade
  - tags: **GOOD-CALL-FAILED** (v02), **BAD-CALL-WORKED** (v03), **CLOCK** (v04/v05), **DEFENSE** (v09),
    **CLOSE-FINISH**, **WEATHER** (v10)
- [ ] For the Daily (v07): record your **first and only** attempt from the brief to the end screen, with no restarts.
- [ ] For Survivor (v12): record the whole run.
- [ ] For weather (v10): in Practice, set Weather to Snow, Rain or Wind and build a late goal-line spot.

## After recording (5 minutes)

- [ ] Rename the file `YYYY-MM-DD_session.mp4` and put it in `recordings/` (outside the repository: video files don't
      belong in git).
- [ ] Copy the timestamp notes into a text file with the same name.
- [ ] Add a row per planned video to [WEEKLY_CONTENT_TRACKER.csv](WEEKLY_CONTENT_TRACKER.csv) with the source file and
      timestamp.
- [ ] Scrub the footage once for anything personal: a notification, a tab, an email or a real name you didn't mean to
      show.

## Never in footage

- Your email, real name if you don't want it public, other tabs, bookmarks, the Windows taskbar or system tray.
- League, team or broadcast logos from anywhere else on your screen.
- Analytics dashboards, Cloudflare or AdSense screens (account IDs), `.env` files or API keys.
- Music playing on your PC: it ends up in the recording, and you probably don't have the rights.
