#!/bin/zsh
set -euo pipefail
cd "${0:A:h}/.."
TONEBENCH_PYTHON="${TONEBENCH_PYTHON:-python3.11}"
"$TONEBENCH_PYTHON" -m venv .separation/venv
.separation/venv/bin/python -m pip install -r scripts/separation/requirements.txt
mkdir -p .separation/models
curl -fL --retry 2 https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/5c90dfd2-34c22ccb.th -o .separation/models/5c90dfd2-34c22ccb.th.download
.separation/venv/bin/python - <<'PY'
import hashlib
from pathlib import Path
p = Path('.separation/models/5c90dfd2-34c22ccb.th.download')
assert hashlib.sha256(p.read_bytes()).hexdigest() == '34c22ccb381c6f9fdbf324f04e1e2fe21aaaf293f5ded163a162697ff9a02ddd', '模型校验失败'
p.rename(p.with_suffix(''))
PY
command -v ffmpeg > /dev/null
print '本地分离环境已安装。运行 npm run mac:build 将其接入应用。'
