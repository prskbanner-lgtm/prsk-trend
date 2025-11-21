import React from 'react';
import { ProcessedVideoData } from '../types';
import { UNIT_COLORS, mixWithWhiteRatio } from '../constants';
import { TrendingUp, Calendar, Trophy, Zap } from 'lucide-react';

interface TrendCardProps {
  title: string;
  icon: 'new' | 'week' | 'month' | 'total';
  video: ProcessedVideoData | null;
  metaText: string | null;
  onClick: (video: ProcessedVideoData) => void;
}

const TrendCard: React.FC<TrendCardProps> = ({ title, icon, video, metaText, onClick }) => {

  const getIcon = () => {
    switch(icon) {
      case 'new': return <Calendar size={18} className="text-green-500" />;
      case 'week': return <Zap size={18} className="text-yellow-500" />;
      case 'month': return <TrendingUp size={18} className="text-orange-500" />;
      case 'total': return <Trophy size={18} className="text-blue-500" />;
    }
  };

  const bgStyle = video && video.unit && UNIT_COLORS[video.unit]
    ? { backgroundColor: mixWithWhiteRatio(UNIT_COLORS[video.unit], 5), borderColor: UNIT_COLORS[video.unit] }
    : { backgroundColor: '#ffffff', borderColor: '#e2e8f0' };

  if (!video) {
     return (
      <div className="flex flex-col p-4 rounded-2xl border border-slate-200 bg-white shadow-sm h-full justify-center items-center text-slate-400 gap-2 min-h-[140px]">
        <div>{getIcon()}</div>
        <div className="text-sm font-bold">{title}</div>
        <div className="text-xs">—</div>
      </div>
     );
  }

  return (
    <div
      className="flex flex-col p-4 rounded-2xl border shadow-sm h-full cursor-pointer"
      style={bgStyle as React.CSSProperties}
      onClick={() => onClick(video)}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div>{getIcon()}</div>
          <div className="text-xs font-bold">{title}</div>
        </div>
        <div className="text-xs text-slate-600">{metaText}</div>
      </div>
      <div className="mt-3 text-sm font-bold text-slate-800 truncate">{video.title}</div>
      <div className="text-xs text-slate-500 mt-1 truncate">{video.unit || ''} {video.banner ? `・ ${video.banner}` : ''}</div>
    </div>
  );
};

export default TrendCard;
