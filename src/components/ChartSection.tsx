import React, { useMemo, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { ProcessedVideoData, TimeScope } from '../types';
import { BANNER_COLORS, UNIT_COLORS } from '../constants';
import { predictValueAt, floorToHalfHour } from '../utils/math';
import { ExternalLink } from 'lucide-react';

interface ChartSectionProps {
  video: ProcessedVideoData | null;
  onBadgeClick: (type: 'banner' | 'unit', val: string) => void;
}

const ChartSection: React.FC<ChartSectionProps> = ({ video, onBadgeClick }) => {
  const [timeScope, setTimeScope] = useState<TimeScope>('all');

  const chartData = useMemo(() => {
    if (!video || !video.history || video.history.length === 0) return [];

    const now = new Date();
    let startTime: Date;

    if (timeScope === '7') {
      startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (timeScope === '30') {
      startTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else {
      const first = video.history[0];
      const t = first.datetime ? new Date(first.datetime) : (first.date ? new Date(first.date + 'T00:00:00.000Z') : new Date());
      startTime = t;
    }

    if (startTime > now) startTime = now;
    let t0 = floorToHalfHour(startTime);
    if (t0 > now) t0 = floorToHalfHour(now);

    const ticks: Date[] = [];
    const thirtyMin = 30 * 60 * 1000;
    for (let t = new Date(t0.getTime()); t.getTime() <= now.getTime(); t = new Date(t.getTime() + thirtyMin)) {
      ticks.push(new Date(t.getTime()));
      if (ticks.length > 2000) break;
    }
    if (ticks.length === 0 || Math.abs(ticks[ticks.length - 1].getTime() - now.getTime()) > 1000) {
      ticks.push(new Date(now.getTime()));
    }

    return ticks.map(t => ({
      time: t.getTime(),
      dateStr: timeScope === 'all'
        ? `${t.getMonth()+1}/${t.getDate()}`
        : (timeScope === '30' ? `${t.getMonth()+1}/${t.getDate()}` : `${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`),
      fullDate: t.toLocaleString(),
      views: predictValueAt(video.history, t)
    }));
  }, [video, timeScope]);

  const color = useMemo(() => {
    if (!video) return '#3b82f6';
    if (video.banner && (BANNER_COLORS as Record<string,string>)[video.banner]) return (BANNER_COLORS as Record<string,string>)[video.banner];
    if (video.unit && (UNIT_COLORS as Record<string,string>)[video.unit]) return (UNIT_COLORS as Record<string,string>)[video.unit];
    return '#3b82f6';
  }, [video]);

  if (!video) {
    return (
      <div className="bg-white rounded-2xl shadow-md border border-slate-200 h-full flex items-center justify-center text-slate-400 p-8">
        動画を選択してください
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-md border border-slate-200 flex flex-col h-full overflow-hidden">
      <div className="p-4 md:p-6 border-b border-slate-100 bg-slate-50/50 flex flex-col gap-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
             <h2 className="text-lg font-bold text-slate-800 leading-tight">{video.title}</h2>
             <a
               href={video.url}
               target="_blank"
               rel="noreferrer"
               className="inline-flex items-center gap-1 text-sm text-primary hover:underline mt-1 font-medium"
             >
               YouTubeで見る <ExternalLink size={12} />
             </a>
          </div>
          <div className="flex gap-2">
            {video.banner && (
              <span
                onClick={() => onBadgeClick('banner', video.banner)}
                className="text-xs px-2 py-1 rounded-full font-bold cursor-pointer transition hover:opacity-80"
                style={{ backgroundColor: (BANNER_COLORS as any)[video.banner] + '20', color: '#334155' }}
              >
                {video.banner}
              </span>
            )}
            {video.unit && (
              <span
                onClick={() => onBadgeClick('unit', video.unit)}
                className="text-xs px-2 py-1 rounded-full font-bold cursor-pointer transition hover:opacity-80"
                style={{ backgroundColor: (UNIT_COLORS as any)[video.unit] + '20', color: '#334155' }}
              >
                {video.unit}
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
             <div className="text-xs text-slate-500 mb-1">最新再生数 (推定)</div>
             <div className="text-lg font-bold text-slate-800">{video.latestViewCount.toLocaleString()}</div>
          </div>
          <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
             <div className="text-xs text-slate-500 mb-1">7日間増加</div>
             <div className="text-lg font-bold text-emerald-600">+{video.delta7.toLocaleString()}</div>
          </div>
          <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
             <div className="text-xs text-slate-500 mb-1">30日間増加</div>
             <div className="text-lg font-bold text-emerald-600">+{video.delta30.toLocaleString()}</div>
          </div>
          <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
             <div className="text-xs text-slate-500 mb-1">投稿日</div>
             <div className="text-sm font-bold text-slate-800 mt-1">{video.published || '—'}</div>
          </div>
        </div>
      </div>

      <div className="p-4 flex-1 flex flex-col min-h-[300px]">
        <div className="flex justify-end mb-4">
           <div className="inline-flex bg-slate-100 p-1 rounded-lg">
             {(['all', '30', '7'] as TimeScope[]).map(scope => (
               <button
                 key={scope}
                 onClick={() => setTimeScope(scope)}
                 className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${
                   timeScope === scope ? 'bg-white text-primary shadow-sm' : 'text-slate-500 hover:text-slate-700'
                 }`}
               >
                 {scope === 'all' ? '全期間' : `${scope}日`}
               </button>
             ))}
           </div>
        </div>

        <div className="flex-1 w-full min-h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorViews" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.2}/>
                  <stop offset="95%" stopColor={color} stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis
                dataKey="time"
                tickFormatter={(tick, idx) => (chartData as any)[idx]?.dateStr || ''}
                tick={{fontSize: 10, fill: '#94a3b8'}}
                axisLine={false}
                tickLine={false}
                minTickGap={30}
              />
              <YAxis
                tickFormatter={(val) => Intl.NumberFormat('ja-JP', { notation: "compact" }).format(val)}
                tick={{fontSize: 10, fill: '#94a3b8'}}
                axisLine={false}
                tickLine={false}
                domain={['auto', 'auto']}
              />
              <Tooltip
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                formatter={(value: number) => [value.toLocaleString(), '再生数']}
                labelFormatter={(label) => {
                  const pt = (chartData as any).find((p: any) => p.time === label);
                  return pt ? pt.fullDate : '';
                }}
              />
              <Area
                type="monotone"
                dataKey="views"
                stroke={color}
                fillOpacity={1}
                fill="url(#colorViews)"
                strokeWidth={2}
                animationDuration={500}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default ChartSection;
