# Simulator flows

Flows drive the app in the two project simulators without a person. `apps/mobile/scripts/sim-qa.sh`
runs them; `apps/mobile/sim-driver` is the XCUITest bundle that reads them. Maestro was the first
choice and does not install on this Mac (see the B0 entry in `docs/OVERNIGHT_BACKLOG.md`), so the
flows are plain text in a small language of their own.

## Running

```bash
apps/mobile/scripts/sim-qa.sh                 # everything from a clean state: up, every flow, down
apps/mobile/scripts/sim-qa.sh up              # bring the rig up and leave it running
apps/mobile/scripts/sim-qa.sh flow nurse nurse-flags.flow        # one flow, rig already up
apps/mobile/scripts/sim-qa.sh flow camera /path/to/my.flow shot  # your own flow, files named shot-…
apps/mobile/scripts/sim-qa.sh deteriorate     # a trend flag through the API (add `two` for two alerts)
apps/mobile/scripts/sim-qa.sh status
apps/mobile/scripts/sim-qa.sh down            # stop servers, shut the simulators down (--drop-db)
```

`up` makes the simulators "TriageCam Camera" and "TriageCam Nurse" if they do not exist (a clone
of a stock iPhone 17, erased, then slimmed with `apps/mobile/simslim.json`), creates and seeds
the database `triagecam_simqa`, starts the web server on port 3200 with `.next-3200`, runs
`pod install` and builds the development build, installs it signed out on both simulators, and
starts Metro on 8081 with the app pointed at `http://localhost:3200`. Set `SIMQA_SKIP_BUILD=1`
when only JavaScript changed, and `SIMQA_KEEP_DATA=1` to keep the database and the sign-ins.

Output is in `apps/mobile/.sim-qa/latest/` (git-ignored): `<prefix>-<name>.png` for every `shot`,
`<prefix>-flow.log` with the time of every step, `camera-app.log` and `nurse-app.log` (the app's
own log lines), and `web.log`, `metro.log`, `xcodebuild.log`. A flow that fails stops there and
leaves `<prefix>-FAILED.png` and `<prefix>-FAILED-tree.txt`, the accessibility tree of the screen
it stopped on, which is where to look up the label of anything you want to tap.

The account is the seeded one, `demo@triagecam.test` / `triagecam-demo`. The camera simulator
measures a generated signal, not a camera; every sitting it makes says "Simulated".

## What the committed flows cover

| Flow | Simulator | Screens |
|---|---|---|
| `camera.flow` | camera | sign-in and its errors, create an account and its errors, check your email, role choice, check-in, face-match consent, a full 60-second sitting, summary, find patient by face, settings, a re-check ended early |
| `nurse.flow` | nurse | sign-in, role choice, Worklist, Flags, Patients (waiting, discharged, all, no match), a patient top to bottom, You |
| `nurse-flag.flow` | nurse | after `deteriorate`: the trend-flag banner, acknowledged from the banner, the Flags tab after |
| `nurse-push.flow` | nurse | a notification sent with `xcrun simctl push`, tapped from the home screen, opens its patient |
| `links-nurse.flow`, `links-camera.flow` | both | every route by `triagecam://` link, and the other role's routes refused |

The smaller files (`sign-in.flow`, `role-nurse.flow`, `nurse-flags.flow` and so on) are the
pieces those are made of, and can be run on their own against a rig that is up.

## Other states

These are simulator settings, not flows. Set them, then run a flow with its own prefix:

```bash
xcrun simctl ui <udid> appearance dark                      # or light
xcrun simctl ui <udid> content_size accessibility-extra-extra-extra-large   # or large, the default
apps/mobile/scripts/sim-qa.sh flow nurse nurse-flags.flow nurse-dark
```

`sim-qa.sh status` prints the two ids. Server unreachable: stop the web server
(`kill $(lsof -tiTCP:3200 -sTCP:LISTEN)`) and run a flow; `sim-qa.sh up` with `SIMQA_KEEP_DATA=1`
starts it again. A second phone size: `SIMQA_CLONE_FROM` chooses what a missing project simulator
is cloned from.

## The language

