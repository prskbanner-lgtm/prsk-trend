export interface HistoryEntry {
  datetime?: string;
  date?: string;
  views: number;
}

export interface VideoData {
  videoId: string;
  url: string;
  title: string;
  thumbnail: string;
  published: string;
  banner: string;
  unit: string;
  history: HistoryEntry[];
}

export interface DataResponse {
  videos: VideoData[];
  updated_at: string;
}

export interface ProcessedVideoData extends VideoData {
  latestViewCount: number;
  delta7: number;
  delta30: number;
}

export type SortMode = 'total' | 'published';
export type TimeScope = 'all' | '30' | '7';
export type GroupScope = 'all' | 'banner' | 'unit';

export interface TrendPicks {
  new: { video: ProcessedVideoData; date: Date } | null;
  week: ProcessedVideoData | null;
  month: ProcessedVideoData | null;
  total: ProcessedVideoData | null;
}
