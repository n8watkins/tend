# Security policy

## Reporting a vulnerability

Please report security problems privately through GitHub's [private vulnerability reporting](https://github.com/n8watkins/tend/security/advisories/new).
Do not open a public issue.
You will get a reply within a week.

Please include what you found, how to reproduce it, and what an attacker could do with it.
Test only against your own account; do not access other people's data or degrade the service.

## What Tend protects

- **Your data is yours:** every query is scoped to the signed-in user, and people, messages and settings of one account are never visible to another.
- **The people you add:** phone numbers and notes are encrypted with AES-256-GCM before they reach the database; the key is a Worker secret.
  This protects against a leaked database or backup, not against a compromised server.
- **Signal:** Tend never connects to Signal and never holds Signal keys or sessions.
- **Sign-in:** passwordless email links (one use, one hour) or GitHub; database sessions; Turnstile and daily limits on sign-in emails.
- **Stop links:** 256-bit random tokens; a stop only happens on a POST, so link previews cannot trigger it.
- **Headers:** a per-request nonce Content-Security-Policy, HSTS, `X-Frame-Options: DENY` and a strict referrer policy.

## Supported versions

Only the live site and the latest `main` are supported.
