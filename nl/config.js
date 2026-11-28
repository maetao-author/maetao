/* 𖹭 Newsletter settings: the ONLY file you edit to connect everything.
   These values are safe to be public: the anon/publishable key can only do what the
   database rules allow (sign up, vote, ask a question, request a swap).
   NEVER paste the service_role key or the Resend API key here. Those live in Supabase secrets. */
window.MAE_NL = {
  supabaseUrl: "https://sfpllnkugewuzmxqdwzr.supabase.co",   // maetao-author's Project
  anonKey: "sb_publishable_8bVe37AzF4s_beM7EDXcdA_xplabm14", // publishable key: safe in the browser (RLS protects the data)
  siteUrl: "https://maetao-author.github.io/maetao",          // change to your own domain once you have one

  magnet: {
    name: "Stephen's first-date chapter",
    tagline: "the night he finally asked her out, told from his side of the net",
    perk: "a bonus chapter in Stephen's POV + two letters a month"
  },

  book: {
    title: "Call It a Let",
    series: "Deuce Series · book one",
    release: "2026-11-30",                      // used for countdowns + "add to calendar"
    cover: "email/cover.jpg",            // path from the site root
    buy: [ { label: "Amazon", link: "" }, { label: "Buy direct", link: "" } ]
  },

  sendDays: [1, 15],                           // your 2x/month newsletter days
  sendHour: 9,                                 // local hour you like letters to go out

  popup: {
    enabled: true,
    delaySeconds: 25,        // show after this long on the page…
    scrollPercent: 55,       // …or after scrolling this far, whichever comes first
    exitIntent: true,        // also when the mouse heads for the tab bar (desktop)
    snoozeDays: 10           // don't show again for this many days after closing
  },

  tropes: ["rivals-to-lovers", "fake dating", "forced proximity", "forbidden coach-player"]
};
