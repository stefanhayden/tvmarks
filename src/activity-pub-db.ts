/**
 * Module handles activitypub data management
 *
 * Server API calls the methods in here to query and update the SQLite database
 */

// Utilities we need
import * as path from 'path';
import fs from 'fs';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import crypto from 'crypto';
import { account, domain, actorInfo, dataDir } from './util';

type Account = {
  name: string;
  privkey: string;
  pubkey: string;
  webfinger: string;
  actor: string;
  followers: string;
  following: string;
  messages: string;
  blocks: string;
};

type Message = {
  guid: string;
  PRIMARY: string;
  message: string;
  id: string;
};

type Permission = {
  id: string;
  allowed: string;
  blocked: string;
};

const dbFile = `${dataDir}/activitypub.db`;
let db: Database<sqlite3.Database, sqlite3.Statement> | undefined;

function actorJson(pubkey) {
  return {
    '@context': ['https://www.w3.org/ns/activitystreams', 'https://w3id.org/security/v1'],

    id: `https://${domain}/u/${account}`,
    type: 'Person',
    preferredUsername: `${account}`,
    name: actorInfo.disabled === false ? actorInfo.displayName : undefined,
    summary: actorInfo.disabled === false ? actorInfo.description : undefined,
    icon: {
      type: 'Image',
      mediaType: `image/${path.extname(actorInfo.disabled === false ? actorInfo.avatar : '').slice(1)}`,
      url: actorInfo.disabled === false ? actorInfo.avatar : undefined,
    },
    inbox: `https://${domain}/u/${account}/inbox`,
    outbox: `https://${domain}/u/${account}/outbox`,
    followers: `https://${domain}/u/${account}/followers`,
    following: `https://${domain}/u/${account}/following`,

    publicKey: {
      id: `https://${domain}/u/${account}#main-key`,
      owner: `https://${domain}/u/${account}`,
      publicKeyPem: pubkey,
    },
  };
}

function webfingerJson() {
  return {
    subject: `acct:${account}@${domain}`,

    links: [
      {
        rel: 'self',
        type: 'application/activity+json',
        href: `https://${domain}/u/${account}`,
      },
    ],
  };
}

export async function getFollowers() {
  const result = await db?.get<Pick<Account, 'followers'>>('select followers from accounts limit 1');
  return result?.followers || null;
}

export async function setFollowers(followersJson: string) {
  return db?.run('update accounts set followers=?', followersJson);
}

export async function getFollowing() {
  const result = await db?.get<Pick<Account, 'following'>>('select following from accounts limit 1');
  return result?.following;
}

export async function setFollowing(followingJson) {
  return db?.run('update accounts set following=?', followingJson);
}

export async function getBlocks() {
  const result = await db?.get<Pick<Account, 'blocks'>>('select blocks from accounts limit 1');
  return result?.blocks;
}

export async function setBlocks(blocksJson: string) {
  return db?.run('update accounts set blocks=?', blocksJson);
}

export async function getActor() {
  const result = await db?.get<Pick<Account, 'actor'>>('select actor from accounts limit 1');
  return result?.actor;
}

export async function getWebfinger() {
  const result = await db?.get<Pick<Account, 'webfinger'>>('select webfinger from accounts limit 1');
  return result?.webfinger;
}

export async function getPublicKey() {
  const result = await db?.get<Pick<Account, 'pubkey'>>('select pubkey from accounts limit 1');
  return result?.pubkey;
}

export async function getPrivateKey() {
  const result = await db?.get<Pick<Account, 'privkey'>>('select privkey from accounts limit 1');
  return result?.privkey;
}

export async function getGuidForId(id) {
  return (await db?.get<Pick<Message, 'guid'>>('select guid from messages where id = ?', id))?.guid;
}

export async function getIdFromMessageGuid(guid) {
  return (await db?.get<Pick<Message, 'id'>>('select id from messages where guid = ?', guid))?.id;
}

export async function getMessage(guid) {
  return db?.get<Pick<Message, 'message'>>('select message from messages where guid = ?', guid);
}

