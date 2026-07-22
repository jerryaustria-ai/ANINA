/**
 * ANINA Wellness Sanctuary — Booking backend (Google Apps Script)
 * ---------------------------------------------------------------
 * Receives booking requests from the website and appends them as a
 * row in the bound Google Sheet. Optionally emails a notification.
 *
 * SETUP: see apps-script/README-booking.md (5 minutes).
 *
 * The website posts JSON as text/plain (a CORS "simple" request), so
 * no special response headers are needed.
 */

// ── Settings ────────────────────────────────────────────────
var SHEET_NAME = 'Bookings';
// Set NOTIFY_EMAIL to receive an email on every booking. Leave "" to disable.
var NOTIFY_EMAIL = '';

var HEADERS = [
  'Timestamp', 'Name', 'Email', 'Phone',
  'Service', 'Preferred Date', 'Preferred Time', 'Notes', 'Source'
];

/** Handle POST from the website. */
function doPost(e) {
  try {
    var payload = {};
    if (e && e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    }

    var sheet = getSheet_();
    var ts = new Date();
    // Calendar booking sends a `slots` array — one sheet row per selected slot.
    var slots = (payload.slots && payload.slots.length) ? payload.slots : null;
    if (slots) {
      for (var i = 0; i < slots.length; i++) {
        var sl = slots[i];
        sheet.appendRow([
          ts, payload.name || '', payload.email || '', payload.phone || '',
          payload.service || '', sl.date || '',
          (sl.start || '') + (sl.end ? ' - ' + sl.end : ''),
          payload.notes || '', payload.source || 'website'
        ]);
      }
    } else {
      sheet.appendRow([
        ts, payload.name || '', payload.email || '', payload.phone || '',
        payload.service || '', payload.date || '',
        payload.time || (payload.slotsText || ''),
        payload.notes || '', payload.source || 'website'
      ]);
    }

    if (NOTIFY_EMAIL) {
      MailApp.sendEmail({
        to: NOTIFY_EMAIL,
        subject: 'New ANINA booking — ' + (payload.name || 'Unknown'),
        body: [
          'A new booking request came in:',
          '',
          'Name:    ' + (payload.name || ''),
          'Email:   ' + (payload.email || ''),
          'Phone:   ' + (payload.phone || ''),
          'Service: ' + (payload.service || ''),
          'When:    ' + (payload.slotsText || ((payload.date||'') + ' ' + (payload.time||''))),
          'Notes:   ' + (payload.notes || ''),
        ].join('\n')
      });
    }

    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/** Simple GET so you can confirm the deployment is live in a browser. */
function doGet() {
  return json_({ ok: true, service: 'ANINA booking endpoint' });
}

/** Get (or create + header) the Bookings sheet. */
function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
