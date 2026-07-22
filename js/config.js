/* =========================================================
   ANINA — site configuration
   ========================================================= */
window.ANINA_CONFIG = {

  /* ---------------------------------------------------------
     BOOKING → Google Sheets
     Paste your deployed Google Apps Script Web App URL below.
     (See apps-script/README-booking.md for the 5-minute setup.)
     Empty = DEMO MODE (validates + shows success, writes nowhere).
     --------------------------------------------------------- */
  /* ---------------------------------------------------------
     GOOGLE ANALYTICS (GA4) — tracks all pages, no domain needed.
     Create a free GA4 property, then paste its Measurement ID
     (looks like "G-XXXXXXXXXX") here. Empty = analytics off.
     --------------------------------------------------------- */
  GA_ID: "G-9KR0EK2VJQ",

  BOOKING_ENDPOINT: "https://script.google.com/macros/s/AKfycbwJDOAPFb3DZ7baM7cz_chHoUTQeCMDNibSJbbvK4olDuDWBYxmd0Txs4QWCYZ6UJn-/exec",

  /* ---------------------------------------------------------
     INSTAGRAM — live "Follow along" feed
     ---------------------------------------------------------
     A static site can't pull a profile feed by itself (Instagram
     needs an access token that must NOT live in a public repo).
     The standard fix is a free widget service that holds the token
     for you and gives you an embed snippet. See README → "Live
     Instagram feed" for 3-minute setup (LightWidget / Behold / etc).

     Fill ONE of these:
       • EMBED_HTML     — paste the full <iframe>/<script> snippet the
                          widget service gives you (works with any of them)
       • LIGHTWIDGET_ID — just the id from a LightWidget embed
                          (e.g. the "abc123..." in lightwidget.com/widgets/abc123.html)

     Leave both empty to show the on-brand fallback grid that links
     to the profile below.
     --------------------------------------------------------- */
  INSTAGRAM: {
    HANDLE: "anina_wellness_sanctuary",
    PROFILE_URL: "https://www.instagram.com/anina_wellness_sanctuary/",
    EMBED_HTML: "",
    LIGHTWIDGET_ID: "",

    // --- Google Sheet as the image source (no Instagram login needed) ---
    // Publish a sheet to the web as CSV and paste that URL here. Columns
    // (with a header row): image | caption | link  — only "image" is required.
    // See README → "Option B: drive the feed from a Google Sheet".
    // Your sheet's CSV endpoint. It stays on the fallback grid until the
    // sheet is shared "Anyone with the link: Viewer" (or Published to web).
    SHEET_CSV_URL: "https://docs.google.com/spreadsheets/d/1nR4OwXGJDkQSsKtomN-NoFZ1Dnr_CtTJj82hA1Qg0xA/gviz/tq?tqx=out:csv&gid=0",
  },
};
