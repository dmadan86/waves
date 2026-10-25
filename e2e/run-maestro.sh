#!/usr/bin/env bash
# Drives the Maestro flows inside the CI emulator. This lives in a file, invoked
# as a single line from the workflow, because android-emulator-runner parses its
# inline `script:` line-by-line — a multi-line `for` loop or a persisted `export`
# in the inline block would not survive that. One `bash e2e/run-maestro.sh` runs
# as one command, so the loop and PATH behave normally.
#
# Each flow mutates the shared staging backend (archive, leave, rename, delete),
# so the deterministic fixture is reseeded before every flow. The seed is
# idempotent (reset + rebuild) and each flow's login.yaml does clearState, so no
# state leaks across. Flows run one at a time so login.yaml is never standalone.
#
# Requires in the environment: E2E_SUPABASE_URL, E2E_SERVICE_KEY, E2E_EMAIL,
# E2E_PASSWORD (the seeder + Maestro read these).
set -uo pipefail

curl -Ls "https://get.maestro.mobile.dev" | bash
export PATH="$PATH:$HOME/.maestro/bin"

adb install -r apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
# Fail here, loudly, if the app did not land — not 20 flows later as "not installed".
adb devices -l
adb shell pm list packages -3
adb shell pm list packages app.waves.mobile.debug | grep -q app.waves.mobile.debug || { echo "app.waves.mobile.debug not installed after adb install"; exit 1; }

FLOWS=(
  home-to-add-expense
  edit-expense
  delete-restore-expense
  rename-archive-group
  change-logo
  capture-assign
  review-selection-back
  tab-bar-returns
  back-through-the-stack
  custom-tags
  locale-switch
  sign-out-privacy
  local-privacy-audit
  clone-group
  group-photo-paid-gate
  friends-merge-guests
  leave-group
  widget-deeplinks
  auth-providers
  welcome-door
)

# The Waves Assistant flows (docs/assistant-qa-checklist.md has the manual half).
# Each is `flow:seed-extras`; the extras are E2E_SEED_EXTRAS for seed-e2e.mjs.
# They need the staging voice-agent function to run with VOICE_AGENT_STUB=1
# (supabase/functions/_shared/voiceStub.ts), and they are the flows that need
# the corrections build (correction, undo). The sub-flows assistant-open,
# assistant-say, assistant-intro and assistant-close are not listed: like
# login.yaml they only run inside another flow.
ASSISTANT_FLOWS=(
  assistant-personal-add:assistant
  assistant-group-add-payer:assistant
  assistant-skip-twice:assistant
  assistant-mute:assistant
  assistant-correction:assistant
  assistant-undo:assistant
  assistant-duplicate:assistant,duplicate
  assistant-offline:assistant
  assistant-clarify:assistant
  assistant-balance-question:assistant
  assistant-settings-toggle:assistant
  assistant-intro-once:assistant
)

status=0
for flow in "${FLOWS[@]}"; do
  echo "::group::seed + ${flow}"
  node e2e/seed-e2e.mjs
  maestro test \
    --env E2E_EMAIL="${E2E_EMAIL}" \
    --env E2E_PASSWORD="${E2E_PASSWORD}" \
    "e2e/${flow}.yaml" || status=1
  echo "::endgroup::"
done

# Off by default so the nightly stays what it was: set E2E_ASSISTANT=1 (or run the
# workflow with it) once the staging stub is on.
if [ "${E2E_ASSISTANT:-0}" = "1" ]; then
  for entry in "${ASSISTANT_FLOWS[@]}"; do
    flow="${entry%%:*}"
    extras="${entry#*:}"
    echo "::group::seed (${extras}) + ${flow}"
    E2E_SEED_EXTRAS="${extras}" node e2e/seed-e2e.mjs
    maestro test \
      --env E2E_EMAIL="${E2E_EMAIL}" \
      --env E2E_PASSWORD="${E2E_PASSWORD}" \
      "e2e/${flow}.yaml" || status=1
    echo "::endgroup::"
  done
fi

exit "${status}"
