# Design notes: what Mae wants (and doesn't)

Read this before building anything new for the site. New work is based on **this project**, not on fresh picks.

## Yes, please
- **Fonts: the site's own set, in the same roles**
  - Headings: **Bricolage Grotesque**, weight 800, tight letter-spacing (about -.045em)
  - Italic accent word inside a heading: **Instrument Serif** italic in deep rose (`<em>`)
  - Body: **Nunito**
  - Handwritten notes: **Caveat**
  - Little labels: **DM Mono**
  - **Fredoka** only lives inside the logo wordmark
- **Logo / heart: the project's own** striped candy heart outline with the tilted "mae tao" (`logo()` in `index.html`, `nl/logo.svg`, `nl/heart.svg`, `email/logo.png`). Use these files for the logo.
- **Palette: hers only.** Cream `#fbf5f0`, paper `#fffaf7`, blush `#fbe3e2`, pink `#f0c1c7`, rose `#d98f97`, deep rose `#c66a77`, sage `#868a76` / `#a9b8a8` / `#c7c8b9` / `#e6e7dc`, cocoa `#2f2427` for dark cards. Other shades come only from these.
- **The heart is 𖹭**, not ♡.
- **3D, like her oonda dashboard:** raised cards with a soft top highlight and deep soft shadow, glossy pill buttons, striped (hatched) capsule bars with one tall dark capsule for "now", ring gauges, a paperclip on the dark card, spiral rings on the calendar. Bars should be creative, never plain rectangles.
- **Icons, not emoji:** her icon photos recoloured to the palette with the black outline removed and blended; colourful ones (books, envelope, Mae's desk) adopt the theme colours.
- **Soft edges, no harsh lines.** Round corners everywhere, soft shadows and tints instead of borders, pill buttons, lots of space. Aesthetic, creative, elegant.
- **Mostly CSS** for the look: shapes, washi tape, stickers, animations, pop-ups.
- Cute decorations in the site's style: washi tape labels, sticker circles, blobs, envelope, confetti hearts.
- The newsletter is **built into the existing website**, not a separate app.
- Free tools only (GitHub Pages, Supabase, Resend). Two letters a month. Friendly voice, not salesy.
- Show a **preview** before anything goes live, including what readers see versus what only Mae sees.
- Readers must never see or reach Mae's login: no links to /admin anywhere public, no pre-filled email on the login.

## No, thanks
- Picking new fonts (e.g. Fredoka for headings), or swapping her logo for a typed heart.
- The ♡ heart symbol: use **𖹭** instead (needs the Noto Sans Medefaidrin font, already loaded).
- Emoji. Use her icon set in `nl/icons/` (recoloured to the palette, outlines melted in) and the small UI icons in `nl/icons/ui.svg`.
- Hard borders, table grid lines, sharp corners, busy layouts.
- Copying example products she shares (like NewsletterPulse screenshots). Those are layout inspiration only.
- Paid email services, reader accounts, a marketplace.
