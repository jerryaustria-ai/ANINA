# Wiring the booking form to Google Sheets

The site's booking form posts to a **Google Apps Script Web App** that appends
each request as a row in a Google Sheet. No server, no API keys, no secrets in
the repo — and it's free.

Takes about 5 minutes.

## 1. Create the Sheet
1. Go to <https://sheets.google.com> and create a new blank spreadsheet.
2. Name it something like **ANINA Bookings**.

## 2. Add the script
1. In the sheet, open **Extensions → Apps Script**.
2. Delete any starter code in `Code.gs`.
3. Copy the entire contents of [`Code.gs`](./Code.gs) from this repo and paste it in.
4. *(Optional)* set `NOTIFY_EMAIL` near the top to get an email on every booking.
5. Click the **Save** (💾) icon.

## 3. Deploy as a Web App
1. Click **Deploy → New deployment**.
2. Click the gear ⚙️ next to "Select type" → **Web app**.
3. Set:
   - **Description:** `ANINA booking`
   - **Execute as:** **Me**
   - **Who has access:** **Anyone**
4. Click **Deploy**.
5. Approve the permissions prompt (it needs to write to *your* sheet and,
   if enabled, send email as you). You may need to click
   *Advanced → Go to project (unsafe)* — that's normal for your own script.
6. Copy the **Web app URL** (ends in `/exec`).

## 4. Plug it into the site
Open [`js/config.js`](../js/config.js) and paste the URL:

```js
window.ANINA_CONFIG = {
  BOOKING_ENDPOINT: "https://script.google.com/macros/s/AKfycb..../exec",
};
```

Commit and push. Done — real bookings now land in the **Bookings** tab.

## 5. Test it
- Visit your deployed site, submit the booking form → a new row should appear.
- Or paste the `/exec` URL into a browser: you should see
  `{"ok":true,"service":"ANINA booking endpoint"}`.

## Notes
- **Before configuring an endpoint, the form runs in DEMO MODE** — it validates
  and shows a success message but doesn't write anywhere. Great for previews.
- The browser can't read the Web App's response (Apps Script doesn't send CORS
  headers), so the site treats a completed request as success. That's expected.
- **Updating the script later:** edit the code, then **Deploy → Manage
  deployments → ✏️ Edit → Version: New version → Deploy**. The `/exec` URL
  stays the same.
- Want the data elsewhere too? Add a `SpreadsheetApp` call, a webhook, or a
  `MailApp` line inside `doPost` — it's your script.
