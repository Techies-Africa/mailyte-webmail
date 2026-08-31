# Mailyte Webmail

A self-hostable webmail client. Reads and sends real mail over your own mail
server — no vendor account, no hosted middle tier.

Built as the webmail for [Mailyte Mail Server][server], and usable with any
server that implements the same mailbox API.

[server]: https://github.com/Techies-Africa/mailyte-mail-server-community

---

## What it does

- Read, search, and organise mail. Search runs **on the server**, over message
  bodies, so a word buried deep in an email is findable.
- Compose with a rich-text editor, inline pictures (inserted, pasted or
  dropped), attachments, and drafts stored as real messages in your Drafts
  folder — every other client on the account can see and continue them.
- Folders, flags, threading, and move/trash.
- Filter rules, mail forwarding, and a vacation responder, compiled to Sieve.
- Signature (rich text, with pictures), display density, and an optional
  undo-send window.
- Optional two-factor authentication on webmail sign-in.
- Optional AI compose and thread summary, against any OpenAI-compatible
  endpoint you point it at.

Optional features are **absent, not disabled**, when the server does not
support them: the app asks the server what it can do and does not render a
control that would fail.

## Quick start

```bash
cp .env.example .env      # point MAILBOX_API_BASE_URL at your mail server
npm install
npm run dev               # http://localhost:3000/webmail
```

With Docker:

```bash
docker build -t mailyte-webmail .
docker run -p 3000:3000 -e MAILBOX_API_BASE_URL="https://mail.example.com/api/v1" mailyte-webmail
```

## Configuration

| Variable | Required | What it does |
|---|---|---|
| `MAILBOX_API_BASE_URL` | yes | Your mail server's API base, e.g. `https://mail.example.com/api/v1` |
| `NEXT_PUBLIC_BRAND_NAME` | no | Name shown on the sign-in screen. Default `Webmail` |
| `NEXT_PUBLIC_BRAND_MARK` | no | One or two characters for the mark beside it. Default `✉` |

`MAILBOX_API_BASE_URL` is read **at request time, on the server**, so one
image works for every deployment — change it and restart, no rebuild. The
`NEXT_PUBLIC_*` values are rendered in the browser and are therefore baked in
at build time; that is the difference between the two, and it is deliberate.

## How it is put together

```
browser ──► Next.js route handlers (this app) ──► your mail server
            └─ holds the session in an HttpOnly cookie
```

The browser never holds the session token. Every call goes through a route
handler in `app/api/webmail/*`, which reads the cookie server-side and
attaches it as a Bearer token. That is why the proxy exists rather than the
browser calling the mail server directly.

| Path | What lives there |
|---|---|
| `app/webmail/` | The pages: mailbox, login, settings |
| `app/api/webmail/` | The server-side proxy to your mail server |
| `lib/webmail/` | API client, sanitising, keyboard shortcuts |
| `components/webmail/` | The interface |

## Security

Choices worth knowing about, because they constrain contributions:

- **Message HTML is sanitised with DOMPurify and rendered in a sandboxed
  iframe.** Both, not either.
- **Remote images are blocked by default**, with a per-sender allow. Loading
  them silently tells a sender when, and roughly where, a message was opened.
- **Signatures are sanitised on the way in**, against an allowlist. A
  signature is HTML the server later attaches to outgoing mail. The one
  `data:` URI it admits is a base64 raster image on `<img src>` — how the
  editor embeds a picture — and on send the server turns those into
  Content-ID parts, because Gmail and Outlook will not render `data:` images.
- **Attachments always download**, never render inline, and are served with
  `X-Content-Type-Options: nosniff`. An HTML attachment rendered in the app's
  own origin is stored XSS.
- **Nothing is destroyed outside Trash.** Delete moves to Trash; only a second
  delete from inside Trash is permanent.
- **No control appears that does not work.** If the server cannot do
  something, the button is not there.

Report vulnerabilities per [SECURITY.md](SECURITY.md) — not in a public issue.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

[AGPL-3.0-or-later](LICENSE). If you run a modified version as a network
service, the AGPL requires you to offer that version's source to its users.
This is the same licence as the mail server.
