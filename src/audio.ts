import { HARMAN_IN_EAR_2019_RAW } from './harmanInEar2019';
import { uniqueId } from './identity';

export type Point = { frequency: number; db: number };
export type FilterKind = 'PK' | 'LSC' | 'HSC';
export type Band = {
  id: string;
  enabled: boolean;
  kind: FilterKind;
  frequency: number;
  gain: number;
  q: number;
};
export type Measurement = {
  id: string;
  name: string;
  source: string;
  note: string;
  demo: boolean;
  points: Point[];
};
export type Target = {
  id: string;
  name: string;
  description: string;
  source: string;
  note: string;
  points: Point[];
};
export type Preset = {
  id: string;
  name: string;
  savedAt: string;
  measurement: Measurement | null;
  target: Target;
  bands: Band[];
  preamp: number;
};
export const SAMPLE_RATE = 48000;
export const FREQUENCIES = Array.from(
  { length: 241 },
  (_, i) => 20 * 1000 ** (i / 240),
);
export const TARGETS: Target[] = [
  {
    id: 'harman-in-ear-2019',
    name: 'Harman In-Ear 2019',
    description: 'Harman 入耳式偏好目标曲线；个体听感与佩戴仍有差异。',
    source:
      'AutoEq · jaakkopasanen/AutoEq · 7ae0f56d53074872b028649617a22bbb4232feb7',
    note: 'Harman 发布的入耳式偏好目标曲线，经 AutoEq 项目分发。',
    points: normalize(
      HARMAN_IN_EAR_2019_RAW.map(([frequency, db]) => ({ frequency, db })),
    ),
  },
];
export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function interpolate(points: Point[], frequency: number): number {
  if (!points.length) return 0;
  if (frequency <= points[0].frequency) return points[0].db;
  if (frequency >= points.at(-1)!.frequency) return points.at(-1)!.db;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (points[mid].frequency <= frequency) lo = mid;
    else hi = mid;
  }
  const ratio =
    Math.log(frequency / points[lo].frequency) /
    Math.log(points[hi].frequency / points[lo].frequency);
  return points[lo].db + ratio * (points[hi].db - points[lo].db);
}

export function normalize(points: Point[]): Point[] {
  const offset = interpolate(points, 1000);
  return points.map((point) => ({ ...point, db: point.db - offset }));
}

export function targetAt(frequency: number, target: Target) {
  return interpolate(target.points, frequency);
}

export function newBand(frequency = 1000): Band {
  return {
    id: uniqueId(),
    enabled: true,
    kind: 'PK',
    frequency,
    gain: 0,
    q: 1,
  };
}

export function initialBands(): Band[] {
  return [60, 150, 400, 1000, 2400, 5500].map((f) => newBand(f));
}

// Same RBJ formulas as the native engine, evaluated at the device sample rate.
export function coefficients(
  band: Band,
  sampleRate = SAMPLE_RATE,
): { b: number[]; a: number[] } {
  const w =
    (2 * Math.PI * Math.min(band.frequency, sampleRate * 0.499)) / sampleRate;
  const cos = Math.cos(w);
  const sin = Math.sin(w);
  const A = 10 ** (band.gain / 40);
  const alpha = sin / (2 * band.q);
  const beta = 2 * Math.sqrt(A) * alpha;
  let b: number[];
  let a: number[];
  if (band.kind === 'LSC') {
    b = [
      A * (A + 1 - (A - 1) * cos + beta),
      2 * A * (A - 1 - (A + 1) * cos),
      A * (A + 1 - (A - 1) * cos - beta),
    ];
    a = [
      A + 1 + (A - 1) * cos + beta,
      -2 * (A - 1 + (A + 1) * cos),
      A + 1 + (A - 1) * cos - beta,
    ];
  } else if (band.kind === 'HSC') {
    b = [
      A * (A + 1 + (A - 1) * cos + beta),
      -2 * A * (A - 1 + (A + 1) * cos),
      A * (A + 1 + (A - 1) * cos - beta),
    ];
    a = [
      A + 1 - (A - 1) * cos + beta,
      2 * (A - 1 - (A + 1) * cos),
      A + 1 - (A - 1) * cos - beta,
    ];
  } else {
    b = [1 + alpha * A, -2 * cos, 1 - alpha * A];
    a = [1 + alpha / A, -2 * cos, 1 - alpha / A];
  }
  return {
    b: b.map((value) => value / a[0]),
    a: a.map((value) => value / a[0]),
  };
}

