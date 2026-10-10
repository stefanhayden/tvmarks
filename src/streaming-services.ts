export type StreamingService = {
  // stored in shows.streaming_service, so don't rename a slug once it is in use
  slug: string;
  name: string;
  // colors used to draw the service badge
  color: string;
  textColor: string;
};

// for media that is owned: nothing to subscribe to, so it is never reported as in use or as cancellable
export const NO_SERVICE = 'none';

// Seeded into the streaming_services table, where more can be added from the admin page.
// The order here is only the starting order, the picker sorts by how many shows use each service.
export const defaultStreamingServices: StreamingService[] = [
  { slug: NO_SERVICE, name: 'None', color: '#ffffff', textColor: '#545454' },
  { slug: 'netflix', name: 'Netflix', color: '#000000', textColor: '#e50914' },
  { slug: 'hbo-max', name: 'HBO Max', color: '#000000', textColor: '#ffffff' },
  { slug: 'hulu', name: 'Hulu', color: '#1ce783', textColor: '#040405' },
  { slug: 'disney-plus', name: 'Disney+', color: '#0e3fa9', textColor: '#ffffff' },
  { slug: 'prime-video', name: 'Prime Video', color: '#1399ff', textColor: '#ffffff' },
  { slug: 'apple-tv', name: 'Apple TV', color: '#1d1d1f', textColor: '#ffffff' },
  { slug: 'paramount-plus', name: 'Paramount+', color: '#0064ff', textColor: '#ffffff' },
  { slug: 'peacock', name: 'Peacock', color: '#ffffff', textColor: '#000000' },
  { slug: 'youtube-tv', name: 'YouTube TV', color: '#ffffff', textColor: '#ff0000' },
  { slug: 'youtube', name: 'YouTube', color: '#ff0000', textColor: '#ffffff' },
  { slug: 'crunchyroll', name: 'Crunchyroll', color: '#f47521', textColor: '#ffffff' },
  { slug: 'amc-plus', name: 'AMC+', color: '#101820', textColor: '#ffffff' },
  { slug: 'starz', name: 'Starz', color: '#00323d', textColor: '#ffffff' },
  { slug: 'mgm-plus', name: 'MGM+', color: '#000000', textColor: '#d4af37' },
  { slug: 'discovery-plus', name: 'Discovery+', color: '#2175d9', textColor: '#ffffff' },
  { slug: 'britbox', name: 'BritBox', color: '#101b3b', textColor: '#ffffff' },
  { slug: 'acorn-tv', name: 'Acorn TV', color: '#00a79d', textColor: '#ffffff' },
  { slug: 'bbc-iplayer', name: 'BBC iPlayer', color: '#000000', textColor: '#ff4c98' },
  { slug: 'channel-4', name: 'Channel 4', color: '#aaff89', textColor: '#000000' },
  { slug: 'cbc-gem', name: 'CBC Gem', color: '#e60505', textColor: '#ffffff' },
  { slug: 'pbs', name: 'PBS', color: '#2638c4', textColor: '#ffffff' },
  { slug: 'shudder', name: 'Shudder', color: '#000000', textColor: '#ea0000' },
  { slug: 'bet-plus', name: 'BET+', color: '#f20d7c', textColor: '#ffffff' },
  { slug: 'hallmark-plus', name: 'Hallmark+', color: '#5c2d91', textColor: '#ffffff' },
  { slug: 'hidive', name: 'HIDIVE', color: '#00aeef', textColor: '#ffffff' },
  { slug: 'viki', name: 'Viki', color: '#0c9bff', textColor: '#ffffff' },
  { slug: 'dropout', name: 'Dropout', color: '#feea3b', textColor: '#000000' },
  { slug: 'nebula', name: 'Nebula', color: '#0f1a2b', textColor: '#ffffff' },
  { slug: 'beacon', name: 'Beacon', color: '#1b1b1b', textColor: '#ffd23f' },
  { slug: 'twitch', name: 'Twitch', color: '#9146ff', textColor: '#ffffff' },
  { slug: 'criterion-channel', name: 'Criterion Channel', color: '#000000', textColor: '#ffffff' },
  { slug: 'curiosity-stream', name: 'Curiosity Stream', color: '#f7941d', textColor: '#000000' },
  { slug: 'sling-tv', name: 'Sling TV', color: '#0072ce', textColor: '#ffffff' },
  { slug: 'fubo', name: 'Fubo', color: '#fa4616', textColor: '#ffffff' },
  { slug: 'philo', name: 'Philo', color: '#0064ff', textColor: '#ffffff' },
  { slug: 'directv-stream', name: 'DirecTV Stream', color: '#00a6d6', textColor: '#ffffff' },
  { slug: 'tubi', name: 'Tubi', color: '#7408ff', textColor: '#ffffff' },
  { slug: 'pluto-tv', name: 'Pluto TV', color: '#000000', textColor: '#fff200' },
  { slug: 'roku-channel', name: 'Roku Channel', color: '#662d91', textColor: '#ffffff' },
  { slug: 'plex', name: 'Plex', color: '#1f1f1f', textColor: '#e5a00d' },
  { slug: 'kanopy', name: 'Kanopy', color: '#e2231a', textColor: '#ffffff' },
  { slug: 'hoopla', name: 'Hoopla', color: '#1f7dc2', textColor: '#ffffff' },
  { slug: 'cable', name: 'Cable', color: '#3a2a6b', textColor: '#ffffff' },
];

