import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpRight,
  AudioLines,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Cpu,
  FileText,
  FolderOpen,
  Headphones,
  Info,
  LoaderCircle,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  SlidersHorizontal,
  Trash2,
  Upload,
  Undo2,
  X,
} from 'lucide-react';
import FrequencyChart from './FrequencyChart';
import FrequencyGuide from './FrequencyGuide';
import { INSTRUMENTS, formatGuideHz } from './instrumentRanges';
import type { FrequencyRegion } from './instrumentRanges';
import SpectrumPanel from './SpectrumPanel';
import type { CurveVisibility } from './FrequencyChart';
import {
  autoFit,
  clamp,
  deviation,
  equalizerApo,
  initialBands,
  isMeasurement,
  isPreset,
  newBand,
  parseMeasurement,
  parseTarget,
  suggestedPreamp,
  TARGETS,
  isTarget,
} from './audio';
import type { Band, Measurement, Preset, Target } from './audio';
import { isNative, nativeMessage, useSystemAudio } from './native';
import { uniqueId } from './identity';
import { createHistory, historyReducer } from './history';

type Modal = 'import' | 'export' | 'save' | 'presets' | 'help' | 'gear' | null;
type Session = {
  measurement: Measurement;
  target: Target;
  bands: Band[];
  preamp: number;
  manualMode: boolean;
};
type TuningState = Session & { autoPreamp: boolean; bypass: boolean };
type Gear = { id: string; name: string; type: string; note: string };
type ImportKind = 'measurement' | 'target';
const PRESETS_KEY = 'tonebench.presets.v1';
const SESSION_KEY = 'tonebench.session.v1';
const GEAR_KEY = 'tonebench.gear.v1';
const EMPTY_MEASUREMENT: Measurement = {
  id: 'no-measurement',
  name: '尚未导入测量',
  source: '等待实测数据',
  note: '尚未载入耳机实测频响。',
  demo: false,
  points: [],
};
function readStorage<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
}
function readPresets(): Preset[] {
  const data: unknown = readStorage(PRESETS_KEY, []);
  return Array.isArray(data) ? data.filter(isPreset) : [];
}
function readSession(): Session {
  const data = readStorage<unknown>(SESSION_KEY, null);
  if (isPreset(data)) {
    return {
      measurement: data.measurement ?? EMPTY_MEASUREMENT,
      target: data.target,
      bands: data.bands,
      preamp: data.preamp,
      manualMode: data.measurement === null,
    };
  }
  return {
    measurement: EMPTY_MEASUREMENT,
    target: TARGETS[0],
    bands: [],
    preamp: 0,
    manualMode: false,
  };
}
function download(filename: string, contents: string, type = 'text/plain') {
  if (nativeMessage({ action: 'export', name: filename, contents })) return;
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function safeFilename(name: string) {
  return (
    name.replace(/[^a-zA-Z0-9\u4e00-\u9fff._-]/g, '-').slice(0, 80) ||
    'tonebench'
  );
}

function NumericInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
  suffix,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
  suffix?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  const discard = useRef(false);
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    if (discard.current) {
      discard.current = false;
      setDraft(String(value));
      return;
    }
    const parsed = Number(draft);
    if (!draft.trim() || !Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const next = Number(
      clamp(parsed, min, max).toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0),
    );
    setDraft(String(next));
    onChange(next);
  };
  return (
    <span className="numeric-field">
      <input
        aria-label={label}
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            discard.current = true;
            setDraft(String(value));
            e.currentTarget.blur();
          }
        }}
      />
      {suffix && <span>{suffix}</span>}
    </span>
  );
}

