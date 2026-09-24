// A stand-in for the Mailyte mail server's /api/v1 mailbox surface, enough to
// render every webmail screen with real-shaped data. Envelope is the live one:
// { type: 'success', msg, data }. Nothing here is persisted.
import http from 'node:http';

const PORT = Number(process.env.PORT || 8180);
const TOKEN = 'mock-token';
const SELF = 'devops@techies.africa';

const people = [
  ['Mailyte', 'noreply@mailyte.com'],
  ['Anthropic, PBC', 'billing@anthropic.com'],
  ['DMARC Report', 'noreply@google.com'],
  ['Namecheap Renewals', 'noreply@namecheap.com'],
  ['Cloudflare', 'noreply@cloudflare.com'],
  ['Amara Chukwu', 'amara@techies.africa'],
  ['GitHub', 'noreply@github.com'],
  ['App Store Connect', 'no_reply@email.apple.com'],
  ['Jordan Lee', 'jordan@techies.africa'],
  ['Ngozi Umeh', 'ngozi@techies.africa'],
];

const subjects = [
  'Login verification for your Mailyte account',
  'Your receipt from Anthropic, PBC #2951-4324-0130',
  '[Preview] Report Domain: techies.africa — Outlook submitter',
  '24 hours left to renew your hosting package',
  '[Alert] New certificate activity for techies.africa',
  'Re: Q4 launch checklist — who owns DNS?',
  'Request to install Codemagic CI/CD in Techies-Africa',
  'Action needed: The uploaded build for Mailyte has issues',
  'Board deck draft attached — comments by Friday',
  'Lunch on Thursday?',
];

const bodies = [
  '<p>Hello,</p><p>Someone signed in to your Mailyte account from a new device. If this was you, no action is needed.</p><p>If not, change your password and turn on two-factor authentication under Settings › Security.</p><p>— The Mailyte team</p>',
  '<p>Thank you for your payment.</p><table><tr><td>Order</td><td>#2951-4324-0130</td></tr><tr><td>Amount</td><td>$200.00</td></tr><tr><td>Status</td><td>Paid</td></tr></table>',
  '<p>This is an automated DMARC aggregate report.</p><p>Domain: techies.africa<br/>Pass: 11 · Fail: 3</p>',
  '<p>Your hosting package for techies.africa is expiring in 24 hours.</p><p>Renew before the deadline to avoid interruption.</p>',
  '<p>A new SSL/TLS certificate has been issued for techies.africa.</p><p>If you did not request this, review your dashboard.</p>',
  '<p>Hi Jordan,</p><p>DNS is on me. I will publish the new DKIM selector tomorrow morning and post the verification screenshot in the channel.</p><p>Amara</p>',
  '<p>@crystalz05 has requested installation of Codemagic CI/CD for Techies-Africa.</p>',
  '<p>The uploaded build for Mailyte has one or more issues:</p><ul><li>Missing App Privacy details</li><li>Icon does not meet requirements</li></ul>',
  '<p>Team,</p><p>The board deck draft is attached. Please leave comments by Friday.</p>',
  '<p>Fancy lunch on Thursday? There is a new place near the office.</p>',
];

const folders = ['INBOX', 'Drafts', 'Sent', 'Archive', 'Junk', 'Trash', 'Social', 'Promotions', 'Updates', 'Receipts'];
const roles = { INBOX: 'inbox', Drafts: 'drafts', Sent: 'sent', Archive: 'archive', Junk: 'junk', Trash: 'trash' };

