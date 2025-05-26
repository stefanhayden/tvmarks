# Tvmarks

## About this project

Tvmarks is a tv tracking site that you own yourself and can connect the Fediverse, interacting with other Tvmarks sites as well as Mastodon/FireFish/any text-based ActivityPub platform.

![tvmarks-screenshot](https://github.com/user-attachments/assets/1bf17675-f2f6-4ae7-ba26-8b815ee81412)

The site allows the owner to add shows and track which episodes you have watched, but only if a valid login is provided.
Check the setup below to understand how to do that!

## Setting up your site

To set your app up:

  - Create a `.env` file in the root of the project.
  - Add the line `PUBLIC_BASE_URL=<hostname>` to your .env where \<hostname\> is the hostname of your instance.
  - Add the line `ADMIN_KEY=<key>` to your .env where \<key\> is the password you'll enter when the browser prompts you, and another line for `SESSION_SECRET=<secret>` where \<secret\> is a random string used when hashing your session for use in a secure cookie.
  - Add the line `DISPLAY_NAME=<display_name>` to your .env where \<display_name\> is your app's fediverse display name.
  - Add the line `DESCRIPTION=<description>` to your .env where \<description\> is your app's fediverse user description
  - Add the line `AVATAR=<avatar>` to your .env where \<avatar\> is your app's fediverse user image.
  - Add the line `USERNAME=<name>` to your .env where \<name\> is your app's fediverse username. (ex `@USERNAME@PUBLIC_BASE_URL`)
  - Add the line `TIMEZONE_OFFSET=<offset>` to your .env where \<offset\> is your UTC timezone offset. ex: -7 or +3
- Run `npm run start` via whatever mechanism you choose to use to host this website.
- Click on the **Admin** link in the footer, and enter the password (whatever you set ADMIN_KEY to in the .env).
- You should be logged in, at which point you can configure various settings, import bookmarks, and use the "Add" links in the header and footer (as well as the bookmarklet, available in the Admin section) to save new bookmarks.

## Mastodon Verification

Setting `MASTODON_ACCOUNT` in the `.env` file will cause a link to be added to the Tvmarks home page that can be used for verification with your Mastodon account. See the [Mastodon documentation](https://docs.joinmastodon.org/user/profile/#verification) for more details.

## Development & Contributions

See [CONTRIBUTING.md](/CONTRIBUTING.md) for more information on how to work with Tvmarks' development environment as well
as how to submit your changes for review.

## Acknowledgments

- The "Tvmarks" name is based off the [Postmarks](https://github.com/ckolderup/postmarks/) app which this code was forked from.. Thank you!
- Tvmarks (in its default configuration) uses an edited version of ["Nuvola devices tv"](https://commons.wikimedia.org/wiki/File:Nuvola_devices_tv.svg) icon from Wikimedia commons.
- It also makes use of free fonts including [Averia Sans](http://iotic.com/averia/) and [Public Sans](https://public-sans.digital.gov/).
- Much of the original form of the site's frontend is lifted from the starter projects that were available on [Glitch](https://glitch.com). Thank you to all the people who have contributed to those projects over the years!
- Much of the original backend of the site is based off of Darius Kazemi's [express-activitypub](https://github.com/dariusk/express-activitypub) repo. I made a point not to just clone his repo from the start, but then ended up retyping most of it as I learned how things work. While some pieces have been upgraded, much of Darius' work creates the foundation for Postmarks' ActivityPub functionality.

## We built this with Glitch!

[Glitch](https://glitch.com) was a friendly community where millions of people come together to build web apps and websites.

