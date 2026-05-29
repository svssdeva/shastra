#!/usr/bin/env bash
# Compile the darshan WASM inference core to wasm32-unknown-unknown and copy the artifact into
# apps/web/public/wasm/ so the dev server serves it. Run from any directory; paths are computed
# relative to this script.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
workspace="$(cd "$here/../../.." && pwd)"
out_dir="$workspace/apps/web/public/wasm"

cd "$here"
cargo build --release --target wasm32-unknown-unknown
mkdir -p "$out_dir"
cp "target/wasm32-unknown-unknown/release/darshan_inference_core_wasm.wasm" \
   "$out_dir/darshan-inference-core.wasm"

echo "wrote $out_dir/darshan-inference-core.wasm ($(wc -c < "$out_dir/darshan-inference-core.wasm") bytes)"
