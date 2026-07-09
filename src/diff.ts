import { PageMeta, DiffResult, TrackField } from './types';

export function diff(prev: PageMeta[], curr: PageMeta[], track: TrackField[]): DiffResult {
  const prevByUrl = new Map(prev.map((p) => [p.url, p]));
  const currByUrl = new Map(curr.map((p) => [p.url, p]));

  const result: DiffResult = {
    newPages: [],
    removedPages: [],
    changedTitle: [],
    changedH1: [],
    changedDesc: [],
    hasChanges: false,
  };

  for (const page of curr) {
    if (!prevByUrl.has(page.url)) {
      result.newPages.push(page);
    }
  }

  for (const page of prev) {
    if (!currByUrl.has(page.url)) {
      result.removedPages.push(page);
    }
  }

  for (const [url, currPage] of currByUrl) {
    const prevPage = prevByUrl.get(url);
    if (!prevPage) continue;

    if (track.includes('title') && prevPage.title !== currPage.title) {
      result.changedTitle.push({ url, old: prevPage.title, new: currPage.title });
    }
    if (track.includes('h1') && prevPage.h1 !== currPage.h1) {
      result.changedH1.push({ url, old: prevPage.h1, new: currPage.h1 });
    }
    if (track.includes('description') && prevPage.description !== currPage.description) {
      result.changedDesc.push({ url, old: prevPage.description, new: currPage.description });
    }
  }

  result.hasChanges =
    result.newPages.length > 0 ||
    result.removedPages.length > 0 ||
    result.changedTitle.length > 0 ||
    result.changedH1.length > 0 ||
    result.changedDesc.length > 0;

  return result;
}
