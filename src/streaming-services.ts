export type StreamingService = {
  // stored in shows.streaming_service, so don't rename a slug once it is in use
  slug: string;
  name: string;
  // brand colors used to draw the service badge
  color: string;
  textColor: string;
};

export const streamingServices: StreamingService[] = [
  { slug: 'netflix', name: 'Netflix', color: '#000000', textColor: '#e50914' },
  { slug: 'hbo-max', name: 'HBO Max', color: '#000000', textColor: '#ffffff' },
  { slug: 'hulu', name: 'Hulu', color: '#1ce783', textColor: '#040405' },
  { slug: 'disney-plus', name: 'Disney+', color: '#0e3fa9', textColor: '#ffffff' },
  { slug: 'prime-video', name: 'Prime Video', color: '#1399ff', textColor: '#ffffff' },
  { slug: 'apple-tv', name: 'Apple TV', color: '#1d1d1f', textColor: '#ffffff' },
  { slug: 'paramount-plus', name: 'Paramount+', color: '#0064ff', textColor: '#ffffff' },
  { slug: 'peacock', name: 'Peacock', color: '#ffffff', textColor: '#000000' },
  { slug: 'youtube-tv', name: 'YouTube TV', color: '#ffffff', textColor: '#ff0000' },
  { slug: 'crunchyroll', name: 'Crunchyroll', color: '#f47521', textColor: '#ffffff' },
  { slug: 'amc-plus', name: 'AMC+', color: '#101820', textColor: '#ffffff' },
  { slug: 'starz', name: 'Starz', color: '#00323d', textColor: '#ffffff' },
  { slug: 'britbox', name: 'BritBox', color: '#101b3b', textColor: '#ffffff' },
  { slug: 'pbs', name: 'PBS', color: '#2638c4', textColor: '#ffffff' },
  { slug: 'tubi', name: 'Tubi', color: '#7408ff', textColor: '#ffffff' },
  { slug: 'cable', name: 'Cable', color: '#3a2a6b', textColor: '#ffffff' },
  { slug: 'other', name: 'Other', color: '#545454', textColor: '#ffffff' },
];

export const getStreamingService = (slug?: string | null) => streamingServices.find((service) => service.slug === slug);

type ServiceShow = { id: number; streaming_service?: string | null };

// A subscription is needed only while one of its shows is in progress (see getShowIdsInProgress).
// Everything else on a service (between seasons, finished, abandoned, not started) doesn't need the subscription right now.
export const groupShowsBySubscription = <T extends ServiceShow>(shows: { watching: T[]; upToDate: T[]; others: T[] }, inProgressShowIds: Set<number>) => {
  const groups = new Map(
    streamingServices.map((service) => [service.slug, { service, watching: [] as T[], upToDate: [] as T[], betweenSeasons: [] as T[], idle: [] as T[] }]),
  );
  const unassigned: T[] = [];
  const seen = new Set<number>();

  const add = (list: T[], bucket: 'watching' | 'upToDate' | 'betweenSeasons' | 'idle') =>
    list.forEach((show) => {
      if (seen.has(show.id)) return;
      seen.add(show.id);
      const group = groups.get(show.streaming_service);
      if (group) group[bucket].push(show);
      else if (bucket === 'watching' || bucket === 'upToDate') unassigned.push(show);
    });

  const inProgress = (show: T) => inProgressShowIds.has(show.id);
  add(shows.watching.filter(inProgress), 'watching');
  add(shows.upToDate.filter(inProgress), 'upToDate');
  add([...shows.watching, ...shows.upToDate], 'betweenSeasons');
  add(shows.others, 'idle');

  const activeCount = (group: { watching: T[]; upToDate: T[] }) => group.watching.length + group.upToDate.length;
  const idleCount = (group: { betweenSeasons: T[]; idle: T[] }) => group.betweenSeasons.length + group.idle.length;
  const used = [...groups.values()].filter((group) => activeCount(group) + idleCount(group) > 0);

  return {
    needed: used.filter((group) => activeCount(group) > 0).sort((a, b) => activeCount(b) - activeCount(a)),
    notNeeded: used.filter((group) => activeCount(group) === 0).sort((a, b) => idleCount(b) - idleCount(a)),
    unassigned,
  };
};