export default function App() {
  const [session] = useState(readSession);
  const [history, dispatch] = useReducer(
    historyReducer<TuningState>,
    session,
    (initial) => createHistory({ ...initial, autoPreamp: true, bypass: false }),
  );
  const { measurement, target, bands, preamp, manualMode, autoPreamp, bypass } =
    history.current;
  const changeTuning = (patch: Partial<TuningState>) =>
    dispatch({ type: 'change', patch });
  const [presets, setPresets] = useState(readPresets);
  const [modal, setModal] = useState<Modal>(null);
  const [visible, setVisible] = useState<CurveVisibility>({
    measured: !session.manualMode,
    target: !session.manualMode,
    predicted: !session.manualMode,
    eq: session.manualMode,
  });
  const [selected, setSelected] = useState<string | null>(
    session.bands[0]?.id ?? null,
  );
  const [fitCount, setFitCount] = useState(6);
  const [maxBoost, setMaxBoost] = useState(6);
  const [fitting, setFitting] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideInstrumentId, setGuideInstrumentId] = useState(INSTRUMENTS[0].id);
  const [guideRegionId, setGuideRegionId] = useState(
    INSTRUMENTS[0].regions[0].id,
  );
  const guideInstrument =
    INSTRUMENTS.find((item) => item.id === guideInstrumentId) ?? INSTRUMENTS[0];
  const guideRegion =
    guideInstrument.regions.find((item) => item.id === guideRegionId) ??
    guideInstrument.regions[0];
  const [toast, setToast] = useState('');
  const [storageProblem, setStorageProblem] = useState(false);
  const [importError, setImportError] = useState('');
  const [importKind, setImportKind] = useState<ImportKind>('measurement');
  const [presetName, setPresetName] = useState('');
  const [exportType, setExportType] = useState<'apo' | 'json'>('apo');
  const [gears, setGears] = useState<Gear[]>(() => {
    const data: unknown = readStorage(GEAR_KEY, []);
    return Array.isArray(data)
      ? data.filter(
          (g): g is Gear =>
            g &&
            typeof g.id === 'string' &&
            typeof g.name === 'string' &&
            typeof g.type === 'string' &&
            typeof g.note === 'string',
        )
      : [];
  });
  const [customMeasurements, setCustomMeasurements] = useState<Measurement[]>(
    () => {
      const data = readStorage<unknown>('tonebench.measurements.v1', []);
      if (!Array.isArray(data)) return [];
      return data.filter(isMeasurement).filter((m) => !m.demo);
    },
  );
  const [customTargets, setCustomTargets] = useState<Target[]>(() => {
    const data = readStorage<unknown>('tonebench.targets.v1', []);
    return Array.isArray(data) ? data.filter(isTarget) : [];
  });
  const [gearName, setGearName] = useState('');
  const [gearType, setGearType] = useState('DAC / 耳放');
  const [gearNote, setGearNote] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const modalPanel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const fitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const systemAudio = useSystemAudio({ bands, preamp, bypass, autoPreamp });
  const { status: audioStatus } = systemAudio;
  const sampleRate = audioStatus.sampleRate;
  const suggested = useMemo(
    () => suggestedPreamp(bands, sampleRate),
    [bands, sampleRate],
  );
  const beforeError = useMemo(
    () => deviation(measurement, target),
    [measurement, target],
  );
  const afterError = useMemo(
    () => deviation(measurement, target, bypass ? [] : bands, sampleRate),
    [measurement, target, bands, bypass, sampleRate],
  );
  const effectivePreamp = autoPreamp ? suggested : preamp;
  const safePreset: Preset = {
    id: 'session',
    name:
      presetName || (measurement.points.length ? measurement.name : '手动调音'),
    savedAt: new Date().toISOString(),
    measurement: measurement.points.length ? measurement : null,
    target,
    bands,
    preamp: effectivePreamp,
  };
  const hasMeasurement = measurement.points.length > 0;
  const hasActiveWorkbench = hasMeasurement || manualMode;
  const availableTargets = [
    ...TARGETS,
    ...customTargets.filter(
      (t) => !TARGETS.some((builtin) => builtin.id === t.id),
    ),
  ];
  const fitMinimum = hasMeasurement
    ? Math.max(20, measurement.points[0].frequency)
    : 20;
  const fitRange = hasMeasurement
    ? `${Math.round(fitMinimum)} Hz – 8 kHz`
    : '需实测';
  const availableCustom = [
    ...customMeasurements,
    ...(hasMeasurement &&
    !measurement.demo &&
    !customMeasurements.some((m) => m.id === measurement.id)
      ? [measurement]
      : []),
  ];

  useEffect(() => {
    try {
      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify({
          id: 'session',
          name: '工作草稿',
          savedAt: new Date().toISOString(),
          measurement: hasMeasurement
            ? measurement
            : manualMode
              ? null
              : measurement,
          target,
          bands,
          preamp: effectivePreamp,
          manualMode,
        }),
      );
      setStorageProblem(false);
    } catch {
      setStorageProblem(true);
    }
  }, [measurement, target, bands, effectivePreamp, manualMode]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 3600);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(
    () => () => {
      if (fitTimer.current) clearTimeout(fitTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (!modal) return;
    trigger.current = document.activeElement as HTMLElement;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focus = requestAnimationFrame(() =>
      modalPanel.current
        ?.querySelector<HTMLElement>('input:not([type="file"]), button, select')
        ?.focus(),
    );
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setModal(null);
      }
      if (event.key === 'Tab') {
        const elements = Array.from(
          modalPanel.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not([type="file"]):not(:disabled), select, textarea, a[href]',
          ) ?? [],
        );
        const first = elements[0],
          last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', listener);
    return () => {
      cancelAnimationFrame(focus);
      document.body.style.overflow = priorOverflow;
      document.removeEventListener('keydown', listener);
      trigger.current?.focus();
    };
  }, [modal]);

  const updateBand = (id: string, patch: Partial<Band>) => {
    const band = bands.find((item) => item.id === id);
    if (
      !band ||
      (Object.keys(patch) as (keyof Band)[]).every((key) =>
        Object.is(band[key], patch[key]),
      )
    )
      return;
    changeTuning({
      bands: bands.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    });
  };
  const restoreTuning = () => {
    const previous = history.past.at(-1);
    if (!previous || fitting) return;
    dispatch({ type: 'undo' });
    setSelected(previous.bands[0]?.id ?? null);
    const measured = previous.measurement.points.length > 0;
    if (hasMeasurement !== measured) {
      setVisible({
        measured,
        target: measured,
        predicted: measured,
        eq: !measured,
      });
    }
    setToast('已撤销上一步调音');
  };
  const resetTuning = () => {
    if (fitting) return;
    const defaults = initialBands();
    changeTuning({
      bands: defaults,
      preamp: 0,
      autoPreamp: true,
      bypass: false,
    });
    setSelected(defaults[0].id);
    setVisible({
      measured: hasMeasurement,
      target: hasMeasurement,
      predicted: hasMeasurement,
      eq: true,
    });
    setToast('已恢复默认 EQ：6 段，增益 0 dB');
  };
  const addGuideBand = (region: FrequencyRegion) => {
    if (bands.length >= 12 || fitting) return;
    const frequency = Math.round(Math.sqrt(region.low * region.high));
    const band = { ...newBand(frequency), q: 0.8 };
    changeTuning({ bands: [...bands, band] });
    setSelected(band.id);
    setVisible((current) => ({ ...current, eq: true }));
    setToast(
      `已添加 ${formatGuideHz(frequency)}，增益 0 dB；拖动控制点或编辑增益试听`,
    );
  };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement | null;
      if (
        modal ||
        fitting ||
        !history.past.length ||
        event.defaultPrevented ||
        !(event.metaKey || event.ctrlKey) ||
        event.shiftKey ||
        event.altKey ||
        event.key.toLowerCase() !== 'z' ||
        element?.closest('input, textarea, select, [contenteditable="true"]')
      )
        return;
      event.preventDefault();
      restoreTuning();
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  });
  const persistPresets = (next: Preset[]) => {
    try {
      localStorage.setItem(PRESETS_KEY, JSON.stringify(next));
      setPresets(next);
      return true;
    } catch {
      setToast('本地存储不可用或已满，请导出 JSON 备份。');
      return false;
    }
  };
  const load = (preset: Preset) => {
    changeTuning({
      measurement: preset.measurement ?? EMPTY_MEASUREMENT,
      manualMode: preset.measurement === null,
      target: preset.target,
      bands: preset.bands,
      preamp: preset.preamp,
      autoPreamp: false,
      bypass: false,
    });
    setVisible({
      measured: preset.measurement !== null,
      target: preset.measurement !== null,
      predicted: preset.measurement !== null,
      eq: preset.measurement === null,
    });
    if (!TARGETS.some((t) => t.id === preset.target.id)) {
      const nextTargets = [
        preset.target,
        ...customTargets.filter((t) => t.id !== preset.target.id),
      ].slice(0, 20);
      setCustomTargets((current) =>
        current.some((t) => t.id === preset.target.id)
          ? current
          : [preset.target, ...current].slice(0, 20),
      );
      try {
        localStorage.setItem(
          'tonebench.targets.v1',
          JSON.stringify(nextTargets),
        );
      } catch {
        setStorageProblem(true);
      }
    }
    setSelected(preset.bands[0]?.id ?? null);
    setModal(null);
    setToast(`已载入「${preset.name}」`);
  };
  const changeMeasurement = (next: Measurement) => {
    const reset = initialBands();
    changeTuning({
      measurement: next,
      manualMode: false,
      bands: reset,
      autoPreamp: true,
      bypass: false,
    });
    setVisible({ measured: true, target: true, predicted: true, eq: false });
    setSelected(reset[0].id);
  };
  const importFile = async (selectedFile: File) => {
    setImportError('');
    try {
      if (selectedFile.size > 1_000_000)
        throw new Error('请使用 1 MB 以内的文件。');
      const text = await selectedFile.text();
      if (/\.json$/i.test(selectedFile.name)) {
        let data: unknown;
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error('JSON 语法有误，请使用 ToneBench 导出的预设文件。');
        }
        if (!isPreset(data))
          throw new Error(
            '预设格式或参数范围不正确，请使用 ToneBench 导出的 JSON 文件。',
          );
        load({
          ...data,
          measurement: data.measurement
            ? {
                ...data.measurement,
                points: data.measurement.points.map((p) => ({
                  frequency: p.frequency,
                  db: p.db,
                })),
              }
            : null,
        });
      } else if (importKind === 'target') {
        const next = parseTarget(text, selectedFile.name);
        const targets = [
          next,
          ...customTargets.filter((t) => t.id !== next.id),
        ].slice(0, 20);
        let stored = true;
        try {
          localStorage.setItem('tonebench.targets.v1', JSON.stringify(targets));
          setCustomTargets(targets);
        } catch {
          stored = false;
        }
        changeTuning({ target: next });
        setModal(null);
        setToast(
          stored
            ? `已导入目标曲线「${next.name}」`
            : '目标曲线已载入，但无法保存到列表。',
        );
      } else {
        const next = parseMeasurement(text, selectedFile.name);
        const measurements = [
          next,
          ...customMeasurements.filter((m) => m.id !== next.id),
        ].slice(0, 20);
        let stored = true;
        try {
          localStorage.setItem(
            'tonebench.measurements.v1',
            JSON.stringify(measurements),
          );
          setCustomMeasurements(measurements);
        } catch {
          stored = false;
        }
        changeMeasurement(next);
        setModal(null);
        setToast(
          stored
            ? `已导入 ${next.points.length} 个频响点，已在 1 kHz 对齐`
            : '频响已载入，但无法保存到列表；请导出 JSON 备份。',
        );
      }
    } catch (error) {
      setImportError(
        error instanceof Error ? error.message : '导入失败，请检查文件。',
      );
      setModal('import');
    }
  };
  const runFit = () => {
    if (!hasMeasurement) return;
    setFitting(true);
    fitTimer.current = setTimeout(() => {
      try {
        const fitted = autoFit(
          measurement,
          target,
          fitCount,
          maxBoost,
          sampleRate,
        );
        changeTuning({ bands: fitted, autoPreamp: true, bypass: false });
        setSelected(fitted[0]?.id ?? null);
        setToast('EQ 已生成，可以继续微调各段参数');
      } catch {
        setToast('拟合未完成，请检查测量数据后重试。');
      } finally {
        setFitting(false);
      }
    }, 40);
  };
  const exportText =
    exportType === 'apo'
      ? equalizerApo(
          bands,
          effectivePreamp,
          hasMeasurement ? measurement.name : '手动调音',
          sampleRate,
        )
      : JSON.stringify(safePreset, null, 2);
  const title = {
    import: '导入频响曲线',
    export: '导出调音配置',
    save: '保存个人预设',
    presets: '我的预设',
    help: '关于这个工作台',
    gear: '器材档案',
  }[modal ?? 'help'];
  const chartLegendItems: { key: keyof CurveVisibility; label: string }[] =
    hasMeasurement
      ? [
          { key: 'measured', label: '原始测量' },
          { key: 'target', label: '目标曲线' },
          { key: 'predicted', label: 'EQ 后预测' },
          { key: 'eq', label: 'EQ 增益' },
        ]
      : [
          { key: 'target', label: '目标曲线' },
          { key: 'eq', label: 'EQ 增益' },
        ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          aria-label="ToneBench 首页"
          onClick={(e) => {
            e.preventDefault();
            setModal(null);
          }}
        >
          <span className="brand-mark">
            <img src="/app-icon.png" width="26" height="26" alt="" />
          </span>
          <span>
            ToneBench<span className="brand-subtitle">PERSONAL AUDIO LAB</span>
          </span>
        </a>
        <div className="nav-caption">工作空间</div>
        <nav aria-label="主导航">
          <button
            className={`nav-item ${modal !== 'presets' && modal !== 'gear' ? 'active' : ''}`}
            onClick={() => setModal(null)}
          >
            <SlidersHorizontal size={16} />
            调音工作台
            <span className="nav-indicator" />
          </button>
          <button
            className={`nav-item ${modal === 'presets' ? 'active' : ''}`}
            onClick={() => setModal('presets')}
          >
            <Bookmark size={16} />
            我的预设
            <span className="nav-count">
              {presets.length.toString().padStart(2, '0')}
            </span>
          </button>
          <button
            className={`nav-item ${modal === 'gear' ? 'active' : ''}`}
            onClick={() => setModal('gear')}
          >
            <Headphones size={16} />
            器材档案
          </button>
        </nav>
        <div className="sidebar-sessions">
          <div className="nav-caption">最近保存</div>
          {presets.length === 0 ? (
            <p className="sidebar-empty">你的调音，会留在这里。</p>
          ) : (
            presets.slice(0, 4).map((p) => (
              <button
                key={p.id}
                className="recent-preset"
                onClick={() => load(p)}
              >
                <FileText size={13} />
                <span>{p.name}</span>
              </button>
            ))
          )}
        </div>
        <div className="sidebar-bottom">
          <button className="nav-item" onClick={() => setModal('help')}>
            <CircleHelp size={16} />
            使用说明
            <ArrowUpRight size={13} className="push-right" />
          </button>
          <div className="version-line">
            <span className="status-led" />
            本地工作区<span>v0.2</span>
          </div>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <span>工作空间</span>
            <ChevronRight size={13} />
            <strong>调音工作台</strong>
          </div>
          <div className="topbar-right">
            <span
              className={`draft-status ${storageProblem ? 'warning-text' : ''}`}
            >
              <span className="status-led" />
              {storageProblem ? '草稿未保存，请导出备份' : '草稿已保存在本机'}
            </span>
            <button
              className="button save-button"
              disabled={!hasActiveWorkbench}
              onClick={() => {
                setPresetName(
                  `${hasMeasurement ? measurement.name : '手动调音'} · ${target.name}`,
                );
                setModal('save');
              }}
            >
              <Save size={14} />
              保存预设
            </button>
          </div>
        </header>
        <main>
          <section className="workspace-heading">
            <div>
              <div className="eyebrow">HEADPHONE TUNING</div>
              <h1>
                调音工作台
                <span className="heading-rule" />
              </h1>
              <p>按实测曲线或个人听感调整 EQ。</p>
            </div>
            <div className="heading-actions">
              <button
                className="button"
                onClick={() => {
                  setImportKind('measurement');
                  setImportError('');
                  setModal('import');
                }}
              >
                <Upload size={14} />
                导入实测曲线
              </button>
              <button
                className="button button-primary"
                disabled={!hasActiveWorkbench}
                onClick={() => {
                  setExportType('apo');
                  setModal('export');
                }}
              >
                <ArrowDownToLine size={14} />
                导出 EQ
              </button>
            </div>
          </section>

          <section className="source-strip" aria-label="测量来源与状态">
            <div className="source-icon">
              <Headphones size={23} strokeWidth={1.2} />
            </div>
            <div className="measurement-picker">
              <label htmlFor="measurement-select">当前测量</label>
              <div className="select-wrap">
                <select
                  id="measurement-select"
                  value={hasMeasurement ? measurement.id : ''}
                  onChange={(e) => {
                    const next = availableCustom.find(
                      (item) => item.id === e.target.value,
                    );
                    if (next) changeMeasurement(next);
                  }}
                >
                  {!hasMeasurement && (
                    <option value="" disabled>
                      尚未导入
                    </option>
                  )}
                  {availableCustom.length > 0 && (
                    <optgroup label="我的实测曲线 · 本地保存">
                      {availableCustom.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <ChevronDown size={13} />
              </div>
            </div>
            <div className="source-divider" />
            <div className="measurement-meta">
              <span>数据来源</span>
              <strong>
                {hasMeasurement
                  ? measurement.source
                  : manualMode
                    ? '手动调音 · 无实测曲线'
                    : '等待实测曲线'}
              </strong>
            </div>
            <div className="measurement-meta alignment-meta">
              <span>曲线对齐</span>
              <strong>{hasMeasurement ? '1 kHz / 0 dB' : '—'}</strong>
            </div>
            <button
              className="source-badge"
              title={measurement.note}
              onClick={() => setModal('help')}
            >
              <Info size={12} />
              {hasMeasurement ? '实测曲线' : manualMode ? '手动调音' : '未载入'}
            </button>
          </section>

          <section
            className={`audio-strip ${audioStatus.phase === 'running' ? 'audio-running' : ''}`}
            aria-label="系统音频"
          >
            <AudioLines size={18} strokeWidth={1.5} />
            <div className="audio-description">
              <strong>
                {systemAudio.native
                  ? audioStatus.phase === 'running'
                    ? bypass
                      ? '系统 EQ · 旁路'
                      : '系统 EQ · 运行中'
                    : audioStatus.phase === 'starting'
                      ? '正在开启系统 EQ'
                      : '系统 EQ · 未开启'
                  : '网页编辑器'}
              </strong>
              <span>
                {systemAudio.native
                  ? audioStatus.message ||
                    (audioStatus.phase === 'running'
                      ? `${audioStatus.outputDevice} · ${sampleRate / 1000} kHz · 旁路保留前级电平`
                      : `${audioStatus.outputDevice || '当前输出设备'} · 开启后实时处理其他应用的声音`)
                  : '在 Mac 应用中开启系统 EQ，网页用于编辑和导出。'}
              </span>
              {audioStatus.clipped > 0 && (
                <span className="warning-text">
                  检测到削波，请降低前级或开启自动余量。
                </span>
              )}
            </div>
            {systemAudio.native && (
              <button
                className="button"
                disabled={
                  audioStatus.phase !== 'running' &&
                  audioStatus.phase !== 'starting' &&
                  !hasActiveWorkbench
                }
                onClick={() =>
                  audioStatus.phase === 'running' ||
                  audioStatus.phase === 'starting'
                    ? systemAudio.stop()
                    : systemAudio.start()
                }
              >
                {audioStatus.phase === 'running' ||
                audioStatus.phase === 'starting'
                  ? '停止系统 EQ'
                  : '开启系统 EQ'}
              </button>
            )}
          </section>

          {hasActiveWorkbench ? (
            <div className="workbench-grid">
              <div className="main-column">
                <section className="panel response-panel">
                  <div className="panel-header">
                    <div className="panel-title">
                      <Activity size={15} />
                      <h2>{hasMeasurement ? '频响对比' : '调音曲线'}</h2>
                      <span className="subtle-en">FREQUENCY RESPONSE</span>
                    </div>
                    <div className="response-actions">
                      <button
                        className="button reset-tuning-button"
                        title="重置频率、增益、Q 值和前级；保留测量、目标和预设，可撤销"
                        disabled={fitting}
                        onClick={resetTuning}
                      >
                        <RotateCcw size={12} />
                        恢复默认
                      </button>
                      <button
                        className={`bypass-button ${bypass ? 'engaged' : ''}`}
                        aria-pressed={bypass}
                        onClick={() => changeTuning({ bypass: !bypass })}
                      >
                        <span className="bypass-light" />
                        {bypass
                          ? 'EQ 已旁路'
                          : audioStatus.phase === 'running'
                            ? 'EQ 已启用'
                            : 'EQ 曲线'}
                      </button>
                    </div>
                  </div>
                  <div className="chart-legend" aria-label="曲线显示">
                    {chartLegendItems.map((item) => (
                      <button
                        key={item.key}
                        className={`legend-item ${!visible[item.key] ? 'muted' : ''}`}
                        aria-pressed={visible[item.key]}
                        onClick={() =>
                          setVisible({
                            ...visible,
                            [item.key]: !visible[item.key],
                          })
                        }
                      >
                        <span className={`line-swatch ${item.key}`} />
                        {item.label}
                      </button>
                    ))}
                    <span className="chart-scale">20 Hz — 20 kHz</span>
                  </div>
                  <details className="curve-guide">
                    <summary>
                      <CircleHelp size={12} />
                      曲线说明
                    </summary>
                    <dl>
                      <div>
                        <dt>实测曲线</dt>
                        <dd>耳机测出来的频响，作为调音前的参考。</dd>
                      </div>
                      <div>
                        <dt>目标曲线</dt>
                        <dd>希望接近的参考频响，用于自动拟合。</dd>
                      </div>
                      <div>
                        <dt>EQ 后预测</dt>
                        <dd>实测曲线加上 EQ 调整量后，计算出的频响。</dd>
                      </div>
                      <div>
                        <dt>EQ 增益</dt>
                        <dd>各频率提升或衰减的量，0 dB 表示不调整。</dd>
                      </div>
                    </dl>
                    {!hasMeasurement && (
                      <p>尚未导入实测曲线，图上没有耳机当前的频响。</p>
                    )}
                  </details>
                  <FrequencyGuide
                    open={guideOpen}
                    instrumentId={guideInstrumentId}
                    regionId={guideRegionId}
                    canAdd={bands.length < 12 && !fitting}
                    onToggle={() => setGuideOpen(!guideOpen)}
                    onInstrument={(id) => {
                      setGuideInstrumentId(id);
                      setGuideRegionId(
                        INSTRUMENTS.find((item) => item.id === id)!.regions[0]
                          .id,
                      );
                    }}
                    onRegion={setGuideRegionId}
                    onAdd={addGuideBand}
                  />
                  <FrequencyChart
                    measurement={measurement}
                    target={target}
                    bands={bands}
                    sampleRate={sampleRate}
                    bypass={bypass}
                    visible={visible}
                    selected={selected}
                    onSelect={setSelected}
                    onChange={updateBand}
                    onEditStart={() => dispatch({ type: 'begin' })}
                    onEditEnd={() => dispatch({ type: 'end' })}
                    reference={
                      guideOpen
                        ? {
                            low: guideRegion.low,
                            high: guideRegion.high,
                            label: `${guideInstrument.name} · ${guideRegion.name}`,
                          }
                        : null
                    }
                  />
                  <div className="chart-footer">
                    <span>
                      <Info size={12} />
                      {hasMeasurement
                        ? 'EQ 后曲线为计算预测，未包含前级整体衰减'
                        : 'EQ 增益：0 dB 表示不调整；目标曲线可按需显示'}
                    </span>
                    <span>对数频率 · {sampleRate / 1000} kHz</span>
                  </div>
                </section>

                <SpectrumPanel
                  native={systemAudio.native}
                  phase={audioStatus.phase}
                />

                <section className="panel eq-panel">
                  <div className="panel-header">
                    <div className="panel-title">
                      <SlidersHorizontal size={15} />
                      <h2>参数均衡器</h2>
                      <span className="small-count">
                        {bands.filter((b) => b.enabled).length} / {bands.length}{' '}
                        段
                      </span>
                    </div>
                    <div className="eq-actions">
                      <button
                        className="text-button restore-button"
                        title="撤销上一步调音（⌘Z / Ctrl+Z）"
                        disabled={!history.past.length || fitting}
                        onClick={restoreTuning}
                      >
                        <Undo2 size={12} />
                        撤销
                      </button>
                      <button
                        className="text-button"
                        title="将所有滤波器增益设为 0 dB"
                        disabled={
                          bands.every((band) => band.gain === 0) || fitting
                        }
                        onClick={() => {
                          changeTuning({
                            bands: bands.map((b) => ({ ...b, gain: 0 })),
                          });
                          setToast('各段增益已归零');
                        }}
                      >
                        <RotateCcw size={12} />
                        归零
                      </button>
                      <button
                        className="text-button"
                        disabled={bands.length >= 12}
                        onClick={() => {
                          const band = newBand();
                          changeTuning({ bands: [...bands, band] });
                          setSelected(band.id);
                        }}
                      >
                        <Plus size={13} />
                        添加滤波器
                      </button>
                    </div>
                  </div>
                  <div className="eq-table-wrap">
                    <table className="eq-table">
                      <thead>
                        <tr>
                          <th className="band-column">启用</th>
                          <th>类型</th>
                          <th>
                            频率 <span>Hz</span>
                          </th>
                          <th>
                            增益 <span>dB</span>
                          </th>
                          <th>Q 值</th>
                          <th className="delete-column">
                            <span className="sr-only">删除</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {bands.map((band, index) => (
                          <tr
                            key={band.id}
                            className={`${selected === band.id ? 'selected-row' : ''} ${!band.enabled ? 'disabled-row' : ''}`}
                            onFocus={() => setSelected(band.id)}
                          >
                            <td>
                              <label className="band-enable">
                                <input
                                  type="checkbox"
                                  aria-label={`启用滤波器 ${index + 1}`}
                                  checked={band.enabled}
                                  onChange={(e) =>
                                    updateBand(band.id, {
                                      enabled: e.target.checked,
                                    })
                                  }
                                />
                                <span>
                                  {String(index + 1).padStart(2, '0')}
                                </span>
                              </label>
                            </td>
                            <td>
                              <select
                                aria-label={`滤波器 ${index + 1} 类型`}
                                value={band.kind}
                                onChange={(e) =>
                                  updateBand(band.id, {
                                    kind: e.target.value as Band['kind'],
                                  })
                                }
                              >
                                <option value="PK">Peaking</option>
                                <option value="LSC">Low shelf</option>
                                <option value="HSC">High shelf</option>
                              </select>
                            </td>
                            <td>
                              <NumericInput
                                label={`滤波器 ${index + 1} 频率`}
                                value={band.frequency}
                                min={20}
                                max={20000}
                                onChange={(value) =>
                                  updateBand(band.id, { frequency: value })
                                }
                              />
                            </td>
                            <td>
                              <NumericInput
                                label={`滤波器 ${index + 1} 增益`}
                                value={band.gain}
                                min={-18}
                                max={12}
                                step={0.1}
                                onChange={(value) =>
                                  updateBand(band.id, { gain: value })
                                }
                              />
                            </td>
                            <td>
                              <NumericInput
                                label={`滤波器 ${index + 1} Q 值`}
                                value={band.q}
                                min={0.25}
                                max={10}
                                step={0.01}
                                onChange={(value) =>
                                  updateBand(band.id, { q: value })
                                }
                              />
                            </td>
                            <td>
                              <button
                                className="icon-button delete-band"
                                aria-label={`删除滤波器 ${index + 1}`}
                                onClick={() =>
                                  changeTuning({
                                    bands: bands.filter(
                                      (b) => b.id !== band.id,
                                    ),
                                  })
                                }
                              >
                                <X size={13} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {bands.length === 0 && (
                      <div className="empty-table">
                        还没有滤波器。添加一段，或自动生成 EQ。
                      </div>
                    )}
                  </div>
                  <div className="table-footnote">
                    <span>PK 峰值 · LSC 低架 · HSC 高架</span>
                    <button
                      className="text-button"
                      onClick={() =>
                        setVisible({ ...visible, eq: !visible.eq })
                      }
                    >
                      {visible.eq ? '隐藏' : '显示'}图上控制点
                      <ArrowUpRight size={12} />
                    </button>
                  </div>
                </section>
              </div>

              <aside className="tuning-column" aria-label="调音设置">
                <section className="panel tuning-panel">
                  <div className="panel-header">
                    <div className="panel-title">
                      <Settings2 size={15} />
                      <h2>调音设置</h2>
                    </div>
                    <span className="tiny-label">01</span>
                  </div>
                  <div className="tuning-content">
                    <label className="field-label" htmlFor="target-select">
                      目标曲线
                    </label>
                    <div className="select-wrap target-picker">
                      <select
                        id="target-select"
                        value={target.id}
                        disabled={fitting}
                        onChange={(e) => {
                          const next = availableTargets.find(
                            (item) => item.id === e.target.value,
                          );
                          if (next) changeTuning({ target: next });
                        }}
                      >
                        {availableTargets.map((t) => (
                          <option value={t.id} key={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={13} />
                    </div>
                    <p className="field-description">{target.description}</p>
                    <p className="target-source">{target.source}</p>
                    <button
                      className="text-button target-import-button"
                      onClick={() => {
                        setImportKind('target');
                        setImportError('');
                        setModal('import');
                      }}
                    >
                      <Upload size={13} />
                      导入目标曲线
                    </button>
                    <div className="section-divider" />
                    <div className="control-heading">
                      <span>自动拟合</span>
                      <span className="tiny-label">PARAMETRIC EQ</span>
                    </div>
                    <div className="setting-row">
                      <label htmlFor="band-count">滤波器数量</label>
                      <select
                        id="band-count"
                        value={fitCount}
                        disabled={fitting}
                        onChange={(e) => setFitCount(Number(e.target.value))}
                      >
                        {[4, 6, 8, 10].map((n) => (
                          <option key={n} value={n}>
                            {n} 段
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="setting-row">
                      <label htmlFor="max-boost">单段最大提升</label>
                      <select
                        id="max-boost"
                        value={maxBoost}
                        disabled={fitting}
                        onChange={(e) => setMaxBoost(Number(e.target.value))}
                      >
                        {[0, 3, 6].map((n) => (
                          <option key={n} value={n}>
                            +{n} dB
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="setting-row">
                      <span>拟合范围</span>
                      <strong>{fitRange}</strong>
                    </div>
                    <button
                      className="button autoeq-button"
                      onClick={runFit}
                      disabled={fitting || !hasMeasurement}
                    >
                      {fitting ? (
                        <LoaderCircle size={15} className="spin" />
                      ) : (
                        <SlidersHorizontal size={14} />
                      )}
                      {fitting ? '正在拟合…' : '自动生成 EQ'}
                    </button>
                    <p className="quiet-note">
                      {hasMeasurement
                        ? '拟合结果可继续手动调整参数。'
                        : '导入实测曲线后可自动拟合。'}
                    </p>
                  </div>
                </section>
                <section className="panel output-panel">
                  <div className="panel-header">
                    <div className="panel-title">
                      <Cpu size={15} />
                      <h2>输出余量</h2>
                    </div>
                    <span className="tiny-label">02</span>
                  </div>
                  <div className="tuning-content">
                    <div className="preamp-reading">
                      <div>
                        <span className="field-label">前级增益</span>
                        <div className="preamp-number">
                          {effectivePreamp.toFixed(1)}
                          <span>dB</span>
                        </div>
                      </div>
                      <div className="headroom-meter" aria-hidden="true">
                        {Array.from({ length: 13 }, (_, i) => (
                          <i
                            key={i}
                            className={
                              i <
                              Math.min(
                                12,
                                Math.ceil(Math.abs(effectivePreamp) * 1.2),
                              )
                                ? 'lit'
                                : ''
                            }
                          />
                        ))}
                      </div>
                    </div>
                    <label className="auto-preamp">
                      <input
                        type="checkbox"
                        checked={autoPreamp}
                        onChange={(e) => {
                          changeTuning({
                            autoPreamp: e.target.checked,
                            ...(!e.target.checked ? { preamp: suggested } : {}),
                          });
                        }}
                      />
                      <span>自动保留余量</span>
                    </label>
                    {!autoPreamp && (
                      <div className="manual-preamp">
                        <NumericInput
                          label="前级增益"
                          value={preamp}
                          min={-180}
                          max={0}
                          step={0.1}
                          suffix="dB"
                          onChange={(value) => changeTuning({ preamp: value })}
                        />
                      </div>
                    )}
                    <p
                      className={
                        effectivePreamp > suggested + 0.05
                          ? 'warning-text preamp-note'
                          : 'preamp-note'
                      }
                    >
                      {effectivePreamp > suggested + 0.05
                        ? `可能削波，建议降至 ${suggested.toFixed(1)} dB。`
                        : '按 EQ 最大提升预留 0.5 dB 余量。'}
                    </p>
                  </div>
                </section>
                <section className="fit-summary">
                  {hasMeasurement ? (
                    <>
                      <div className="fit-summary-header">
                        与目标的平均偏差<span>RMS</span>
                      </div>
                      <div className="deviation-values">
                        <div>
                          <span>调整前</span>
                          <strong>
                            {beforeError.toFixed(2)}
                            <small>dB</small>
                          </strong>
                        </div>
                        <ArrowLeft size={16} className="deviation-arrow" />
                        <div>
                          <span>调整后{bypass ? ' · 旁路' : ''}</span>
                          <strong className="after-value">
                            {afterError.toFixed(2)}
                            <small>dB</small>
                          </strong>
                        </div>
                      </div>
                      <p>
                        {fitRange}，等对数频率加权。
                        <br />
                        偏差仅反映曲线距离，不代表听感评分。
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="fit-summary-header">手动模式</div>
                      <p>导入实测曲线可查看频响预测，并使用自动拟合。</p>
                    </>
                  )}
                </section>
              </aside>
            </div>
          ) : (
            <section className="empty-workbench" aria-label="开始调音">
              <div className="empty-workbench-copy">
                <Headphones size={26} strokeWidth={1.2} />
                <h2>开始调音</h2>
                <p>
                  导入实测曲线与目标曲线，自动生成 EQ；也可直接按听感手动调音。
                </p>
                <div className="empty-workbench-actions">
                  <button
                    className="button button-primary"
                    onClick={() => {
                      setImportKind('measurement');
                      setImportError('');
                      setModal('import');
                    }}
                  >
                    <Upload size={14} />
                    导入实测曲线
                  </button>
                  <button
                    className="button"
                    onClick={() => {
                      const initial = initialBands();
                      dispatch({
                        type: 'reset',
                        current: {
                          ...history.current,
                          manualMode: true,
                          bands: initial,
                        },
                      });
                      setSelected(initial[0]?.id ?? null);
                      setVisible({
                        measured: false,
                        target: false,
                        predicted: false,
                        eq: true,
                      });
                    }}
                  >
                    <SlidersHorizontal size={14} />
                    直接手动调音
                  </button>
                  <a
                    href="https://squig.link/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    浏览公开测量库 <ArrowUpRight size={13} />
                  </a>
                </div>
                <small>支持保存预设与导出 EQ 配置。</small>
              </div>
            </section>
          )}
          <footer className="workspace-footer">
            <span className="footer-wordmark">TONEBENCH</span>
            <span>听感由你决定，曲线提供参考。</span>
            <a
              href="https://github.com/Cass-ette/tonebench"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
              <ArrowUpRight size={12} />
            </a>
          </footer>
        </main>
      </div>

      {toast && (
        <div className="toast" role="status">
          <Check size={15} />
          {toast}
          <button
            className="icon-button"
            aria-label="关闭提示"
            onClick={() => setToast('')}
          >
            <X size={13} />
          </button>
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <div
            className={`modal ${modal === 'export' ? 'export-modal' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            ref={modalPanel}
          >
            <div className="modal-header">
              <h2 id="dialog-title">{title}</h2>
              <button
                className="icon-button"
                aria-label="关闭对话框"
                onClick={() => setModal(null)}
              >
                <X size={18} />
              </button>
            </div>
            {modal === 'import' && (
              <div className="modal-body">
                <p className="modal-description">
                  导入实测曲线、目标曲线或 EQ 预设。数据保存在本机。
                </p>
                <div className="segmented-control import-kind-control">
                  <button
                    className={importKind === 'measurement' ? 'active' : ''}
                    onClick={() => {
                      setImportKind('measurement');
                      setImportError('');
                    }}
                  >
                    耳机实测
                  </button>
                  <button
                    className={importKind === 'target' ? 'active' : ''}
                    onClick={() => {
                      setImportKind('target');
                      setImportError('');
                    }}
                  >
                    目标曲线
                  </button>
                </div>
                <button
                  className="import-dropzone"
                  onClick={() => file.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const dropped = e.dataTransfer.files[0];
                    if (dropped) void importFile(dropped);
                  }}
                >
                  <Upload size={26} strokeWidth={1.2} />
                  <strong>
                    {importKind === 'measurement'
                      ? '选择实测文件，或拖到这里'
                      : '选择目标文件，或拖到这里'}
                  </strong>
                  <span>CSV / TXT / TSV · 频率 Hz 与声压 dB · 最大 1 MB</span>
                </button>
                <input
                  ref={file}
                  type="file"
                  accept=".csv,.txt,.tsv,.json"
                  className="sr-only"
                  aria-label="选择频响曲线或预设文件"
                  onChange={(e) => {
                    const picked = e.target.files?.[0];
                    if (picked) void importFile(picked);
                    e.target.value = '';
                  }}
                />
                {importError && (
                  <p className="import-error" role="alert">
                    {importError}
                  </p>
                )}
                <div className="format-help">
                  <h3>
                    {importKind === 'measurement'
                      ? '耳机实测格式'
                      : '目标曲线格式'}
                  </h3>
                  <p>
                    前两列为频率（Hz）与声压（dB），支持逗号、制表符或空格分隔。至少
                    8 个点，覆盖 100–8,000 Hz。
                  </p>
                  <pre>
                    frequency,db{'\n'}20,73.2{'\n'}25,74.1{'\n'}…
                  </pre>
                  <p>
                    导入后按 1 kHz 对齐到 0
                    dB。测量曲线受夹具、佩戴深度和密封影响；尽量使用与目标曲线相容的测量条件。
                  </p>
                  {importKind === 'measurement' && (
                    <p>导入新测量会重置当前 EQ。</p>
                  )}
                  <a
                    href="https://squig.link/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    打开 Squiglink 测量库 <ArrowUpRight size={13} />
                  </a>
                </div>
              </div>
            )}
            {modal === 'save' && (
              <form
                className="modal-body"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = presetName.trim();
                  if (!name) return;
                  const preset = {
                    ...safePreset,
                    id: uniqueId(),
                    name,
                  };
                  if (persistPresets([preset, ...presets])) {
                    setModal(null);
                    setToast(`已保存「${name}」`);
                  }
                }}
              >
                <label className="field-label" htmlFor="preset-name">
                  预设名称
                </label>
                <input
                  id="preset-name"
                  className="full-input"
                  required
                  maxLength={80}
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                />
                <p className="modal-description">
                  {hasMeasurement
                    ? '包含耳机实测曲线、'
                    : '不含耳机实测曲线；包含'}
                  目标曲线、滤波器与前级增益。预设保存在当前浏览器中，可导出
                  JSON 备份。
                </p>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="button"
                    onClick={() => setModal(null)}
                  >
                    取消
                  </button>
                  <button className="button button-primary" type="submit">
                    <Save size={14} />
                    保存预设
                  </button>
                </div>
              </form>
            )}
            {modal === 'export' && (
              <div className="modal-body">
                <div className="segmented-control">
                  <button
                    className={exportType === 'apo' ? 'active' : ''}
                    onClick={() => setExportType('apo')}
                  >
                    Equalizer APO / Peace
                  </button>
                  <button
                    className={exportType === 'json' ? 'active' : ''}
                    onClick={() => setExportType('json')}
                  >
                    ToneBench JSON
                  </button>
                </div>
                <p className="modal-description">
                  {exportType === 'apo'
                    ? `可导入 Equalizer APO / Peace。当前图表按 ${sampleRate / 1000} kHz 计算。`
                    : '包含目标曲线与调音参数，可再次导入 ToneBench。'}
                </p>
                {bypass && (
                  <p className="import-error">
                    当前图表已旁路；导出仍包含已启用的 EQ 滤波器。
                  </p>
                )}
                <pre className="export-preview">{exportText}</pre>
                <div className="modal-actions">
                  <button
                    className="button"
                    onClick={async () => {
                      try {
                        if (
                          !nativeMessage({
                            action: 'copy',
                            contents: exportText,
                          })
                        )
                          await navigator.clipboard.writeText(exportText);
                        setToast('配置已复制');
                      } catch {
                        setToast('复制不可用，请下载配置文件。');
                      }
                    }}
                  >
                    复制配置
                  </button>
                  <button
                    className="button button-primary"
                    onClick={() => {
                      download(
                        `${safeFilename(hasMeasurement ? measurement.name : 'manual-eq')}.${exportType === 'apo' ? 'txt' : 'json'}`,
                        exportText,
                        exportType === 'apo'
                          ? 'text/plain'
                          : 'application/json',
                      );
                      setToast('配置文件已导出');
                    }}
                  >
                    <ArrowDownToLine size={14} />
                    下载文件
                  </button>
                </div>
              </div>
            )}
            {modal === 'presets' && (
              <div className="modal-body">
                {presets.length === 0 ? (
                  <div className="empty-state">
                    <FolderOpen size={30} strokeWidth={1} />
                    <h3>还没有保存的预设</h3>
                    <p>调整满意后，点击工作台右上角的“保存预设”。</p>
                    <button className="button" onClick={() => setModal(null)}>
                      回到工作台
                    </button>
                  </div>
                ) : (
                  <div className="preset-list">
                    {presets.map((p) => (
                      <div className="preset-item" key={p.id}>
                        <button
                          className="preset-details"
                          onClick={() => load(p)}
                        >
                          <Bookmark size={17} strokeWidth={1.3} />
                          <span>
                            <strong>{p.name}</strong>
                            <small>
                              {p.bands.filter((b) => b.enabled).length} 段 EQ ·{' '}
                              {new Date(p.savedAt).toLocaleDateString('zh-CN')}
                            </small>
                          </span>
                          <ChevronRight size={15} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`删除预设 ${p.name}`}
                          onClick={() => {
                            if (
                              persistPresets(
                                presets.filter((other) => other.id !== p.id),
                              )
                            )
                              setToast('预设已删除');
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {modal === 'gear' && (
              <div className="modal-body">
                <p className="modal-description">
                  记录器材、搭配与听感笔记，保存在本机。
                </p>
                <form
                  className="gear-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!gearName.trim()) return;
                    const next = [
                      {
                        id: uniqueId(),
                        name: gearName.trim(),
                        type: gearType,
                        note: gearNote.trim(),
                      },
                      ...gears,
                    ];
                    try {
                      localStorage.setItem(GEAR_KEY, JSON.stringify(next));
                      setGears(next);
                      setGearName('');
                      setGearNote('');
                    } catch {
                      setToast('器材记录保存失败，本地存储可能已满。');
                    }
                  }}
                >
                  <label className="sr-only" htmlFor="gear-name">
                    器材名称
                  </label>
                  <input
                    className="full-input"
                    id="gear-name"
                    placeholder="器材名称"
                    required
                    maxLength={80}
                    value={gearName}
                    onChange={(e) => setGearName(e.target.value)}
                  />
                  <select
                    aria-label="器材类型"
                    value={gearType}
                    onChange={(e) => setGearType(e.target.value)}
                  >
                    <option>DAC / 耳放</option>
                    <option>耳机</option>
                    <option>其他器材</option>
                  </select>
                  <textarea
                    className="full-input"
                    aria-label="搭配笔记"
                    placeholder="搭配、设置或听感笔记（可选）"
                    maxLength={2000}
                    value={gearNote}
                    onChange={(e) => setGearNote(e.target.value)}
                  />
                  <button className="button" type="submit">
                    <Plus size={14} />
                    添加器材
                  </button>
                </form>
                <div className="gear-list">
                  {gears.length === 0 ? (
                    <p className="empty-caption">还没有器材记录。</p>
                  ) : (
                    gears.map((g) => (
                      <div className="gear-item" key={g.id}>
                        <Headphones size={18} />
                        <div>
                          <strong>{g.name}</strong>
                          <small>{g.type}</small>
                          {g.note && <p>{g.note}</p>}
                        </div>
                        <button
                          className="icon-button"
                          aria-label={`删除器材 ${g.name}`}
                          onClick={() => {
                            const next = gears.filter(
                              (other) => other.id !== g.id,
                            );
                            try {
                              localStorage.setItem(
                                GEAR_KEY,
                                JSON.stringify(next),
                              );
                              setGears(next);
                            } catch {
                              setToast('删除未保存，请重试。');
                            }
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
            {modal === 'help' && (
              <div className="modal-body help-content">
                <div className="help-intro">
                  <AudioLines size={25} strokeWidth={1.2} />
                  <div>
                    <strong>ToneBench</strong>
                    <span>个人耳机调音工作台 · v0.2</span>
                  </div>
                </div>
                <h3>开始调音</h3>
                <p>
                  直接创建
                  EQ，按听感调整；也可以导入实测曲线和目标曲线，自动生成 EQ
                  后继续微调。
                </p>
                <h3>测量与目标</h3>
                <p>
                  实测曲线是耳机测出来的频响；目标曲线是调音时参考的频响。EQ
                  后预测是实测加上 EQ 调整量后的计算结果。
                </p>
                <p>
                  没有实测曲线时，可直接手动调音。此时 EQ
                  增益曲线只显示各频率提升或衰减的量。
                </p>
                <p>
                  比较曲线时，请留意测量条件。不同夹具、佩戴和密封会影响结果，最终以试听为准。
                </p>
                <h3>参数调整</h3>
                <p>
                  打开“频段参考”，选择人声或乐器和听感区域，可在图上查看常见调音范围。“添加此频段”会创建一段
                  0 dB
                  的滤波器，再按听感调整。它不会分离乐器，同一频段的其他声音也会受到影响。
                </p>
                <p>
                  调整频率、增益与 Q 值，按 Enter 或移开焦点生效。打开“EQ
                  增益”后可拖动图上的控制点。
                </p>
                <p>
                  曲线右上角的“恢复默认”将频率、增益、Q
                  值和前级恢复为初始设置，保留测量、目标和预设。“归零”只将各段增益设为
                  0 dB。
                </p>
                <p>
                  “撤销”可退回上一步操作，也可撤销恢复默认。撤销记录保留到本次使用结束。
                </p>
                <h3>音频与频谱</h3>
                <p>
                  {isNative()
                    ? '开启系统 EQ 后，调音会应用到当前输出设备。实时频谱可查看 EQ 前后的频段电平。旁路保留前级衰减，停止系统 EQ 后恢复直出。'
                    : '网页可编辑和导出 EQ。使用 Mac 应用可开启系统 EQ，实时处理其他应用的声音并查看频谱。'}
                </p>
                <h3>保存与导出</h3>
                <p>将调音设置保存为预设，或导出配置文件供其他软件使用。</p>
                <p>
                  草稿、测量、预设和器材记录保存在本机，不会上传。清除应用或浏览器数据会删除本地记录，请用
                  JSON 导出备份。
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
