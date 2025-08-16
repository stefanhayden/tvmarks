import express from 'express';
import { synthesizeActivity } from '../../activitypub.js';
import * as apDb from '../../activity-pub-db.js';

const router = express.Router();

router.get('/:guid', async (req, res) => {
  let { guid } = req.params;
  let isActivity = false;

  if (guid.startsWith('a-')) {
    guid = guid.slice(2);
    isActivity = true;
  }

  if (!guid) {
    return res.status(400).send('Bad request.');
  }

  if (!req.headers.accept?.includes('json')) {
    const id = await apDb.getIdFromMessageGuid(guid);
    const parts = id.split('-');
    const showId = parts[1];
    const episodeId = parts[3];
    if (episodeId) {
      return res.redirect(`/show/${showId}/episode/${episodeId}`);
    }
    return res.redirect(`/show/${showId}`);
  }

  const result = await apDb.getMessage(guid);

  if (result === undefined) {
    return res.status(404).send(`No message found for ${guid}.`);
  }

  let object = JSON.parse(result.message);
  if (isActivity) {
    object = synthesizeActivity(object);
  }

  res.setHeader('Content-Type', 'application/activity+json');
  return res.json(object);
});

export default router;
