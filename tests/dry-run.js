// Dry run without NFC hardware: loads index.html in headless Chromium with a fake NDEFReader.
// Run: node tests/dry-run.js   (needs the `playwright` package)
const { chromium } = require('playwright');
const assert = require('assert/strict');
const path = require('path');

const url = 'file://' + path.resolve(__dirname, '..', 'index.html');

// Injected before app.js. Tests drive it through window.__nfc.
function mockNfc() {
  window.__nfc = { scanError: null, writeError: null, writes: [], reader: null };
  const fail = (name, message) => Promise.reject(new DOMException(message, name));
  window.NDEFReader = class extends EventTarget {
    scan({ signal } = {}) {
      if (__nfc.scanError) return fail(...__nfc.scanError);
      __nfc.reader = this;
      signal?.addEventListener('abort', () => { __nfc.reader = null; });
      return Promise.resolve();
    }
    write(message, { signal } = {}) {
      if (__nfc.writeError) return fail(...__nfc.writeError);
      __nfc.writes.push(message);
      if (__nfc.holdWrite) {
        return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
      }
      return Promise.resolve();
    }
  };
  // Simulates tapping a tag while scanning.
  window.__nfc.tap = (serialNumber, records) => {
    const e = new Event('reading');
    const enc = new TextEncoder();
    e.serialNumber = serialNumber;
    e.message = { records: records.map((r) => ({ ...r, data: r.data == null ? null : new DataView(enc.encode(r.data).buffer) })) };
    __nfc.reader.onreading?.(e);
  };
}

(async () => {
  const browser = await chromium.launch();
  const status = (page) => page.textContent('#status');
  const fresh = async (mock = true) => {
    const page = await browser.newPage();
    page.on('pageerror', (e) => { throw e; });
    if (mock) await page.addInitScript(mockNfc);
    await page.goto(url);
    return page;
  };

  // 1. Unsupported browser
  let page = await fresh(false);
  assert.equal(await page.isVisible('#unsupported'), true);
  assert.match(await status(page), /isn't supported.*Chrome on Android/);
  assert.equal(await page.isDisabled('#scan'), true);

  // 2. Supported: nothing requested on load
  page = await fresh();
  assert.equal(await page.isVisible('#unsupported'), false);
  assert.equal(await status(page), 'Ready to scan');

  // 3. Read: text + url + binary mime records, serial number shown
  await page.click('#scan');
  assert.equal(await status(page), 'Hold phone near tag...');
  assert.equal(await page.isVisible('#cancel'), true);
  await page.evaluate(() => __nfc.tap('04:a2:5b:1a', [
    { recordType: 'text', encoding: 'utf-8', lang: 'en', data: 'héllo <b>x</b>' },
    { recordType: 'url', data: 'https://example.com' },
    { recordType: 'mime', mediaType: 'application/octet-stream', data: 'AB' },
    { recordType: 'empty', data: null },
  ]));
  assert.equal(await status(page), 'Tag read successfully');
  const result = await page.textContent('#result');
  assert.match(result, /Serial number: 04:a2:5b:1a/);
  assert.match(result, /héllo <b>x<\/b>/); // rendered as text, not HTML
  assert.match(result, /https:\/\/example\.com/);
  assert.match(result, /2 bytes: 41 42/);
  assert.match(result, /\(empty\)/);
  assert.equal(await page.$('#result b'), null);
  assert.equal(await page.evaluate(() => __nfc.reader), null, 'scan stopped after a read');

  // 4. Cancel a scan
  await page.click('#scan');
  await page.click('#cancel');
  assert.equal(await status(page), 'Cancelled. Ready.');
  assert.equal(await page.evaluate(() => __nfc.reader), null);

  // 5. Scan errors
  for (const [name, re] of [['NotAllowedError', /permission denied/], ['NotSupportedError', /No usable NFC hardware/], ['NotReadableError', /NFC is off/]]) {
    await page.evaluate((n) => { __nfc.scanError = [n, 'x']; }, name);
    await page.click('#scan');
    assert.match(await status(page), re);
    assert.equal(await page.isDisabled('#scan'), false);
  }
  await page.evaluate(() => { __nfc.scanError = null; });

  // 6. Write: each type builds the right record
  await page.click('#tab-write');
  assert.equal(await page.isVisible('#write'), true);
  assert.equal(await status(page), 'Ready to write');
  const writeAs = async (type, content) => {
    await page.selectOption('#type', type);
    if (content != null) await page.fill('#content', content);
    await page.click('#write-btn');
    return page.evaluate(() => __nfc.writes.at(-1));
  };
  assert.deepEqual(await writeAs('text', 'hello'), { records: [{ recordType: 'text', data: 'hello' }] });
  assert.equal(await status(page), 'Tag written successfully');
  assert.deepEqual(await writeAs('url', 'https://example.com/a'), { records: [{ recordType: 'url', data: 'https://example.com/a' }] });
  await page.fill('#content', '');
  const wifi = await writeAs('wifi'); // template prefilled on empty content
  assert.equal(wifi.records[0].recordType, 'text');
  assert.match(wifi.records[0].data, /^WIFI:S:/);
  await page.fill('#content', '');
  const vcard = await writeAs('vcard');
  assert.equal(vcard.records[0].recordType, 'text');
  assert.match(vcard.records[0].data, /^BEGIN:VCARD/);

  // 7. Typed content is not overwritten by switching type
  await page.fill('#content', 'my own text');
  await page.selectOption('#type', 'url');
  assert.equal(await page.inputValue('#content'), 'my own text');

  // 8. Validation: bad URL and empty content never reach write()
  const before = await page.evaluate(() => __nfc.writes.length);
  await writeAs('url', 'not a url');
  assert.match(await status(page), /full URL/);
  await writeAs('text', '   ');
  assert.match(await status(page), /Enter some content/);
  assert.equal(await page.evaluate(() => __nfc.writes.length), before);

  // 9. Write errors: read-only vs generic failure are distinct
  const writeFails = async (name, message) => {
    await page.evaluate(([n, m]) => { __nfc.writeError = [n, m]; }, [name, message]);
    await writeAs('text', 'x');
    return status(page);
  };
  assert.match(await writeFails('NotAllowedError', 'The NFC tag is read-only.'), /read-only \(locked\)/);
  assert.match(await writeFails('NetworkError', 'IO error'), /Write failed\. Keep the phone still/);
  assert.match(await writeFails('NotSupportedError', 'x'), /can't be written/);
  assert.match(await writeFails('NotAllowedError', 'denied'), /permission denied/);
  await page.evaluate(() => { __nfc.writeError = null; });

  // 10. Cancel a pending write
  await page.evaluate(() => { __nfc.holdWrite = true; });
  await page.fill('#content', 'pending');
  await page.click('#write-btn');
  assert.equal(await status(page), 'Hold phone near tag...');
  await page.click('#cancel');
  await page.waitForFunction(() => /cancelled/i.test(document.getElementById('status').textContent));
  assert.equal(await page.isDisabled('#write-btn'), false);

  await browser.close();
  console.log('All dry-run checks passed.');
})().catch((e) => { console.error(e); process.exit(1); });
