#!/bin/bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"
runtime="${PYTHON_VOCAL:-$repo_root/.venv-vocal/bin/python}"

if [[ ! -x "$runtime" ]]; then
  echo "Create .venv-vocal and install scripts/vocal-engine-requirements.txt first." >&2
  exit 1
fi

build_root="$repo_root/.build/vocal-engine"
export PYINSTALLER_CONFIG_DIR="$repo_root/.build/pyinstaller-cache"
mkdir -p "$build_root"

"$runtime" -m PyInstaller --noconfirm --clean --onedir --name vocal-engine \
  --collect-all mlx --collect-all mlx_audio_io --collect-all mlx_spectro \
  --collect-all demucs_mlx --collect-all certifi --collect-all soundfile --collect-all imageio_ffmpeg \
  --distpath "$repo_root/src-tauri/resources" \
  --workpath "$build_root/work" \
  --specpath "$build_root/spec" \
  "$repo_root/scripts/vocal-worker.py"

"$runtime" "$repo_root/scripts/rebase-wheel-records.py" \
  "$repo_root/src-tauri/resources/vocal-engine/_internal"
"$runtime" "$repo_root/scripts/collect-engine-licenses.py" \
  "$repo_root/src-tauri/resources/vocal-engine/licenses"

cp "$repo_root/src-tauri/resources/vocal-engine/_internal/mlx/lib/mlx.metallib" \
  "$repo_root/src-tauri/resources/vocal-engine/_internal/mlx.metallib"
