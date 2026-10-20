"""Isolated local Demucs runner. stdout is a JSON-lines protocol; never writes input."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import time

ENGINE_VERSION = 'htdemucs-mlx-1.6.1-v1'
MODEL_FILES = {
    'htdemucs.safetensors': (168005865, '339d267a7a6983a11eedbdc00413c602a65e9b9103f695fb5c2b2a481cd9d297'),
    'htdemucs_config.json': (4215, '23657b19db14771aecf366ceedbf846c1386836c10043c97f4569acf05526b78'),
}


def emit(stage, **values):
    print(json.dumps(dict(stage=stage, **values), ensure_ascii=False), flush=True)


def source_digest(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def validate_paths(source, output):
    source, output = Path(source).resolve(), Path(output).resolve()
    if not source.is_file() or source == output:
        raise ValueError('输入文件不可用，或输出路径与原曲相同。')
    if output.exists():
        raise ValueError('输出文件已经存在。')
    return source, output


def instrumental(stems):
    return stems['drums'] + stems['bass'] + stems['other']


def chunk_ranges(samples, chunk, context):
    for start in range(0, samples, chunk):
        end = min(start + chunk, samples)
        yield start, end, max(0, start - context), min(samples, end + context)


def overlap_weights(start, end, left, right, context):
    import numpy as np
    weights = np.ones(right-left, dtype='float32')
    ramp = min(context*2, right-left)
    if start > 0:
        weights[:ramp] *= np.linspace(0, 1, ramp, endpoint=False, dtype='float32')
    if right > end:
        weights[-ramp:] *= np.linspace(1, 0, ramp, endpoint=False, dtype='float32')
    return weights


def save_flac(path, samples, rate, chunk=None):
    import soundfile as sf
    block = chunk or rate * 30
    with sf.SoundFile(str(path), mode='w', samplerate=rate,
                      channels=samples.shape[0], format='FLAC', subtype='PCM_24') as target:
        for start in range(0, samples.shape[1], block):
            target.write(samples[:, start:start+block].T)


def verify_model(directory):
    for name, (size, digest) in MODEL_FILES.items():
        path = directory / name
        if not path.is_file() or path.stat().st_size != size or source_digest(path) != digest:
            raise ValueError('模型缺失或完整性校验失败，请删除模型后重新下载。')


def prepare_model(directory):
    import certifi
    os.environ['SSL_CERT_FILE'] = certifi.where()
    # Ignore inherited mirrors: only the pinned public source is used.
    os.environ.pop('HF_ENDPOINT', None)
    os.environ.pop('DEMUCS_MLX_HUB_URL', None)
    import urllib.request
    directory.mkdir(parents=True, exist_ok=True)
    total = sum(size for size, _ in MODEL_FILES.values())
    if shutil.disk_usage(directory).free < total * 2:
        raise ValueError('空间不足，模型下载至少需要 350 MB 可用空间。')
    downloaded = 0
    for name, (expected_size, expected_digest) in MODEL_FILES.items():
        target = directory / name
        if target.is_file() and target.stat().st_size == expected_size and source_digest(target) == expected_digest:
            downloaded += expected_size
            continue
        partial = directory / (name + '.part')
        try:
            digest, size = hashlib.sha256(), 0
            with urllib.request.urlopen('https://huggingface.co/ssmall256/demucs-mlx/resolve/main/' + name, timeout=30) as response, partial.open('wb') as output:
                for data in iter(lambda: response.read(1024 * 1024), b''):
                    size += len(data)
                    if size > expected_size:
                        raise ValueError('模型下载大小异常。')
                    output.write(data)
                    digest.update(data)
                    emit('download', progress=(downloaded + size) / total)
            if size != expected_size or digest.hexdigest() != expected_digest:
                raise ValueError('模型完整性校验失败，请重新下载。')
            partial.replace(target)
            downloaded += size
        finally:
            partial.unlink(missing_ok=True)


def convert_audio(source, output):
    import subprocess
    import imageio_ffmpeg
    limit=min(2 * 1024**3, shutil.disk_usage(output.parent).free-200*1024**2)
    if limit < 16*1024**2:
        raise ValueError('空间不足，无法准备音频。')
    emit('preparing', progress=0)
    executable=Path(imageio_ffmpeg.__file__).parent/'binaries'/'ffmpeg-macos-aarch64-v7.1'
    process=subprocess.run([str(executable), '-nostdin', '-hide_banner', '-loglevel', 'error',
        '-protocol_whitelist', 'file,pipe', '-i', str(source), '-map', '0:a:0',
        '-vn', '-t', '14401', '-ar', '44100', '-ac', '2', '-c:a', 'flac',
        '-fs', str(limit), '-n', str(output)], capture_output=True, timeout=1800)
    if process.returncode or not output.is_file() or output.stat().st_size >= limit:
        output.unlink(missing_ok=True)
        raise ValueError('音频转换失败、文件损坏或临时空间不足。原曲保留。')
    return output


def separate(source, output, model_directory):
    verify_model(model_directory)
    import numpy as np
    import mlx.core as mx
    import mlx_audio_io as audio
    from demucs_mlx import Separator
    source, output = validate_paths(source, output)
    output.parent.mkdir(parents=True, exist_ok=True)
    before = source_digest(source)
    emit('loading', progress=0)
    os.environ['DEMUCS_MLX_CACHE_DIR'] = str(model_directory)
    os.environ['DEMUCS_MLX_NO_DOWNLOAD'] = '1'
    converted = output.with_suffix('.decoded.flac')
    decode_source = source
    try:
        info = audio.info(str(source))
    except Exception:
        decode_source = convert_audio(source, converted)
        info = audio.info(str(decode_source))
    duration = info.duration
    if not 0 < duration <= 4 * 3600:
        raise ValueError('目前支持时长不超过四小时的歌曲。')
    rate, samples = 44100, round(duration * 44100)
    if shutil.disk_usage(output.parent).free < samples * 2 * 4 * 3 + 200 * 1024 * 1024:
        raise ValueError('空间不足，请先清理伴奏缓存。')
    engine = Separator(model='htdemucs', shifts=1, seed=0, batch_size=1)
    raw = output.with_suffix('.pcm')
    weight_file = output.with_suffix('.weights')
    begin = time.monotonic()
    try:
        result = np.memmap(raw, dtype='float32', mode='w+', shape=(2, samples))
        total_weights = np.memmap(weight_file, dtype='float32', mode='w+', shape=(samples,))
        result[:] = 0
        total_weights[:] = 0
        for start, end, left, right in chunk_ranges(samples, rate * 30, rate * 3):
            clip, _ = audio.load(str(decode_source), sr=rate, layout='channels_first', offset=left/rate, duration=(right-left)/rate)
            if clip.ndim == 1:
                clip = mx.stack([clip, clip])
            elif clip.shape[0] == 1:
                clip = mx.concatenate([clip, clip], axis=0)
            elif clip.shape[0] != 2:
                raise ValueError('目前去人声支持单声道或双声道音频。')
            _, stems = engine.separate_tensor(clip, return_mx=True)
            accompaniment = np.asarray(instrumental(stems))
            if not np.all(np.isfinite(accompaniment)):
                raise ValueError('模型输出异常，请重试。')
            weights = overlap_weights(start, end, left, right, rate*3)
            result[:, left:right] += accompaniment[:, :right-left] * weights
            total_weights[left:right] += weights
            del clip, stems, accompaniment
            mx.clear_cache()
            emit('separating', progress=end/samples)
        result.flush()
        emit('saving', progress=1)
        peak = 1.0
        for start in range(0, samples, rate*30):
            end = min(samples, start+rate*30)
            result[:, start:end] /= np.maximum(total_weights[start:end], 1e-8)
            peak = max(peak, float(np.max(np.abs(result[:, start:end]))) * 1.01)
        for start in range(0, samples, rate*30):
            result[:, start:start+rate*30] /= peak
        save_flac(output, result, rate)
        del result, total_weights
        if source_digest(source) != before:
            output.unlink(missing_ok=True)
            raise ValueError('处理期间原文件发生变化，请刷新音乐库后重试。')
        emit('result', sourceHash=before, version=ENGINE_VERSION, seconds=time.monotonic()-begin, bytes=output.stat().st_size)
    finally:
        raw.unlink(missing_ok=True)
        weight_file.unlink(missing_ok=True)
        converted.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['download', 'separate', 'inspect'])
    parser.add_argument('--models', required=True, type=Path)
    parser.add_argument('--source', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    try:
        if args.action == 'inspect':
            import mlx.core as mx
            emit('result', version=ENGINE_VERSION, metal=mx.metal.is_available())
        elif args.action == 'download':
            prepare_model(args.models)
            emit('result', version=ENGINE_VERSION)
        else:
            if not args.source or not args.output:
                raise ValueError('缺少输入或输出路径。')
            separate(args.source, args.output, args.models)
    except Exception as error:
        emit('error', message=str(error))
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
