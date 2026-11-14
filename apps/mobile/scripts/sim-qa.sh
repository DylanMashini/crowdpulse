#!/bin/bash
# The simulator test rig (backlog item B0). Runs the mobile app in two slim iOS simulators, one
# in the camera role and one in the nurse role, against a web server and database of its own,
# drives the screens with the flows in apps/mobile/sim-flows, and collects screenshots and logs.
#
#   apps/mobile/scripts/sim-qa.sh              everything: up, every flow, down
#   apps/mobile/scripts/sim-qa.sh up           bring the rig up and leave it running
#   apps/mobile/scripts/sim-qa.sh flow <camera|nurse> <file.flow> [prefix]
#                                              run one flow against a rig that is up
#   apps/mobile/scripts/sim-qa.sh deteriorate [two]
#                                              raise a trend flag through the API (one alert,
#                                              or two alerts with "two")
#   apps/mobile/scripts/sim-qa.sh status       what is running, and the simulator ids
#   apps/mobile/scripts/sim-qa.sh down         stop what the rig started, shut the simulators down
#   apps/mobile/scripts/sim-qa.sh down --drop-db   and drop the rig's database
#
# Output goes to apps/mobile/.sim-qa (git-ignored): runs/<time>/ holds the screenshots and logs
# of one run, and `latest` points at the newest. See apps/mobile/sim-flows/README.md.
#
# Environment:
#   SIMQA_PORT         Web server port. Default 3200, the Mobile QA row of CONTRACTS section 9.
#   SIMQA_METRO_PORT   Metro port. Default 8081.
#   SIMQA_DB           Database name. Default triagecam_simqa. Dropped and seeded again by `up`.
#   SIMQA_SKIP_BUILD=1 Reuse the app already built in apps/mobile/ios/build (JavaScript-only changes).
#   SIMQA_KEEP_DATA=1  `up` keeps the database and the apps' sign-ins as they are.
#   SIMQA_CLONE_FROM   Simulator to clone when the two project simulators do not exist yet.
#                      Default: the first available "iPhone 17".
#
# The rig never touches a simulator it did not create, the shared `triagecam` database, or
# apps/mobile/.env.local.
set -euo pipefail

