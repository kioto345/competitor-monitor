export type TrackField = 'title' | 'h1' | 'description';

export interface Competitor {
  id: string;
  name: string;
  url: string;
  maxPages?: number;
  maxDepth?: number;
  track?: TrackField[];
}

export interface PageMeta {
  url: string;
  title: string;
  description: string;
  h1: string;
  scannedAt: string;
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
  duration: number;
  isFirstRun: boolean;
  error: string | null;
}
