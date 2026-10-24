import { useId, useRef, useState } from 'react';
import type { Band, Measurement, Target } from './audio';
import { clamp, eqResponse, FREQUENCIES, interpolate, targetAt } from './audio';

export type CurveVisibility = {
  measured: boolean;
  target: boolean;
  predicted: boolean;
  eq: boolean;
};
type Props = {
  measurement: Measurement;
  target: Target;
  bands: Band[];
  sampleRate: number;
  bypass: boolean;
  visible: CurveVisibility;
  selected: string | null;
  onSelect: (id: string) => void;
  onChange: (id: string, patch: Partial<Band>) => void;
  onEditStart: () => void;
  onEditEnd: () => void;
};
const W = 1000,
  H = 380,
  LEFT = 48,
  RIGHT = 22,
  TOP = 20,
  BOTTOM = 42;
const INNER_W = W - LEFT - RIGHT,
  INNER_H = H - TOP - BOTTOM;
const Y_MIN = -16,
  Y_MAX = 18;
const ticks = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
const yTicks = [-15, -10, -5, 0, 5, 10, 15];
const px = (f: number) => LEFT + (Math.log10(f / 20) / 3) * INNER_W;
const py = (db: number) => TOP + ((Y_MAX - db) / (Y_MAX - Y_MIN)) * INNER_H;
const formatHz = (f: number) =>
  f >= 1000 ? `${Number((f / 1000).toFixed(1))}k` : String(Math.round(f));

