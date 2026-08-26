# Contributing

## Getting set up

```bash
cp .env.example .env      # point MAILBOX_API_BASE_URL at a mail server
npm install
npm run dev
```

You need a running mail server to develop against; this app has no data of
its own and deliberately no mock mode, because a mock mail server is a very
effective way to ship a webmail that does not work against a real one.

Before opening a pull request:

```bash
npm run typecheck
npm run build
```

## Conventions worth reading before you write code

**No control that does not work.** If the server cannot do something, remove
the control — do not render it disabled. The server advertises what it
supports at `/api/v1/mailbox/capabilities`; render against that.

**Nothing is destroyed outside Trash.** Delete moves to Trash. Only a second
delete from inside Trash is permanent, and the server enforces this too.

**Message HTML is hostile.** It is sanitised with DOMPurify *and* rendered in
a sandboxed iframe. Do not remove either. Remote images stay blocked until the
reader allows that sender.

**No fabricated data.** A field the server did not send renders as absent, not
as a placeholder, a zero or a guess. An invented number in a mail client is
worse than a blank.

**Explain the non-obvious in comments.** This codebase favours comments that
say *why* — especially where something looks wrong but is deliberate. If you
work out something subtle, leave the reasoning behind for the next person.

## Where things live

| Path | What lives there |
|---|---|
| `app/webmail/` | Pages: mailbox, login, settings |
| `app/api/webmail/` | Server-side proxy to the mail server |
| `lib/webmail/` | API client, sanitising, adapters, shortcuts |
| `components/webmail/` | Interface |
| `components/webmail/settings/` | Settings sections — add one here |

Adding a settings section means adding a component and one entry in
`components/webmail/settings/sections.ts`. The page picks it up.

## Licence

Contributions are accepted under [AGPL-3.0-or-later](LICENSE), the same
licence as the project.
