import React from 'react';
import { ProcessedVideoData, SortMode } from '../types';
import { BANNER_COLORS, UNIT_COLORS, mixWithWhiteRatio } from '../constants';
import { ArrowUpRight } from 'lucide-react';

interface RankingListProps {
  videos: ProcessedVideoData[];
  selectedId: string | null;
  onSelect: (video: ProcessedVideoData) => void;
  sortMode: SortMode;
  onSortChange: (mode: SortMode) => void;
  onBadgeClick: (type: 'banner' | 'unit', val: string) => void;
}

const RankingList: React.FC<RankingListProps> = ({
  videos,
  selectedId,
  onSelect,
  sortMode,
  onSortChange,
  onBadgeClick
}) => {
  return (
    <div className="bg-white rounded-2xl shadow-md border border-slate-200 flex flex-col h-[600px] lg:h-full overflow-hidden">
      <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
        <h3 className="font-bold text-slate-700">ランキング</h3>
        <select
          value={sortMode}
          onChange={(e) => onSortChange(e.target.value as SortMode)}
          className="text-xs bg-white border border-slate-200 rounded-lg px-2 py-1 outline-none focus:border-blue-500"
        >
          <option value="total">再生数順</option>
          <option value="published">新着順</option>
        </select>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {videos.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">該当する動画がありません</div>
        ) : (
          videos.map((v, idx) => {
            const isSelected = selectedId === v.videoId;
            return (
              <div
                key={v.videoId}
                onClick={() => onSelect(v)}
                className={`flex gap-3 p-2 rounded-xl cursor-pointer transition-all border ${
                  isSelected
                    ? 'bg-blue-50 border-blue-200 shadow-sm'
                    : 'bg-white border-transparent hover:bg-slate-50 hover:border-slate-100'
                }`}
              >
                <div className="flex flex-col items-center justify-center min-w-[24px] text-slate-400 font-bold text-sm">
                  {idx + 1}
                </div>

                <div className="relative w-20 h-[45px] flex-shrink-0 rounded-md overflow-hidden bg-slate-200">
                  <img src={v.thumbnail} alt="" className="w-full h-full object-cover" loading="lazy" />
                </div>

                <div className="flex-1 min-w-0 flex flex-col gap-1">
                  <div className={`text-sm font-bold truncate ${isSelected ? 'text-blue-700' : 'text-slate-700'}`}>
                    {v.title}
                  </div>

                  <div className="flex items-center gap-2">
                    {v.banner && (
                      <span
                        onClick={(e) => { e.stopPropagation(); onBadgeClick('banner', v.banner); }}
                        className="text-[10px] px-1.5 py-0.5 rounded-full truncate max-w-[60px] hover:opacity-75"
                        style={{ backgroundColor: mixWithWhiteRatio(BANNER_COLORS[v.banner] || '#cbd5e1'), color: '#1e293b' }}
                      >
                        {v.banner}
                      </span>
                    )}
                    {v.unit && (
                      <span
                        onClick={(e) => { e.stopPropagation(); onBadgeClick('unit', v.unit); }}
                        className="text-[10px] px-1.5 py-0.5 rounded-full truncate max-w-[60px] hover:opacity-75"
                        style={{ backgroundColor: mixWithWhiteRatio(UNIT_COLORS[v.unit] || '#cbd5e1'), color: '#1e293b' }}
                      >
                        {v.unit}
                      </span>
                    )}
                  </div>

                  <div className="flex justify-between items-end mt-0.5">
                    <span className="text-xs font-bold text-slate-600">{v.latestViewCount.toLocaleString()} 回</span>
                    <span className="text-[10px] font-medium text-emerald-600 flex items-center">
                      <ArrowUpRight size={10} /> {v.delta7.toLocaleString()} / 7d
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default RankingList;
