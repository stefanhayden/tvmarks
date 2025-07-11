import * as dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import { create } from 'express-handlebars';
import escapeHTML from 'escape-html';
import helpers from 'handlebars-helpers';

import { domain, account, simpleLogger, actorInfo, replaceEmptyText, dataDir } from './src/util.js';
import session, { isAuthenticated } from './src/session-auth.js';
import * as apDb from './src/activity-pub-db.js';
import { initTvshowDb } from './src/tvshow-db.js';
import packageJson from './package.json' with { type: 'json' };

import routes from './src/routes/index.js';

dotenv.config();

const { version } = packageJson;
const symlinkPath = `${dataDir}/show_images`;

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static('public'));
app.use('/shows', express.static(symlinkPath));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.json({ type: ['application/json', 'application/ld+json', 'application/activity+json'] }));
app.use(session());

app.use((req, res, next) => {
  res.locals.loggedIn = req.session.loggedIn;
  return next();
});

app.set('site_name', actorInfo.displayName || 'Tvmarks');
app.set('apDb', apDb);
const tvdb = initTvshowDb();
tvdb.init();
app.set('tvshowDb', tvdb);
app.set('account', account);
app.set('domain', domain);
app.disable('x-powered-by');

// force HTTPS in production
if (process.env.ENVIRONMENT === 'production') {
  app.set('trust proxy', ['127.0.0.1', '10.0.0.0/8']);

  app.use(({ secure, hostname, url }, response, next) => {
    if (!secure) {
      return response.redirect(308, `https://${hostname}${url}}`);
    }

    return next();
  });
} else {
  console.log("ENVIRONMENT is not 'production', HTTPS not forced");
}

const hbs = create({
  helpers: {
    ...helpers(), // https://www.npmjs.com/package/handlebars-helpers
    toCssPercent(number1, number2) {
      if (number2 === 0 || number1 == null) return 0;
      const val = (number1 / number2) * 100;
      if (val > 100) return 100;
      return val;
    },
    pluralize(number, singular, plural) {
      if (number === 1) return singular;
      return typeof plural === 'string' ? plural : `${singular}s`;
    },
    htmlize(text) {
      // uh-oh. ohhhh no.
      const returnText = escapeHTML(text);
      return returnText?.replace('\n', '<br/>');
    },
    siteName() {
      return app.get('site_name');
    },
    siteVersion() {
      return `v${version}`;
    },
    account() {
      return app.get('account');
    },
    feedUrl() {
      return `https://${app.get('domain')}/index.xml`;
    },
    projectUrl() {
      return `https://${app.get('domain')}`;
    },
    glitchProjectName() {
      return process.env.PROJECT_DOMAIN;
    },
    section(name, options) {
      if (!this._sections) this._sections = {};
      this._sections[name] = options.fn(this);
      return null;
    },
    mastodonAccount() {
      return process.env.MASTODON_ACCOUNT;
    },
    ifIn(item, array, options) {
      const lowercased = array.map((tag) => tag.toLowerCase());
      return lowercased.indexOf(item.toLowerCase()) >= 0 ? options.fn(this) : options.inverse(this);
    },
    eq(a, b, options) {
      return a === b ? options.fn(this) : options.inverse(this);
    },
    setTitle(item) {
      return replaceEmptyText(item.title, item.url);
    },
  },
  partialsDir: './src/pages/partials',
  extname: '.hbs',
});

app.set('view engine', '.hbs');
app.set('views', './src/pages');
app.engine('.hbs', hbs.engine);

app.use(simpleLogger);

app.use('/admin', isAuthenticated, routes.admin);
app.use('/', routes.auth);
app.use('/comment', routes.comment);
app.use('/.well-known/webfinger', cors(), routes.webfinger);
app.use('/u', cors(), routes.user);
app.use('/m', cors(), routes.message);
app.use('/', routes.core);
app.use('/show', routes.show);
app.use('/.well-known/nodeinfo', routes.nodeinfo);
app.use('/nodeinfo/2.0', routes.nodeinfo);
app.use('/nodeinfo/2.1', routes.nodeinfo);

app.listen(PORT, () => console.log(`App listening on port ${PORT}`));
