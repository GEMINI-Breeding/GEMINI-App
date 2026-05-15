#!/usr/bin/env bash
# Warn when running worker/rest-api containers are older than the host source
# they were built from. Wired into `npm run dev` via `predev`. Always exits 0
# so a stale check never blocks the dev server. Set SKIP_STALE_CHECK=1 to
# suppress entirely.
#
# Per-image effective watch paths (matter for accuracy — false alarms train
# developers to ignore the warning):
#   workers (geo, amiga, ml, odm) : COPY gemini/workers/  -> watch
#                                   backend/gemini/workers/
#   gwas                          : COPY gemini/          -> watch all of
#                                   backend/gemini/
#   rest-api                      : source is bind-mounted with --reload, so
#                                   editing gemini/*.py does NOT make the
#                                   container stale. The IMAGE only bakes
#                                   pyproject.toml/poetry.lock/alembic + the
#                                   Dockerfile, so we restrict the watch to
#                                   those — otherwise it flags every Python
#                                   edit and gets ignored.

set -u

[[ "${SKIP_STALE_CHECK:-0}" == "1" ]] && exit 0
command -v docker >/dev/null 2>&1 || exit 0

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"
GEMINI_DIR="$BACKEND_DIR/gemini"

# Per-service watch config. Format:
#   container_name|path1,path2,...|extra_files (space-separated, repo-relative)
# `paths` are scanned with the broad source-file filter; `extra_files` are
# checked individually (used for rest-api's narrow set).
SERVICES=(
  "geminibase-rest-api||backend/pyproject.toml backend/poetry.lock backend/alembic backend/gemini/rest_api/Dockerfile backend/gemini/rest_api/entrypoint.sh"
  "geminibase-worker-geo|$GEMINI_DIR/workers|"
  "geminibase-worker-gwas|$GEMINI_DIR|"
  "geminibase-worker-amiga|$GEMINI_DIR/workers|"
  "geminibase-worker-ml|$GEMINI_DIR/workers|"
  "geminibase-worker-odm|$GEMINI_DIR/workers|"
)

YELLOW=$'\033[33m'
RED=$'\033[31m'
GREEN=$'\033[32m'
DIM=$'\033[2m'
RESET=$'\033[0m'

stale=()
running_count=0

for entry in "${SERVICES[@]}"; do
  IFS='|' read -r name paths_csv extras <<<"$entry"

  # Skip cleanly when the container isn't up — handled in the summary below.
  image_id=$(docker inspect "$name" --format '{{.Image}}' 2>/dev/null) || continue
  [[ -z "$image_id" ]] && continue
  running_count=$((running_count + 1))

  # .Created on the image (not the container) — that's the build time.
  built_iso=$(docker inspect "$name" --format '{{.Created}}' 2>/dev/null)
  [[ -z "$built_iso" ]] && continue

  # macOS `date` doesn't grok the nanosecond suffix; chop it.
  built_trim="${built_iso%.*}"
  built_trim="${built_trim%Z}"

  if ! built_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%S" "$built_trim" "+%s" 2>/dev/null); then
    # GNU date fallback for Linux dev machines
    built_epoch=$(date -d "$built_iso" "+%s" 2>/dev/null) || continue
  fi

  stamp=$(mktemp)
  touch_ts=$(date -r "$built_epoch" "+%Y%m%d%H%M.%S" 2>/dev/null) \
    || touch_ts=$(date -d "@$built_epoch" "+%Y%m%d%H%M.%S" 2>/dev/null)
  touch -t "$touch_ts" "$stamp"

  newer=""

  # Broad scan over watched directories.
  if [[ -n "$paths_csv" ]]; then
    IFS=',' read -ra paths <<<"$paths_csv"
    for p in "${paths[@]}"; do
      [[ -d "$p" ]] || continue
      hit=$(find "$p" -type f -newer "$stamp" \
        \( -name "*.py" -o -name "*.toml" -o -name "*.lock" \
           -o -name "Dockerfile" -o -name "requirements.txt" \
           -o -name "*.sql" -o -name "*.yaml" -o -name "*.yml" \) \
        -not -path "*/__pycache__/*" -not -path "*/.pytest_cache/*" \
        -print -quit 2>/dev/null)
      if [[ -n "$hit" ]]; then newer="$hit"; break; fi
    done
  fi

  # Narrow file/dir list (used by services like rest-api whose source is
  # bind-mounted — only specific baked artifacts trigger image staleness).
  if [[ -z "$newer" && -n "$extras" ]]; then
    for ef in $extras; do
      target="$REPO_ROOT/$ef"
      [[ -e "$target" ]] || continue
      if [[ -d "$target" ]]; then
        hit=$(find "$target" -type f -newer "$stamp" -print -quit 2>/dev/null)
      else
        hit=$(find "$target" -newer "$stamp" -print -quit 2>/dev/null)
      fi
      if [[ -n "$hit" ]]; then newer="$hit"; break; fi
    done
  fi

  rm -f "$stamp"

  if [[ -n "$newer" ]]; then
    rel="${newer#$REPO_ROOT/}"
    built_human=$(date -r "$built_epoch" "+%Y-%m-%d %H:%M" 2>/dev/null) \
      || built_human=$(date -d "@$built_epoch" "+%Y-%m-%d %H:%M" 2>/dev/null)
    stale+=("$name|$built_human|$rel")
  fi
done

if [[ "$running_count" == 0 ]]; then
  echo "${DIM}ℹ Backend stack not running. Start with:${RESET}"
  echo "${DIM}    docker compose -p geminibase up -d${RESET}"
  exit 0
fi

if [[ "${#stale[@]}" == 0 ]]; then
  echo "${GREEN}✓${RESET} ${DIM}Worker images are fresh.${RESET}"
  exit 0
fi

echo "${YELLOW}⚠ Stale backend images detected${RESET} ${DIM}(host code newer than baked image)${RESET}"
short_names=()
for s in "${stale[@]}"; do
  IFS='|' read -r name built_human trigger <<<"$s"
  short="${name#geminibase-}"
  short="${short#worker-}"
  printf "  ${RED}%s${RESET}  built ${DIM}%s${RESET}  newer file: ${DIM}%s${RESET}\n" \
    "$short" "$built_human" "$trigger"
  short_names+=("$name")
done

# Build a single rebuild command the developer can copy/paste.
echo
echo "${DIM}To refresh:${RESET}"
echo "  docker compose -p geminibase -f docker-compose.yaml up -d --build ${short_names[*]}"
echo "${DIM}(set SKIP_STALE_CHECK=1 to suppress this check)${RESET}"
echo

exit 0
