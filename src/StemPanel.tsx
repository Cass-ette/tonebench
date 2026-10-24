import { useEffect, useState } from 'react';
import {
  AudioLines,
  FolderOpen,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  Upload,
} from 'lucide-react';
import { isNative, nativeMessage } from './native';
import { initialStems, parseStemStatus, stemTime } from './stems';
import type { StemControl, StemId } from './stems';

const labels: Record<StemId, [string, string]> = {
  vocals: ['人声', 'VOCALS'],
  drums: ['鼓', 'DRUMS'],
  bass: ['贝斯', 'BASS'],
  guitar: ['吉他', 'GUITAR'],
  piano: ['钢琴', 'PIANO'],
  other: ['其他伴奏', 'OTHER'],
};

export default function StemPanel() {
  const [status, setStatus] = useState(initialStems);
  const [preview, setPreview] = useState(true);
  const native = isNative();
  useEffect(() => {
    const receive = (event: Event) => {
      const value = parseStemStatus((event as CustomEvent).detail);
      if (value) setStatus(value);
    };
    window.addEventListener('tonebench:stems', receive);
    nativeMessage({ action: 'stemsReady' });
    return () => window.removeEventListener('tonebench:stems', receive);
  }, []);
  const busy = !['idle', 'ready', 'error'].includes(status.phase);
  const ready = status.phase === 'ready';
  const controls = (stems: StemControl[], original = status.original) => {
    nativeMessage({ action: 'stemsControls', stems, original });
  };
  const change = (id: StemId, patch: Partial<StemControl>) =>
    controls(
      status.stems.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  return (
    <div className="stem-workspace">
      <section className="workspace-heading">
        <div>
          <div className="eyebrow">LOCAL AUDIO · EXPERIMENT</div>
          <h1>
            声部试听
            <span className="heading-rule" />
          </h1>
          <p>导入一首歌，分开听、分别调。</p>
        </div>
        <div className="heading-actions">
          <select
            aria-label="分离长度"
            value={preview ? 'preview' : 'full'}
            disabled={busy}
            onChange={(e) => setPreview(e.target.value === 'preview')}
          >
            <option value="preview">先试前 60 秒</option>
            <option value="full">完整音频 · 最长 10 分钟</option>
          </select>
          <button
            className="button button-primary"
            disabled={!native || !status.available || busy}
            onClick={() => nativeMessage({ action: 'stemsImport', preview })}
          >
            <Upload size={14} />
            {ready ? '更换音频' : '导入音频'}
          </button>
        </div>
      </section>
      {!native ? (
        <div className="stem-notice" role="status">
          在 ToneBench Mac 应用中使用本地分离和试听。
        </div>
      ) : !status.available ? (
        <div className="stem-notice" role="status">
          尚未安装本地分离环境。按 README 的“声部试听”步骤安装后重新构建应用。
        </div>
      ) : null}
      <section className="panel stem-player" aria-label="声部播放器">
        <div className="stem-file">
          <div className="stem-file-icon">
            <AudioLines size={27} strokeWidth={1.2} />
          </div>
          <div>
            <strong>{status.fileName || '选择本地音频'}</strong>
            <span>
              {ready
                ? `${status.stems.length} 个声部 · ${stemTime(status.duration)}`
                : '支持 WAV、MP3、FLAC、M4A 等常见音频格式'}
            </span>
          </div>
          <span className="stem-local">本机处理</span>
        </div>
        {busy && (
          <div className="stem-progress" role="status">
            <div>
              <LoaderCircle size={14} className="spin" />
              {status.message}
              <button
                className="text-button"
                disabled={status.phase === 'cancelling'}
                onClick={() => nativeMessage({ action: 'stemsCancel' })}
              >
                取消
              </button>
            </div>
            <progress aria-label="分离进度" max={1} value={status.progress} />
            <small>分离需要一些时间，完成后可以试听。</small>
          </div>
        )}
        {status.phase === 'error' && (
          <div className="stem-notice error-text" role="alert">
            {status.message}
          </div>
        )}
        <div className="stem-transport">
          <button
            className="stem-play"
            aria-label={status.playing ? '暂停声部试听' : '播放声部试听'}
            disabled={!ready}
            onClick={() => nativeMessage({ action: 'stemsPlay' })}
          >
            {status.playing ? <Pause size={19} /> : <Play size={19} />}
          </button>
          <span className="stem-time">{stemTime(status.position)}</span>
          <input
            type="range"
            min={0}
            max={status.duration || 1}
            step={0.1}
            value={status.position}
            disabled={!ready}
            aria-label="试听进度"
            onChange={(e) =>
              nativeMessage({
                action: 'stemsSeek',
                seconds: Number(e.target.value),
              })
            }
          />
          <span className="stem-time">{stemTime(status.duration)}</span>
          <div className="segmented-control stem-compare" aria-label="试听来源">
            <button
              className={status.original ? 'active' : ''}
              disabled={!ready}
              aria-pressed={status.original}
              onClick={() => controls(status.stems, true)}
            >
              原曲
            </button>
            <button
              className={!status.original ? 'active' : ''}
              disabled={!ready}
              aria-pressed={!status.original}
              onClick={() => controls(status.stems, false)}
            >
              分离混音
            </button>
          </div>
        </div>
        {ready && status.message && status.message !== '分离完成' && (
          <p className="stem-playback-message" role="status">
            {status.message}
          </p>
        )}
      </section>
      <section className="panel stem-mixer" aria-label="声部音量">
        <div className="panel-header">
          <h2>声部</h2>
          <button
            className="text-button"
            disabled={!ready}
            onClick={() => controls(initialStems.stems, false)}
          >
            <RotateCcw size={13} />
            还原音量
          </button>
        </div>
        {status.stems.map((row) => (
          <div
            className={`stem-row ${ready && !status.original && (row.muted || (status.stems.some((r) => r.solo) && !row.solo)) ? 'stem-muted' : ''}`}
            key={row.id}
          >
            <div className="stem-name">
              <strong>{labels[row.id][0]}</strong>
              <span>{labels[row.id][1]}</span>
            </div>
            <button
              className={`stem-switch ${row.solo ? 'active' : ''}`}
              aria-label={`独听${labels[row.id][0]}`}
              aria-pressed={row.solo}
              disabled={!ready || status.original}
              onClick={() => change(row.id, { solo: !row.solo })}
            >
              独听
            </button>
            <button
              className={`stem-switch ${row.muted ? 'active' : ''}`}
              aria-label={`静音${labels[row.id][0]}`}
              aria-pressed={row.muted}
              disabled={!ready || status.original}
              onClick={() => change(row.id, { muted: !row.muted })}
            >
              静音
            </button>
            <input
              type="range"
              min={-24}
              max={6}
              step={0.5}
              value={row.gain}
              disabled={!ready || status.original}
              aria-label={`${labels[row.id][0]}音量`}
              onChange={(e) => change(row.id, { gain: Number(e.target.value) })}
            />
            <output>
              {row.gain > 0 ? '+' : ''}
              {row.gain.toFixed(1)}
              <small>dB</small>
            </output>
          </div>
        ))}
        <div className="stem-mixer-footer">
          <span title="根据各声部峰值预留播放余量；原曲和分离混音使用相同衰减。">
            播放余量 <b>{ready ? `${status.headroom.toFixed(1)} dB` : '—'}</b>
          </span>
          <button
            className="text-button"
            disabled={!ready}
            onClick={() => nativeMessage({ action: 'stemsReveal' })}
          >
            <FolderOpen size={13} />
            打开分离文件夹
          </button>
        </div>
      </section>
      <div className="stem-notes">
        <p>
          “其他伴奏”包含未单独分出的乐器。分离结果可能有串音或音色变化，独听时更容易察觉。
        </p>
        <p>钢琴分离仍属实验功能，可能混入其他乐器，也可能漏掉部分琴声。</p>
        <p>
          此播放器暂只调整声部音量，不叠加工作台
          EQ。分离文件保存在本机缓存，重要结果请另存。
        </p>
      </div>
    </div>
  );
}