const messages = new Map();
let uid = 1000;
const now = Date.now();
for (const folder of folders) {
  const count = folder === 'INBOX' ? 24 : folder === 'Drafts' ? 2 : folder === 'Trash' ? 3 : folder === 'Junk' ? 4 : 5;
  for (let i = 0; i < count; i += 1) {
    const p = people[(i + folder.length) % people.length];
    const id = `${folder}:${uid++}`;
    const isSent = folder === 'Sent';
    messages.set(id, {
      id,
      folder,
      subject: subjects[(i + folder.length) % subjects.length],
      from: isSent ? [{ name: 'DevOps', email: SELF }] : [{ name: p[0], email: p[1] }],
      to: isSent ? [{ name: p[0], email: p[1] }] : [{ name: 'DevOps', email: SELF }],
      cc: i % 4 === 0 ? [{ name: 'Ngozi Umeh', email: 'ngozi@techies.africa' }] : [],
      bcc: [],
      reply_to: [],
      received_at: new Date(now - (i * 5 + folder.length) * 3600 * 1000 * (i % 3 === 0 ? 1 : 7)).toISOString(),
      size: 4096 + i * 100,
      has_attachment: i % 3 === 1,
      is_read: i % 3 !== 0,
      is_starred: i % 5 === 1,
      is_answered: i % 6 === 2,
      is_draft: folder === 'Drafts',
      preview: bodies[(i + folder.length) % bodies.length].replace(/<[^>]+>/g, ' ').trim().slice(0, 120),
      thread_id: null,
      message_id: `<${uid}.${i}@mock>`,
      in_reply_to: null,
      references: null,
      body_html: bodies[(i + folder.length) % bodies.length],
      body_text: null,
      attachments: i % 3 === 1 ? [{ index: 0, name: 'board-deck.pdf', type: 'application/pdf', size: 245000, is_inline: false, content_id: null }] : [],
    });
  }
}

const blocked = { addresses: ['spam@example.com'], managed: true, folder: 'Junk', limit: 500 };

