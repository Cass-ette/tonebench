"""Local, file-only HTDemucs inference. stdout is a JSON-lines protocol.

No runtime network calls: the model must have been installed by setup first.
Output stems share the input scale; never normalize each stem independently.
"""
import argparse
import json
import os
import signal
from pathlib import Path
import subprocess
import sys

MODEL = "955717e8"
SOURCES = ("drums", "bass", "other", "vocals")
MAX_SECONDS = 600
decoder = None


def cancel(_signal, _frame):
    if decoder is not None and decoder.poll() is None:
        decoder.terminate()
    raise SystemExit(130)


def emit(**data):
    print(json.dumps(data, ensure_ascii=False, allow_nan=False), flush=True)


def decode(source, output, ffmpeg, limit):
    global decoder
    # Decode at most one sample beyond the limit, including unknown-duration files.
    decoder = subprocess.Popen(
        [ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
         "-i", str(source), "-vn", "-t", str(limit + 1 / 44100),
         "-ac", "2", "-ar", "44100", "-c:a", "pcm_f32le", str(output)],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    try:
        _, stderr = decoder.communicate(timeout=120)
        if decoder.returncode:
            raise subprocess.CalledProcessError(decoder.returncode, ffmpeg, stderr=stderr)
    finally:
        if decoder.poll() is None:
            decoder.kill()
            decoder.wait()
        decoder = None


def separate(args):
    import numpy as np
    import soundfile as sf
    import torch
    from demucs.apply import TensorChunk, apply_model
    from demucs.pretrained import get_model

    torch.set_num_threads(min(6, os.cpu_count() or 2))
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    emit(phase="decoding", progress=0, message="正在读取音频")
    original = output / "original.wav"
    limit = 60 if args.preview else MAX_SECONDS
    decode(Path(args.input), original, args.ffmpeg, limit)
    audio, rate = sf.read(original, dtype="float32", always_2d=True)
    if not len(audio) or not np.isfinite(audio).all():
        raise ValueError("音频为空或含有无效采样")
    if len(audio) > limit * rate:
        if not args.preview:
            raise ValueError("实验版支持不超过 10 分钟的音频，可选择先试听前 60 秒")
        audio = audio[:limit * rate]
        sf.write(original, audio, rate, subtype="FLOAT")
    emit(phase="loading", progress=0, message="正在加载本地模型")
    model = get_model(MODEL, repo=Path(args.models))
    if tuple(model.sources) != SOURCES or model.samplerate != rate:
        raise ValueError("模型格式与预期不符，请重新安装分离环境")
    mix = torch.from_numpy(audio.T.copy())
    ref = mix.mean(0)
    mean, std = ref.mean(), ref.std().clamp(min=1e-8)
    mix = ((mix - mean) / std)[None]
    length = mix.shape[-1]
    segment = int(float(model.segment) * rate)
    stride = int(segment * 0.75)
    offsets = list(range(0, length, stride))
    # Same triangular overlap-add as Demucs; explicit loop allows actual progress.
    weight = torch.cat((torch.arange(1, segment // 2 + 1),
                        torch.arange(segment - segment // 2, 0, -1))).float()
    weight /= weight.max()
    result = torch.zeros(len(SOURCES), 2, length)
    weights = torch.zeros(length)
    with torch.inference_mode():
        for index, offset in enumerate(offsets):
            emit(phase="separating", progress=index / len(offsets),
                 message=f"正在分离 · {index + 1} / {len(offsets)}")
            chunk = TensorChunk(mix, offset, segment)
            estimate = apply_model(model, chunk, shifts=0, split=False, device="cpu")[0]
            size = estimate.shape[-1]
            result[..., offset:offset + size] += estimate * weight[:size]
            weights[offset:offset + size] += weight[:size]
    result /= weights.clamp(min=1e-8)
    result = result * std + mean / len(SOURCES)
    emit(phase="writing", progress=1, message="正在保存声部")
    stems = []
    for name, samples in zip(SOURCES, result.numpy()):
        if not np.isfinite(samples).all():
            raise ValueError("分离结果包含无效采样")
        sf.write(output / f"{name}.wav", samples.T, rate, subtype="FLOAT")
        stems.append({"id": name, "peak": float(np.abs(samples).max())})
    manifest = {"model": "HTDemucs", "sampleRate": rate,
                "duration": length / rate, "frames": length,
                "originalPeak": float(np.abs(audio).max()), "stems": stems}
    (output / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    emit(phase="complete", progress=1, message="分离完成")


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, cancel)
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--models", required=True)
    parser.add_argument("--ffmpeg", required=True)
    parser.add_argument("--preview", action="store_true")
    try:
        separate(parser.parse_args())
    except Exception as error:
        # Avoid leaking file paths or ffmpeg stderr through the UI.
        message = str(error) if isinstance(error, ValueError) else "分离失败，请检查文件格式和本地分离环境"
        emit(phase="error", progress=0, message=message)
        print(type(error).__name__ + ": " + str(error), file=sys.stderr)
        sys.exit(1)
