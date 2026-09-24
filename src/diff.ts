import { DiffResult, PageMeta, TrackField } from './types';

export function diff(prev: PageMeta[], curr: PageMeta[], track: TrackField[]): DiffResult {
  const prevByUrl = new Map(prev.map((p) => [p.url, p]));
  const currByUrl = new Map(curr.map((p) => [p.url, p]));

  const newPages: PageMeta[] = [];
  const removedPages: PageMeta[] = [];
  const changedTitle: DiffResult['changedTitle'] = [];
  const changedH1: DiffResult['changedH1'] = [];
  const changedDesc: DiffResult['changedDesc'] = [];

  for (const page of curr) {
    if (!prevByUrl.has(page.url)) {
      newPages.push(page);
    }
  }

  for (const page of prev) {
    if (!currByUrl.has(page.url)) {
      removedPages.push(page);
    }
  }

  for (const [url, currPage] of currByUrl) {
    const prevPage = prevByUrl.get(url);
    if (!prevPage) continue;

    if (track.includes('title') && prevPage.title !== currPage.title) {
      changedTitle.push({ url, old: prevPage.title, new: currPage.title });
    }
    if (track.includes('h1') && prevPage.h1 !== currPage.h1) {
      changedH1.push({ url, old: prevPage.h1, new: currPage.h1 });
    }
    if (track.includes('description') && prevPage.description !== currPage.description) {
      changedDesc.push({ url, old: prevPage.description, new: currPage.description });
    }
  }

  const hasChanges =
    newPages.length > 0 ||
    removedPages.length > 0 ||
    changedTitle.length > 0 ||
    changedH1.length > 0 ||
    changedDesc.length > 0;

  return { newPages, removedPages, changedTitle, changedH1, changedDesc, hasChanges };
}
