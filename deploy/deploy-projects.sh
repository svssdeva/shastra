#!/usr/bin/env bash
#
# Deploy yantra / darshan / naadi as static sites under beyondcodekarma.in/projects/<name>/.
#
# They are uploaded into a `projects/` prefix of the EXISTING root S3 bucket that the live
# CloudFront distribution already serves. A dedicated CloudFront behavior on `projects/*` (plus the
# subdir-index function in cloudfront-subdir-index.js) maps clean sub-paths to index.html.
#
# Usage:
#   deploy/deploy-projects.sh all
#   deploy/deploy-projects.sh yantra darshan
#
# Config (env vars, or deploy/deploy-projects.env which is sourced if present):
#   AWS_PROFILE  AWS CLI profile (default: beyondcodekarma)
#   BUCKET       root S3 bucket name (no s3:// prefix)
#   DIST_ID      CloudFront distribution id
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Optional local config (gitignored). Holds BUCKET / DIST_ID after discovery.
[ -f "$SCRIPT_DIR/deploy-projects.env" ] && source "$SCRIPT_DIR/deploy-projects.env"

: "${AWS_PROFILE:=beyondcodekarma}"
: "${BUCKET:?set BUCKET=<root-s3-bucket> (env or deploy/deploy-projects.env)}"
: "${DIST_ID:?set DIST_ID=<cloudfront-distribution-id> (env or deploy/deploy-projects.env)}"

PREFIX="projects"
AWS=(aws --profile "$AWS_PROFILE")

VALID_APPS=(yantra darshan naadi)

build_app() {
  local app="$1"
  echo "==> build $app"
  if [ "$app" = "darshan" ]; then
    # Rust -> wasm artifact must exist before the web build picks it up from public/wasm/.
    (cd "$REPO_ROOT/darshan" && bun run build:wasm)
  fi
  (cd "$REPO_ROOT/$app" && bun --filter "@$app/web" build)
}

deploy_app() {
  local app="$1"
  local dist="$REPO_ROOT/$app/apps/web/dist"
  local dst="s3://$BUCKET/$PREFIX/$app"
  [ -d "$dist" ] || { echo "!! no dist for $app at $dist — build first" >&2; exit 1; }

  echo "==> sync $app -> $dst"
  # 1. Fingerprinted assets (everything except HTML): immutable, year-long cache. --delete prunes
  #    stale assets but leaves HTML untouched (it's excluded from the whole op, delete included).
  "${AWS[@]}" s3 sync "$dist" "$dst" --delete \
    --exclude "*.html" \
    --cache-control "public,max-age=31536000,immutable"

  # 2. HTML: must always re-fetch so new deploys are seen immediately. --delete (scoped to *.html)
  #    prunes removed pages.
  "${AWS[@]}" s3 sync "$dist" "$dst" --delete \
    --exclude "*" --include "*.html" \
    --cache-control "no-cache" \
    --content-type "text/html; charset=utf-8"

  # 3. WebAssembly: aws-cli mis-guesses .wasm MIME on many versions; streaming instantiation in the
  #    browser requires application/wasm. Re-put in place with the right type (no-op if no .wasm).
  if find "$dist" -name '*.wasm' -print -quit | grep -q .; then
    echo "==> fix .wasm MIME for $app"
    "${AWS[@]}" s3 cp "$dst/" "$dst/" --recursive \
      --exclude "*" --include "*.wasm" \
      --content-type "application/wasm" \
      --cache-control "public,max-age=31536000,immutable" \
      --metadata-directive REPLACE
  fi

  echo "==> invalidate /$PREFIX/$app/*"
  "${AWS[@]}" cloudfront create-invalidation \
    --distribution-id "$DIST_ID" \
    --paths "/$PREFIX/$app/*" \
    --query 'Invalidation.{Id:Id,Status:Status}' --output table
}

main() {
  local args=("$@")
  [ "${#args[@]}" -gt 0 ] || { echo "usage: $0 [all|${VALID_APPS[*]}]" >&2; exit 2; }

  local apps=()
  if [ "${args[0]}" = "all" ]; then
    apps=("${VALID_APPS[@]}")
  else
    for a in "${args[@]}"; do
      [[ " ${VALID_APPS[*]} " == *" $a "* ]] || { echo "unknown app: $a" >&2; exit 2; }
      apps+=("$a")
    done
  fi

  for app in "${apps[@]}"; do
    build_app "$app"
    deploy_app "$app"
  done
  echo "==> done: ${apps[*]}"
}

main "$@"
