import express from 'express';
import { isAuthenticated } from '../session-auth.js';
import * as tvDb from '../tvshow-db.js';

const router = express.Router();

router.post('/:id/toggle', isAuthenticated, async (req, res) => {
  await tvDb.toggleCommentVisibility(req.params.id);

  return res.redirect(req.get('Referrer'));
});

router.post('/:id/delete', isAuthenticated, async (req, res) => {
  await tvDb.deleteCommentById(req.params.id);

  return res.redirect(req.get('Referrer'));
});

export default router;
