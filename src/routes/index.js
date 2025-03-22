import admin from './admin.js';
import auth from './auth.js';
import comment from './comment.js';
import core from './core.js';
import inbox from './activitypub/inbox.js';
import message from './activitypub/message.js';
import user from './activitypub/user.js';
import webfinger from './activitypub/webfinger.js';
import nodeinfo from './activitypub/nodeinfo.js';
import show from './show.js';

export default {
  admin,
  auth,
  comment,
  core,
  inbox,
  message,
  user,
  webfinger,
  nodeinfo,
  show,
};
