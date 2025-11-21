import React from 'react';
import { TrendPicks, ProcessedVideoData } from '../types';
import TrendCard from './TrendCard';

interface TrendSectionProps {
  trends: TrendPicks;
  onSelect: (v: ProcessedVideoData) => void;
}

const TrendSection: React.FC<TrendSectionProps> = ({ trends, onSelect }) => {

  const formatDate = (d?: Date) => d ? d.toISOString().slice(0, 10) : '—';
  const fmt = (n: number) => n.toLocaleString();

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <TrendCard
        title="新着動画"
        icon="new"
        video={trends.new?.video || null}
        metaText={trends.new ? formatDate(trends.new.date) : '—'}
        onClick={onSelect}
      />
      <TrendCard
        title="急上昇 (7日間)"
        icon="week"
        video={trends.week}
        metaText={trends.week ? `+${fmt(trends.week.delta7)}` : '—'}
        onClick={onSelect}
      />
      <TrendCard
        title="急上昇 (30日間)"
        icon="month"
        video={trends.month}
        metaText={trends.month ? `+${fmt(trends.month.delta30)}` : '—'}
        onClick={onSelect}
      />
      <TrendCard
        title="累計トップ"
        icon="total"
        video={trends.total}
        metaText={trends.total ? `${fmt(trends.total.latestViewCount)}` : '—'}
        onClick={onSelect}
      />
    </div>
  );
};

export default TrendSection;
