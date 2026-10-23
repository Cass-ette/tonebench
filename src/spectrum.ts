export type SpectrumFrame = {
  frequencies: number[];
  before: number[];
  after: number[];
  sampleRate: number;
  fftSize: number;
};

export function isSpectrumFrame(value: unknown): value is SpectrumFrame {
  if (!value || typeof value !== 'object') return false;
  const s = value as SpectrumFrame;
  if (
    !Number.isFinite(s.sampleRate) ||
    s.sampleRate < 32000 ||
    s.sampleRate > 192000 ||
    ![8192, 16384, 32768].includes(s.fftSize) ||
    !Array.isArray(s.frequencies) ||
    s.frequencies.length !== 192 ||
    !Array.isArray(s.before) ||
    !Array.isArray(s.after) ||
    s.before.length !== 192 ||
    s.after.length !== 192
  )
    return false;
  return s.frequencies.every(
    (f, i) =>
      Number.isFinite(f) &&
      f >= 20 &&
      f <= Math.min(20000, s.sampleRate / 2) &&
      (i === 0 || f > s.frequencies[i - 1]) &&
      Number.isFinite(s.before[i]) &&
      Number.isFinite(s.after[i]) &&
      s.before[i] >= -120 &&
      s.before[i] <= 100 &&
      s.after[i] >= -120 &&
      s.after[i] <= 100,
  );
}

export function nearestSpectrumBin(frequencies: number[], frequency: number) {
  return frequencies.reduce(
    (best, f, i) =>
      Math.abs(Math.log(f / frequency)) <
      Math.abs(Math.log(frequencies[best] / frequency))
        ? i
        : best,
    0,
  );
}