function ok(res, msg, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ type: 'success', msg, data }));
}
function fail(res, status, msg) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ type: 'error', msg }));
}
function folderList() {
  return folders.map((name) => {
    const rows = [...messages.values()].filter((m) => m.folder === name);
    return {
      id: Buffer.from(name).toString('hex'),
      name,
      role: roles[name] ?? null,
      total: rows.length,
      unread: rows.filter((m) => !m.is_read).length,
      uid_next: uid,
      uid_validity: 1,
    };
  });
}
function summary(m) {
  const { body_html, body_text, attachments, ...rest } = m;
  return rest;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname.replace(/^\/api\/v1/, '');
  let body = '';
  for await (const chunk of req) body += chunk;
  let json = {};
  try {
    json = body ? JSON.parse(body) : {};
  } catch {
    json = {};
  }

  if (path === '/mailbox-auth/login' && req.method === 'POST') {
    if (json.password === 'wrong') return fail(res, 401, 'Invalid email address or password');
    if (json.password === '2fa' && !json.two_factor_code) return ok(res, 'Enter your code', { two_factor_required: true });
    // The token names the mailbox, so several accounts can be signed in at
    // once and every mailbox call can answer for the right one.
    const who = (json.email_address || SELF).trim().toLowerCase();
    return ok(res, 'Signed in', {
      token: `${TOKEN}:${who}`,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      email_account: { email_address: who },
      must_change_password: json.password === 'temp',
      password_change_reason: json.password === 'temp' ? 'temporary' : null,
    });
  }
  if (path === '/mailbox-auth/logout') return ok(res, 'Signed out', null);

  const auth = req.headers.authorization || '';
  if (!auth.startsWith(`Bearer ${TOKEN}`)) return fail(res, 401, 'Not logged in');
  // Whose session this is; the pre-multi-account bare token means the default mailbox.
  const me = auth.slice(`Bearer ${TOKEN}`.length).replace(/^:/, '') || SELF;

  if (path === '/mailbox/capabilities') {
    return ok(res, 'ok', {
      email_address: me,
      capabilities: { mail: true, send: true, settings: true, two_factor: true, rules: true, forwarding: true, vacation: true, ai: true, calendar: true, contacts: true, scheduled_send: true },
      shared_mailboxes: [{ address: 'sales@techies.africa', name: 'Sales', permission: 'send_as', can_send: true }],
    });
  }
  if (path === '/mailbox/folders' && req.method === 'GET') return ok(res, 'ok', folderList());
  if (path === '/mailbox/folders' && req.method === 'POST') {
    if (!folders.includes(json.name)) folders.push(json.name);
    return ok(res, 'Folder created', folderList());
  }
  if (path.startsWith('/mailbox/folders/') && req.method === 'PATCH') return ok(res, 'Renamed', { id: 'x', name: json.name, folders: folderList() });
  if (path.startsWith('/mailbox/folders/') && req.method === 'DELETE') return ok(res, 'Deleted', null);

  if (path === '/mailbox/messages' && req.method === 'GET') {
    const folder = url.searchParams.get('folder');
    const q = (url.searchParams.get('search') || '').toLowerCase();
    const unread = url.searchParams.get('unread') === 'true';
    const starred = url.searchParams.get('starred') === 'true';
    const limit = Number(url.searchParams.get('limit') || 50);
    const offset = Number(url.searchParams.get('offset') || 0);
    let rows = [...messages.values()];
    if (folder) rows = rows.filter((m) => m.folder === folder);
    else if (!q) rows = rows.filter((m) => m.folder === 'INBOX');
    if (q) rows = rows.filter((m) => (m.subject + m.preview + m.from[0].email).toLowerCase().includes(q));
    if (unread) rows = rows.filter((m) => !m.is_read);
    if (starred) rows = rows.filter((m) => m.is_starred);
    rows.sort((a, b) => b.received_at.localeCompare(a.received_at));
    const page = rows.slice(offset, offset + limit).map(summary);
    return ok(res, 'ok', { messages: page, total: rows.length, offset, limit, has_more: offset + limit < rows.length, folder: folder || 'INBOX' });
  }
  if (path === '/mailbox/messages/scheduled') return ok(res, 'ok', { messages: [] });
  if (path === '/mailbox/messages/send' && req.method === 'POST') return ok(res, 'Sent', { sent: true, filed_to_sent: true });
  if (path === '/mailbox/messages/draft' && req.method === 'POST') return ok(res, 'Saved', { id: 'Drafts:9999' });
  if (path.startsWith('/mailbox/messages/draft/') && req.method === 'DELETE') return ok(res, 'Discarded', null);

  const msgMatch = path.match(/^\/mailbox\/messages\/([^/]+)(?:\/(.+))?$/);
  if (msgMatch) {
    const id = decodeURIComponent(msgMatch[1]);
    const action = msgMatch[2];
    const m = messages.get(id);
    if (!m) return fail(res, 404, 'Message not found');
    if (!action && req.method === 'GET') return ok(res, 'ok', m);
    if (!action && req.method === 'DELETE') {
      messages.delete(id);
      return ok(res, 'Deleted', null);
    }
    if (action === 'thread') {
      const others = [...messages.values()].filter((x) => x.folder === m.folder && x.subject === m.subject && x.id !== id).slice(0, 2).map(summary);
      return ok(res, 'ok', [...others, summary(m)]);
    }
    if (action === 'mark-read') m.is_read = true;
    if (action === 'mark-unread') m.is_read = false;
    if (action === 'star') m.is_starred = true;
    if (action === 'unstar') m.is_starred = false;
    if (action === 'move') { m.folder = json.folder; m.id = `${json.folder}:${uid++}`; messages.delete(id); messages.set(m.id, m); }
    if (action === 'trash') { m.folder = 'Trash'; m.id = `Trash:${uid++}`; messages.delete(id); messages.set(m.id, m); }
    if (action === 'raw') { res.writeHead(200, { 'Content-Type': 'message/rfc822', 'Content-Disposition': 'attachment; filename="message.eml"' }); return res.end('Subject: mock\r\n\r\nhello'); }
    if (action && action.startsWith('attachments/')) { res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="board-deck.pdf"' }); return res.end('%PDF-1.4 mock'); }
    return ok(res, 'ok', null);
  }

  if (path === '/mailbox/contacts') return ok(res, 'ok', people.map(([name, email], i) => ({ name, email, count: 10 - i })));
  if (path === '/mailbox/settings' && req.method === 'GET') return ok(res, 'ok', { email_address: me, name: me === SELF ? 'DevOps' : me.split('@')[0], signature_html: '<p>— DevOps, Techies Africa</p>', signature_on_reply: true, display_density: 'comfortable', undo_send_enabled: true, undo_send_seconds: 10, storage: { used_mb: 812, quota_mb: 5120, percentage: 16 } });
  if (path === '/mailbox/settings' && req.method === 'PUT') return ok(res, 'Saved', json);
  if (path === '/mailbox/security') return ok(res, 'ok', { two_factor_enabled: false, two_factor_confirmed_at: null, recovery_codes_remaining: 0, protects: 'webmail_sign_in_only' });
  if (path === '/mailbox/security/sessions') return ok(res, 'ok', { scope: 'webmail', sessions: [{ id: 's1', signed_in_at: new Date().toISOString(), expires_at: null, ip_address: '102.89.1.4', user_agent: 'Chrome on macOS', revoked: false, active: true, current: true }] });
  if (path === '/mailbox/forwarding') return ok(res, 'ok', { enabled: false, addresses: [], keep_copy: true, managed: true });
  if (path === '/mailbox/vacation') return ok(res, 'ok', { enabled: false, subject: null, message: null, start_date: null, end_date: null, managed: true });
  if (path === '/mailbox/rules') return ok(res, 'ok', { rules: [], active: false, managed: true });
  if (path === '/mailbox/blocked-senders' && req.method === 'GET') return ok(res, 'ok', blocked);
  if (path === '/mailbox/blocked-senders' && req.method === 'POST') { if (!blocked.addresses.includes(json.address)) blocked.addresses.push(json.address); return ok(res, 'Sender blocked', blocked); }
  if (path.startsWith('/mailbox/blocked-senders/') && req.method === 'DELETE') { const a = decodeURIComponent(path.split('/').pop()); blocked.addresses = blocked.addresses.filter((x) => x !== a); return ok(res, 'Unblocked', blocked); }
  if (path === '/mailbox/calendars') return ok(res, 'ok', [{ uri: 'default', name: 'Calendar', color: null, description: null, read_only: false, is_default: true }]);
  if (path.match(/^\/mailbox\/calendars\/[^/]+\/events$/) && req.method === 'GET') {
    const d = new Date(); d.setHours(15, 0, 0, 0);
    const d2 = new Date(d.getTime() + 2 * 86400000);
    return ok(res, 'ok', [
      { id: 'e1', etag: '1', calendar: 'default', uid: 'e1', summary: 'Deliverability review', description: null, location: 'Room 2', status: null, start: d.toISOString(), end: new Date(d.getTime() + 3600000).toISOString(), timezone: 'Africa/Lagos', all_day: false, recurring: false, rrule: null, sequence: 0, organizer: null, attendees: [], alarms: 0, reminders: [] },
      { id: 'e2', etag: '1', calendar: 'default', uid: 'e2', summary: 'Board meeting', description: null, location: null, status: null, start: d2.toISOString(), end: new Date(d2.getTime() + 5400000).toISOString(), timezone: 'Africa/Lagos', all_day: false, recurring: false, rrule: null, sequence: 0, organizer: null, attendees: [], alarms: 0, reminders: [] },
    ]);
  }
  if (path === '/mailbox/calendar/invitations') return ok(res, 'ok', []);
  if (path === '/mailbox/calendar/rooms') return ok(res, 'ok', []);
  if (path === '/mailbox/calendar-subscriptions') return ok(res, 'ok', []);
  if (path === '/mailbox/address-book/books') return ok(res, 'ok', [{ uri: 'default', name: 'Contacts', description: null, read_only: false }, { uri: 'directory', name: 'Techies Africa', description: 'Everyone at techies.africa', read_only: true }]);
  if (path === '/mailbox/address-book/contacts') {
    const book = url.searchParams.get('book');
    const rows = (book === 'directory' ? people.filter((p) => p[1].endsWith('techies.africa')) : people.slice(5, 8)).map(([name, email], i) => ({ id: `c${i}${book}`, etag: '1', book, read_only: book === 'directory', uid: null, full_name: name, first_name: name.split(' ')[0], last_name: name.split(' ')[1] ?? null, emails: [{ address: email, type: 'WORK' }], phones: i % 2 ? [{ number: '+234 801 000 0000', type: 'CELL' }] : [], organization: 'Techies Africa', title: i === 0 ? 'Engineering' : null, address: null, note: null, birthday: null }));
    return ok(res, 'ok', rows);
  }
  if (path === '/mailbox/ai/compose') return ok(res, 'ok', { draft: '<p>Thanks for the update — Friday works for me. I will send the agenda ahead.</p>' });
  if (path.startsWith('/mailbox/ai/summarize')) return ok(res, 'ok', { summary: 'Amara confirmed she owns DNS and will publish the new DKIM selector tomorrow morning.' });

  return fail(res, 404, `No mock for ${req.method} ${path}`);
});

server.listen(PORT, () => console.log(`mock mail server on http://localhost:${PORT}/api/v1`));
