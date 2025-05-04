# Tvmarks

## About this project

Tvmarks is a tv tracking site that you own yourself and can connect the Fediverse, interacting with other Tvmarks sites as well as Mastodon/FireFish/any text-based ActivityPub platform.


The site allows the owner to add shows and track which episodes you have watched, but only if a valid login is provided.
Check the setup below to understand how to do that!

## Setting up your site

To set your app up:

- If you're using Glitch:
  - Rename your project immediately in the project settings, if you intend to be called something else. This determines the domain that your site lives at, which also determines the second half of your `@username@project-name.glitch.me` identity on the fediverse. NOTE: If you change this later, you will break the connection any existing followers have to your site, they'll have to re-follow the account on its new domain (and depending on the software they're following from, may even prevent them from unfollowing the old URL 😱)
  - In your `.env` editor, create a key `ADMIN_KEY` and give it a text string as a value. This is your "password" when your browser prompts you, so make it as secure as you need to protect your data.
  - Add another key to your .env called `SESSION_SECRET` and generate a random string for its value. This is your [session secret](http://expressjs.com/en/resources/middleware/session.html#secret), used to generate the hashed version of your session that gets encoded with the cookies used to store your login. If you make this string too easily guessable, you make it easier for someone to hijack your session and gain unauthorized login. Also, if you ever change this string, it will invalidate all existing cookies.
  - If you've got a custom domain in front of your Glitch project, add a key to your .env called `PUBLIC_BASE_URL` with the value set to the hostname (the part after the https://) at which you want the project to be accessible.
  - Next we will configure the site communicate with the fediverse. Add another key to your .env called `DISPLAY_NAME` for the fediverse account
  - Then in your `.env` editor, create a key `DESCRIPTION` and add a text description. Next add an `AVATAR` key add a URL to a profile image.
  - Finally add a `USERNAME` key to the `.env` editor to set your `@username` for your app's feiverse accout. It will be used in this context: `@watching@project-name.glitch.me`. 
- Otherwise:
  - Create a `.env` file in the root of the project.
  - Add the line `PUBLIC_BASE_URL=<hostname>` to your .env where \<hostname\> is the hostname of your instance.
  - Add the line `ADMIN_KEY=<key>` to your .env where \<key\> is the password you'll enter when the browser prompts you, and another line for `SESSION_SECRET=<secret>` where \<secret\> is a random string used when hashing your session for use in a secure cookie.
  - Add the line `DISPLAY_NAME=<display_name>` to your .env where \<display_name\> is your app's fediverse display name.
  - Add the line `DESCRIPTION=<description>` to your .env where \<description\> is your app's fediverse user description
  - Add the line `AVATAR=<avatar>` to your .env where \<avatar\> is your app's fediverse user image
  - Add the line `USERNAME=<name>` to your .env where \<name\> is your app's fediverse username.
- If you're using Glitch, you should be done! If you're running this yourself, run `npm run start` via whatever mechanism you choose to use to host this website.
- Click on the **Admin** link in the footer, and enter the password (whatever you set ADMIN_KEY to in the .env).
- You should be logged in, at which point you can configure various settings, import bookmarks, and use the "Add" links in the header and footer (as well as the bookmarklet, available in the Admin section) to save new bookmarks.

## Mastodon Verification

Setting `MASTODON_ACCOUNT` in the `.env` file will cause a link to be added to the Tvmarks home page that can be used for verification with your Mastodon account. See the [Mastodon documentation](https://docs.joinmastodon.org/user/profile/#verification) for more details.

## Development & Contributions

See [CONTRIBUTING.md](/CONTRIBUTING.md) for more information on how to work with Tvmarks' development environment as well
as how to submit your changes for review.

## Acknowledgments

- The "Tvmarks" name is based off the [Tvmarks](https://tvmarks.glitch.me/) app which this code was forked from.. Thank you!
- Tvmarks (in its default configuration) uses an edited version of ["Nuvola devices tv"](https://commons.wikimedia.org/wiki/File:Nuvola_devices_tv.svg) icon from Wikimedia commons.
- It also makes use of free fonts including [Averia Sans](http://iotic.com/averia/) and [Public Sans](https://public-sans.digital.gov/).
- Much of the original form of the site's frontend is lifted from the starter projects available on [Glitch](https://glitch.com). Thank you to all the people who have contributed to those projects over the years!
- Much of the original backend of the site is based off of Darius Kazemi's [express-activitypub](https://github.com/dariusk/express-activitypub) repo. I made a point not to just clone his repo from the start, but then ended up retyping most of it as I learned how things work. While some pieces have been upgraded, much of Darius' work creates the foundation for Postmarks' ActivityPub functionality.

## We built this with Glitch!

[Glitch](https://glitch.com) is a friendly community where millions of people come together to build web apps and websites.

- Need more help? [Check out the Help Center](https://help.glitch.com/) for answers to any common questions.
- Ready to make it official? [Become a paid Glitch member](https://glitch.com/pricing) to boost your app with private sharing, more storage and memory, domains and more.
