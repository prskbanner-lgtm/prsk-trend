import type { HistoryEntry } from '../types';

interface Point {
  t: Date;
  tsMin: number;
  v: number;
}

function median(arr: number[]): number {
  if (!arr || arr.length === 0) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  if (s.length % 2 === 1) return s[m];
  return (s[m - 1] + s[m]) / 2;
}

function mad(arr: number[]): number {
  if (!arr || arr.length === 0) return 0;
  const med = median(arr);
  const abs = arr.map(x => Math.abs(x - med));
  return median(abs);
}

function emaOfRates(rates: number[], alpha: number): number {
  if (!rates || rates.length === 0) return 0;
  let s = rates[0];
  for (let i = 1; i < rates.length; i++) {
    s = alpha * rates[i] + (1 - alpha) * s;
  }
  return s;
}

function preprocessHistory(history: HistoryEntry[]): Point[] {
  if (!Array.isArray(history)) return [];
  const pts = history.map(h => {
    const t = h.datetime ? new Date(h.datetime) : (h.date ? new Date(h.date + 'T00:00:00.000Z') : null);
    if (!t) return null;
    return { t: t, tsMin: t.getTime() / 60000, v: (h.views || 0) };
  }).filter((x): x is Point => !!x);

  pts.sort((a, b) => a.t.getTime() - b.t.getTime());

  const unique: Point[] = [];
  for (const p of pts) {
    const last = unique[unique.length - 1];
    if (last && Math.abs(last.tsMin - p.tsMin) < 1e-6) {
      unique[unique.length - 1] = p;
    } else unique.push(p);
  }
  return unique;
}

export function computeAdvancedSlope(history: HistoryEntry[]) {
  const pts = preprocessHistory(history);
  const n = pts.length;
  if (n < 2) return { slope_reg: 0, slope_ema: 0, slope_final: 0, r2: 0, nPoints: n, medRate: 0 };

  const segRates: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const dv = pts[i + 1].v - pts[i].v;
    const dt = pts[i + 1].tsMin - pts[i].tsMin;
    if (dt <= 0) continue;
    segRates.push(dv / dt);
  }
  if (segRates.length === 0) return { slope_reg: 0, slope_ema: 0, slope_final: 0, r2: 0, nPoints: n, medRate: 0 };

  const medRate = median(segRates);
  const madRate = mad(segRates) || 1e-6;

  const OUTLIER_K = 6;
  const goodIdx: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    let ok = true;
    if (i < pts.length - 1) {
      const r = (pts[i + 1].v - pts[i].v) / Math.max(0.0001, (pts[i + 1].tsMin - pts[i].tsMin));
      if (Math.abs(r - medRate) > OUTLIER_K * madRate) ok = false;
    }
    if (i > 0) {
      const r2 = (pts[i].v - pts[i - 1].v) / Math.max(0.0001, (pts[i].tsMin - pts[i - 1].tsMin));
      if (Math.abs(r2 - medRate) > OUTLIER_K * madRate) ok = false;
    }
    if (ok) goodIdx.push(i);
  }

  const goodPts = goodIdx.map(i => pts[i]);
  if (goodPts.length < 2) goodPts.splice(0, goodPts.length, ...pts);

  const last = goodPts[goodPts.length - 1];
  const refTs = last.tsMin;
  const xs = goodPts.map(p => p.tsMin - refTs);
  const ys = goodPts.map(p => p.v);

  const HALF_LIFE_MIN = 180;
  const ln2 = Math.log(2);
  const ws = xs.map(x => Math.exp(-(Math.abs(x) / HALF_LIFE_MIN) * ln2));

  let S = 0, Sx = 0, Sy = 0, Sxx = 0, Sxy = 0;
  for (let i = 0; i < xs.length; i++) {
    const w = ws[i];
    const x = xs[i];
    const y = ys[i];
    S += w;
    Sx += w * x;
    Sy += w * y;
    Sxx += w * x * x;
    Sxy += w * x * y;
  }

  const denom = (S * Sxx - Sx * Sx);
  let slope_reg = 0;
  let intercept = 0;
  if (Math.abs(denom) > 1e-9) {
    slope_reg = (S * Sxy - Sx * Sy) / denom;
    intercept = (Sy - slope_reg * Sx) / S;
  } else {
    const totalDv = ys[ys.length - 1] - ys[0];
    const totalDt = (goodPts[goodPts.length - 1].tsMin - goodPts[0].tsMin) || 1;
    slope_reg = totalDv / totalDt;
    intercept = ys[ys.length - 1] - slope_reg * xs[xs.length - 1];
  }

  let SSres = 0;
  let SStot = 0;
  const yWeightedMean = Sy / S;
  for (let i = 0; i < xs.length; i++) {
    const w = ws[i];
    const x = xs[i];
    const y = ys[i];
    const yhat = intercept + slope_reg * x;
    SSres += w * Math.pow(y - yhat, 2);
    SStot += w * Math.pow(y - yWeightedMean, 2);
  }
  let r2 = 0;
  if (SStot > 1e-9) r2 = Math.max(0, 1 - (SSres / SStot));
  if (!isFinite(r2) || r2 < 0) r2 = 0;

  const instRates: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const dv = pts[i + 1].v - pts[i].v;
    const dt = pts[i + 1].tsMin - pts[i].tsMin;
    if (dt <= 0) continue;
    instRates.push(dv / dt);
  }
  const alpha = 0.5;
  const slope_ema = emaOfRates(instRates, alpha);

  const nEff = Math.min(6, xs.length);
  let conf = r2 * (nEff / 6);
  if (conf < 0) conf = 0;
  if (conf > 1) conf = 1;

  let slope_final = conf * slope_reg + (1 - conf) * slope_ema;
  if (!isFinite(slope_final) || slope_final < 0) slope_final = Math.max(0, slope_ema, slope_reg, 0);

  const maxMultiplier = 10;
  const cap = Math.max(Math.abs(medRate) * maxMultiplier, 1);
  if (Math.abs(slope_final) > cap) slope_final = Math.sign(slope_final) * cap;

  return { slope_reg, slope_ema, slope_final, r2, nPoints: pts.length, medRate };
}