// "Paramount+ with Showtime" -> "paramount-plus-with-showtime"
export const slugifyServiceName = (name: string) =>
  name
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

// network names from the data provider that go by another name as a service, keyed by slugifyServiceName
const networkAliases = new Map([
  ['hbo', 'hbo-max'],
  ['max', 'hbo-max'],
  ['apple-tv-plus', 'apple-tv'],
  ['amazon-prime-video', 'prime-video'],
  ['amazon-prime', 'prime-video'],
  ['paramount-plus-with-showtime', 'paramount-plus'],
  ['showtime', 'paramount-plus'],
  ['youtube-premium', 'youtube'],
  ['the-roku-channel', 'roku-channel'],
]);

// Never guessed from a network: choices only the viewer can make,
// and broadcast channels that share a name with a service but could be watched anywhere.
const neverGuessed = [NO_SERVICE, 'cable', 'pbs', 'channel-4'];

// The service a show is most likely watched on, going by the network it airs on.
// A network matches when a service carries its name or it is listed above. That covers streaming networks and
// the premium channels with a service of their own, like HBO and Starz. Broadcast networks like NBC or PBS don't match.
export const createStreamingServiceMatcher = <S extends StreamingService>(services: S[]) => {
  // a service's slug is its name run through slugifyServiceName, the same as is done to the network here
  const bySlug = new Map(services.filter((service) => !neverGuessed.includes(service.slug)).map((service) => [service.slug, service]));

  return (networkName: string | null | undefined) => {
    const network = slugifyServiceName(networkName || '');
    // a service named exactly like the network wins over an alias
    return bySlug.get(network) || bySlug.get(networkAliases.get(network)) || undefined;
  };
};

// 'network' when the service was guessed from the network, 'manual' once the viewer has picked one.
// Only used to know what a new guess may replace, a guessed service otherwise counts like any other.
export type StreamingServiceSource = 'manual' | 'network';

type ServiceShow = { id: number; streaming_service?: string | null };

// A subscription is needed only while one of its shows is in progress (see getShowIdsInProgress).
// Shows between seasons or not started are listed as not needing it right now.
// Abandoned shows (flagged, or untouched for three months) and completed shows aren't listed at all.
export const groupShowsBySubscription = <T extends ServiceShow, S extends StreamingService>(
  services: S[],
  shows: { watching: T[]; upToDate: T[]; notStarted: T[] },
  inProgressShowIds: Set<number>,
  // services to list even with no shows left to list, because they were in use until recently
  alwaysListed: string[] = [],
) => {
  const groups = new Map(
    services
      .filter((service) => service.slug !== NO_SERVICE)
      .map((service) => [service.slug, { service, watching: [] as T[], upToDate: [] as T[], betweenSeasons: [] as T[], notStarted: [] as T[] }]),
  );
  const unassigned: T[] = [];
  const seen = new Set<number>();

  const add = (list: T[], bucket: 'watching' | 'upToDate' | 'betweenSeasons' | 'notStarted') =>
    list.forEach((show) => {
      if (seen.has(show.id)) return;
      seen.add(show.id);
      if (show.streaming_service === NO_SERVICE) return;
      const group = groups.get(show.streaming_service);
      if (group) group[bucket].push(show);
      else if (bucket === 'watching' || bucket === 'upToDate') unassigned.push(show);
    });

  const inProgress = (show: T) => inProgressShowIds.has(show.id);
  add(shows.watching.filter(inProgress), 'watching');
  add(shows.upToDate.filter(inProgress), 'upToDate');
  add([...shows.watching, ...shows.upToDate], 'betweenSeasons');
  add(shows.notStarted, 'notStarted');

  const activeCount = (group: { watching: T[]; upToDate: T[] }) => group.watching.length + group.upToDate.length;
  const idleCount = (group: { betweenSeasons: T[]; notStarted: T[] }) => group.betweenSeasons.length + group.notStarted.length;
  const used = [...groups.values()].filter((group) => activeCount(group) + idleCount(group) > 0 || alwaysListed.includes(group.service.slug));

  return {
    needed: used.filter((group) => activeCount(group) > 0).sort((a, b) => activeCount(b) - activeCount(a)),
    notNeeded: used.filter((group) => activeCount(group) === 0).sort((a, b) => idleCount(b) - idleCount(a)),
    unassigned,
  };
};