export function responseFromCoefficients(
  filter: ReturnType<typeof coefficients>,
  frequency: number,
  sampleRate = SAMPLE_RATE,
): number {
  const w = (2 * Math.PI * frequency) / sampleRate;
  const squaredMagnitude = (c: number[]) =>
    (c[0] + c[1] * Math.cos(w) + c[2] * Math.cos(2 * w)) ** 2 +
    (c[1] * Math.sin(w) + c[2] * Math.sin(2 * w)) ** 2;
  return (
    10 *
    Math.log10(
      Math.max(1e-20, squaredMagnitude(filter.b)) /
        Math.max(1e-20, squaredMagnitude(filter.a)),
    )
  );
}

export function bandResponse(
  band: Band,
  frequency: number,
  sampleRate = SAMPLE_RATE,
): number {
  return band.enabled
    ? responseFromCoefficients(
        coefficients(band, sampleRate),
        frequency,
        sampleRate,
      )
    : 0;
}

export function eqResponse(
  bands: Band[],
  frequency: number,
  sampleRate = SAMPLE_RATE,
): number {
  return bands.reduce(
    (sum, band) => sum + bandResponse(band, frequency, sampleRate),
    0,
  );
}

export function responseCurve(
  bands: Band[],
  sampleRate = SAMPLE_RATE,
): Point[] {
  const filters = bands
    .filter((b) => b.enabled)
    .map((b) => coefficients(b, sampleRate));
  return FREQUENCIES.map((frequency) => ({
    frequency,
    db: filters.reduce(
      (sum, filter) =>
        sum + responseFromCoefficients(filter, frequency, sampleRate),
      0,
    ),
  }));
}

export function suggestedPreamp(
  bands: Band[],
  sampleRate = SAMPLE_RATE,
): number {
  // Dense sampling also covers high-Q peaks between the displayed chart points.
  const filters = bands
    .filter((b) => b.enabled)
    .map((b) => coefficients(b, sampleRate));
  let maximum = 0;
  const samples = [
    ...Array.from(
      { length: 1601 },
      (_, i) => 20 * ((sampleRate * 0.499) / 20) ** (i / 1600),
    ),
    ...bands
      .filter((b) => b.enabled)
      .map((b) => Math.min(b.frequency, sampleRate * 0.499)),
  ];
  for (const f of samples)
    maximum = Math.max(
      maximum,
      filters.reduce(
        (sum, c) => sum + responseFromCoefficients(c, f, sampleRate),
        0,
      ),
    );
  if (maximum < 1e-7) return 0;
  return -Math.ceil((maximum + 0.5) * 10 - 1e-8) / 10;
}

export function deviation(
  measurement: Measurement,
  target: Target,
  bands: Band[] = [],
  sampleRate = SAMPLE_RATE,
): number {
  if (measurement.points.length === 0) return 0;
  const grid = FREQUENCIES.filter(
    (f) =>
      f >= Math.max(20, measurement.points[0].frequency) &&
      f <= Math.min(8000, measurement.points.at(-1)!.frequency),
  );
  return Math.sqrt(
    grid.reduce(
      (sum, f) =>
        sum +
        (interpolate(measurement.points, f) +
          eqResponse(bands, f, sampleRate) -
          targetAt(f, target)) **
          2,
      0,
    ) / grid.length,
  );
}

