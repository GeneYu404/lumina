export interface RemoteSample {
  name: string;
  url: string;
  credit: string;
  date: string;
}

const px = (id: number) =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=2000`;

export const REMOTE_SAMPLES: RemoteSample[] = [
  { name: '山间湖泊.jpg', url: px(12365962), credit: 'eberhard grossgasteiger', date: '2024-05-12T06:24:00' },
  { name: '城市夜景.jpg', url: px(20185085), credit: 'Elsie Soto', date: '2024-02-03T20:15:00' },
  { name: '小猫.jpg', url: px(14488468), credit: 'blossom', date: '2023-11-20T15:02:00' },
  { name: '秋日森林.jpg', url: px(1437601), credit: 'Johannes Plenio', date: '2023-10-18T08:40:00' },
  { name: '晨露花朵.jpg', url: px(20651998), credit: 'Olga Solo', date: '2024-04-02T07:10:00' },
  { name: '海岛航拍.jpg', url: px(1585960), credit: 'Josh Sorenson', date: '2023-07-28T11:30:00' },
  { name: '多伦多夜景.jpg', url: px(29422607), credit: 'Anurag Jamwal', date: '2024-11-09T19:45:00' },
  { name: '海边山脉.jpg', url: px(6136314), credit: 'Quang Nguyen Vinh', date: '2023-12-30T17:20:00' },
];

/** Windows 11 inspired "bloom" artwork. Also used as the desktop wallpaper. */
export const BLOOM_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice">
<defs>
<radialGradient id="bloom-bg" cx="50%" cy="58%" r="80%">
<stop offset="0" stop-color="#1d56c9"/><stop offset="0.42" stop-color="#0a2468"/><stop offset="1" stop-color="#030a22"/>
</radialGradient>
<linearGradient id="bloom-p1" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#9ad8ff"/><stop offset="0.5" stop-color="#2f7dff"/><stop offset="1" stop-color="#0b2e8a"/>
</linearGradient>
<linearGradient id="bloom-p2" x1="1" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#c2e9ff"/><stop offset="0.55" stop-color="#3f8cff"/><stop offset="1" stop-color="#0d2f86"/>
</linearGradient>
<filter id="bloom-soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5"/></filter>
<filter id="bloom-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="70"/></filter>
</defs>
<rect width="1920" height="1080" fill="url(#bloom-bg)"/>
<ellipse cx="960" cy="650" rx="560" ry="260" fill="#2f7dff" opacity="0.5" filter="url(#bloom-glow)"/>
<g transform="translate(960 610)" filter="url(#bloom-soft)">
<path d="M0 0 C -200 -60 -380 -20 -560 120 C -360 170 -170 110 0 0 Z" fill="url(#bloom-p1)" opacity="0.8"/>
<path d="M0 0 C 200 -60 380 -20 560 120 C 360 170 170 110 0 0 Z" fill="url(#bloom-p2)" opacity="0.8"/>
<path d="M0 0 C -120 -160 -330 -210 -520 -120 C -360 -40 -180 10 0 0 Z" fill="url(#bloom-p1)" opacity="0.95"/>
<path d="M0 0 C 120 -160 330 -210 520 -120 C 360 -40 180 10 0 0 Z" fill="url(#bloom-p2)" opacity="0.95"/>
<path d="M0 0 C -160 -120 -300 -330 -250 -480 C -120 -380 -40 -200 0 0 Z" fill="url(#bloom-p1)" opacity="0.88"/>
<path d="M0 0 C 160 -120 300 -330 250 -480 C 120 -380 40 -200 0 0 Z" fill="url(#bloom-p2)" opacity="0.88"/>
<path d="M0 0 C -60 -220 -40 -420 60 -540 C 110 -390 90 -180 0 0 Z" fill="url(#bloom-p2)" opacity="0.92"/>
</g>
</svg>`;

const SHAPES_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200">
<defs>
<linearGradient id="ga" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff9a8b"/><stop offset="1" stop-color="#ff6a88"/></linearGradient>
<linearGradient id="gb" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#43e97b"/><stop offset="1" stop-color="#38f9d7"/></linearGradient>
<linearGradient id="gc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#667eea"/><stop offset="1" stop-color="#764ba2"/></linearGradient>
<linearGradient id="gd" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f6d365"/><stop offset="1" stop-color="#fda085"/></linearGradient>
</defs>
<circle cx="460" cy="470" r="300" fill="url(#gc)" opacity="0.92"/>
<rect x="560" y="520" width="420" height="420" rx="72" fill="url(#ga)" opacity="0.9" transform="rotate(-12 770 730)"/>
<polygon points="300,980 520,600 740,980" fill="url(#gb)" opacity="0.9"/>
<circle cx="860" cy="330" r="130" fill="url(#gd)"/>
<circle cx="860" cy="330" r="190" fill="none" stroke="#f6d365" stroke-width="10" stroke-dasharray="4 26" stroke-linecap="round"/>
<g fill="#ffffff" opacity="0.9"><circle cx="240" cy="230" r="14"/><circle cx="1010" cy="620" r="10"/><circle cx="210" cy="760" r="8"/></g>
<path d="M170 560 q 60 -60 120 0 t 120 0 t 120 0" fill="none" stroke="#38f9d7" stroke-width="14" stroke-linecap="round"/>
</svg>`;

export function svgSamples(): File[] {
  return [
    new File([BLOOM_SVG], '蓝色花瓣壁纸.svg', {
      type: 'image/svg+xml',
      lastModified: Date.parse('2024-06-01T10:00:00'),
    }),
    new File([SHAPES_SVG], '透明几何插画.svg', {
      type: 'image/svg+xml',
      lastModified: Date.parse('2024-08-15T14:30:00'),
    }),
  ];
}
