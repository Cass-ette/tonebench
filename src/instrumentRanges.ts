export type FrequencyRegion = {
  id: string;
  name: string;
  low: number;
  high: number;
  boost: string;
  cut: string;
};

type Instrument = {
  id: string;
  name: string;
  regions: FrequencyRegion[];
};

// Broad mixing reference ranges, not an instrument's full pitch range or a
// measurement of the playing track. Adjacent sources intentionally overlap.
export const INSTRUMENTS: Instrument[] = [
  {
    id: 'voice',
    name: '人声',
    regions: [
      {
        id: 'body',
        name: '厚度',
        low: 120,
        high: 350,
        boost: '声音更饱满，过多会发闷。',
        cut: '减少低中频的浑浊，过多会变薄。',
      },
      {
        id: 'presence',
        name: '清晰度',
        low: 1500,
        high: 4000,
        boost: '咬字更清楚，人声更靠前；过多会刺耳。',
        cut: '缓和喊叫感，过多会让人声后退。',
      },
      {
        id: 'sibilance',
        name: '齿音',
        low: 5000,
        high: 9000,
        boost: '齿音与气声更明显。',
        cut: '减轻“嘶、丝”声，也会削弱镲片和其他高频。',
      },
      {
        id: 'air',
        name: '空气感',
        low: 10000,
        high: 16000,
        boost: '气声与高频细节更明显，也会带起底噪。',
        cut: '声音更柔和，过多会显得暗。',
      },
    ],
  },
  {
    id: 'acoustic-guitar',
    name: '木吉他',
    regions: [
      {
        id: 'body',
        name: '琴体',
        low: 100,
        high: 300,
        boost: '琴体共鸣更饱满，过多会轰。',
        cut: '减轻低频共鸣，也会削弱琴体厚度。',
      },
      {
        id: 'box',
        name: '箱体感',
        low: 300,
        high: 800,
        boost: '中频更浓，过多会有箱子里的感觉。',
        cut: '缓和箱体感，过多会显得空。',
      },
      {
        id: 'attack',
        name: '拨弦',
        low: 2000,
        high: 5000,
        boost: '拨弦轮廓更清楚，过多会显得硬。',
        cut: '拨片和触弦声更柔和。',
      },
      {
        id: 'string',
        name: '弦声',
        low: 6000,
        high: 10000,
        boost: '弦的亮度与滑弦声更明显。',
        cut: '减轻刮弦和摩擦声，也会减少亮度。',
      },
    ],
  },
  {
    id: 'electric-guitar',
    name: '电吉他',
    regions: [
      {
        id: 'body',
        name: '厚度',
        low: 120,
        high: 350,
        boost: '声音更厚重，过多会盖住贝斯。',
        cut: '减少低中频堆积。',
      },
      {
        id: 'mid',
        name: '中频',
        low: 700,
        high: 1800,
        boost: '旋律更突出，过多会有鼻音。',
        cut: '缓和鼻音，也可能失去存在感。',
      },
      {
        id: 'edge',
        name: '咬劲',
        low: 2000,
        high: 4500,
        boost: '失真与拨弦更有冲击力，过多会刺。',
        cut: '减轻尖锐和疲劳感。',
      },
      {
        id: 'fizz',
        name: '毛刺',
        low: 5000,
        high: 9000,
        boost: '失真高频更粗粝。',
        cut: '缓和失真毛刺，也会让镲片变暗。',
      },
    ],
  },
  {
    id: 'piano',
    name: '钢琴',
    regions: [
      {
        id: 'weight',
        name: '低音重量',
        low: 40,
        high: 150,
        boost: '低音更有分量，过多会轰。',
        cut: '减轻低音堆积，也会削弱贝斯和底鼓。',
      },
      {
        id: 'body',
        name: '温暖感',
        low: 150,
        high: 500,
        boost: '琴声更温暖饱满。',
        cut: '减少浑浊，过多会变薄。',
      },
      {
        id: 'attack',
        name: '击弦',
        low: 2000,
        high: 5000,
        boost: '击弦轮廓与颗粒感更明显。',
        cut: '缓和敲击感，声音更柔和。',
      },
      {
        id: 'brilliance',
        name: '明亮度',
        low: 5000,
        high: 10000,
        boost: '高音与泛音更明亮。',
        cut: '减少高音的尖亮感。',
      },
    ],
  },
  {
    id: 'bass',
    name: '贝斯',
    regions: [
      {
        id: 'weight',
        name: '低频重量',
        low: 40,
        high: 100,
        boost: '低音更深、更有分量，过多会轰。',
        cut: '减轻低频压力，也会影响底鼓。',
      },
      {
        id: 'body',
        name: '厚度',
        low: 100,
        high: 250,
        boost: '贝斯更饱满，过多会混成一团。',
        cut: '减少低频堆积，过多会变薄。',
      },
      {
        id: 'definition',
        name: '音符轮廓',
        low: 700,
        high: 1500,
        boost: '音高与旋律线更容易辨认。',
        cut: '缓和中频的硬度，也可能听不清音符。',
      },
      {
        id: 'attack',
        name: '拨弦',
        low: 2000,
        high: 4000,
        boost: '手指或拨片的触弦声更清楚。',
        cut: '减轻触弦杂音和敲击感。',
      },
    ],
  },
  {
    id: 'kick',
    name: '底鼓',
    regions: [
      {
        id: 'thump',
        name: '下潜',
        low: 40,
        high: 80,
        boost: '鼓声更深，过多会拖尾或轰。',
        cut: '减轻低频压力，也会影响贝斯。',
      },
      {
        id: 'punch',
        name: '冲击',
        low: 80,
        high: 150,
        boost: '鼓点更厚实有力。',
        cut: '减轻低频的拥挤。',
      },
      {
        id: 'box',
        name: '闷响',
        low: 250,
        high: 500,
        boost: '鼓腔声更明显，过多会闷。',
        cut: '缓和纸箱感与闷响。',
      },
      {
        id: 'click',
        name: '鼓槌',
        low: 2500,
        high: 5000,
        boost: '鼓槌落点更清楚，过多会硬。',
        cut: '减轻鼓点的点击声。',
      },
    ],
  },
  {
    id: 'snare',
    name: '军鼓',
    regions: [
      {
        id: 'body',
        name: '鼓身',
        low: 150,
        high: 300,
        boost: '鼓声更厚实。',
        cut: '减轻鼓身的闷响，过多会变薄。',
      },
      {
        id: 'ring',
        name: '共鸣',
        low: 500,
        high: 1000,
        boost: '鼓皮共鸣更明显。',
        cut: '缓和中频共鸣，也会影响其他声部。',
      },
      {
        id: 'crack',
        name: '敲击',
        low: 2000,
        high: 5000,
        boost: '敲击更利落、更靠前。',
        cut: '减轻鼓声的刺耳感。',
      },
      {
        id: 'wire',
        name: '响弦',
        low: 6000,
        high: 10000,
        boost: '响弦与沙沙声更明显。',
        cut: '响弦更柔和，也会减少镲片亮度。',
      },
    ],
  },
  {
    id: 'cymbals',
    name: '镲片',
    regions: [
      {
        id: 'harsh',
        name: '金属感',
        low: 2500,
        high: 5000,
        boost: '金属敲击感更强，过多会刺。',
        cut: '缓和硬度和刺耳感。',
      },
      {
        id: 'sizzle',
        name: '亮度',
        low: 6000,
        high: 10000,
        boost: '镲片更亮、更醒目。',
        cut: '缓和沙沙声，也会减轻人声齿音。',
      },
      {
        id: 'air',
        name: '延伸感',
        low: 10000,
        high: 16000,
        boost: '高频尾音更明显，也会带起底噪。',
        cut: '尾音更柔和，过多会变暗。',
      },
    ],
  },
  {
    id: 'cello',
    name: '大提琴',
    regions: [
      {
        id: 'body',
        name: '厚度',
        low: 100,
        high: 250,
        boost: '琴体更温暖、更饱满，过多会轰。',
        cut: '减轻低音堆积，过多会失去厚度。',
      },
      {
        id: 'mud',
        name: '浑浊感',
        low: 250,
        high: 500,
        boost: '低中频更浓，过多会闷住旋律。',
        cut: '可尝试减轻闷和浑浊，也会削弱其他乐器的厚度。',
      },
      {
        id: 'presence',
        name: '清晰度',
        low: 1000,
        high: 3000,
        boost: '拉弦轮廓更清楚，旋律更容易被听到；过多会硬。',
        cut: '缓和硬度，也可能让大提琴更靠后。',
      },
      {
        id: 'bow',
        name: '弓弦摩擦',
        low: 3000,
        high: 6000,
        boost: '弓弦质感更明显，过多会粗糙。',
        cut: '减轻摩擦与尖锐感。',
      },
    ],
  },
  {
    id: 'violin',
    name: '小提琴',
    regions: [
      {
        id: 'body',
        name: '琴体',
        low: 200,
        high: 500,
        boost: '琴体更温暖饱满，过多会闷。',
        cut: '减少低中频堆积，也会削弱厚度。',
      },
      {
        id: 'presence',
        name: '清晰度',
        low: 1000,
        high: 3000,
        boost: '旋律线更靠前、更清楚。',
        cut: '缓和中频的紧张感。',
      },
      {
        id: 'bow',
        name: '弓弦摩擦',
        low: 3000,
        high: 6000,
        boost: '弓弦质感更明显，过多会粗糙。',
        cut: '减轻摩擦与尖锐感。',
      },
      {
        id: 'brilliance',
        name: '泛音',
        low: 6000,
        high: 12000,
        boost: '泛音更亮、更通透。',
        cut: '高音更柔和。',
      },
    ],
  },
];

export const formatGuideHz = (frequency: number) =>
  frequency >= 1000
    ? `${Number((frequency / 1000).toFixed(1))} kHz`
    : `${frequency} Hz`;

export const formatGuideRange = ({
  low,
  high,
}: Pick<FrequencyRegion, 'low' | 'high'>) =>
  low >= 1000
    ? `${Number((low / 1000).toFixed(1))}–${Number((high / 1000).toFixed(1))} kHz`
    : high < 1000
      ? `${low}–${high} Hz`
      : `${low} Hz–${formatGuideHz(high)}`;
