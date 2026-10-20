最后修改日期：2026-10-19（America/Los_Angeles）

# Third-party notices

This project includes or uses third-party software. These notices describe the principal bundled or build-time components; dependency-specific license texts remain with their respective package sources and generated app resources.

## Browser audio decoder

- `@ffmpeg/ffmpeg` 0.12.15: MIT.
- `@ffmpeg/core` 0.12.10: GPL-2.0-or-later, with additional licenses for included dependencies.
- Upstream source and build project: [ffmpegwasm/ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm); package [@ffmpeg/core 0.12.10](https://www.npmjs.com/package/@ffmpeg/core/v/0.12.10).
- This project patches the JavaScript wrapper in `scripts/patch-ffmpeg-core.mjs`; `scripts/prepare-decoder.mjs` applies the patch during local builds. The upstream WebAssembly core itself is not modified.
- Build outputs under `public/decoder/` are generated locally and excluded from source control. Anyone who hosts those outputs must make the corresponding source and build materials available as required by the upstream license.

## macOS audio fingerprinting

The bundled `src-tauri/resources/fpcalc` executable is the upstream Chromaprint 1.6.1 macOS arm64 build. Chromaprint is MIT-licensed; its FFmpeg components are LGPL-2.1. Source and license: [Chromaprint v1.6.1](https://github.com/acoustid/chromaprint/tree/v1.6.1) and [Chromaprint license notes](https://github.com/acoustid/chromaprint/blob/v1.6.1/LICENSE.md).

## Optional vocal separation engine

The engine is built locally from `scripts/vocal-worker.py` using the pinned dependencies in `scripts/vocal-engine-requirements.txt`. It is not checked into this repository. Principal components include Demucs MLX 1.6.1 (MIT), MLX 0.32.3 (MIT), mlx-audio-io 1.3.24, mlx-spectro 0.9.10, SoundFile 0.13.1 (BSD), imageio-ffmpeg 0.6.0 (BSD-2-Clause) and its bundled FFmpeg build. Per-package notices are collected into the generated engine resources during packaging. The htdemucs model is downloaded on demand from [ssmall256/demucs-mlx](https://huggingface.co/ssmall256/demucs-mlx) and is not bundled.

For the full terms of each dependency, consult its source repository and the generated `resources/vocal-engine/licenses/` directory after building the engine.
