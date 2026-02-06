#!/usr/bin/env bash
set -euo pipefail

FLAGR_URL="${FLAGR_URL:-http://localhost:18000}"
API="${FLAGR_URL}/api/v1"

# --- helpers ---

wait_for_flagr() {
  local attempts=0
  local max_attempts=30
  printf "Waiting for Flagr at %s " "$FLAGR_URL" >&2
  while ! curl -sf "${API}/health" > /dev/null 2>&1; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge "$max_attempts" ]; then
      printf "\nFlagr did not become healthy after %ds. Is it running?\n" "$max_attempts" >&2
      exit 1
    fi
    printf "." >&2
    sleep 1
  done
  printf " ready!\n" >&2
}

# Extract a numeric id from a JSON response like {"id":42,...}
extract_id() {
  grep -o '"id":[0-9]*' | head -1 | grep -o '[0-9]*'
}

# create_flag KEY DESCRIPTION
# Prints the flag ID to stdout. Returns 0 on create, 1 if already exists.
# All status messages go to stderr.
create_flag() {
  local key="$1"
  local description="$2"

  local response
  local http_code
  http_code=$(curl -s -o /tmp/flagr_response -w "%{http_code}" \
    -X POST "${API}/flags" \
    -H "Content-Type: application/json" \
    -d "{\"key\":\"${key}\",\"description\":\"${description}\"}")

  response=$(cat /tmp/flagr_response)

  if [ "$http_code" = "409" ]; then
    echo "  Flag '${key}' already exists — skipping" >&2
    # Fetch the existing flag to get its ID
    response=$(curl -s "${API}/flags" | grep -o "{[^}]*\"key\":\"${key}\"[^}]*}" | head -1)
    echo "$response" | extract_id
    return 1
  fi

  if [ "$http_code" != "200" ] && [ "$http_code" != "201" ]; then
    echo "  ERROR creating flag '${key}': HTTP ${http_code}" >&2
    echo "  $response" >&2
    exit 1
  fi

  echo "$response" | extract_id
}

add_variant() {
  local flag_id="$1"
  local variant_key="$2"
  local attachment="${3:-}"

  local body="{\"key\":\"${variant_key}\"}"
  if [ -n "$attachment" ]; then
    body="{\"key\":\"${variant_key}\",\"attachment\":${attachment}}"
  fi

  local response
  response=$(curl -s -X POST "${API}/flags/${flag_id}/variants" \
    -H "Content-Type: application/json" \
    -d "$body")

  echo "$response" | extract_id
}

create_segment() {
  local flag_id="$1"
  local description="${2:-All users}"

  local response
  response=$(curl -s -X POST "${API}/flags/${flag_id}/segments" \
    -H "Content-Type: application/json" \
    -d "{\"description\":\"${description}\",\"rolloutPercent\":100}")

  echo "$response" | extract_id
}

set_distribution() {
  local flag_id="$1"
  local segment_id="$2"
  shift 2
  # Remaining args are pairs: variantID percent variantID percent ...
  local distributions="["
  local first=true
  while [ $# -ge 2 ]; do
    local vid="$1"
    local pct="$2"
    shift 2
    if [ "$first" = true ]; then
      first=false
    else
      distributions="${distributions},"
    fi
    distributions="${distributions}{\"variantID\":${vid},\"percent\":${pct}}"
  done
  distributions="${distributions}]"

  curl -s -X PUT "${API}/flags/${flag_id}/segments/${segment_id}/distributions" \
    -H "Content-Type: application/json" \
    -d "{\"distributions\":${distributions}}" > /dev/null
}

enable_flag() {
  local flag_id="$1"
  curl -s -X PUT "${API}/flags/${flag_id}/enabled" \
    -H "Content-Type: application/json" \
    -d '{"enabled":true}' > /dev/null
}

# --- main ---

wait_for_flagr

echo "" >&2
echo "Seeding example flags..." >&2
echo "" >&2

# ---- 1. example-dark-mode (boolean) ----
echo "[1/4] example-dark-mode (boolean)" >&2
if flag_id=$(create_flag "example-dark-mode" "Example boolean flag for dark mode"); then
  v_on=$(add_variant "$flag_id" "on")
  v_off=$(add_variant "$flag_id" "off")
  seg_id=$(create_segment "$flag_id")
  set_distribution "$flag_id" "$seg_id" "$v_on" 100 "$v_off" 0
  enable_flag "$flag_id"
  echo "  Created! (flagID=${flag_id})" >&2
fi

# ---- 2. example-greeting (string) ----
echo "[2/4] example-greeting (string)" >&2
if flag_id=$(create_flag "example-greeting" "Example string flag for greeting message"); then
  v_hello=$(add_variant "$flag_id" "hello")
  v_welcome=$(add_variant "$flag_id" "welcome")
  v_hey=$(add_variant "$flag_id" "hey-there")
  seg_id=$(create_segment "$flag_id")
  set_distribution "$flag_id" "$seg_id" "$v_hello" 100 "$v_welcome" 0 "$v_hey" 0
  enable_flag "$flag_id"
  echo "  Created! (flagID=${flag_id})" >&2
fi

# ---- 3. example-items-per-page (number) ----
echo "[3/4] example-items-per-page (number)" >&2
if flag_id=$(create_flag "example-items-per-page" "Example number flag for items per page"); then
  v_10=$(add_variant "$flag_id" "10")
  v_25=$(add_variant "$flag_id" "25")
  v_50=$(add_variant "$flag_id" "50")
  seg_id=$(create_segment "$flag_id")
  set_distribution "$flag_id" "$seg_id" "$v_10" 0 "$v_25" 100 "$v_50" 0
  enable_flag "$flag_id"
  echo "  Created! (flagID=${flag_id})" >&2
fi

# ---- 4. example-ui-config (object) ----
echo "[4/4] example-ui-config (object)" >&2
if flag_id=$(create_flag "example-ui-config" "Example object flag for UI configuration"); then
  v_default=$(add_variant "$flag_id" "default" '{"theme":"light","showBanner":true,"maxItems":10}')
  v_compact=$(add_variant "$flag_id" "compact" '{"theme":"dark","showBanner":false,"maxItems":5}')
  seg_id=$(create_segment "$flag_id")
  set_distribution "$flag_id" "$seg_id" "$v_default" 100 "$v_compact" 0
  enable_flag "$flag_id"
  echo "  Created! (flagID=${flag_id})" >&2
fi

echo "" >&2
echo "Done! All example flags are seeded." >&2
echo "" >&2
echo "Flagr UI: ${FLAGR_URL}" >&2
echo "" >&2
echo "Quick test:" >&2
echo "  curl -s -X POST ${API}/evaluation \\" >&2
echo '    -H "Content-Type: application/json" \' >&2
echo '    -d '\''{"flagKey":"example-dark-mode","entityID":"test"}'\'' | grep variantKey' >&2