export default function FrequencyChart({
  measurement,
  target,
  bands,
  sampleRate,
  bypass,
  visible,
  selected,
  onSelect,
  onChange,
  onEditStart,
  onEditEnd,
}: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const id = useId().replace(/:/g, '');
  const [hover, setHover] = useState<{
    frequency: number;
    x: number;
    y: number;
  } | null>(null);
  const drag = useRef<{ band: Band; startY: number } | null>(null);
  const curve = (read: (f: number) => number, measuredRange = false) =>
    FREQUENCIES.filter((f) => {
      if (f >= sampleRate / 2) return false;
      if (!measuredRange) return true;
      return (
        measurement.points.length > 0 &&
        f >= measurement.points[0].frequency &&
        f <= measurement.points.at(-1)!.frequency
      );
    })
      .map(
        (f, i) =>
          `${i ? 'L' : 'M'}${px(f).toFixed(2)},${py(read(f)).toFixed(2)}`,
      )
      .join(' ');
  const local = (event: React.PointerEvent<SVGSVGElement>) => {
    const matrix = svg.current!.getScreenCTM();
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix!.inverse(),
    );
    return {
      x: clamp(point.x, LEFT, W - RIGHT),
      y: clamp(point.y, TOP, H - BOTTOM),
    };
  };
  const activeBands = bypass ? [] : bands;
  const measured = (f: number) => interpolate(measurement.points, f);
  const response = (f: number) => eqResponse(activeBands, f, sampleRate);
  const predicted = (f: number) => measured(f) + response(f);
  const move = (event: React.PointerEvent<SVGSVGElement>) => {
    const { x, y } = local(event);
    const frequency = 20 * 1000 ** ((x - LEFT) / INNER_W);
    setHover({ frequency, x, y });
    if (drag.current) {
      const { band, startY } = drag.current;
      onChange(band.id, {
        frequency: Math.round(clamp(frequency, 20, 20000)),
        gain:
          Math.round(
            clamp(
              band.gain + ((startY - y) / INNER_H) * (Y_MAX - Y_MIN),
              -18,
              12,
            ) * 10,
          ) / 10,
      });
    }
  };
  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    onEditEnd();
  };
  const tooltipLeft = hover ? clamp((hover.x / W) * 100 + 2, 8, 76) : 0;
  const hoverHasData =
    hover &&
    measurement.points.length > 0 &&
    hover.frequency >= measurement.points[0].frequency &&
    hover.frequency <= measurement.points.at(-1)!.frequency;
  return (
    <div className="frequency-chart" data-testid="frequency-chart">
      <div className="axis-caption">相对声压 · dB</div>
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={
          measurement.points.length
            ? '耳机原始频响、目标与 EQ 后预测曲线。启用 EQ 曲线后可拖动滤波器控制点。'
            : 'EQ 增益曲线，0 dB 表示不调整；目标曲线可按需显示。可拖动滤波器控制点。'
        }
        onPointerMove={move}
        onPointerLeave={() => {
          if (!drag.current) setHover(null);
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
        style={{ touchAction: drag.current ? 'none' : 'pan-y' }}
      >
        <defs>
          <clipPath id={`clip-${id}`}>
            <rect x={LEFT} y={TOP} width={INNER_W} height={INNER_H} />
          </clipPath>
        </defs>
        <rect
          x={LEFT}
          y={TOP}
          width={INNER_W}
          height={INNER_H}
          fill="#17191c"
        />
        <rect
          x={px(8000)}
          y={TOP}
          width={px(20000) - px(8000)}
          height={INNER_H}
          fill="#ffffff"
          opacity="0.018"
        />
        {Array.from({ length: 28 }, (_, i) => 20 * 1000 ** (i / 27)).map(
          (f) => (
            <line
              key={`minor-${f}`}
              x1={px(f)}
              x2={px(f)}
              y1={TOP}
              y2={H - BOTTOM}
              stroke="#272a2f"
              strokeWidth="0.55"
            />
          ),
        )}
        {ticks.map((f, i) => (
          <g key={f}>
            <line
              x1={px(f)}
              x2={px(f)}
              y1={TOP}
              y2={H - BOTTOM}
              stroke="#303338"
              strokeWidth="0.7"
            />
            <text
              x={px(f)}
              y={H - BOTTOM + 24}
              textAnchor="middle"
              className={`chart-tick ${[1, 3, 6, 8].includes(i) ? 'compact-hidden-tick' : ''}`}
            >
              {formatHz(f)}
            </text>
          </g>
        ))}
        {yTicks.map((db) => (
          <g key={db}>
            <line
              x1={LEFT}
              x2={W - RIGHT}
              y1={py(db)}
              y2={py(db)}
              stroke={db === 0 ? '#4c5158' : '#303338'}
              strokeWidth={db === 0 ? '1' : '0.7'}
            />
            <text
              x={LEFT - 12}
              y={py(db) + 4}
              textAnchor="end"
              className="chart-tick"
            >
              {db > 0 ? '+' : ''}
              {db}
            </text>
          </g>
        ))}
        <g clipPath={`url(#clip-${id})`}>
          {visible.target && (
            <path
              d={curve((f) => targetAt(f, target))}
              className="curve target-curve"
            />
          )}
          {measurement.points.length > 0 && visible.measured && (
            <path d={curve(measured, true)} className="curve measured-curve" />
          )}
          {measurement.points.length > 0 && visible.predicted && (
            <path
              d={curve(predicted, true)}
              className="curve predicted-curve"
            />
          )}
          {visible.eq && (
            <path d={curve(response)} className="curve eq-curve" />
          )}
          {visible.eq &&
            !bypass &&
            bands
              .filter((b) => b.enabled)
              .map((band, i) => (
                <g
                  key={band.id}
                  className="band-handle"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    svg.current!.setPointerCapture(event.pointerId);
                    const point = new DOMPoint(
                      event.clientX,
                      event.clientY,
                    ).matrixTransform(svg.current!.getScreenCTM()!.inverse());
                    drag.current = { band: { ...band }, startY: point.y };
                    onEditStart();
                    onSelect(band.id);
                  }}
                >
                  <circle
                    cx={px(band.frequency)}
                    cy={py(response(band.frequency))}
                    r={band.id === selected ? 10 : 8}
                    fill={band.id === selected ? '#b8c8dc' : '#282d33'}
                    stroke="#a0b0c4"
                    strokeWidth="1.2"
                  />
                  <text
                    x={px(band.frequency)}
                    y={py(response(band.frequency)) + 3.5}
                    textAnchor="middle"
                    className={`handle-label ${band.id === selected ? 'selected' : ''}`}
                  >
                    {i + 1}
                  </text>
                </g>
              ))}
          {hover && !drag.current && (
            <line
              x1={hover.x}
              x2={hover.x}
              y1={TOP}
              y2={H - BOTTOM}
              stroke="#a4aab3"
              strokeDasharray="3 4"
              opacity="0.55"
              pointerEvents="none"
            />
          )}
        </g>
        <text x={W - RIGHT} y={H - 4} textAnchor="end" className="chart-tick">
          Hz
        </text>
        <text
          x={px(12000)}
          y={TOP + 16}
          textAnchor="middle"
          className="chart-region-label"
        >
          高频谨慎区
        </text>
      </svg>
      {hover && !drag.current && (
        <div
          className="chart-tooltip"
          style={{ left: `${tooltipLeft}%`, top: 48 }}
        >
          <strong>{Math.round(hover.frequency).toLocaleString()} Hz</strong>
          {measurement.points.length > 0 && visible.measured && (
            <span>
              <i className="dot measured" />
              原始{' '}
              <b>
                {hoverHasData
                  ? `${measured(hover.frequency).toFixed(1)} dB`
                  : '无测量'}
              </b>
            </span>
          )}
          {visible.target && (
            <span>
              <i className="dot target" />
              目标 <b>{targetAt(hover.frequency, target).toFixed(1)} dB</b>
            </span>
          )}
          {measurement.points.length > 0 && visible.predicted && (
            <span>
              <i className="dot predicted" />
              预测{' '}
              <b>
                {hoverHasData
                  ? `${predicted(hover.frequency).toFixed(1)} dB`
                  : '无测量'}
              </b>
            </span>
          )}
        </div>
      )}
      <div className="frequency-regions">
        <span>
          低频 <small>20–200 Hz</small>
        </span>
        <span>
          中频 <small>200 Hz–2 kHz</small>
        </span>
        <span>
          高频 <small>2–20 kHz</small>
        </span>
      </div>
    </div>
  );
}
