import * as tvDb from './tvshow-db';
import { getStreamingService } from './streaming-services';

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
    const service = getStreamingService(show?.streaming_service)?.slug;
    if (!service) return;

    const inProgress = await tvDb.getShowIdsInProgress(service);
    if (inProgress?.length === 0 && (await hasSomethingToWatch(show)) === false) {
      await tvDb.setSubscriptionNotice(service, show.id);
    }
  } catch (error) {
    console.error('failed addSubscriptionNoticeIfUnused', error);
  }
};

// The notices to show, after dropping any that stopped being true since they were left:
// the service is in use again, or its show moved to another service, was deleted, or has something to watch.
export const getCurrentSubscriptionNotices = async () => {
  try {
    const notices = (await tvDb.getSubscriptionNotices()) || [];
    const current = await Promise.all(
      notices.map(async (notice) => {
        const service = getStreamingService(notice.service);
        const show = await tvDb.getShow(notice.show_id);
        const inProgress = service && (await tvDb.getShowIdsInProgress(service.slug));

        const stale = !service || !show || show.streaming_service !== service.slug || inProgress?.length > 0 || (await hasSomethingToWatch(show)) === true;
        if (stale) {
          await tvDb.deleteSubscriptionNotice(notice.service);
          return undefined;
        }
        return { ...notice, service };
      }),
    );
    return current.filter(Boolean);
  } catch (error) {
    console.error('failed getCurrentSubscriptionNotices', error);
  }
  return [];
};
