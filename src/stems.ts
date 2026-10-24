export const STEM_IDS = [
  'vocals',
  'drums',
  'bass',
  'guitar',
  'piano',
  'other',
] as const;
export type StemId = (typeof STEM_IDS)[number];
export type StemControl = {
  id: StemId;
  gain: number;
  muted: boolean;
  solo: boolean;
};
export type StemStatus = {
  available: boolean;
  phase:
    | 'idle'
    | 'decoding'
    | 'loading'
    | 'separating'
    | 'writing'
    | 'cancelling'
    | 'ready'
    | 'error';
  message: string;
  progress: number;
  fileName: string;
  duration: number;
  position: number;
  playing: boolean;
  original: boolean;
  headroom: number;
  stems: StemControl[];
};
export const initialStems: StemStatus = {
  available: false,
  phase: 'idle',
  message: '',
  progress: 0,
  fileName: '',
  duration: 0,
  position: 0,
  playing: false,
  original: false,
  headroom: 0,
  stems: STEM_IDS.map((id) => ({ id, gain: 0, muted: false, solo: false })),
};
export function parseStemStatus(value: unknown): StemStatus | null {
  if (!value || typeof value !== 'object') return null;
  const s = value as StemStatus;
  if (
    ![
      'idle',
      'decoding',
      'loading',
      'separating',
      'writing',
      'cancelling',
      'ready',
      'error',
    ].includes(s.phase) ||
    typeof s.available !== 'boolean' ||
    typeof s.message !== 'string' ||
    typeof s.fileName !== 'string' ||
    typeof s.playing !== 'boolean' ||
    typeof s.original !== 'boolean' ||
    !Number.isFinite(s.progress) ||
    s.progress < 0 ||
    s.progress > 1 ||
    !Number.isFinite(s.duration) ||
    s.duration < 0 ||
    s.duration > 601 ||
    !Number.isFinite(s.position) ||
    s.position < 0 ||
    s.position > s.duration ||
    !Number.isFinite(s.headroom) ||
    s.headroom > 0 ||
    s.headroom < -160 ||
    !Array.isArray(s.stems) ||
    s.stems.length !== STEM_IDS.length ||
    new Set(s.stems.map((r) => r?.id)).size !== STEM_IDS.length ||
    s.stems.some(
      (r) =>
        !r ||
        !STEM_IDS.includes(r.id) ||
        !Number.isFinite(r.gain) ||
        r.gain < -24 ||
        r.gain > 6 ||
        typeof r.muted !== 'boolean' ||
        typeof r.solo !== 'boolean',
    )
  )
    return null;
  return s;
}
export function stemTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`;
}
