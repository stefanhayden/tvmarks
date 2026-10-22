import { describe, expect, test } from 'vitest';
import { createNoteObject, createEpisodeNoteObject, showHashtag, showPostData, episodePostData } from './activitypub';

const domain = 'tv.example';
const show = { id: 526, name: 'The Office', url: 'https://www.tvmaze.com/shows/526/the-office', note: 'so good', tags: 'comfy Rewatch' };
const episode = { id: 9, season: 2, number: 3, note: null, tags: 'finale comfy' };

const tagNames = (note) => note.tag.map((tag) => tag.name);

describe('showHashtag', () => {
  test("is the show's TVMaze slug in title case", () => {
    expect(showHashtag(show.url)).toBe('TheOffice');
  });

  test('keeps a show named only with numbers', () => {
    expect(showHashtag('https://www.tvmaze.com/shows/167/24')).toBe('24');
  });

  test("is nothing for a url with nothing a hashtag can hold", () => {
    expect(showHashtag('https://www.tvmaze.com/shows/')).toBeUndefined();
  });
});

describe('a show post', () => {
  const note = createNoteObject(showPostData(show, domain), 'me', domain);

  test('is tagged #tvmarks, with the show, and with its hashtags', () => {
    expect(tagNames(note)).toEqual(['#tvmarks', '#TheOffice', '#comfy', '#Rewatch']);
  });

  test('links its hashtags to the tagged page, and the automatic ones to the site and the show', () => {
    expect(note.tag.map((tag) => tag.href)).toEqual([
      'https://tv.example/',
      'https://tv.example/show/526',
      'https://tv.example/tagged/comfy',
      'https://tv.example/tagged/Rewatch',
    ]);
  });

  test('shows its hashtags in the post', () => {
    expect(note.content).toContain('<a href="https://tv.example/tagged/comfy" class="mention hashtag" rel="tag">#<span>comfy</span></a>');
    expect(note.content).toContain('#<span>Rewatch</span>');
  });

  test('without hashtags has none in the post', () => {
    const plain = createNoteObject(showPostData({ ...show, tags: null }, domain), 'me', domain);
    expect(plain.content).not.toContain('hashtag');
    expect(tagNames(plain)).toEqual(['#tvmarks', '#TheOffice']);
  });

  test("doesn't repeat a hashtag the post already gets", () => {
    const repeated = createNoteObject(showPostData({ ...show, tags: 'theoffice TVMARKS' }, domain), 'me', domain);
    expect(tagNames(repeated)).toEqual(['#tvmarks', '#TheOffice']);
  });

  test('links a hashtag the post already gets to the same place in the post', () => {
    const repeated = createNoteObject(showPostData({ ...show, tags: 'theoffice' }, domain), 'me', domain);
    expect(repeated.content).toContain('<a href="https://tv.example/show/526" class="mention hashtag" rel="tag">#<span>theoffice</span></a>');
    expect(repeated.content).not.toContain('/tagged/');
  });
});

describe('an episode post', () => {
  test("carries the show's hashtags and its own", () => {
    expect(episodePostData(show, episode, domain).tags).toEqual(['comfy', 'Rewatch', 'finale']);
  });

  test('fetched from the episode page has the same hashtags', () => {
    const note = createEpisodeNoteObject(episode, show, 'me', domain);
    expect(tagNames(note)).toEqual(['#tvmarks', '#TheOffice', '#comfy', '#Rewatch', '#finale']);
    expect(note.content).toContain('#<span>finale</span>');
  });
});
