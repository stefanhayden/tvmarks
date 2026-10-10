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

// Every stored notice, with whether it stopped being true since it was left:
// the service is in use again, or its show moved to another service, was deleted, or has something to watch.
const checkSubscriptionNotices = async () => {
  const notices = (await tvDb.getSubscriptionNotices()) || [];
  return Promise.all(
    notices.map(async (notice) => {
      const service = await tvDb.getStreamingService(notice.service);
      const show = await tvDb.getShow(notice.show_id);
      const inProgress = service && (await tvDb.getShowIdsInProgress(service.slug));

      const stale = !service || !show || show.streaming_service !== service.slug || inProgress?.length > 0 || (await hasSomethingToWatch(show)) === true;
      return { ...notice, slug: notice.service, service, stale };
    }),
  );
};

// The notices to show. Ones that stopped being true are deleted.
export const getCurrentSubscriptionNotices = async () => {
  try {
    const notices = await checkSubscriptionNotices();
    await Promise.all(notices.filter((notice) => notice.stale).map((notice) => tvDb.deleteSubscriptionNotice(notice.slug)));
    return notices.filter((notice) => !notice.stale);
  } catch (error) {
    console.error('failed getCurrentSubscriptionNotices', error);
  }
  return [];
};

// The services with a notice that is still true, without changing anything
export const getServicesWithSubscriptionNotice = async () => {
  try {
    return (await checkSubscriptionNotices()).filter((notice) => !notice.stale).map((notice) => notice.slug);
  } catch (error) {
    console.error('failed getServicesWithSubscriptionNotice', error);
  }
  return [];
};
