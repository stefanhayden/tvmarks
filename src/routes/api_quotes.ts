import express from 'express';
import * as apDb from '../activity-pub-db';
import { domain } from '../util';

const router = express.Router();

// Helper to build possible search strings for a status identifier
function buildSearchTerms(id: string) {
  const terms = [id];
  // url for message id form
  terms.push(`https://${domain}/m/${id}`);
  // possible public page url
  terms.push(`https://${domain}/${id}`);
  return terms;
}

// GET /api/v1/statuses/:id/quotes
router.get('/statuses/:id/quotes', async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).send('Bad request');

  const terms = buildSearchTerms(id);
  const results = new Set();

  for (const t of terms) {
    try {
      const rows = await apDb.findMessage(t);
      if (rows && rows.length > 0) {
        rows.forEach((r) => {
          try {
            const parsed = JSON.parse(r.message || '{}');
            results.add(JSON.stringify(parsed));
          } catch (e) {
            // ignore parse errors
          }
        });
      }
    } catch (e) {
      // ignore
    }
  }

  const out = Array.from(results).map((s) => JSON.parse(s));
  return res.json(out);
});

// POST /api/v1/statuses/:id/quotes/:quoting_status_id/revoke
router.post('/statuses/:id/quotes/:quoting_status_id/revoke', async (req, res) => {
  const { quoting_status_id } = req.params;
  if (!quoting_status_id) return res.status(400).send('Bad request');

  try {
    // try to find by guid
    const msg = await apDb.getMessage(quoting_status_id);
    if (msg) {
      await apDb.deleteMessage(quoting_status_id);
      return res.sendStatus(200);
    }

    // fallback: try to find a message whose content contains the quoting id
    const rows = await apDb.findMessage(quoting_status_id);
    if (rows && rows.length > 0) {
      await Promise.all(rows.map((r) => apDb.deleteMessage(r.guid)));
      return res.sendStatus(200);
    }
  } catch (e) {
    console.log('error revoking quote', e);
    return res.status(500).send('Server error');
  }

  return res.status(404).send('Not found');
});

// PUT /api/v1/statuses/:id/interaction_policy
router.put('/statuses/:id/interaction_policy', async (req, res) => {
  // This app does not yet implement persistent quote approval policy storage.
  // Accept the request and return a simple 200 to be compatible.
  return res.sendStatus(200);
});

export default router;
