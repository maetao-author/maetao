# Turning on the community board (about 10 minutes, free)

Until you do this, the community tab, signing notes and early reader applications run in **preview mode**: they work, but everything is saved only in the browser you're using.

1. Go to **console.firebase.google.com** → **Add project** (any name, e.g. `maetao-site`). You can turn Google Analytics off.
2. On the project home page click the **</>** (Web) icon → give it a nickname → **Register app**. Copy the four values `apiKey`, `authDomain`, `projectId`, `appId` into `community.firebase` in the settings block at the top of `index.html`.
3. **Build → Firestore Database → Create database** (pick the location closest to your readers, start in *production mode*).
4. Open the **Rules** tab, delete what's there, paste everything from `firestore.rules`, change `your-email@gmail.com` to your own Google email (lowercase), then **Publish**.
5. **Build → Authentication → Get started → Sign-in method**: turn on **Anonymous** and **Google**.
6. **Authentication → Settings → Authorized domains**: add your website's domain (e.g. `maetao.com` or `maetao.netlify.app`).
7. In `index.html`, set `ownerEmail` to the same Google email.
8. Upload the site. Open the **community** tab, scroll to "house rules" and click **are you Mae? sign in**. Sign in with Google and you'll see the "♡ author" badge, pin / delete / idea-status buttons, and **mae's desk** with signing notes and early reader applications.

Readers never need an email or password. They pick an @, emoji and colour, and that profile stays with their browser.

## GIFs (GIPHY)

1. Go to **developers.giphy.com** → sign in → **Create an App** → choose **API** → give it a name (e.g. `maetao-site`) and a short description.
2. Copy the **API key** it shows you.
3. In `index.html`, paste it into `giphyKey: ""` in the `community` settings block (between the quotes).

The GIF button shows trending GIFs and lets readers search. Until a key is added, the button just says GIFs aren't switched on yet.

## Characters, reactions and photos

- Readers pick one of 60 illustrated characters (or an emoji) and a background colour for their profile. The pictures live in the `characters/` folder.
- Anyone with a profile can react to posts and replies with any emoji, plus the ♡ votes as before.
- Readers can attach a photo to a post or reply. It's shrunk in their browser and saved in the database's `photos` collection, so no extra storage service is needed. Deleting a post also deletes its photo.

If you set the database up before these features were added, paste the latest `firestore.rules` into **Firestore → Rules** again and **Publish**.

**Moderating:** as Mae you can delete any post or reply, pin posts, and mark ideas as *thinking about it*, *planned* or *done*.
