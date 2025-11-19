// scripts/fetch_youtube.js
// - Node 18 前提 (Actions の setup-node で node-version: '18' を使ってください)
// - 必須: 環境変数 YOUTUBE_API_KEY を GitHub Actions Secrets に設定
// - 入力: videos_list.json (各エントリに url, banner, unit)
// - 出力: data/videos.json (各動画に videoId, url, title, thumbnail, published, banner, unit, history の配列)
// - 履歴は { datetime: "2025-11-17T12:30:00.000Z", views: 12345 } の形で保存（以前は 30分刻みだったが、本スクリプトは取得時刻をそのまま保存します）
// --- 変更点 ---
// - サーバーや API 取得が失敗した場合や GitHub Actions が動かなかったときに、既存の履歴から「推定（predicted）」エントリを生成して data/videos.json に保存するようにしました。
// - 実測エントリは predicted フラグなし、推定エントリは { predicted: true } が付与されます。
// - GitHub Actions がスケジュール（30分毎）で動く想定なので、穴が空いている場合は 30 分刻みで線形補間（または傾向外挿）して推定値を差し込みます。

const fs = require('fs').promises;
const path = require('path');

const API_KEY = process.env.YOUTUBE_API_KEY;
if (!API_KEY) {
  console.error('Error: YOUTUBE_API_KEY が設定されていません。GitHub Secrets を確認してください。');
  process.exit(1);
}