MOBILE="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$MOBILE/../.." && pwd)"
WORK="$MOBILE/.sim-qa"
PIDS="$WORK/pids"
PORT="${SIMQA_PORT:-3200}"
METRO_PORT="${SIMQA_METRO_PORT:-8081}"
DB="${SIMQA_DB:-triagecam_simqa}"
DATABASE_URL_RIG="postgres://localhost:5432/$DB"
API_URL="http://localhost:$PORT"
BUNDLE_ID="com.triagecam.app"
CAMERA_NAME="TriageCam Camera"
NURSE_NAME="TriageCam Nurse"
PROFILE="$MOBILE/simslim.json"
# The generated iOS project takes its names from the Expo config at the time of the prebuild:
# "TriageCam" in a project made before the product was renamed, "Crowdpulse" after. Read them
# from the project instead of assuming either.
PRODUCT="$(sed -n 's/^[[:space:]]*PRODUCT_NAME = "\{0,1\}\([^";$]*\)"\{0,1\};.*/\1/p' "$MOBILE"/ios/*.xcodeproj/project.pbxproj 2>/dev/null | head -1)"
PRODUCT="${PRODUCT:-TriageCam}"
WORKSPACE="$(ls -d "$MOBILE"/ios/*.xcworkspace 2>/dev/null | head -1)"
SCHEME="$(basename "${WORKSPACE:-TriageCam.xcworkspace}" .xcworkspace)"
APP="$MOBILE/ios/build/DerivedData/Build/Products/Debug-iphonesimulator/$PRODUCT.app"
SEED_EMAIL="${SEED_EMAIL:-demo@triagecam.test}"
SEED_PASSWORD="${SEED_PASSWORD:-triagecam-demo}"
UNVERIFIED_EMAIL="simqa-unverified@triagecam.test"
# The dev launcher loads the bundle from this link. The flags keep the developer menu, its
# first-run sheet and its floating button out of the screenshots.
METRO_LINK="triagecam://expo-development-client/?url=http%3A%2F%2Flocalhost%3A$METRO_PORT&disableOnboarding=1&disableAutoLaunch=1&disableFab=1"

say() { printf '[sim-qa] %s\n' "$*"; }
die() { printf '[sim-qa] %s\n' "$*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "$1 is not installed. $2"; }

if [ "$DB" = "triagecam" ]; then die "SIMQA_DB must not be the shared triagecam database"; fi
mkdir -p "$WORK" "$PIDS" "$WORK/logs"

# --- simulators -------------------------------------------------------------------------------

udid_of() {
  xcrun simctl list devices available | grep -F "    $1 (" | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/' | head -1
}

state_of() {
  xcrun simctl list devices | grep -F "$1" | sed -E 's/.*\) \(([A-Za-z ]+)\).*/\1/' | head -1
}

# Creates one project simulator by cloning a stock iPhone. A clone carries its source's apps,
# data and keychain, so it is erased before first use: nothing of the source stays in it.
create_simulator() {
  local name="$1" source="${SIMQA_CLONE_FROM:-}"
  if [ -z "$source" ]; then source="$(udid_of "iPhone 17")"; fi
  [ -n "$source" ] || die "No simulator to clone. Set SIMQA_CLONE_FROM to the id of a stock iPhone."
  say "creating \"$name\" as a clone of $source"
  simslim clone "$source" "$name" >/dev/null
  local udid
  udid="$(udid_of "$name")"
  [ -n "$udid" ] || die "\"$name\" was not created"
  if [ "$(state_of "$udid")" != "Shutdown" ]; then simslim shutdown "$udid" >/dev/null; fi
  simslim erase "$udid" >/dev/null
}

ensure_simulators() {
  need simslim "Install it with: brew install mobai-app/tap/simslim"
  [ -n "$(udid_of "$CAMERA_NAME")" ] || create_simulator "$CAMERA_NAME"
  [ -n "$(udid_of "$NURSE_NAME")" ] || create_simulator "$NURSE_NAME"
  CAMERA="$(udid_of "$CAMERA_NAME")"
  NURSE="$(udid_of "$NURSE_NAME")"
}

boot_slim() {
  local udid="$1"
  # Applies the committed profile; boots the simulator slim when the profile had to change.
  simslim on "$udid" --profile "$PROFILE" >/dev/null 2>&1
  if [ "$(state_of "$udid")" != "Booted" ]; then simslim boot "$udid" >/dev/null; fi
  simslim verify "$udid" --profile "$PROFILE" >/dev/null || die "$udid does not match $PROFILE"
  # Push is what the nurse role needs from the daemons a slim boot drops.
  simslim doctor "$udid" --requires push >/dev/null || die "simslim doctor: push is broken on $udid"
}

# --- web server and database --------------------------------------------------------------------

listener() { lsof -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null | head -1 || true; }

stop_pid_file() {
  local file="$PIDS/$1" pid
  [ -f "$file" ] || return 0
  pid="$(cat "$file")"
  # The process and what it started.
  pkill -TERM -P "$pid" 2>/dev/null || true
  kill "$pid" 2>/dev/null || true
  rm -f "$file"
}

stop_port() {
  # Only for a port this rig opened: its pid file says so.
  local name="$1" port="$2" pid
  [ -f "$PIDS/$name" ] || return 0
  stop_pid_file "$name"
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    pid="$(listener "$port")"
    [ -n "$pid" ] || return 0
    kill "$pid" 2>/dev/null || true
    sleep 0.5
  done
}

reset_database() {
  need psql "The rig needs the local Postgres server."
  say "database $DB: dropping, creating, migrating, seeding"
  dropdb --if-exists "$DB"
  createdb "$DB"
  (cd "$ROOT" && DATABASE_URL="$DATABASE_URL_RIG" pnpm db:migrate >"$WORK/logs/db.log" 2>&1) || die "migrate failed, see $WORK/logs/db.log"
  (cd "$ROOT" && DATABASE_URL="$DATABASE_URL_RIG" SEED_EMAIL="$SEED_EMAIL" SEED_PASSWORD="$SEED_PASSWORD" \
    pnpm --filter @triagecam/web db:seed >>"$WORK/logs/db.log" 2>&1) || die "seed failed, see $WORK/logs/db.log"
}

start_server() {
  if [ -n "$(listener "$PORT")" ]; then
    [ -f "$PIDS/web" ] || die "Port $PORT is in use by something the rig did not start. Set SIMQA_PORT."
    say "web server already up on $PORT"
    return 0
  fi
  say "web server on $PORT (database $DB, no email key, no push service)"
  # RESEND_API_KEY and EXPO_PUSH_URL are overridden so nothing leaves this machine: sign-up
  # answers with the verification link instead of sending an email, and a push goes nowhere.
  (cd "$ROOT" && DATABASE_URL="$DATABASE_URL_RIG" APP_URL="$API_URL" RESEND_API_KEY= \
    EXPO_PUSH_URL="http://127.0.0.1:9/push" NEXT_DIST_DIR=".next-$PORT" PORT="$PORT" \
    nohup pnpm dev:web >"$WORK/logs/web.log" 2>&1 </dev/null &
    echo $! >"$PIDS/web") >/dev/null 2>&1 </dev/null
  for _ in $(seq 1 120); do
    if curl -s -o /dev/null "$API_URL/api/auth/me"; then return 0; fi
    sleep 1
  done
  die "the web server did not answer on $PORT, see $WORK/logs/web.log"
}

# An account that exists and is not verified, for the check-email screen.
create_unverified_account() {
  curl -s -o /dev/null -X POST "$API_URL/api/auth/sign-up" -H 'Content-Type: application/json' \
    --data "{\"email\":\"$UNVERIFIED_EMAIL\",\"password\":\"$SEED_PASSWORD\"}" || true
}

# --- Metro ----------------------------------------------------------------------------------------

start_metro() {
  # Always a fresh Metro: it runs in CI mode, which does not watch files, so that a Fast Refresh
  # cannot reset a screen in the middle of a flow. A JavaScript change is picked up here.
  stop_port metro "$METRO_PORT"
  [ -z "$(listener "$METRO_PORT")" ] || die "Port $METRO_PORT is in use by something the rig did not start. Set SIMQA_METRO_PORT."
  say "Metro on $METRO_PORT, app pointed at $API_URL"
  # EXPO_PUBLIC_SIM_API_URL, not EXPO_PUBLIC_API_URL: see apps/mobile/src/config.ts.
  (cd "$MOBILE" && CI=1 EXPO_NO_TELEMETRY=1 EXPO_PUBLIC_SIM_API_URL="$API_URL" \
    nohup npx expo start --dev-client --port "$METRO_PORT" >"$WORK/logs/metro.log" 2>&1 </dev/null &
    echo $! >"$PIDS/metro") >/dev/null 2>&1 </dev/null
  for _ in $(seq 1 120); do
    if curl -s "http://localhost:$METRO_PORT/status" | grep running >/dev/null; then break; fi
    sleep 1
  done
  # Build the bundle once before any simulator asks, and refuse to go on if it would talk to
  # any server but the rig's.
  local bundle
  bundle="$(curl -s "http://localhost:$METRO_PORT/" -H 'expo-platform: ios' -H 'accept: application/expo+json,application/json' \
    | sed -E 's/.*"launchAsset":\{[^}]*"url":"([^"]+)".*/\1/')"
  case "$bundle" in http*) ;; *) die "Metro gave no bundle URL, see $WORK/logs/metro.log" ;; esac
  curl -s "$bundle" -o "$WORK/bundle.check" || die "Metro did not build the bundle, see $WORK/logs/metro.log"
  grep -a -q "\"EXPO_PUBLIC_SIM_API_URL\": { enumerable: true, value: \"$API_URL\" }" "$WORK/bundle.check" \
    || die "The bundle does not carry EXPO_PUBLIC_SIM_API_URL=$API_URL. Is another Metro on $METRO_PORT?"
  rm -f "$WORK/bundle.check"
}

