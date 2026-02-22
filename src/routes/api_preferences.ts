import express from 'express';

const router = express.Router();

// GET /api/v1/preferences
// Minimal implementation returning the default quote policy as 'public'
router.get('/preferences', async (req, res) => {
  return res.json({
    'posting:default:quote_policy': 'public',
  });
});

export default router;