const LIST_PATH = path.resolve(process.cwd(), 'videos_list.json');
const OUT_DIR = path.resolve(process.cwd(), 'data');
const OUT_PATH = path.join(OUT_DIR, 'videos.json');

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText} for ${url}`);
  return await res.json();
}

/* --- 変更点 ---
   ここで「丸めた時刻」を作る関数ではなく、**取得時の正確な ISO 時刻**を返すようにします。
   また将来的に推定挿入するためのユーティリティを用意します。
*/
function nowISO(date = new Date()) {
  return new Date(date).toISOString();
}

function parseHistoryEntryDatetime(e) {
  // Accept either { datetime: "..."} or { date: "YYYY-MM-DD" } (legacy)
  if (!e) return null;
  if (e.datetime) return new Date(e.datetime);
  if (e.date) {
    // treat as midnight UTC to preserve existing
    return new Date(e.date + 'T00:00:00.000Z');
  }
  return null;
}

function isoFromEntry(e) {
  if (!e) return null;
  if (e.datetime) return e.datetime;
  if (e.date) return e.date + 'T00:00:00.000Z';
  return null;
}

function trimHistory(history, max = 5000) {
  if (!Array.isArray(history)) return [];
  if (history.length <= max) return history;
  return history.slice(history.length - max);
}

// URL から YouTube の videoId を抽出するユーティリティ（ショート URL / watch?v= / shorts / embed 対応）
function extractVideoIdFromUrl(urlStr) {
  if (!urlStr) return null;
  try {
    if (!/^https?:\/\//i.test(urlStr)) urlStr = 'https://' + urlStr;
    const url = new URL(urlStr);
    const host = url.hostname.toLowerCase();

    if (host === 'youtu.be') {
      const p = url.pathname.split('/').filter(Boolean);
      return p[0] || null;
    }

    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      const p = url.pathname.split('/').filter(Boolean);
      if (url.searchParams && url.searchParams.get('v')) return url.searchParams.get('v');
      if (p[0] === 'shorts' && p[1]) return p[1];
      if (p[0] === 'embed' && p[1]) return p[1];
      if (p[0] === 'v' && p[1]) return p[1];
    }

    // fallback: match typical 11-char id
    const m = urlStr.match(/([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
    return null;
  } catch (e) {
    return null;
  }
}

/* generate intermediate timestamps between two Date objects at intervalMinutes spacing */
function generateIntermediateTimes(fromDate, toDate, intervalMinutes = 30) {
  const res = [];
  const start = new Date(fromDate.getTime());
  let t = new Date(start.getTime() + intervalMinutes * 60 * 1000);
  while (t < toDate) {
    res.push(new Date(t.getTime()));
    t = new Date(t.getTime() + intervalMinutes * 60 * 1000);
  }
  return res;
}

/* linear interpolation/extrapolation for views between two points (a,b)
   aTime, bTime: Date, aViews,bViews: number
   for times between them, return predicted views.
*/
function interpolateViews(aTime, aViews, bTime, bViews, atTime) {
  const totalMs = bTime.getTime() - aTime.getTime();
  if (totalMs === 0) return bViews;
  const frac = (atTime.getTime() - aTime.getTime()) / totalMs;
  return Math.round(aViews + (bViews - aViews) * frac);
}

/* estimate trend rate (views per minute) from last N history entries (prefer actual entries)
   returns viewsPerMinute (can be fractional). If insufficient data, returns 0.
*/
function estimateRatePerMinute(history, lookback = 6) {
  if (!Array.isArray(history) || history.length < 2) return 0;
  // pick last up to lookback actual entries (prefer entries with datetime)
  const arr = history.slice().filter(h => !h.predicted).slice(-lookback);
  if (arr.length < 2) {
    // fallback to including predicted if no actuals
    const arr2 = history.slice().slice(-lookback);
    if (arr2.length < 2) return 0;
    let deltaV = 0, deltaM = 0;
    for (let i = 1; i < arr2.length; i++) {
      const a = arr2[i-1], b = arr2[i];
      const ta = parseHistoryEntryDatetime(a), tb = parseHistoryEntryDatetime(b);
      if (!ta || !tb) continue;
      deltaV += (b.views - a.views);
      deltaM += (tb.getTime() - ta.getTime()) / 60000;
    }
    if (deltaM <= 0) return 0;
    return deltaV / deltaM;
  }
  let deltaV = 0, deltaM = 0;
  for (let i = 1; i < arr.length; i++) {
    const a = arr[i-1], b = arr[i];
    const ta = parseHistoryEntryDatetime(a), tb = parseHistoryEntryDatetime(b);
    if (!ta || !tb) continue;
    deltaV += (b.views - a.views);
    deltaM += (tb.getTime() - ta.getTime()) / 60000;
  }
  if (deltaM <= 0) return 0;
  return deltaV / deltaM;
}

(function isoNow() {
  // noop placeholder for linter friendliness
})();

(async () => {
  try {
    console.log('読み込み: videos_list.json');
    const raw = await fs.readFile(LIST_PATH, 'utf8');
    const listJson = JSON.parse(raw);
    const list = Array.isArray(listJson.videos) ? listJson.videos : [];
    if (!list.length) {
      console.error('videos_list.json に動画が登録されていません。');
      process.exit(1);
    }

    await fs.mkdir(OUT_DIR, { recursive: true });

    // 既存の data/videos.json があれば読み込んで履歴を引き継ぐ
    let existing = { videos: [], updated_at: null };
    try {
      const old = await fs.readFile(OUT_PATH, 'utf8');
      existing = JSON.parse(old);
    } catch (e) {
      console.log('既存の data/videos.json が見つかりません。新規作成します。');
    }
    const existingMap = new Map();
    (existing.videos || []).forEach(v => {
      if (v.videoId) existingMap.set(v.videoId, v);
    });

    // entries: [{ videoId, url, banner, unit }, ...]
    const entries = [];
    for (const meta of list) {
      const url = meta.url;
      const vid = extractVideoIdFromUrl(url);
      if (!vid) {
        console.warn(`警告: URL から動画IDを抽出できませんでした。スキップします: ${url}`);
        continue;
      }
      entries.push({ videoId: vid, url, banner: meta.banner || '', unit: meta.unit || '' });
    }

    if (entries.length === 0) {
      console.error('有効な動画が1つも見つかりませんでした。videos_list.json を確認してください。');
      process.exit(1);
    }

    // fetch in batches (max 50)
    const batchSize = 50;
    const results = [];

    // current (exact) datetime in ISO (UTC) to use as key — 取り得る時刻を丸めずそのまま保存
    const currentIso = nowISO(new Date());
    const currentDate = new Date(currentIso);

    for (let i = 0; i < entries.length; i += batchSize) {
      const chunk = entries.slice(i, i + batchSize);
      const ids = chunk.map(x => x.videoId).join(',');
      const urlApi = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${ids}&key=${API_KEY}`;
      console.log('Fetching IDs:', ids);
      let json;
      try {
        json = await fetchJson(urlApi);
      } catch (err) {
        console.error('YouTube API 取得エラー:', err.message);
        // on error: fallback to existing data for this chunk, BUT generate predicted entries up to now
        for (const meta of chunk) {
          const prev = existingMap.get(meta.videoId);
          const prevHistory = prev && prev.history ? (Array.isArray(prev.history) ? prev.history.slice() : []) : [];
          // estimate rate and extrapolate from last actual to now in 30-min steps
          let history = prevHistory.slice();
          let lastEntry = history.length ? history[history.length - 1] : null;
          let lastTime = lastEntry ? parseHistoryEntryDatetime(lastEntry) : null;
          let lastViews = lastEntry ? lastEntry.views || 0 : 0;
          const ratePerMin = estimateRatePerMinute(history, 6); // views per minute
          if (!lastTime) {
            // no history - cannot predict; leave empty
            results.push({
              videoId: meta.videoId,
              url: meta.url,
              title: prev?.title || 'Unknown title',
              thumbnail: prev?.thumbnail || '',
              published: prev?.published || '',
              banner: meta.banner || prev?.banner || '',
              unit: meta.unit || prev?.unit || '',
              history: trimHistory(history)
            });
            continue;
          }
          // generate intermediate times between lastTime and currentDate at 30-min intervals (exclusive of lastTime, exclusive of now)
          const intermediates = generateIntermediateTimes(lastTime, currentDate, 30);
          for (const t of intermediates) {
            // extrapolate: views = lastViews + ratePerMin * minutesFromLast
            const minsFromLast = (t.getTime() - lastTime.getTime()) / 60000;
            const estViews = Math.max(0, Math.round(lastViews + ratePerMin * minsFromLast));
            history.push({ datetime: t.toISOString(), views: estViews, predicted: true });
          }
          // also append a final predicted point at currentIso
          const minsTotal = (currentDate.getTime() - lastTime.getTime()) / 60000;
          const estNow = Math.max(0, Math.round(lastViews + ratePerMin * minsTotal));
          history.push({ datetime: currentIso, views: estNow, predicted: true });

          results.push({
            videoId: meta.videoId,
            url: meta.url,
            title: prev?.title || 'Unknown title',
            thumbnail: prev?.thumbnail || '',
            published: prev?.published || '',
            banner: meta.banner || prev?.banner || '',
            unit: meta.unit || prev?.unit || '',
            history: trimHistory(history)
          });
        }
        continue;
      }

      const items = Array.isArray(json.items) ? json.items : [];
      const itemMap = new Map();
      items.forEach(it => itemMap.set(it.id, it));

      for (const meta of chunk) {
        const id = meta.videoId;
        const item = itemMap.get(id);

        const title = item ? (item.snippet?.title || '') : (existingMap.get(id)?.title || '');
        const thumbnail = item ? (item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.default?.url || '') : (existingMap.get(id)?.thumbnail || '');
        const published = item ? (item.snippet?.publishedAt ? item.snippet.publishedAt.slice(0, 10) : '') : (existingMap.get(id)?.published || '');
        const views = item ? parseInt(item.statistics?.viewCount || 0, 10) : (existingMap.get(id)?.history?.slice(-1)[0]?.views || 0);
        const prev = existingMap.get(id);
        let history = prev && Array.isArray(prev.history) ? prev.history.slice() : [];

        // normalize legacy 'date' entries by keeping them but not altering
        // Check last entry datetime (either datetime or date)
        let lastEntry = history.length ? history[history.length - 1] : null;
        let lastIso = lastEntry ? isoFromEntry(lastEntry) : null;

        // If we have a previous actual timestamp, and there's a gap to now, insert predicted intermediate entries
        if (lastIso) {
          const lastTime = new Date(lastIso);
          const currentTime = currentDate;
          const diffMin = (currentTime.getTime() - lastTime.getTime()) / 60000;
          // threshold: if more than 45 minutes since last entry, we assume an Actions miss / network error occurred sometime
          if (diffMin > 45) {
            // generate intermediates at 30-min intervals (to reflect previous schedule)
            const intermediates = generateIntermediateTimes(lastTime, currentTime, 30); // excludes lastTime, excludes currentTime
            // If there is at least one intermediate, create predicted entries by interpolation between last known and current observed (views)
            // If we have real current views (from API), we can interpolate between last and current.
            if (intermediates.length > 0) {
              // compute interpolation target values between lastEntry.views and views
              for (const t of intermediates) {
                // If we have a prev.views and current views, linearly interpolate
                const predVal = interpolateViews(lastTime, lastEntry.views || 0, currentTime, views, t);
                history.push({ datetime: t.toISOString(), views: predVal, predicted: true });
              }
            } else {
              // no intermediates but still gap (e.g., gap <30 but >45) -> we can still append a predicted point at some midpoint if desired.
            }
          }
        } else {
          // no previous history -> nothing to interpolate
        }

        // Now append or update the final current-time entry (actual)
        if (!lastIso) {
          history.push({ datetime: currentIso, views: views });
        } else {
          if (lastIso === currentIso) {
            // same timestamp: update last entry
            history[history.length - 1] = { datetime: currentIso, views: views };
          } else {
            history.push({ datetime: currentIso, views: views });
          }
        }

        history = trimHistory(history, 5000);

        results.push({
          videoId: id,
          url: meta.url,
          title,
          thumbnail,
          published,
          banner: meta.banner || (prev && prev.banner) || '',
          unit: meta.unit || (prev && prev.unit) || '',
          history
        });
      }
    }

    const out = { updated_at: new Date().toISOString(), videos: results };
    await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2), 'utf8');
    console.log('更新完了: data/videos.json を書き出しました。');
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