export async function getMessageCount() {
  return (await db?.get<{ count: number }>('select count(message) as count from messages'))?.count;
}

export async function getMessages(offset = 0, limit = 20) {
  return db?.all<Pick<Message, 'message'>[]>('select message from messages order by id desc limit ? offset ?', limit, offset);
}

export async function findMessageGuid(id) {
  return (await db?.get<Pick<Message, 'guid'>>('select guid from messages where id = ?', id))?.guid;
}

export async function deleteMessage(guid: string) {
  await db?.get('delete from messages where guid = ?', guid);
}

export async function getGlobalPermissions() {
  return db?.get<Permission>('select * from permissions where id = 0');
}

export async function setPermissions(id, allowed, blocked) {
  return db?.run('insert or replace into permissions(id, allowed, blocked) values (?, ?, ?)', id, allowed, blocked);
}

export async function setGlobalPermissions(allowed, blocked) {
  return setPermissions('0', allowed, blocked);
}

export async function getPermissions(id) {
  return db?.get<Permission>('select * from permissions where id = ?', id);
}

export async function insertMessage(guid, id, json) {
  return db?.run('insert or replace into messages(guid, id, message) values(?, ?, ?)', guid, id, json);
}

export async function findMessage(object) {
  return db?.all<Message[]>('select * from messages where message like ?', `%${object}%`);
}

async function firstTimeSetup(actorName) {
  const newDb = new sqlite3.Database(dbFile, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
      throw new Error(`unable to open or create database: ${err}`);
    }
  });

  newDb.close();

  // now do it again, using the async/await library
  await open({
    filename: dbFile,
    driver: sqlite3.Database,
  }).then(async (dBase) => {
    db = dBase;
  });

  await db.run(
    'CREATE TABLE IF NOT EXISTS accounts (name TEXT PRIMARY KEY, privkey TEXT, pubkey TEXT, webfinger TEXT, actor TEXT, followers TEXT, following TEXT, messages TEXT, blocks TEXT)',
  );

  // if there is no `messages` table in the DB, create an empty table
  await db.run('CREATE TABLE IF NOT EXISTS messages (guid TEXT PRIMARY KEY, message TEXT, id TEXT)');
  await db.run('CREATE TABLE IF NOT EXISTS permissions (id TEXT NOT NULL UNIQUE, allowed TEXT, blocked TEXT)');

  return new Promise((resolve, reject) => {
    crypto.generateKeyPair(
      'rsa',
      {
        modulusLength: 4096,
        publicKeyEncoding: {
          type: 'spki',
          format: 'pem',
        },
        privateKeyEncoding: {
          type: 'pkcs8',
          format: 'pem',
        },
      },
      async (err, publicKey, privateKey) => {
        if (err) return reject(err);
        try {
          const actorRecord = actorJson(publicKey);
          const webfingerRecord = webfingerJson();
          await db.run(
            'INSERT OR REPLACE INTO accounts (name, actor, pubkey, privkey, webfinger) VALUES (?, ?, ?, ?, ?)',
            actorName,
            JSON.stringify(actorRecord),
            publicKey,
            privateKey,
            JSON.stringify(webfingerRecord),
          );
          return resolve(true);
        } catch (e) {
          return reject(e);
        }
      },
    );
  });
}

export function init() {
  console.log('start activity-pub db setup');
  // activitypub not set up yet, skip until we have the data we need
  if (actorInfo.disabled) {
    return;
  }

  // Initialize the database
  const exists = fs.existsSync(dbFile);

  open({
    filename: dbFile,
    driver: sqlite3.Database,
  }).then(async (dBase) => {
    db = dBase;

    const actorName = `${account}@${domain}`;

    try {
      if (!exists) {
        await firstTimeSetup(actorName);
      }

      // re-run the profile portion of the actor setup every time in case the avatar, description, etc have changed
      const publicKey = await getPublicKey();
      const actorRecord = actorJson(publicKey);

      await db.run('UPDATE accounts SET name = ?, actor = ?', actorName, JSON.stringify(actorRecord));
    } catch (dbError) {
      console.error(dbError);
    }
  });
}
