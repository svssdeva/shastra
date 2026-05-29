# darshan

> Local-first vision agent. Drop a file, run a model in your tab, get a result. Zero cloud.

`darshan` (Sanskrit *darśana*, "sight / perception") is the third project in the [`shastra`](../README.md) workspace, alongside [`yantra`](../yantra/) (WebGPU heat solver) and [`trishul`](../trishul/) (Rust MCP server).

The architectural bet is a **pluggable inference shell**: one UI hosts swappable pipelines (echo / OCR / dashcam) on top of swappable backends (Mock, transformers.js, ONNX Runtime Web, Rust+candle WASM). The shell is the project. The models are interchangeable.

## Quickstart

```bash
cd darshan
bun install
bun run build:wasm   # one-time: compiles Rust → wasm32
bun dev              # → http://localhost:4321
```

Then visit `/run` to pick a pipeline + backend and drop a file, or `/docs` for the full walkthrough — concepts, the pipeline × backend matrix, request flow, troubleshooting.

## What ships in v1

| Pipeline | Backend | Status |
|---|---|---|
| **echo** | Mock · Candle (WASM) | seam tests |
| **ocr** (Devanagari → English) | Tesseract.js (`hin.traineddata`) for recognition + transformers.js (Opus-MT) for translation | real |
| **dashcam** (incident extractor) | ORT Web (YOLOv10n + heuristic scoring) | real |

WebGPU preferred; everything falls back to WASM. Model weights are fetched once from HuggingFace and cached in the browser Cache API — verifiable in airplane mode.

## Stack

Astro 6 · Preact 10 · Tailwind v4 · Bun workspace · `tesseract.js` v7 (Hindi traineddata) · `@huggingface/transformers` v4 · `onnxruntime-web` · Rust → `wasm32-unknown-unknown` (no `wasm-bindgen`). Biome 2 handles lint + format. See `/docs` in-app for the full breakdown.

## Repo layout

```
darshan/
├─ apps/web/              Astro + Preact + Tailwind shell + /docs
└─ packages/
   ├─ inference-core/     Backend + Pipeline interfaces, worker host, mock, transformers, ort
   ├─ inference-core-wasm/ Candle backend + Rust crate
   ├─ pipeline-ocr/       Devanagari OCR (Tesseract.js) + Hindi→English translation (Opus-MT)
   ├─ pipeline-dashcam/   Dashcam incident extractor
   └─ ui-kit/             DropZone, Picker, ProgressMeter, ResultPanel, OcrCanvas, TimelineScrubber
```

## Develop

```bash
bun run lint              # biome check across all packages
bun --filter '*' test     # 14 tests across 5 packages
bun outdated              # check for newer package versions
bun --filter @darshan/web build
bun run build:wasm        # rebuild Rust core
```

## License

MIT.
