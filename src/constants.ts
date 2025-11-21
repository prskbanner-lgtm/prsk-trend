export const BANNER_COLORS: Record<string, string> = {
  "一歌": "#33AAEE",
  "咲希": "#FFDD44",
  "穂波": "#EE6666",
  "志歩": "#BBDD22",
  "みのり": "#FFCCAA",
  "遥":   "#99CCFF",
  "愛莉": "#FFAACC",
  "雫":   "#99EEDD",
  "こはね": "#FF6699",
  "杏":   "#00BBDD",
  "彰人": "#FF7722",
  "冬弥": "#0077DD",
  "司":   "#FFBB00",
  "えむ": "#FF66BB",
  "寧々": "#33DD99",
  "類":   "#BB88EE",
  "奏":   "#BB6688",
  "まふゆ": "#8888CC",
  "絵名": "#CCAA88",
  "瑞希": "#DDAACC"
};

export const UNIT_COLORS: Record<string, string> = {
  "レオニ": "#4455DD",
  "モモジャン": "#88DD44",
  "ビビバス": "#EE1166",
  "ワンダショ": "#FF9900",
  "ニーゴ": "#884499"
};

export const BANNER_ORDER = [
  "一歌", "咲希", "穂波", "志歩", "みのり", "遥", "愛莉", "雫", "こはね", "杏", "彰人", "冬弥", "司", "えむ", "寧々", "類", "奏", "まふゆ", "絵名", "瑞希"
];

export const UNIT_ORDER = ["レオニ", "モモジャン", "ビビバス", "ワンダショ", "ニーゴ"];

export function mixWithWhiteRatio(hex: string, whiteParts: number = 4): string {
  if (!hex) hex = '#2563eb';
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const total = 1 + whiteParts;
  const mr = Math.round((r + whiteParts * 255) / total);
  const mg = Math.round((g + whiteParts * 255) / total);
  const mb = Math.round((b + whiteParts * 255) / total);
  return '#' + [mr, mg, mb].map(n => n.toString(16).padStart(2, '0')).join('');
}
