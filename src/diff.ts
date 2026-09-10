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

  for (const page of curr) {
    const prevPage = prevByUrl.get(page.url);
    if (!prevPage) continue;

    if (track.includes('title') && prevPage.title !== page.title) {
      changedTitle.push({ url: page.url, old: prevPage.title, new: page.title });
    }
    if (track.includes('h1') && prevPage.h1 !== page.h1) {
      changedH1.push({ url: page.url, old: prevPage.h1, new: page.h1 });
    }
    if (track.includes('description') && prevPage.description !== page.description) {
      changedDesc.push({ url: page.url, old: prevPage.description, new: page.description });
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
