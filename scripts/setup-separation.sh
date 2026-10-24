#!/bin/zsh
set -euo pipefail
cd "${0:A:h}/.."
TONEBENCH_PYTHON="${TONEBENCH_PYTHON:-python3.11}"
"$TONEBENCH_PYTHON" -m venv .separation/venv
.separation/venv/bin/python -m pip install -r scripts/separation/requirements.txt
mkdir -p .separation/models
curl -fL --retry 2 https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/955717e8-8726e21a.th -o .separation/models/955717e8-8726e21a.th.download
.separation/venv/bin/python - <<'PY'
import hashlib
from pathlib import Path
p = Path('.separation/models/955717e8-8726e21a.th.download')
assert hashlib.sha256(p.read_bytes()).hexdigest().startswith('8726e21a'), '模型校验失败'
p.rename(p.with_suffix(''))
PY
command -v ffmpeg > /dev/null
print '本地分离环境已安装。运行 npm run mac:build 将其接入应用。'