# --- builds ----------------------------------------------------------------------------------------

build_app() {
  if [ "${SIMQA_SKIP_BUILD:-}" = "1" ] && [ -d "$APP" ]; then
    say "reusing the app build in ios/build (SIMQA_SKIP_BUILD=1)"
    return 0
  fi
  [ -d "$MOBILE/ios" ] || die "apps/mobile/ios does not exist. Run: (cd apps/mobile && npx expo prebuild --platform ios)"
  need pod "CocoaPods is needed to build the app."
  say "pod install"
  (cd "$MOBILE/ios" && pod install >"$WORK/logs/pod.log" 2>&1) || die "pod install failed, see $WORK/logs/pod.log"
  say "building the development build for the simulator (minutes when native code changed)"
  (cd "$MOBILE/ios" && xcodebuild -workspace "$SCHEME.xcworkspace" -scheme "$SCHEME" -configuration Debug \
    -sdk iphonesimulator -destination "generic/platform=iOS Simulator" -derivedDataPath build/DerivedData \
    ARCHS=arm64 ONLY_ACTIVE_ARCH=YES build >"$WORK/logs/xcodebuild.log" 2>&1) \
    || die "the app did not build, see $WORK/logs/xcodebuild.log"
}

build_driver() {
  say "building the UI driver"
  (cd "$MOBILE" && xcodebuild build-for-testing -project sim-driver/SimDriver.xcodeproj -scheme SimDriver \
    -sdk iphonesimulator -destination "generic/platform=iOS Simulator" -derivedDataPath "$WORK/driver" \
    ARCHS=arm64 >"$WORK/logs/driver-build.log" 2>&1) || die "the UI driver did not build, see $WORK/logs/driver-build.log"
}

