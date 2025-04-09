import express from 'express';
import { isAuthenticated } from '../session-auth.js';

const router = express.Router();

router.post('/:id/toggle', isAuthenticated, async (req, res) => {
  const tvshowDb = req.app.get('tvshowDb');

  await tvshowDb.toggleCommentVisibility(req.params.id);

  return res.redirect(req.get('Referrer'));
});

export default router;
