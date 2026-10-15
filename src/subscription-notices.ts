import * as tvDb from './tvshow-db';
import { NO_SERVICE } from './streaming-services';

// Whether a show has unwatched episodes, in any season, that have aired or air soon.
// undefined when that couldn't be determined, so callers can leave things as they are.
const hasSomethingToWatch = async (show: tvDb.Show) => {
  if (!show.watched_episodes_count) return true;
  const count = await tvDb.getEpisodesToWatchSoonCount(show.id);
  return count === undefined ? undefined : count > 0;
};

// Call after an episode is marked watched.
// Leaves a notice when that was the last thing to watch on the show's streaming service.
// A failure here must never get in the way of the watch itself.
export const addSubscriptionNoticeIfUnused = async (showId: string | number) => {
  try {
    const show = await tvDb.getShow(showId);
    const service = (await tvDb.getStreamingService(show?.streaming_service))?.slug;
    // owned media isn't a subscription
    if (!service || service === NO_SERVICE) return;

    const inProgress = await tvDb.getShowIdsInProgress(service);
    if (inProgress?.length === 0 && (await hasSomethingToWatch(show)) === false) {
      await tvDb.setSubscriptionNotice(service, show.id);
    }
  } catch (error) {
    console.error('failed addSubscriptionNoticeIfUnused', error);
  }
};

// What checking the notices needs, for a caller that has it loaded already.
type Loaded = { services?: tvDb.StoredStreamingService[]; inProgress?: tvDb.ShowInProgress[] };

// Every stored notice, with whether it stopped being true since it was left:
// the service is in use again, or its show moved to another service, was deleted, or has something to watch.
// Throws when something couldn't be loaded, so a notice is never thought stale because of a failed query.
const checkSubscriptionNotices = async (loaded: Loaded = {}) => {
  const notices = await tvDb.getSubscriptionNotices();
  if (!notices) throw new Error('could not load the notices');
  if (notices.length === 0) return [];
  const [services, inProgress] = await Promise.all([loaded.services || tvDb.getStreamingServices(), loaded.inProgress || tvDb.getShowsInProgress()]);
  if (!services || !inProgress) throw new Error('could not load the services');
  const bySlug = new Map(services.map((service) => [service.slug, service]));
  const inUse = new Set(inProgress.map((show) => show.streaming_service));
  return notices.map((notice) => {
    const service = bySlug.get(notice.service);
    // the show_ columns are null when the show is gone
    const somethingToWatch = !notice.show_watched_episodes_count || (notice.show_to_watch_soon_count ?? 0) > 0;
    const stale = !service || notice.show_service !== service.slug || inUse.has(service.slug) || somethingToWatch;
    return { ...notice, slug: notice.service, service, stale };
  });
};

// The notices to show. With deleteStale, ones that stopped being true are also deleted:
// only the owner's visits should change anything, the notices are theirs.
export const getCurrentSubscriptionNotices = async ({ deleteStale = false, ...loaded }: { deleteStale?: boolean } & Loaded = {}) => {
  try {
    const notices = await checkSubscriptionNotices(loaded);
    if (deleteStale) await Promise.all(notices.filter((notice) => notice.stale).map((notice) => tvDb.deleteSubscriptionNotice(notice.slug)));
    return notices.filter((notice) => !notice.stale);
  } catch (error) {
    console.error('failed getCurrentSubscriptionNotices', error);
  }
  return [];
};
