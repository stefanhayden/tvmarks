import { initTvshowDb } from './tvshow-db.js';

const dateFormat = (v) => v.split('T').join(' ').split('.')[0];

const now = dateFormat(new Date().toISOString());
const past6Months = dateFormat(new Date(new Date().setMonth(new Date().getMonth() - 6)).toISOString());
const past4Months = dateFormat(new Date(new Date().setMonth(new Date().getMonth() - 4)).toISOString());
const past3Months = dateFormat(new Date(new Date().setMonth(new Date().getMonth() - 3)).toISOString());
const past3Days = dateFormat(new Date(new Date().setDate(new Date().getDate() - 3)).toISOString());
const nextWeek = dateFormat(new Date(new Date().setDate(new Date().getDate() + 7)).toISOString());
const next2Week = dateFormat(new Date(new Date().setDate(new Date().getDate() + 14)).toISOString());

describe('tvshow-db', () => {
  let db;
  beforeAll(async () => {
    db = initTvshowDb(':memory:');

    await db.init();
    
    // NOT STARTED
    await db.createShow({
      id: 1,
    });
    await db.createEpisode({
      id: 101,
      show_id: 1,
    });
    await db.createEpisode({
      id: 102,
      show_id: 1,
    });
    
    // COMPLETED
    await db.createShow({
      id: 2,
      status: 'Ended'
    });
    await db.createEpisode({
      id: 201,
      show_id: 2,
      season: 1,
      number: 1,
      watched_status: 'WATCHED',
      watched_at: now,
      airdate: past3Days.split(' ')[0],
    });
    await db.createEpisode({
      id: 202,
      show_id: 2,
      season: 1,
      number: 2,
      watched_status: 'WATCHED',
      watched_at: now,
      airdate: past3Days.split(' ')[0],
    });
    await db.createEpisode({
      id: 203,
      show_id: 2,
      season: 1,
      number: null,
      airdate: past3Days.split(' ')[0],
    });

    
    // UP TO DATE
    await db.createShow({
      id: 3,
      status: 'Running'
    });
    await db.createEpisode({
      id: 301,
      show_id: 3,
      season: 1,
      number: 1,
      watched_status: 'WATCHED',
      watched_at: now,
      airdate: past3Days.split(' ')[0],
    });
    await db.createEpisode({
      id: 302,
      show_id: 3,
      season: 1,
      number: 2,
      watched_status: 'WATCHED',
      watched_at: now,
      airdate: past3Days.split(' ')[0],
    });
    await db.createEpisode({
      id: 303,
      show_id: 3,
      season: 1,
      number: null,
      airdate: past3Days.split(' ')[0],
    });
    

    // UP TO DATE
    // marked unaired shows as watched
    await db.createShow({
      id: 31,
      status: 'Running'
    });
    await db.createEpisode({
      id: 3101,
      show_id: 31,
      season: 1,
      number: 1,
      watched_status: 'WATCHED',
      watched_at: now,
      airdate: past3Days.split(' ')[0],
    });
    await db.createEpisode({
      id: 3102,
      show_id: 31,
      season: 1,
      number: 2,
      watched_status: 'WATCHED',
      watched_at: now,
      airdate: past3Days.split(' ')[0],
    });
    await db.createEpisode({
      id: 3103,
      show_id: 31,
      season: 1,
      number: 3,
      // watched_status: 'WATCHED',
      // watched_at: now,
      airdate: nextWeek.split(' ')[0],
    });
    await db.createEpisode({
      id: 3104,
      show_id: 31,
      season: 1,
      number: 4,
      airdate: next2Week.split(' ')[0],
    });
    
    // TO WATCH #1
    await db.createShow({
      id: 4,
      status: 'Running'
    });
    await db.createEpisode({
      id: 401,
      show_id: 4,
      season: 1,
      number: 1,
      watched_status: 'WATCHED',
      watched_at: now,
      airdate: past3Days.split(' ')[0],
    });
    await db.createEpisode({
      id: 402,
      show_id: 4,
      season: 1,
      number: 2,
      airdate: past3Days.split(' ')[0],
    });
    await db.createEpisode({
      id: 403,
      show_id: 4,
      season: 1,
      number: null,
      airdate: past3Days.split(' ')[0],
    });
    
    // TO WATCH #2
    await db.createShow({
      id: 41,
      status: 'Ended'
    });
    await db.createEpisode({
      id: 4101,
      show_id: 41,
      season: 1,
      number: 1,
      watched_status: 'WATCHED',
      watched_at: now,
      airdate: past3Days.split(' ')[0],
    });
    await db.createEpisode({
      id: 4102,
      show_id: 41,
      season: 1,
      number: 2,
      airdate: past3Days.split(' ')[0],
    });
    await db.createEpisode({
      id: 4103,
      show_id: 41,
      season: 1,
      number: null,
      airdate: past3Days.split(' ')[0],
    });
    
    // TO WATCH #3
    await db.createShow({
      id: 42,
      status: 'To Be Determined'
    });
    await db.createEpisode({
      id: 4201,
      show_id: 42,
      season: 1,
      number: 1,
      watched_status: 'WATCHED',
      watched_at: now,
      airdate: past3Days.split(' ')[0],
    });
    await db.createEpisode({
      id: 4202,
      show_id: 42,
      season: 1,
      number: 2,
      airdate: past3Days.split(' ')[0],
    });
    await db.createEpisode({
      id: 4203,
      show_id: 42,
      season: 1,
      number: null,
      airdate: past3Days.split(' ')[0],
    });
    
    // ABANDONED
    // watched 1 episode 2 months after aired and was up to date
    // didn't watch new episodes for 4 months
    await db.createShow({
      id: 5,
      status: 'Running'
    });
    await db.createEpisode({
      id: 501,
      show_id: 5,
      season: 1,
      number: 1,
      watched_status: 'WATCHED',
      watched_at: past4Months,
      airdate: past6Months.split(' ')[0],
    });
    await db.createEpisode({
      id: 502,
      show_id: 5,
      season: 1,
      number: 2,
      airdate: past3Months.split(' ')[0],
    });
    await db.createEpisode({
      id: 503,
      show_id: 5,
      season: 1,
      number: 3,
      airdate: past3Days.split(' ')[0],
    });
    await db.createEpisode({
      id: 504,
      show_id: 5,
      season: 1,
      number: 4,
      airdate: nextWeek.split(' ')[0],
    });
    await db.createEpisode({
      id: 505,
      show_id: 5,
      season: 1,
      number: null,
      airdate: nextWeek.split(' ')[0],
    });
    
    // ABANDONED #2
    // watched 1 episode 2 months after aired
    // didn't watch new episodes for 4 months
    await db.createShow({
      id: 51,
      status: 'Ended'
    });
    await db.createEpisode({
      id: 5101,
      show_id: 51,
      season: 1,
      number: 1,
      watched_status: 'WATCHED',
      watched_at: past4Months,
      airdate: past6Months.split(' ')[0],
    });
    await db.createEpisode({
      id: 5102,
      show_id: 51,
      season: 1,
      number: 2,
      airdate: past6Months.split(' ')[0],
    });
    await db.createEpisode({
      id: 5103,
      show_id: 51,
      season: 1,
      number: 3,
      airdate: past6Months.split(' ')[0],
    });
    await db.createEpisode({
      id: 5104,
      show_id: 51,
      season: 1,
      number: 4,
      airdate: past6Months.split(' ')[0],
    });
    await db.createEpisode({
      id: 5105,
      show_id: 51,
      season: 1,
      number: null,
      airdate: past6Months.split(' ')[0],
    });
  });

  
  test('get shows and episodes', async () => {
    const shows = await db.getShows();
    const episodesByShowId = await db.getEpisodesByShowId(1);


    expect(shows?.length).toBe(9);
    expect(episodesByShowId?.length).toBe(2);
  });
  
  test('showsNotStarted', async () => {
    const showsNotStarted = await db.getShowsNotStarted();
    
    expect(showsNotStarted?.length).toBe(1);
    expect(showsNotStarted[0].id).toBe(1);
  });
  
  test('getShowsCompleted', async () => {
    const getShowsCompleted = await db.getShowsCompleted();

    expect(getShowsCompleted?.length).toBe(1);
    expect(getShowsCompleted[0].id).toBe(2);
  });
  
  test('getShowsUpToDate', async () => {
    const getShowsUpToDate = await db.getShowsUpToDate();
    
    expect(getShowsUpToDate?.length).toBe(2);
    expect(getShowsUpToDate[0].id).toBe(3);
    expect(getShowsUpToDate[1].id).toBe(31);
  });
  
  test('getShowsToWatch', async () => {
    const getShowsToWatch = await db.getShowsToWatch();
    
    expect(getShowsToWatch?.length).toBe(3);
    expect(getShowsToWatch[0].id).toBe(4);
    expect(getShowsToWatch[1].id).toBe(41);
    expect(getShowsToWatch[2].id).toBe(42);
  });
  
  test('getShowsAbandoned', async () => {
    const getShowsAbandoned = await db.getShowsAbandoned();
    
    expect(getShowsAbandoned?.length).toBe(2);
    expect(getShowsAbandoned[0].id).toBe(5);
    expect(getShowsAbandoned[1].id).toBe(51);
  });
})