export function autoFit(
  measurement: Measurement,
  target: Target,
  count: number,
  maxBoost: number,
  sampleRate = SAMPLE_RATE,
): Band[] {
  if (measurement.points.length === 0)
    throw new Error('请先导入耳机实测曲线。');
  const grid = FREQUENCIES.filter(
    (f) =>
      f >= Math.max(20, measurement.points[0].frequency) &&
      f <= Math.min(8000, measurement.points.at(-1)!.frequency),
  );
  const wanted = grid.map(
    (f) => targetAt(f, target) - interpolate(measurement.points, f),
  );
  const bands = Array.from({ length: count }, (_, i) =>
    newBand(Math.round(45 * (6500 / 45) ** (i / Math.max(1, count - 1)))),
  );
  let responses = bands.map(() => grid.map(() => 0));
  let total = grid.map(() => 0);
  // Bounded coordinate descent with broad-to-fine frequency, gain, and Q search.
  for (let pass = 0; pass < 9; pass++) {
    const shrink = pass < 3 ? 1 : pass < 6 ? 0.45 : 0.18;
    for (let index = 0; index < bands.length; index++) {
      const base = total.map((value, j) => value - responses[index][j]);
      const evaluate = (candidate: Band) => {
        const c = coefficients(candidate, sampleRate);
        const response = grid.map((f) =>
          responseFromCoefficients(c, f, sampleRate),
        );
        const cost =
          response.reduce(
            (sum, value, j) => sum + (base[j] + value - wanted[j]) ** 2,
            0,
          ) /
            grid.length +
          0.0015 * candidate.gain ** 2 +
          0.003 * candidate.q ** 2;
        return { candidate, response, cost };
      };
      let best = evaluate(bands[index]);
      for (const key of ['gain', 'frequency', 'q'] as const) {
        const current = best.candidate;
        for (const delta of [-2, -1, 1, 2]) {
          const candidate = { ...current };
          if (key === 'gain')
            candidate.gain = clamp(
              current.gain + delta * shrink,
              -12,
              maxBoost,
            );
          if (key === 'frequency')
            candidate.frequency = clamp(
              current.frequency * 2 ** (delta * 0.28 * shrink),
              25,
              7500,
            );
          if (key === 'q')
            candidate.q = clamp(
              current.q * 2 ** (delta * 0.32 * shrink),
              0.35,
              4,
            );
          const result = evaluate(candidate);
          if (result.cost < best.cost) best = result;
        }
      }
      bands[index] = best.candidate;
      responses[index] = best.response;
      total = base.map((value, j) => value + best.response[j]);
    }
  }
  return bands
    .map((b) => ({
      ...b,
      frequency: Math.round(b.frequency),
      gain: Math.round(b.gain * 10) / 10,
      q: Math.round(b.q * 100) / 100,
    }))
    .sort((a, b) => a.frequency - b.frequency);
}

export function parseMeasurement(text: string, filename: string): Measurement {
  if (text.length > 1_000_000)
    throw new Error('文件过大，请使用 1 MB 以内的频响数据。');
  const points: Point[] = [];
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line || /^(#|\*|\/\/)/.test(line)) continue;
    const columns = line
      .split(/[,;\t ]+/)
      .map((value) => value.replace(/^"|"$/g, ''));
    if (points.length === 0 && /^[a-zA-Z\u4e00-\u9fff]/.test(columns[0]))
      continue;
    const frequency = Number(columns[0]);
    const db = Number(columns[1]);
    if (
      columns.length < 2 ||
      !Number.isFinite(frequency) ||
      !Number.isFinite(db) ||
      !columns[0] ||
      !columns[1]
    )
      throw new Error(
        `第 ${index + 1} 行无法读取。前两列应为频率（Hz）和声压（dB）。`,
      );
    if (frequency <= 0 || frequency > 96000 || Math.abs(db) > 300)
      throw new Error(`第 ${index + 1} 行数据超出范围，请检查 Hz 与 dB 单位。`);
    if (frequency >= 20 && frequency <= 20000) points.push({ frequency, db });
  }
  points.sort((a, b) => a.frequency - b.frequency);
  if (points.length < 8)
    throw new Error('至少需要 8 个处于 20–20,000 Hz 范围内的测量点。');
  if (points[0].frequency > 100 || points.at(-1)!.frequency < 8000)
    throw new Error('频率范围至少应覆盖 100–8,000 Hz，才能进行对齐与拟合。');
  if (
    points.some(
      (point, i) => i > 0 && point.frequency === points[i - 1].frequency,
    )
  )
    throw new Error('数据中有重复频率，请每个频率只保留一个测量值。');
  return {
    id: uniqueId(),
    name: filename.replace(/\.(csv|txt|tsv)$/i, ''),
    source: filename,
    note: '用户导入 · 前两列：Hz / dB · 1 kHz 对齐。测量设备与条件请自行核对。',
    demo: false,
    points: normalize(points),
  };
}

