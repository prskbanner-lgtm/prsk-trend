import React, { useEffect, useState, useMemo } from 'react';
import { DataResponse } from './types';
import { fetchVideoData } from './services/dataService';
import { ProcessedVideoData, SortMode, TrendPicks, GroupScope } from './types';
import { predictValueAt, calcDeltaWithPrediction, parseISOorDateString } from './utils/math';
import Header from './components/Header';
import TrendSection from './components/TrendSection';
import ChartSection from './components/ChartSection';
import RankingList from './components/RankingList';

const App: React.FC = () => {
  const [rawData, setRawData] = useState<DataResponse | null>(null);
  const [selectedVideo, setSelectedVideo] = useState<ProcessedVideoData | null>(null);

  // Filter States
  const [searchValue, setSearchValue] = useState('');
  const [scope, setScope] = useState<GroupScope>('all');
  const [filterValue, setFilterValue] = useState('all');
  const [sortMode, setSortMode] = useState<SortMode>('total');

  // Load Data
  const load = async () => {
    try {
      const data = await fetchVideoData();
      setRawData(data);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 20 * 60 * 1000); // 20 min refresh
    return () => clearInterval(interval);
  }, []);

  // Process Data (Predictions & Stats)
  const allProcessedVideos = useMemo(() => {
    if (!rawData) return [];
    const now = new Date();
    return rawData.videos.map(v => ({
      ...v,
      latestViewCount: predictValueAt(v.history, now),
      delta7: calcDeltaWithPrediction(v.history, 7),
      delta30: calcDeltaWithPrediction(v.history, 30),
    })) as ProcessedVideoData[];
  }, [rawData]);

  // Calculate Trends (Global, ignores filters)
  const trends = useMemo<TrendPicks>(() => {
    if (allProcessedVideos.length === 0) return { new: null, week: null, month: null, total: null };

    const sortedBy7 = [...allProcessedVideos].sort((a, b) => b.delta7 - a.delta7);
    const sortedBy30 = [...allProcessedVideos].sort((a, b) => b.delta30 - a.delta30);
    const sortedByTotal = [...allProcessedVideos].sort((a, b) => b.latestViewCount - a.latestViewCount);

    let topNew: { video: ProcessedVideoData; date: Date } | null = null;
    for (const v of allProcessedVideos) {
      const pd = parseISOorDateString(v.published);
      if (!pd) continue;
      if (!topNew || pd.getTime() > topNew.date.getTime()) {
        topNew = { video: v, date: pd };
      }
    }

    return {
      week: sortedBy7[0] || null,
      month: sortedBy30[0] || null,
      total: sortedByTotal[0] || null,
      new: topNew
    };
  }, [allProcessedVideos]);

  // Filtered List for Ranking
  const filteredVideos = useMemo(() => {
    let list = allProcessedVideos.slice();

    // Group Filter
    if (filterValue !== 'all') {
      if (filterValue.startsWith('banner:')) {
        const banner = filterValue.replace('banner:', '');
        list = list.filter(v => v.banner === banner);
      } else if (filterValue.startsWith('unit:')) {
        const unit = filterValue.replace('unit:', '');
        list = list.filter(v => v.unit === unit);
      } else {
         // Direct match (from simpler scope dropdowns)
         if (scope === 'banner') list = list.filter(v => v.banner === filterValue);
         if (scope === 'unit') list = list.filter(v => v.unit === filterValue);
      }
    }

    // Search Filter
    if (searchValue.trim()) {
      const q = searchValue.toLowerCase();
      list = list.filter(v =>
        v.title.toLowerCase().includes(q) ||
        (v.banner && v.banner.toLowerCase().includes(q)) ||
        (v.unit && v.unit.toLowerCase().includes(q))
      );
    }

    // Sorting
    if (sortMode === 'total') {
      list.sort((a, b) => b.latestViewCount - a.latestViewCount);
    } else {
      list.sort((a, b) => {
        const da = parseISOorDateString(a.published)?.getTime() || 0;
        const db = parseISOorDateString(b.published)?.getTime() || 0;
        return db - da;
      });
    }

    return list;
  }, [allProcessedVideos, filterValue, searchValue, scope, sortMode]);

  // Initial Selection
  useEffect(() => {
    if (!selectedVideo && filteredVideos.length > 0) {
      setSelectedVideo(filteredVideos[0]);
    }
  }, [filteredVideos, selectedVideo]);

  // Handlers
  const handleBadgeClick = (type: 'banner' | 'unit', val: string) => {
    setSearchValue('');
    setScope('all');
    // Use microtask to update filter after state updates
    setTimeout(() => {
       setFilterValue(`${type}:${val}`);
    }, 0);
  };

  const handleClearFilters = () => {
    setSearchValue('');
    setScope('all');
    setFilterValue('all');
  };

  return (
    <div className="min-h-screen pb-10">
      <Header
        lastUpdated={rawData?.updated_at || null}
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        scope={scope}
        onScopeChange={setScope}
        filterValue={filterValue}
        onFilterChange={setFilterValue}
        onClear={handleClearFilters}
      />

      <main className="mt-20 md:mt-24 max-w-[1400px] mx-auto px-4 flex flex-col gap-6">
        <section>
          <h2 className="text-lg font-bold text-slate-700 mb-3 hidden md:block">トレンド</h2>
          <TrendSection trends={trends} onSelect={setSelectedVideo} />
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-auto lg:h-[600px]">
          <div className="lg:col-span-8 h-[500px] lg:h-full">
             <ChartSection video={selectedVideo} onBadgeClick={handleBadgeClick} />
          </div>

          <div className="lg:col-span-4 h-auto lg:h-full">
            <RankingList
              videos={filteredVideos}
              selectedId={selectedVideo?.videoId || null}
              onSelect={setSelectedVideo}
              sortMode={sortMode}
              onSortChange={setSortMode}
              onBadgeClick={handleBadgeClick}
            />
          </div>

        </div>
      </main>
    </div>
  );
};

export default App;