export function predictValueAt(history: HistoryEntry[], targetDate: Date): number {
  if (!history || history.length === 0) return 0;
  const last = history[history.length - 1];
  const lastTime = last.datetime ? new Date(last.datetime) : (last.date ? new Date(last.date + 'T00:00:00.000Z') : null);
  const lastViews = last.views || 0;
  if (!lastTime) return lastViews;

  const slopeInfo = computeAdvancedSlope(history);
  const slope = slopeInfo.slope_final || 0;
  const deltaMin = (targetDate.getTime() - lastTime.getTime()) / 60000;

  let pred = lastViews + slope * deltaMin;
  if (!isFinite(pred)) pred = lastViews;
  if (pred < 0) pred = 0;
  return Math.round(pred);
}

export function floorToHalfHour(date: Date): Date {
  const d = new Date(date);
  d.setSeconds(0, 0);
  const m = d.getMinutes();
  if (m === 0 || m === 30) return d;
  if (m < 30) {
    d.setMinutes(0);
    return d;
  }
  d.setMinutes(30);
  return d;
}

export function earliestHistoryTime(history: HistoryEntry[]): Date | null {
  if (!history || history.length === 0) return null;
  const first = history[0];
  const t = first.datetime ? new Date(first.datetime) : (first.date ? new Date(first.date + 'T00:00:00.000Z') : null);
  return t;
}

export function calcDeltaWithPrediction(history: HistoryEntry[], days: number): number {
  if (!history || history.length === 0) return 0;
  const now = new Date();
  const nowPred = predictValueAt(history, now);

  const target = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const targetTick = floorToHalfHour(target);
  const firstTime = earliestHistoryTime(history);

  let baseTick: Date;
  if (!firstTime) {
    baseTick = targetTick;
  } else {
    const firstTick = floorToHalfHour(firstTime);
    if (targetTick.getTime() < firstTick.getTime()) baseTick = firstTick;
    else baseTick = targetTick;
  }
  const basePred = predictValueAt(history, baseTick);
  return Math.max(0, nowPred - basePred);
}

export function parseISOorDateString(s: string | undefined | null): Date | null {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T00:00:00.000Z');
  return new Date(s);
}
