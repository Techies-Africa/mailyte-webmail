# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Mailyte Webmail, please report it
responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, email **security@mailyte.com** with:

1. Description of the vulnerability
2. Steps to reproduce
3. The version or commit you tested
4. Any suggested fix

You can expect an acknowledgement within 3 working days.

## Scope

This repository is the webmail client. Issues in the mail server itself
belong in [mailyte-mail-server-community][server].

Particularly interested in:

- Anything that escapes the message-rendering sandbox (DOMPurify plus the
  iframe) — message HTML is attacker-supplied by definition.
- Anything that causes remote content to load without the reader allowing it.
- Anything that lets one mailbox reach another's mail. No endpoint takes a
  mailbox id from the client; the session decides. A way around that is a
  serious bug.
- Anything that exposes the session cookie to page scripts.

[server]: https://github.com/Techies-Africa/mailyte-mail-server-community