xctestrun() { ls "$WORK"/driver/Build/Products/SimDriver_*.xctestrun 2>/dev/null | head -1; }

install_app() {
  local udid="$1"
  xcrun simctl terminate "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
  if [ "${SIMQA_KEEP_DATA:-}" != "1" ]; then
    # A signed-out phone every time: the session token lives in the keychain, which outlives
    # the app.
    xcrun simctl uninstall "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
    xcrun simctl keychain "$udid" reset
  fi
  xcrun simctl install "$udid" "$APP"
}

# --- flows -----------------------------------------------------------------------------------------

# run_flow <udid> <flow file> <prefix> <output directory>
run_flow() {
  local udid="$1" flow="$2" prefix="$3" out="$4" run
  run="$(xctestrun)"
  [ -n "$run" ] || die "The UI driver is not built. Run: $0 up"
  mkdir -p "$out"
  case "$flow" in /*) ;; *) if [ -f "$MOBILE/sim-flows/$flow" ]; then flow="$MOBILE/sim-flows/$flow"; else flow="$PWD/$flow"; fi ;; esac
  [ -f "$flow" ] || die "No flow at $flow"
  # TEST_RUNNER_ variables reach the test process without the prefix.
  if TEST_RUNNER_SIM_FLOW="$flow" TEST_RUNNER_SIM_OUT="$out" TEST_RUNNER_SIM_PREFIX="$prefix" \
    TEST_RUNNER_SIM_METRO_URL="$METRO_LINK" TEST_RUNNER_SIM_EMAIL="$SEED_EMAIL" \
    TEST_RUNNER_SIM_PASSWORD="$SEED_PASSWORD" TEST_RUNNER_SIM_UNVERIFIED_EMAIL="$UNVERIFIED_EMAIL" \
    xcodebuild test-without-building -xctestrun "$run" -destination "id=$udid" \
    -collect-test-diagnostics never >"$out/$prefix-xcodebuild.log" 2>&1; then
    say "flow $(basename "$flow") on $prefix: passed"
  else
    say "flow $(basename "$flow") on $prefix: FAILED, see $out/$prefix-flow.log and $out/$prefix-FAILED.png"
    return 1
  fi
}

# Sends the flag notification once a flow has put the app in the background and said so.
push_when_ready() {
  local udid="$1" signal="$2"
  for _ in $(seq 1 120); do
    if [ -f "$signal" ]; then
      sleep 1
      xcrun simctl push "$udid" "$BUNDLE_ID" "$MOBILE/sim-flows/push-flag.apns" >/dev/null
      return $?
    fi
    sleep 1
  done
  say "the flow never signalled that it was ready for the push"
  return 1
}

start_app_logs() {
  local udid="$1" name="$2" out="$3"
  # The app's own lines (JavaScript console, the capture module) and anything iOS logs about
  # it as an error. Everything the process logs would be a quarter of a million lines a run.
  xcrun simctl spawn "$udid" log stream --style compact --predicate \
    'process == "'"$PRODUCT"'" AND (messageType == error OR messageType == fault OR subsystem == "com.facebook.react.log" OR eventMessage CONTAINS "TriageCapture")' \
    >"$out/$name-app.log" 2>&1 &
  echo $! >"$PIDS/log-$name"
}

# One `all` or `up` at a time: two would fight over the database, the ports and the simulators.
take_lock() {
  local other
  if [ -f "$WORK/lock" ]; then
    other="$(cat "$WORK/lock")"
    if kill -0 "$other" 2>/dev/null; then die "Another sim-qa.sh (pid $other) is bringing the rig up or running it. Wait for it."; fi
  fi
  echo $$ >"$WORK/lock"
}

drop_lock() { rm -f "$WORK/lock"; }

# --- commands --------------------------------------------------------------------------------------

up() {
  need xcrun "Xcode is needed."
  need pnpm "pnpm is needed."
  ensure_simulators
  say "camera simulator $CAMERA, nurse simulator $NURSE"
  if [ "${SIMQA_KEEP_DATA:-}" != "1" ]; then
    stop_port web "$PORT"
    reset_database
  fi
  start_server
  create_unverified_account
  build_app
  build_driver
  say "booting both simulators slim"
  boot_slim "$CAMERA"
  boot_slim "$NURSE"
  install_app "$CAMERA"
  install_app "$NURSE"
  start_metro
  say "up. Server $API_URL, Metro $METRO_PORT, account $SEED_EMAIL / $SEED_PASSWORD"
}

down() {
  for name in log-camera log-nurse; do stop_pid_file "$name"; done
  stop_port metro "$METRO_PORT"
  stop_port web "$PORT"
  rm -rf "$ROOT/apps/web/.next-$PORT"
  for name in "$CAMERA_NAME" "$NURSE_NAME"; do
    local udid
    udid="$(udid_of "$name")"
    if [ -n "$udid" ] && [ "$(state_of "$udid")" = "Booted" ]; then simslim shutdown "$udid" >/dev/null; fi
  done
  if [ "${1:-}" = "--drop-db" ]; then dropdb --if-exists "$DB"; say "dropped $DB"; fi
  say "down"
}

status() {
  ensure_simulators
  say "camera simulator $CAMERA: $(state_of "$CAMERA")"
  say "nurse simulator  $NURSE: $(state_of "$NURSE")"
  say "web server on $PORT: $([ -n "$(listener "$PORT")" ] && echo up || echo down)"
  say "Metro on $METRO_PORT: $([ -n "$(listener "$METRO_PORT")" ] && echo up || echo down)"
  say "output: $WORK/latest"
}

deteriorate() {
  (cd "$MOBILE" && SIM_URL="$API_URL" SIM_EMAIL="$SEED_EMAIL" SIM_PASSWORD="$SEED_PASSWORD" node scripts/sim-deteriorate.mjs "$@")
}

all() {
  local out failed=0
  out="$WORK/runs/$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$out"
  ln -sfn "$out" "$WORK/latest"
  # Whatever happens, the logs are kept and nothing is left running.
  RUN_OUT="$out"
  take_lock
  trap 'collect_logs "$RUN_OUT"; down; drop_lock' EXIT
  up
  start_app_logs "$CAMERA" camera "$out"
  start_app_logs "$NURSE" nurse "$out"

  # Every screen of each role, the two simulators side by side.
  run_flow "$NURSE" nurse.flow nurse "$out" &
  local nurse_job=$!
  run_flow "$CAMERA" camera.flow camera "$out" || failed=1
  wait "$nurse_job" || failed=1

  # Across devices: a deterioration raised through the API arrives on the nurse phone as one
  # banner, is acknowledged there, and a simulated push opens its patient.
  deteriorate >"$out/deteriorate.log" 2>&1 || failed=1
  run_flow "$NURSE" nurse-flag.flow nurse-flag "$out" || failed=1
  run_flow "$NURSE" nurse-push.flow nurse-push "$out" &
  local push_job=$!
  push_when_ready "$NURSE" "$out/nurse-push-signal-ready" || failed=1
  wait "$push_job" || failed=1

  # The app's links reach every route.
  run_flow "$NURSE" links-nurse.flow nurse-links "$out" || failed=1
  run_flow "$CAMERA" links-camera.flow camera-links "$out" || failed=1

  say "memory: $(simslim measure "$CAMERA" | tail -1)"
  say "memory: $(simslim measure "$NURSE" | tail -1)"
  local shots
  shots="$(find "$out" -name '*.png' | wc -l | tr -d ' ')"
  if [ "$failed" = "0" ]; then
    say "all flows passed: $shots screenshots in $out"
  else
    say "SOME FLOWS FAILED: $shots screenshots in $out"
  fi
  return "$failed"
}

collect_logs() {
  cp "$WORK/logs/"*.log "$1/" 2>/dev/null || true
}

case "${1:-all}" in
  all) all ;;
  up) take_lock; trap drop_lock EXIT; up ;;
  down) shift; down "${1:-}" ;;
  status) status ;;
  deteriorate) shift; deteriorate "$@" ;;
  flow)
    [ $# -ge 3 ] || die "usage: $0 flow <camera|nurse> <file.flow> [prefix]"
    ensure_simulators
    case "$2" in camera) target="$CAMERA" ;; nurse) target="$NURSE" ;; *) die "camera or nurse" ;; esac
    out="$WORK/runs/$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$out"
    ln -sfn "$out" "$WORK/latest"
    run_flow "$target" "$3" "${4:-$2}" "$out"
    say "output in $out"
    ;;
  *) die "unknown command: $1. See the header of $0." ;;
esac
