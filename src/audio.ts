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
export type TargetId = 'balanced' | 'warm' | 'vocal';
export type Preset = {
  id: string;
  name: string;
  savedAt: string;
  measurement: Measurement;
  target: TargetId;
  bands: Band[];
  preamp: number;
};
export const SAMPLE_RATE = 48000;
export const FREQUENCIES = Array.from(
  { length: 241 },
  (_, i) => 20 * 1000 ** (i / 240),
);
export const TARGETS: { id: TargetId; name: string; description: string }[] = [
  {
    id: 'balanced',
    name: '均衡参考',
    description: '适量低频与自然的中高频抬升',
  },
  { id: 'warm', name: '温暖聆听', description: '低频更饱满，中高频稍收敛' },
  { id: 'vocal', name: '人声清晰', description: '减少低频遮蔽，突出中频轮廓' },
];
export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
const bell = (f: number, center: number, width: number) =>
  Math.exp(-0.5 * (Math.log2(f / center) / width) ** 2);

function targetValue(f: number, id: TargetId) {
  const bass =
    (id === 'warm' ? 7 : id === 'vocal' ? 2.5 : 5) / (1 + (f / 140) ** 2.3);
  const presence =
    (id === 'warm' ? 7 : id === 'vocal' ? 10 : 9) * bell(f, 2900, 0.7);
  const treble = 3 * bell(f, 8000, 0.48) - 5 * bell(f, 22000, 0.65);
  return bass + presence + treble;
}

export function targetAt(f: number, id: TargetId) {
  return targetValue(f, id) - targetValue(1000, id);
}

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

export const DEMOS: Measurement[] = [
  {
    id: 'demo-open',
    name: '开放式参考 A',
    source: 'ToneBench 合成演示',
    note: '模拟低频滚降与中高频起伏；不代表任何真实耳机。',
    demo: true,
    points: normalize(
      FREQUENCIES.map((f) => ({
        frequency: f,
        db:
          targetAt(f, 'balanced') -
          5 / (1 + (f / 100) ** 1.8) -
          2.8 * bell(f, 1600, 0.65) +
          4 * bell(f, 5700, 0.42) -
          3 * bell(f, 10500, 0.25),
      })),
    ),
  },
  {
    id: 'demo-closed',
    name: '封闭式参考 B',
    source: 'ToneBench 合成演示',
    note: '模拟低频偏暖与中频凹陷；不代表任何真实耳机。',
    demo: true,
    points: normalize(
      FREQUENCIES.map((f) => ({
        frequency: f,
        db:
          targetAt(f, 'balanced') +
          4.5 * bell(f, 130, 1) -
          3.5 * bell(f, 2200, 0.7) +
          3 * bell(f, 7000, 0.4),
      })),
    ),
  },
  {
    id: 'demo-iem',
    name: '入耳式参考 C',
    source: 'ToneBench 合成演示',
    note: '模拟偏亮的中高频；不代表任何真实耳机。',
    demo: true,
    points: normalize(
      FREQUENCIES.map((f) => ({
        frequency: f,
        db:
          targetAt(f, 'balanced') +
          2 * bell(f, 55, 0.8) +
          4 * bell(f, 3500, 0.5) +
          3.2 * bell(f, 8200, 0.32) -
          2 * bell(f, 800, 0.5),
      })),
    ),
  },
];

export function newBand(frequency = 1000): Band {
  return {
    id: crypto.randomUUID(),
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

// Robert Bristow-Johnson audio EQ cookbook biquads, evaluated at 48 kHz.
// These compute a response prediction; the browser does not process system audio.
export function coefficients(band: Band): { b: number[]; a: number[] } {
  const w = (2 * Math.PI * band.frequency) / SAMPLE_RATE;
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
): number {
  const w = (2 * Math.PI * frequency) / SAMPLE_RATE;
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

export function bandResponse(band: Band, frequency: number): number {
  return band.enabled
    ? responseFromCoefficients(coefficients(band), frequency)
    : 0;
}

export function eqResponse(bands: Band[], frequency: number): number {
  return bands.reduce((sum, band) => sum + bandResponse(band, frequency), 0);
}

export function responseCurve(bands: Band[]): Point[] {
  const filters = bands.filter((b) => b.enabled).map(coefficients);
  return FREQUENCIES.map((frequency) => ({
    frequency,
    db: filters.reduce(
      (sum, filter) => sum + responseFromCoefficients(filter, frequency),
      0,
    ),
  }));
}

export function suggestedPreamp(bands: Band[]): number {
  // Dense sampling also covers high-Q peaks between the displayed chart points.
  const filters = bands.filter((b) => b.enabled).map(coefficients);
  let maximum = 0;
  const samples = [
    ...Array.from({ length: 1601 }, (_, i) => 20 * 1200 ** (i / 1600)),
    ...bands.filter((b) => b.enabled).map((b) => b.frequency),
  ];
  for (const f of samples)
    maximum = Math.max(
      maximum,
      filters.reduce((sum, c) => sum + responseFromCoefficients(c, f), 0),
    );
  if (maximum < 1e-7) return 0;
  return -Math.ceil((maximum + 0.5) * 10 - 1e-8) / 10;
}

export function deviation(
  measurement: Measurement,
  target: TargetId,
  bands: Band[] = [],
): number {
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
          eqResponse(bands, f) -
          targetAt(f, target)) **
          2,
      0,
    ) / grid.length,
  );
}

export function autoFit(
  measurement: Measurement,
  target: TargetId,
  count: number,
  maxBoost: number,
): Band[] {
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
        const c = coefficients(candidate);
        const response = grid.map((f) => responseFromCoefficients(c, f));
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
    id: crypto.randomUUID(),
    name: filename.replace(/\.(csv|txt|tsv)$/i, ''),
    source: filename,
    note: '用户导入 · 前两列：Hz / dB · 1 kHz 对齐。测量设备与条件请自行核对。',
    demo: false,
    points: normalize(points),
  };
}

export function equalizerApo(
  bands: Band[],
  preamp: number,
  name: string,
): string {
  return (
    [
      '# ToneBench — Equalizer APO / Peace',
      `# ${name.replace(/[\r\n]/g, ' ')}`,
      '# Sample rate: 48000 Hz. Prediction only; verify by listening.',
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

export function isPreset(value: unknown): value is Preset {
  if (!value || typeof value !== 'object') return false;
  const p = value as Preset;
  return (
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    typeof p.savedAt === 'string' &&
    Number.isFinite(Date.parse(p.savedAt)) &&
    TARGETS.some((t) => t.id === p.target) &&
    Number.isFinite(p.preamp) &&
    p.preamp >= -180 &&
    p.preamp <= 0 &&
    isMeasurement(p.measurement) &&
    Array.isArray(p.bands) &&
    p.bands.length <= 12 &&
    p.bands.every(
      (b) =>
        b != null &&
        typeof b === 'object' &&
        typeof b.id === 'string' &&
        typeof b.enabled === 'boolean' &&
        ['PK', 'LSC', 'HSC'].includes(b.kind) &&
        Number.isFinite(b.frequency) &&
        b.frequency >= 20 &&
        b.frequency <= 20000 &&
        Number.isFinite(b.gain) &&
        b.gain >= -18 &&
        b.gain <= 12 &&
        Number.isFinite(b.q) &&
        b.q >= 0.25 &&
        b.q <= 10,
    ) &&
    new Set(p.bands.map((b) => b.id)).size === p.bands.length
  );
}