export function parseTarget(text: string, filename: string): Target {
  const measurement = parseMeasurement(text, filename);
  return {
    id: measurement.id,
    name: measurement.name,
    description: '用户导入的目标曲线，已按 1 kHz 对齐到 0 dB。',
    source: measurement.source,
    note: '用户导入 · 前两列：Hz / dB · 1 kHz 对齐。',
    points: measurement.points,
  };
}

export function equalizerApo(
  bands: Band[],
  preamp: number,
  name: string,
  sampleRate = SAMPLE_RATE,
): string {
  return (
    [
      '# ToneBench — Equalizer APO / Peace',
      `# ${name.replace(/[\r\n]/g, ' ')}`,
      `# Response calculated at ${sampleRate} Hz. Verify by listening.`,
      `Preamp: ${preamp.toFixed(1)} dB`,
      ...bands.map(
        (b, i) =>
          `Filter ${i + 1}: ${b.enabled ? 'ON' : 'OFF'} ${b.kind} Fc ${b.frequency.toFixed(0)} Hz Gain ${b.gain.toFixed(1)} dB Q ${b.q.toFixed(2)}`,
      ),
    ].join('\n') + '\n'
  );
}

export function isMeasurement(value: unknown): value is Measurement {
  if (!value || typeof value !== 'object') return false;
  const m = value as Measurement;
  return (
    typeof m.id === 'string' &&
    typeof m.name === 'string' &&
    typeof m.source === 'string' &&
    typeof m.note === 'string' &&
    typeof m.demo === 'boolean' &&
    Array.isArray(m.points) &&
    m.points.length >= 8 &&
    m.points.length <= 50000 &&
    m.points.every(
      (point, i, all) =>
        point != null &&
        typeof point === 'object' &&
        Number.isFinite(point.frequency) &&
        point.frequency >= 20 &&
        point.frequency <= 20000 &&
        Number.isFinite(point.db) &&
        Math.abs(point.db) < 600 &&
        (!i || point.frequency > all[i - 1].frequency),
    ) &&
    m.points[0].frequency <= 100 &&
    m.points.at(-1)!.frequency >= 8000
  );
}

export function isBand(value: unknown): value is Band {
  if (!value || typeof value !== 'object') return false;
  const band = value as Band;
  return (
    typeof band.id === 'string' &&
    typeof band.enabled === 'boolean' &&
    ['PK', 'LSC', 'HSC'].includes(band.kind) &&
    Number.isFinite(band.frequency) &&
    band.frequency >= 20 &&
    band.frequency <= 20000 &&
    Number.isFinite(band.gain) &&
    band.gain >= -18 &&
    band.gain <= 12 &&
    Number.isFinite(band.q) &&
    band.q >= 0.25 &&
    band.q <= 10
  );
}

export function isTarget(value: unknown): value is Target {
  if (!value || typeof value !== 'object') return false;
  const target = value as Target;
  return (
    typeof target.id === 'string' &&
    typeof target.name === 'string' &&
    typeof target.description === 'string' &&
    typeof target.source === 'string' &&
    typeof target.note === 'string' &&
    Array.isArray(target.points) &&
    target.points.length >= 8 &&
    target.points.length <= 50000 &&
    target.points.every(
      (point, i, all) =>
        point != null &&
        typeof point === 'object' &&
        Number.isFinite(point.frequency) &&
        point.frequency >= 20 &&
        point.frequency <= 20000 &&
        Number.isFinite(point.db) &&
        Math.abs(point.db) < 600 &&
        (!i || point.frequency > all[i - 1].frequency),
    ) &&
    target.points[0].frequency <= 100 &&
    target.points.at(-1)!.frequency >= 8000
  );
}

export function isPreset(value: unknown): value is Preset {
  if (!value || typeof value !== 'object') return false;
  const p = value as Preset;
  return (
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    typeof p.savedAt === 'string' &&
    Number.isFinite(Date.parse(p.savedAt)) &&
    isTarget(p.target) &&
    Number.isFinite(p.preamp) &&
    p.preamp >= -180 &&
    p.preamp <= 0 &&
    (p.measurement === null ||
      (isMeasurement(p.measurement) && !p.measurement.demo)) &&
    Array.isArray(p.bands) &&
    p.bands.length <= 12 &&
    p.bands.every(isBand) &&
    new Set(p.bands.map((b) => b.id)).size === p.bands.length
  );
}
