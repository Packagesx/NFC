# NFC Tag Tool

A small mobile web app that reads and writes **NDEF** data on NFC tags using the
[Web NFC API](https://developer.mozilla.org/en-US/docs/Web/API/Web_NFC_API).
Plain HTML/CSS/JS, no build step: `index.html`, `style.css`, `app.js`.

## Requirements

- **Chrome on Android** (version 89 or later) on a phone with NFC hardware, with NFC turned on.
- Web NFC does **not** work on iOS/Safari, Firefox, or desktop browsers. There the app shows
  "Web NFC isn't supported on this browser/device. Use Chrome on Android."
- A writable NDEF tag, e.g. an NTAG213/215/216 sticker.
- A **secure context**: the page must be served over HTTPS (or from `localhost`).

## Running it

Any static server works:

```bash
npx serve .
```

or

```bash
python3 -m http.server 8000
```

A phone can't open your computer's `localhost`, so for real-device testing use one of these:

- **USB port forwarding:** connect the phone, open `chrome://inspect/#devices` on desktop Chrome,
  and forward port `3000` (or `8000`) to `localhost:3000`. Then open `http://localhost:3000`
  on the phone. This counts as a secure context.
- **Any HTTPS static host** (GitHub Pages, Netlify, Cloudflare Pages, …). Upload the three files.

## Permission flow

1. Nothing is requested when the page loads. The app only checks `'NDEFReader' in window`.
2. The first tap on **Scan Tag** or **Write to Tag** calls `NDEFReader.scan()` or `.write()`.
   Chrome then shows its NFC permission prompt.
3. If you allow it, the status changes to "Hold phone near tag...". Hold the back of the phone
   against the tag.
4. If you deny it, the app shows "NFC permission denied". To allow it again, open Chrome ⋮ →
   Settings → Site settings → NFC (or tap the lock icon → Permissions) and reset it for the site.
5. Chrome only allows NFC while the page is visible and in the foreground. **Cancel** stops a
   pending scan or write.

## Features

- **Read:** shows the tag's serial number when Chrome provides it, plus every record's
  type and decoded data. Text, URL and text-like MIME records are decoded as text, and other
  data is shown as hex. The scan stops after one successful read.
- **Write:** Plain Text and URL write a `text` or `url` record. **Wi-Fi-style text** and **vCard**
  fill in an editable template (`WIFI:S:…;T:WPA;P:…;;` and `BEGIN:VCARD…`) that is written as a
  plain `text` record. This is not real Wi-Fi provisioning (`application/vnd.wfa.wsc`) and not a
  `text/vcard` MIME record, so phones show it as text and won't auto-join or auto-import it.
- Read-only tags and other write failures get separate error messages.

## Testing

`tests/dry-run.js` loads the page in headless Chromium with a mocked `NDEFReader` and checks
the unsupported-browser message, reading (including that HTML in tag data is shown as plain
text), each write type, input checks, error messages and Cancel:

```bash
npm i -D playwright
```

```bash
node tests/dry-run.js
```

**Final testing still needs a real Android phone with Chrome and an NFC tag.** The mock can't
show real permission prompts, real tag timing, or the exact error Chrome gives for a
read-only/locked tag. The app spots read-only errors by their message text, so check that
on a locked tag.

## Scope

This app reads and writes **NDEF tags only**. It deliberately does **not** support, and will not
be extended to support:

- cloning or emulating access cards, hotel keys, transit cards, payment cards, or any
  proprietary or encrypted card format (MIFARE Classic, HID iCLASS/Prox, DESFire, EMV, etc.);
- reading raw card data outside NDEF, or writing or spoofing tag UIDs/serial numbers.

Web NFC doesn't expose these capabilities, and cloning secured cards is out of scope for this
project. Requests to add them should be declined.
