import { useEffect, useState } from 'react';
import { AudioLines } from 'lucide-react';
import type { AudioStatus } from './native';
import { isSpectrumFrame, nearestSpectrumBin } from './spectrum';
import type { SpectrumFrame } from './spectrum';

const W = 960,
  H = 222,
  LEFT = 49,
  RIGHT = 18,
  TOP = 20,
  BOTTOM = 30;
const frequencyX = (f: number) =>
  LEFT + (Math.log(f / 20) / Math.log(1000)) * (W - LEFT - RIGHT);
const levelY = (db: number) =>
  TOP + (Math.max(-100, Math.min(0, db)) / -100) * (H - TOP - BOTTOM);
const frequencyLabel = (f: number) =>
  f >= 1000
    ? `${(f / 1000).toFixed(f >= 10000 ? 1 : 2)} kHz`
    : `${f.toFixed(0)} Hz`;
const levelLabel = (db: number) =>
  db <= -100 ? '≤ −100' : db.toFixed(1).replace('-', '−');

export default function SpectrumPanel({
  native,
  phase,
}: {
  native: boolean;
  phase: AudioStatus['phase'];
}) {
  const [frame, setFrame] = useState<SpectrumFrame | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [visible, setVisible] = useState({ before: true, after: true });
  useEffect(() => {
    if (!native || (phase !== 'running' && phase !== 'starting')) return;
    let expiry: ReturnType<typeof setTimeout>;
    const receive = (event: Event) => {
      const data: unknown = (event as CustomEvent).detail;
      if (data !== null && !isSpectrumFrame(data)) return;
      clearTimeout(expiry);
      setFrame(data);
      if (data) expiry = setTimeout(() => setFrame(null), 750);
    };
    window.addEventListener('tonebench:spectrum', receive);
    return () => {
      window.removeEventListener('tonebench:spectrum', receive);
      clearTimeout(expiry);
      setFrame(null);
    };
  }, [native, phase]);
  const live = phase === 'running' || phase === 'starting' ? frame : null;
  const peak = live
    ? live.after.reduce((best, db, i) => (db > live.after[best] ? i : best), 0)
    : 0;
  const bin = live
    ? hover === null
      ? peak
      : nearestSpectrumBin(live.frequencies, hover)
    : 0;
  const signal = live && live.after[peak] > -100;
  const path = (values: number[]) =>
    live
      ? values
          .map(
            (db, i) =>
              `${i ? 'L' : 'M'}${frequencyX(live.frequencies[i]).toFixed(2)},${levelY(db).toFixed(2)}`,
          )
          .join(' ')
      : '';
  return (
    <section className="panel spectrum-panel" aria-label="实时频谱">
      <div className="panel-header">
        <div className="panel-title">
          <AudioLines size={15} />
          <h2>实时频谱</h2>
          <span className="subtle-en">SPECTRUM</span>
        </div>
        <span className={`spectrum-status ${signal ? 'active' : ''}`}>
          <i />
          {!native
            ? 'Mac 应用可用'
            : live
              ? signal
                ? '实时'
                : '无信号'
              : phase === 'running' || phase === 'starting'
                ? '等待音频'
                : '未开启'}
        </span>
      </div>
      <div className="spectrum-toolbar">
        <div className="spectrum-legend">
          {(['before', 'after'] as const).map((key) => (
            <button
              key={key}
              className={`legend-item ${!visible[key] ? 'muted' : ''}`}
              aria-pressed={visible[key]}
              onClick={() => setVisible({ ...visible, [key]: !visible[key] })}
            >
              <span className={`spectrum-swatch ${key}`} />
              {key === 'before' ? 'EQ 前' : 'EQ 后'}
            </button>
          ))}
        </div>
        <div className="spectrum-readout" aria-label="频谱读数">
          <span>
            {live && (hover !== null || signal)
              ? frequencyLabel(live.frequencies[bin])
              : '— Hz'}
          </span>
          <span>
            {live
              ? `${levelLabel(live.before[bin])} / ${levelLabel(live.after[bin])} dBFS`
              : '— / — dBFS'}
          </span>
        </div>
      </div>
      <div className="spectrum-plot" onPointerLeave={() => setHover(null)}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="EQ 前后实时频谱，20 Hz 至 20 kHz，数字电平 dBFS"
          onPointerMove={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const x = ((event.clientX - bounds.left) / bounds.width) * W;
            setHover(
              20 *
                Math.pow(
                  1000,
                  Math.max(0, Math.min(1, (x - LEFT) / (W - LEFT - RIGHT))),
                ),
            );
          }}
        >
          {[0, -20, -40, -60, -80, -100].map((db) => (
            <g key={db}>
              <line
                className="spectrum-grid"
                x1={LEFT}
                x2={W - RIGHT}
                y1={levelY(db)}
                y2={levelY(db)}
              />
              <text
                className="spectrum-axis"
                x={LEFT - 10}
                y={levelY(db) + 3}
                textAnchor="end"
              >
                {db}
              </text>
            </g>
          ))}
          {[20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].map((f) => (
            <g key={f}>
              <line
                className="spectrum-grid vertical"
                x1={frequencyX(f)}
                x2={frequencyX(f)}
                y1={TOP}
                y2={H - BOTTOM}
              />
              <text
                className="spectrum-axis"
                x={frequencyX(f)}
                y={H - 10}
                textAnchor="middle"
              >
                {f >= 1000 ? `${f / 1000}k` : f}
              </text>
            </g>
          ))}
          {live && visible.before && (
            <path className="spectrum-line before" d={path(live.before)} />
          )}
          {live && visible.after && (
            <path className="spectrum-line after" d={path(live.after)} />
          )}
          {live && hover !== null && (
            <>
              <line
                className="spectrum-cursor"
                x1={frequencyX(live.frequencies[bin])}
                x2={frequencyX(live.frequencies[bin])}
                y1={TOP}
                y2={H - BOTTOM}
              />
              {visible.after && (
                <circle
                  cx={frequencyX(live.frequencies[bin])}
                  cy={levelY(live.after[bin])}
                  r={3}
                  className="spectrum-point"
                />
              )}
            </>
          )}
        </svg>
        {!live && (
          <div className="spectrum-empty">
            {native
              ? phase === 'running' || phase === 'starting'
                ? '播放音乐后显示频谱'
                : '开启系统 EQ 后查看'
              : '在 Mac 应用中查看实时频谱'}
          </div>
        )}
      </div>
      <div className="spectrum-regions">
        <span>超低频</span>
        <span>低频</span>
        <span>中频</span>
        <span>中高频</span>
        <span>高频</span>
      </div>
      <div className="chart-footer">
        <span>数字电平 · EQ 后包含前级增益</span>
        <span>
          {live
            ? `${live.sampleRate / 1000} kHz · FFT ${live.fftSize}`
            : '20 Hz — 20 kHz'}{' '}
          · dBFS
        </span>
      </div>
    </section>
  );
}
