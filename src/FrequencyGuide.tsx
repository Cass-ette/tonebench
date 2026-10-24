import { ChevronDown, Plus } from 'lucide-react';
import { INSTRUMENTS, formatGuideRange } from './instrumentRanges';
import type { FrequencyRegion } from './instrumentRanges';

type Props = {
  open: boolean;
  instrumentId: string;
  regionId: string;
  canAdd: boolean;
  onToggle: () => void;
  onInstrument: (id: string) => void;
  onRegion: (id: string) => void;
  onAdd: (region: FrequencyRegion) => void;
};

export default function FrequencyGuide({
  open,
  instrumentId,
  regionId,
  canAdd,
  onToggle,
  onInstrument,
  onRegion,
  onAdd,
}: Props) {
  const instrument =
    INSTRUMENTS.find((item) => item.id === instrumentId) ?? INSTRUMENTS[0];
  const region =
    instrument.regions.find((item) => item.id === regionId) ??
    instrument.regions[0];
  return (
    <section
      className={`frequency-guide ${open ? 'open' : ''}`}
      aria-label="乐器与人声频段参考"
    >
      <button
        className="guide-toggle"
        aria-expanded={open}
        aria-controls="frequency-guide-content"
        onClick={onToggle}
      >
        <span>频段参考</span>
        <span className="guide-toggle-hint">人声 / 乐器</span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div id="frequency-guide-content" className="guide-content">
          <div className="guide-instruments" role="group" aria-label="选择声部">
            {INSTRUMENTS.map((item) => (
              <button
                key={item.id}
                className="guide-chip"
                aria-pressed={item.id === instrument.id}
                onClick={() => onInstrument(item.id)}
              >
                {item.name}
              </button>
            ))}
          </div>
          <div
            className="guide-regions"
            role="group"
            aria-label={`${instrument.name}调音区域`}
          >
            {instrument.regions.map((item) => (
              <button
                key={item.id}
                className="guide-region"
                aria-pressed={item.id === region.id}
                onClick={() => onRegion(item.id)}
              >
                <span>{item.name}</span>
                <small>{formatGuideRange(item)}</small>
              </button>
            ))}
          </div>
          <div className="guide-advice" aria-live="polite">
            <div>
              <span>提升</span>
              <p>{region.boost}</p>
            </div>
            <div>
              <span>衰减</span>
              <p>{region.cut}</p>
            </div>
          </div>
          <div className="guide-bottom">
            <p>
              区间随音域和录音而变；EQ
              会同时影响这个频段的其他声音，不能分离乐器。先从 ±1–2 dB 试听。
            </p>
            <button
              className="text-button guide-add"
              disabled={!canAdd}
              title={
                canAdd
                  ? '添加一段 0 dB 滤波器，再按听感调整增益'
                  : '最多 12 段，请先删除一段'
              }
              onClick={() => onAdd(region)}
            >
              <Plus size={12} />
              添加此频段
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