One command per line. A text with spaces goes in double quotes. `#` starts a comment.

A text matches an element whose accessibility label is exactly that text. With `~` in front it
matches a label that contains it: React Native joins the texts inside one touch target into one
label, so a worklist card is `"~Robert Okafor"`. `${NAME}` is replaced by the rig: `METRO_URL`,
`EMAIL`, `PASSWORD`, `UNVERIFIED_EMAIL`.

| Command | What it does |
|---|---|
| `run other.flow` | Runs another flow file, found beside this one |
| `open "url"` | Opens a link, and answers "Open in Triage Cam?" if iOS asks |
| `launch`, `activate`, `terminate`, `home` | Starts the app, brings it to the front, ends it, presses Home |
| `wait "text" [seconds]` | Fails unless the text appears in time (30 s) |
| `waitGone "text" [seconds]` | Fails unless the text goes away in time |
| `assert "text"`, `assertNot "text"` | Fails unless the text is, or is not, on screen now |
| `count "text" n` | Fails unless exactly n elements match |
| `tap "text" [seconds]` | Taps it, scrolling the list it is in to reach it. A button is preferred over a title with the same words |
| `tapOptional "text" [seconds]` | Taps it if it turns up (3 s) |
| `type "field" "text"` | Taps the field and types |
| `clear "field"` | Empties a field |
| `hideKeyboard` | Puts the keyboard away |
| `scroll down`, `scroll up` | One swipe |
| `scrollTo "text"` | Scrolls until the text can be touched |
| `rotate landscape`, `rotate portrait` | Turns the device |
| `sleep seconds` | Waits |
| `shot name` | Saves `<prefix>-name.png`, turned upright when the app is in landscape |
| `screenShot name` | The same, never turned: for the home screen and iOS's own prompts |
| `dump name` | Saves the accessibility tree as `<prefix>-name.txt` |
| `tapSystem "text" [seconds]`, `tapSystemOptional "text" [seconds]` | Taps something iOS shows itself: a permission question, a notification |
| `signal name` | Writes the empty file `<prefix>-signal-name`, for a script that acts between two steps |
| `if "text" [seconds]` … `end`, `ifNot "text" [seconds]` … `end` | Runs the lines between only if the text is, or is not, on screen within the time (3 s) |

## Things that will bite you

- A touch in the first second after a screen slides in or out is lost, although the button is
  already there to be found. `tap` and `type` wait a second for that reason; it is not a hang.
- Metro runs without file watching, so a Fast Refresh cannot reset a screen in the middle of a
  flow. After a JavaScript change run `sim-qa.sh up` again (with `SIMQA_SKIP_BUILD=1
  SIMQA_KEEP_DATA=1` to keep everything else): it restarts Metro.
- **Leaving the sitting screen is unreliable in the simulator (BUG-14).** After the first
  sitting, a second one usually does not open in the same run of the app; now and then it does
  not open after a restart either, and now and then "Back to check-in" leaves a stretched
  picture of the sitting screen with nothing responding. The flows start the app again before
  every further sitting and put those sittings last, so a run that fails on
  `wait "Start sitting"` in `camera-recheck.flow` or `links-camera.flow` has still captured
  everything else. Run that flow again on its own to get its screenshots.
- The password field of "Create an account" cannot be typed into: iOS covers its keyboard with
  the "Use Strong Password?" sheet. `sign-up.flow` reaches "Check your email" by signing in to an
  account the rig left unverified.
- `open-app.flow` starts the app from cold with the Metro link. Opening the link in an app that
  has already loaded reloads it mid-render, which has crashed React Native here.
- A seeded patient goes overdue about eight minutes after `up`, and a banner then covers the top
  of the nurse's screen. `close-banners.flow` closes what is up.
- The app reads its server from `EXPO_PUBLIC_SIM_API_URL`, which the rig sets for Metro. Putting
  it in an `.env` file would point real phones at localhost.
- `xcrun simctl push` works only after the nurse role has asked for notifications and the flow
  has tapped Allow (`role-nurse.flow`). The server never pushes to a simulator: it has no token.
- Two flows can run at once, one per simulator. Two on the same simulator cannot.
