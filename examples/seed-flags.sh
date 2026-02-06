#!/usr/bin/env bash
set -euo pipefail

FLAGR_URL="${FLAGR_URL:-http://localhost:18000}"
API="${FLAGR_URL}/api/v1"

# --- flag definitions ---

FLAGS_JSON=$(cat <<'EOF'
[
  {
    "key": "example-dark-mode",
    "description": "Example boolean flag for dark mode",
    "variants": [
      { "key": "on",  "percent": 50 },
      { "key": "off", "percent": 50 }
    ]
  },
  {
    "key": "example-greeting",
    "description": "Example string flag for greeting message",
    "variants": [
      { "key": "hello",     "percent": 60 },
      { "key": "welcome",   "percent": 20 },
      { "key": "hey-there", "percent": 20 }
    ]
  },
  {
    "key": "example-items-per-page",
    "description": "Example number flag for items per page",
    "variants": [
      { "key": "10", "percent": 20 },
      { "key": "25", "percent": 60 },
      { "key": "50", "percent": 20 }
    ]
  },
  {
    "key": "example-ui-config",
    "description": "Example object flag for UI configuration",
    "variants": [
      { "key": "default", "percent": 70, "attachment": {"theme":"light","showBanner":true,"maxItems":10} },
      { "key": "compact", "percent": 30, "attachment": {"theme":"dark","showBanner":false,"maxItems":5} }
    ]
  }
]
EOF
)

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

# api_get URL — GET request, prints response body
api_get() {
  curl -s "$1"
}

# api_post URL DATA — POST request, prints response body
# Returns 1 on 409 (conflict/already exists), exits on other errors
api_post() {
  local url="$1"
  local data="$2"
  local http_code response

  http_code=$(curl -s -o /tmp/flagr_response -w "%{http_code}" \
    -X POST "$url" \
    -H "Content-Type: application/json" \
    -d "$data")

  response=$(cat /tmp/flagr_response)

  if [ "$http_code" = "409" ]; then
    echo "$response"
    return 1
  fi

  if [ "$http_code" != "200" ] && [ "$http_code" != "201" ]; then
    echo "  ERROR: POST $url returned HTTP ${http_code}" >&2
    echo "  $response" >&2
    exit 1
  fi

  echo "$response"
}

# api_put URL DATA — PUT request, prints response body
api_put() {
  local url="$1"
  local data="$2"

  curl -s -X PUT "$url" \
    -H "Content-Type: application/json" \
    -d "$data"
}

# ensure_flag KEY DESCRIPTION — creates or finds existing flag, prints flag ID
ensure_flag() {
  local key="$1"
  local description="$2"

  local body
  body=$(jq -n --arg k "$key" --arg d "$description" '{key: $k, description: $d}')

  local response
  if response=$(api_post "${API}/flags" "$body"); then
    echo "$response" | jq -r '.id'
    return 0
  fi

  # 409 — flag already exists, look it up
  echo "  Flag '${key}' already exists — skipping" >&2
  api_get "${API}/flags" | jq --arg k "$key" '.[] | select(.key == $k) | .id'
}

# ensure_variant FLAG_ID VARIANT_KEY [ATTACHMENT_JSON]
# Prints variant ID. Creates the variant if it doesn't exist.
ensure_variant() {
  local flag_id="$1"
  local variant_key="$2"
  local attachment="${3:-}"

  # Check if variant already exists
  local existing_id
  existing_id=$(api_get "${API}/flags/${flag_id}" \
    | jq --arg k "$variant_key" '.variants[] | select(.key == $k) | .id // empty')

  if [ -n "$existing_id" ]; then
    echo "$existing_id"
    return 0
  fi

  local body
  if [ -n "$attachment" ]; then
    body=$(jq -n --arg k "$variant_key" --argjson a "$attachment" '{key: $k, attachment: $a}')
  else
    body=$(jq -n --arg k "$variant_key" '{key: $k}')
  fi

  api_post "${API}/flags/${flag_id}/variants" "$body" | jq -r '.id'
}

# ensure_segment FLAG_ID — prints segment ID, creates one if none exist
ensure_segment() {
  local flag_id="$1"

  local existing_id
  existing_id=$(api_get "${API}/flags/${flag_id}/segments" | jq '.[0].id // empty')

  if [ -n "$existing_id" ]; then
    echo "$existing_id"
    return 0
  fi

  local body
  body=$(jq -n '{description: "All users", rolloutPercent: 100}')

  api_post "${API}/flags/${flag_id}/segments" "$body" | jq -r '.id'
}

# set_distributions FLAG_ID SEGMENT_ID DISTRIBUTIONS_JSON
# DISTRIBUTIONS_JSON is an array of {"variantID": N, "percent": N}
set_distributions() {
  local flag_id="$1"
  local segment_id="$2"
  local distributions="$3"

  local body
  body=$(jq -n --argjson d "$distributions" '{distributions: $d}')
  api_put "${API}/flags/${flag_id}/segments/${segment_id}/distributions" "$body" > /dev/null
}

# enable_flag FLAG_ID — idempotent PUT
enable_flag() {
  local flag_id="$1"
  api_put "${API}/flags/${flag_id}/enabled" '{"enabled":true}' > /dev/null
}

# --- seed a single flag ---

seed_flag() {
  local index="$1"
  local flag_json="$2"
  local total="$3"

  local key description
  key=$(echo "$flag_json" | jq -r '.key')
  description=$(echo "$flag_json" | jq -r '.description')

  echo "[$(( index + 1 ))/${total}] ${key}" >&2

  local flag_id
  flag_id=$(ensure_flag "$key" "$description") || true

  # Create variants and collect IDs paired with their percentages
  local variant_count
  variant_count=$(echo "$flag_json" | jq '.variants | length')

  local distributions="[]"
  local i=0
  while [ "$i" -lt "$variant_count" ]; do
    local variant
    variant=$(echo "$flag_json" | jq -c ".variants[$i]")

    local vkey percent attachment
    vkey=$(echo "$variant" | jq -r '.key')
    percent=$(echo "$variant" | jq '.percent')
    attachment=$(echo "$variant" | jq -c '.attachment // empty')

    local vid
    vid=$(ensure_variant "$flag_id" "$vkey" "$attachment")

    distributions=$(echo "$distributions" \
      | jq --argjson vid "$vid" --argjson pct "$percent" --arg vk "$vkey" '. + [{"variantID": $vid, "variantKey": $vk, "percent": $pct}]')

    i=$((i + 1))
  done

  local seg_id
  seg_id=$(ensure_segment "$flag_id")

  set_distributions "$flag_id" "$seg_id" "$distributions"
  enable_flag "$flag_id"

  echo "  Done! (flagID=${flag_id})" >&2
}

# --- main ---

wait_for_flagr

echo "" >&2
echo "Seeding example flags..." >&2
echo "" >&2

total=$(echo "$FLAGS_JSON" | jq 'length')
index=0
while [ "$index" -lt "$total" ]; do
  seed_flag "$index" "$(echo "$FLAGS_JSON" | jq -c ".[$index]")" "$total"
  index=$((index + 1))
done

echo "" >&2
echo "Done! All example flags are seeded." >&2
echo "" >&2
echo "Flagr UI: ${FLAGR_URL}" >&2
echo "" >&2
echo "Quick test:" >&2
echo "  curl -s -X POST ${API}/evaluation \\" >&2
echo '    -H "Content-Type: application/json" \' >&2
echo '    -d '\''{"flagKey":"example-dark-mode","entityID":"test"}'\'' | jq .variantKey' >&2
