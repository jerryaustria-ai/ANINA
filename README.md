<div align="center">

# ANINA Wellness Sanctuary

**A premium integrated longevity · mobility · strength · recovery sanctuary — BF Homes, Parañaque.**

Marketing site + a booking system that writes to Google Sheets. Zero build step, hosts free on GitHub Pages.

</div>

---

## ✦ What this is

A single-page, visually-rich website for ANINA Wellness Sanctuary, built as a
plain static site (HTML + CSS + vanilla JS) so anyone can clone it, open it, and
ship it without a toolchain.

- **Stunning Scandinavian aesthetic** — warm bone canvas, sage & clay accents,
  editorial serif display, generous whitespace, subtle scroll animations.
- **Booking system → Google Sheets** — the form posts to a Google Apps Script
  Web App that appends each request to a Sheet. No backend, no secrets.
- **Sections** — Hero · Philosophy · Programs · The Space (gallery) ·
  Membership · Booking · Contact.

> **Imagery** is ANINA Wellness Sanctuary's own photography and architectural
> renders (see [`CREDITS.md`](./CREDITS.md)). Drop new shots into
> `assets/images/` using the same filenames to update them.

## ✦ Quick start (local preview)

No dependencies. Either:

```bash
# option A — just open it
open index.html

# option B — serve it (recommended; date input & fetch behave better)
python3 -m http.server 8000
# then visit http://localhost:8000
```

The booking form works immediately in **demo mode** (validates + shows success,
writes nowhere). To make it live, wire up Google Sheets ↓.

## ✦ Connect the booking form to Google Sheets

Full step-by-step (≈5 min): **[`apps-script/README-booking.md`](./apps-script/README-booking.md)**

Short version:
1. New Google Sheet → **Extensions → Apps Script** → paste
   [`apps-script/Code.gs`](./apps-script/Code.gs).
2. **Deploy → New deployment → Web app** · *Execute as: Me* · *Access: Anyone*.
3. Copy the `/exec` URL into [`js/config.js`](./js/config.js):
   ```js
   window.ANINA_CONFIG = { BOOKING_ENDPOINT: "https://script.google.com/macros/s/…/exec" };
   ```
4. Commit & push. Bookings now land in the **Bookings** tab.

## ✦ Live Instagram feed

The "Follow along" section shows the sanctuary's Instagram and **auto-updates as
you post** — once you connect a feed widget.

**Why a widget?** A static site can't read an Instagram profile feed on its own:
Instagram requires an access token, and a token must never live in a public repo.
The standard, secure fix is a free widget service that holds the token for you and
returns an embed you can paste in. (Until you add one, the section shows an
on-brand grid of your photos that links to the profile — nothing looks broken.)

### Option A — a feed widget (auto-pulls from Instagram)

**Setup (~3 min) — using [LightWidget](https://lightwidget.com), free:**
1. Sign up, click **Create new widget**, and connect **@anina_wellness_sanctuary**.
2. Style it if you like, then **Get code**. You'll get a snippet like:
   ```html
   <iframe src="//lightwidget.com/widgets/abc123def456.html" ...></iframe>
   <script src="https://cdn.lightwidget.com/widgets/lightwidget.js"></script>
   ```
3. In [`js/config.js`](./js/config.js), put **either** the widget id **or** the whole snippet:
   ```js
   INSTAGRAM: {
     // easiest: just the id from the iframe URL
     LIGHTWIDGET_ID: "abc123def456",
     // — or — paste any widget service's full embed here instead:
     EMBED_HTML: "",
   }
   ```
4. Commit & push. The live feed replaces the fallback grid and refreshes itself
   as you post.

`EMBED_HTML` accepts **any** widget's snippet — [Behold](https://behold.so),
[SnapWidget](https://snapwidget.com), [Elfsight](https://elfsight.com),
EmbedSocial, etc. — so you're not locked to one service. None of them put a
secret in the repo; the service keeps the token.

### Option B — a Google Sheet (manual, no backend) ✅ already wired

Keep a Google Sheet of posts; the browser reads it live. This site is already
pointed at your sheet in [`js/config.js`](./js/config.js) (`INSTAGRAM.SHEET_CSV_URL`),
so you only need to (1) fill it in and (2) make it readable.

1. **Columns** (row 1 = headers): `image` &#124; `caption` &#124; `link`
   - **image** (required) — a direct, public image URL ending in `.jpg`/`.png`,
     as **plain text** in the cell (not an inserted picture, not `=IMAGE()`).
   - **caption** (optional) — used as hover/alt text.
   - **link** (optional) — the Instagram post URL the tile opens.
2. **Make it readable:** *Share → General access → Anyone with the link → Viewer*
   (or *File → Share → Publish to web*). Until you do, the site shows the fallback grid.
3. Done — the first ~12 rows become the feed and refresh on their own (Google
   caches the CSV for a few minutes).

**Where do the images come from?** Instagram's own image URLs (`scontent…`) will
*display* but expire after a while, so for durability host the images on Google
Drive (public link), in this repo's `assets/images/`, or any image host, and put
those URLs in the sheet.

To use a different sheet/tab, set `SHEET_CSV_URL` to
`https://docs.google.com/spreadsheets/d/<ID>/gviz/tq?tqx=out:csv&gid=<GID>`.

**Priority** if more than one is set: `EMBED_HTML` → `LIGHTWIDGET_ID` →
`SHEET_CSV_URL` → fallback grid.

> Prefer the official Instagram Graph API instead? That needs a Business/Creator
> account, a Meta app, and a server to store the long-lived token — it isn't
> static-site-friendly, which is why the widget route is the default here.

## ✦ Deploy (GitHub Pages)

The site is fully static, so no build is needed:

1. Push to GitHub (already done if you cloned this repo).
2. **Settings → Pages → Build and deployment → Source: _Deploy from a branch_.**
3. Branch: **`main`**, folder: **`/ (root)`** → **Save**.
4. In a minute it publishes to `https://<user>.github.io/<repo>/`.

(Or just drag the folder onto Netlify / Cloudflare Pages — it's fully static.)

## ✦ Editing content

Everything is plain HTML/CSS — no framework to learn.

| Want to change… | Edit |
|---|---|
| Copy, sections, pricing | `index.html` |
| Colours, fonts, spacing | `css/styles.css` (design tokens in `:root`) |
| Nav / gallery / form behaviour | `js/main.js` |
| Booking endpoint | `js/config.js` |
| Instagram feed widget | `js/config.js` (`INSTAGRAM`) |
| Photos | replace files in `assets/images/` (keep the same names) |

Design tokens live at the top of `css/styles.css`:

```css
--bone: #F4F1EA;   --ink:  #221F1A;
--sage: #6E7F63;   --clay: #B47A5E;
```

## ✦ Project structure

```
anina-wellness-sanctuary/
├── index.html                 # the whole page
├── css/styles.css             # design system + all styles
├── js/
│   ├── config.js              # booking endpoint (edit this)
│   └── main.js                # nav, reveals, gallery, form
├── assets/images/             # placeholder photography
├── apps-script/
│   ├── Code.gs                # Google Sheets backend
│   └── README-booking.md      # setup guide
├── CREDITS.md
└── README.md
```

## ✦ For coworkers

Clone it, open `index.html`, and you're looking at the live site. Propose changes
via a branch + PR. The design tokens and section-per-`<section>` structure make
edits low-risk — change copy in `index.html`, tweak colours in `:root`.

---

<div align="center">
<sub>Built for ANINA Wellness Sanctuary · Founder Edrin Panganiban · South Metro Manila</sub>
</div>
