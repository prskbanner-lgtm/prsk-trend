import React from 'react';
import { Search, RotateCw, Filter, X } from 'lucide-react';
import { BANNER_ORDER, UNIT_ORDER } from '../constants';
import { GroupScope } from '../types';

interface HeaderProps {
  lastUpdated: string | null;
  searchValue: string;
  onSearchChange: (val: string) => void;
  scope: GroupScope;
  onScopeChange: (val: GroupScope) => void;
  filterValue: string;
  onFilterChange: (val: string) => void;
  onClear: () => void;
}

const Header: React.FC<HeaderProps> = ({
  lastUpdated,
  searchValue,
  onSearchChange,
  scope,
  onScopeChange,
  filterValue,
  onFilterChange,
  onClear
}) => {
  return (
    <header className="sticky top-2 z-50 w-full max-w-[1400px] mx-auto">
      <div className="bg-white/80 backdrop-blur-md border border-white/50 shadow-sm rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all">
        <div className="flex flex-col">
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <span className="bg-red-600 text-white text-xs font-bold px-1.5 py-0.5 rounded">YT</span>
            <span>再生数ランキング & トレンド</span>
          </h1>
          <div className="text-xs text-slate-500 flex items-center gap-1 mt-1">
            <RotateCw size={12} />
            <span>最終更新: {lastUpdated ? new Date(lastUpdated).toLocaleString() : '読み込み中...'}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 text-slate-400" size={16} />
            <input
              type="search"
              placeholder="キーワード検索..."
              value={searchValue}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-9 pr-3 py-2 bg-slate-100 border border-slate-200 rounded-lg text-sm focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all w-full md:w-48"
            />
          </div>

          <div className="relative">
            <Filter className="absolute left-2.5 top-2.5 text-slate-400" size={16} />
            <select
              value={scope}
              onChange={(e) => {
                onScopeChange(e.target.value as GroupScope);
                onFilterChange('all');
              }}
              className="pl-9 pr-3 py-2 bg-slate-100 border border-slate-200 rounded-lg text-sm focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none appearance-none cursor-pointer min-w-[100px]"
            >
              <option value="all">全範囲</option>
              <option value="banner">バナー別</option>
              <option value="unit">ユニット別</option>
            </select>
          </div>

          <select
            value={filterValue}
            onChange={(e) => onFilterChange(e.target.value)}
            className="px-3 py-2 bg-slate-100 border border-slate-200 rounded-lg text-sm focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none cursor-pointer max-w-[160px]"
          >
            <option value="all">グループ: 全て</option>
            {scope === 'banner' && BANNER_ORDER.map(b => (
              <option key={b} value={b}>{b}</option>
            ))}
            {scope === 'unit' && UNIT_ORDER.map(u => (
              <option key={u} value={u}>{u}</option>
            ))}
            {scope === 'all' && (
              <>
                <optgroup label="--- バナー ---">
                  {BANNER_ORDER.map(b => <option key={`banner:${b}`} value={`banner:${b}`}>{b}</option>)}
                </optgroup>
                <optgroup label="--- ユニット ---">
                  {UNIT_ORDER.map(u => <option key={`unit:${u}`} value={`unit:${u}`}>{u}</option>)}
                </optgroup>
              </>
            )}
          </select>

          {(searchValue || filterValue !== 'all' || scope !== 'all') && (
            <button
              onClick={onClear}
              className="p-2 text-slate-500 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
              title="条件をクリア"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;
