import { useState } from 'react';
import { ChevronDown, Plus, Search } from 'lucide-react';
import {
  INSTRUMENTS,
  INSTRUMENT_GROUPS,
  formatGuideRange,
} from './instrumentRanges';
import type { FrequencyRegion, InstrumentGroup } from './instrumentRanges';

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
  const [group, setGroup] = useState<InstrumentGroup | 'all'>('all');
  const [query, setQuery] = useState('');
  const search = query.trim().toLocaleLowerCase();
  const results = INSTRUMENTS.filter(
    (item) =>
      (group === 'all' || item.group === group) &&
      [item.name, item.id, ...(item.aliases ?? [])].some((name) =>
        name.toLocaleLowerCase().includes(search),
      ),
  );
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
          <div className="guide-browser-heading">
            <div
              className="guide-categories"
              role="group"
              aria-label="乐器分类"
            >
              {[{ id: 'all', name: '全部' }, ...INSTRUMENT_GROUPS].map(
                (item) => (
                  <button
                    key={item.id}
                    className="guide-category"
                    aria-label={`分类：${item.name}`}
                    aria-pressed={item.id === group}
                    onClick={() => {
                      setGroup(item.id as InstrumentGroup | 'all');
                      setQuery('');
                      if (item.id !== 'all' && item.id !== instrument.group)
                        onInstrument(
                          INSTRUMENTS.find(
                            (candidate) => candidate.group === item.id,
                          )!.id,
                        );
                    }}
                  >
                    {item.name}
                  </button>
                ),
              )}
            </div>
            <label className="guide-search">
              <Search size={12} aria-hidden="true" />
              <input
                type="search"
                aria-label="搜索乐器或人声"
                placeholder="搜索乐器 / 人声"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setGroup('all');
                }}
              />
            </label>
          </div>
          <div className="guide-instruments" role="group" aria-label="选择声部">
            {results.map((item) => (
              <button
                key={item.id}
                className="guide-chip"
                aria-pressed={item.id === instrument.id}
                onClick={() => onInstrument(item.id)}
              >
                {item.name}
              </button>
            ))}
            {results.length === 0 && (
              <p className="guide-empty">没有匹配的声部，换个名称试试。</p>
            )}
          </div>
          <div className="guide-current">
            <strong>{instrument.name}</strong>
            <span>选择要调整的听感</span>
            <small>{INSTRUMENTS.length} 类声部</small>
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
