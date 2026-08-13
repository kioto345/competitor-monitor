import { DiffResult, PageMeta, TrackField } from './types';

export function diff(prev: PageMeta[], curr: PageMeta[], track: TrackField[]): DiffResult {
  const prevByUrl = new Map(prev.map((p) => [p.url, p]));
  const currByUrl = new Map(curr.map((p) => [p.url, p]));

  const newPages: PageMeta[] = [];
  const removedPages: PageMeta[] = [];
  const changedTitle: DiffResult['changedTitle'] = [];
  const changedH1: DiffResult['changedH1'] = [];
  const changedDesc: DiffResult['changedDesc'] = [];

  for (const [url, page] of currByUrl) {
    const prevPage = prevByUrl.get(url);
    if (!prevPage) {
      newPages.push(page);
      continue;
    }
    if (track.includes('title') && prevPage.title !== page.title) {
      changedTitle.push({ url, old: prevPage.title, new: page.title });
    }
    if (track.includes('h1') && prevPage.h1 !== page.h1) {
      changedH1.push({ url, old: prevPage.h1, new: page.h1 });
    }
    if (track.includes('description') && prevPage.description !== page.description) {
      changedDesc.push({ url, old: prevPage.description, new: page.description });
    }
  }

  for (const [url, page] of prevByUrl) {
    if (!currByUrl.has(url)) {
      removedPages.push(page);
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
