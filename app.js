// NDEF tag read/write via Web NFC. Scope: NDEF only — see README "Scope".
const $ = (id) => document.getElementById(id);
const supported = 'NDEFReader' in window;
let ctrl = null; // AbortController for the scan/write in progress

const TEMPLATES = {
  text: '',
  url: 'https://',
  wifi: 'WIFI:S:MyNetwork;T:WPA;P:MyPassword;;',
  vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN:Jane Doe\nTEL:+15551234567\nEMAIL:jane@example.com\nEND:VCARD',
};

function setStatus(text, kind = '') {
  $('status').textContent = text;
  $('status').className = kind;
}

function setBusy(on) {
  $('cancel').hidden = !on;
  $('scan').disabled = $('write-btn').disabled = on || !supported;
}

function stop() {
  ctrl?.abort();
  ctrl = null;
  setBusy(false);
}

// ---- Read ----

function toHex(view) {
  return [...new Uint8Array(view.buffer, view.byteOffset, view.byteLength)]
    .map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

function decodeRecord(r) {
  if (!r.data || r.data.byteLength === 0) return '(empty)';
  if (r.recordType === 'text') return new TextDecoder(r.encoding || 'utf-8').decode(r.data);
  if (r.recordType === 'url' || r.recordType === 'absolute-url') return new TextDecoder().decode(r.data);
  if (r.recordType === 'mime' && /^text\/|json|xml/.test(r.mediaType)) return new TextDecoder().decode(r.data);
  return `${r.data.byteLength} bytes: ${toHex(r.data)}`;
}

function showTag({ serialNumber, message }) {
  const out = $('result');
  out.replaceChildren();
  const serial = document.createElement('p');
  serial.className = 'serial';
  serial.textContent = `Serial number: ${serialNumber || 'not available'}`;
  out.append(serial);
  if (!message.records.length) {
    out.append('Tag is empty (no NDEF records).');
    return;
  }
  for (const r of message.records) {
    const box = document.createElement('div');
    box.className = 'record';
    const type = document.createElement('div');
    type.className = 'type';
    type.textContent = r.recordType + (r.mediaType ? ` · ${r.mediaType}` : '') + (r.lang ? ` · ${r.lang}` : '');
    const data = document.createElement('pre');
    data.textContent = decodeRecord(r); // textContent, never innerHTML: tag data is untrusted
    box.append(type, data);
    out.append(box);
  }
}

function nfcError(err, action) {
  switch (err.name) {
    case 'AbortError': return `${action} cancelled.`;
    case 'NotAllowedError': return 'NFC permission denied. Allow NFC for this site (Chrome ⋮ → Site settings → NFC) and try again.';
    case 'NotSupportedError': return 'No usable NFC hardware found on this device.';
    case 'NotReadableError': return 'NFC is off or busy. Turn on NFC in Android settings and try again.';
    default: return err.message || String(err);
  }
}

async function scan() {
  stop();
  ctrl = new AbortController();
  const reader = new NDEFReader();
  reader.onreading = (e) => {
    showTag(e);
    stop(); // one read per tap of "Scan Tag"
    setStatus('Tag read successfully', 'ok');
  };
  reader.onreadingerror = () =>
    setStatus("Error: Couldn't read that tag. It may not be NDEF-formatted (access/payment cards aren't supported). Try again.", 'err');
  setBusy(true);
  try {
    await reader.scan({ signal: ctrl.signal }); // first call triggers the permission prompt
    setStatus('Hold phone near tag...', 'busy');
  } catch (err) {
    stop();
    setStatus(`Error: ${nfcError(err, 'Scan')}`, 'err');
  }
}

// ---- Write ----

// Returns an NDEFMessageInit, or throws Error with a user-facing message.
function buildMessage(type, content) {
  content = content.trim();
  if (!content || content === TEMPLATES.url) throw new Error('Enter some content first.');
  if (type === 'url') {
    try { new URL(content); } catch { throw new Error('Enter a full URL, e.g. https://example.com'); }
    return { records: [{ recordType: 'url', data: content }] };
  }
  // Wi-Fi and vCard are written as plain text records on purpose (no Wi-Fi provisioning / vCard MIME).
  return { records: [{ recordType: 'text', data: content }] };
}

function writeError(err) {
  // shortcut: Chrome has no dedicated "read-only" error name; we match the message text. Re-check on real locked tags.
  if (/read.?only|not writable|locked/i.test(err.message)) return 'This tag is read-only (locked) and cannot be written.';
  if (err.name === 'NetworkError') return 'Write failed. Keep the phone still on the tag until it finishes, then try again.';
  if (err.name === 'NotSupportedError') return "This tag can't be written (it may be read-only or not NDEF-compatible).";
  if (['AbortError', 'NotAllowedError', 'NotReadableError'].includes(err.name)) return nfcError(err, 'Write');
  return `Write failed: ${err.message || err}`;
}

async function write(e) {
  e.preventDefault();
  let message;
  try {
    message = buildMessage($('type').value, $('content').value);
  } catch (err) {
    setStatus(`Error: ${err.message}`, 'err');
    return;
  }
  stop();
  ctrl = new AbortController();
  setBusy(true);
  setStatus('Hold phone near tag...', 'busy');
  try {
    await new NDEFReader().write(message, { signal: ctrl.signal });
    setStatus('Tag written successfully', 'ok');
  } catch (err) {
    setStatus(`Error: ${writeError(err)}`, 'err');
  } finally {
    stop();
  }
}

// ---- UI wiring ----

for (const tab of document.querySelectorAll('[role=tab]')) {
  tab.addEventListener('click', () => {
    stop();
    for (const t of document.querySelectorAll('[role=tab]')) {
      const on = t === tab;
      t.setAttribute('aria-selected', on);
      $(t.getAttribute('aria-controls')).hidden = !on;
    }
    if (supported) setStatus(tab.id === 'tab-read' ? 'Ready to scan' : 'Ready to write');
  });
}

$('type').addEventListener('change', () => {
  // Only replace untouched content, never what the user typed.
  if (Object.values(TEMPLATES).includes($('content').value)) $('content').value = TEMPLATES[$('type').value];
});
$('scan').addEventListener('click', scan);
$('write-form').addEventListener('submit', write);
$('cancel').addEventListener('click', () => { stop(); setStatus('Cancelled. Ready.'); });

if (!supported) {
  $('unsupported').hidden = false;
  setStatus("Error: Web NFC isn't supported on this browser/device. Use Chrome on Android.", 'err');
}
setBusy(false);
