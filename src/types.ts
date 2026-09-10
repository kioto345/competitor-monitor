export type TrackField = 'title' | 'h1' | 'description';

export interface Competitor {
  id: string;
  name: string;
  url: string;
  maxPages?: number; // default 300
  maxDepth?: number; // default 3
  track?: TrackField[]; // default ['title', 'h1', 'description']
}

export interface PageMeta {
  url: string;
  title: string;
  description: string;
  h1: string;
  scannedAt: string; // ISO 8601
}

export interface PageChange {
  url: string;
  old: string;
  new: string;
}

export interface DiffResult {
  newPages: PageMeta[];
  removedPages: PageMeta[];
  changedTitle: PageChange[];
  changedH1: PageChange[];
  changedDesc: PageChange[];
  hasChanges: boolean;
}

export interface CompetitorResult {
  competitor: Competitor;
  diff: DiffResult | null;
  totalPages: number;
  duration: number; // seconds
  isFirstRun: boolean;
  error: string | null;
}
