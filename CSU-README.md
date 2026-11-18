# CSU Student Engagement Platform site (CSU Navigator repo)

The front end of the CSU Student Engagement Platform Tele ("Val") on the Mobeus platform. It has the same look and layout as the Henkel
DX Tele (Unisys build v0.8.2): sign-in page, data privacy notice, welcome page with quick actions, avatar column on
the right with the connection timer and AI disclaimer, and cards on the left. The colours are CSU's.

## What happens when someone opens the site

1. **Sign-in page.** Two ways in:
   - **Sign in with Enterprise ID**: Microsoft Entra ID, Unisys tenant. Only `@unisys.com` accounts by default.
   - **Username and password**: the demo admin account, for people without Unisys SSO.
2. **Data privacy notice.** Two ticks (microphone, notice) and a "join muted / mic on" choice. If the microphone is
   blocked or missing, **Continue with chat only** lets the visitor in, muted, with the chat panel open.
3. **Student verification door** (`VERIFY_GATE: 'mock'`). Six code boxes for "the phone on your record ending
   5013". A few seconds later a **simulated text message** with the code slides in (nothing is sent; this is a demo
   of the step, not a security control). The student types the code or reads it out to Val (`verifyCode`). While
   the door is shut Val says the door line only and the record tools refuse. `VERIFY_GATE: 'off'` removes it.
4. **Welcome page.** Four quick actions send the same phrases Val's prompt uses on her own card buttons.
5. **Greeting.** Once the avatar is ready, the site makes Val say the greeting (the door line first, then the warm
   greeting once the code is right), and tells the agent what was said. **Leave the Greeting field in the Mobeus
   dashboard empty**, or she greets twice.
6. **Status.** The avatar column shows "Connecting… Xs", then "Agent engaged in Xs", plus the AI disclaimer.

## Settings without a rebuild: `public/config.js`

| Key | What it does |
|---|---|
| `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID` | Unisys Entra app registration used for SSO (public identifiers). |
| `ALLOWED_EMAIL_DOMAIN` | Accounts allowed through SSO (`unisys.com` and its subdomains). `''` = any account the registration admits. |
| `PASSWORD_LOGIN_ENABLED` | `'true'` shows the username/password form. |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` | The demo admin account. **Only a salted PBKDF2-SHA256 hash is stored** (this repo is public); the password is kept outside the repo. |
| `GREETING_NAME` | Name in the spoken greeting. `'Maria'` matches the demo student in Val's prompt; `''` greets the signed-in user by first name. |
| `BRAND_LOGO_URL` | Official CSU logo file, e.g. `'/brand/csu-wordmark.svg'` in `public/brand/`. `''` shows a text label. CSU asks that its wordmark is never recreated or generated, so request the file from CSU Marketing Communications. |
| `VERIFY_GATE` | `'mock'` (default) shows the student code door with a simulated text message; `'off'` skips it. |
| `WIDGET_HOST`, `WIDGET_API_KEY` | Leave blank: the Mobeus deploy injects the site's host and publishable key at build time. |

### SSO redirect URI

In the Unisys app registration, add `https://<this site's URL>/auth/callback` as a **Single-page application**
redirect URI (not "Web").

### Changing the admin password

Generate a new strong password, compute `pbkdf2-sha256$210000$<salt base64>$<hash base64>` (PBKDF2-HMAC-SHA256,
16-byte random salt, 32-byte hash) and replace `ADMIN_PASSWORD_HASH`. Never commit the password itself.

## Security, honestly

Mobeus hosts this as a static site and nothing on the Mobeus side checks the Microsoft token or the password, so
both sign-in paths are a **front door for a demo, not a security boundary**. The voice session is created with the
site's publishable key, exactly as the stock Mobeus starter does. Use sample data only.

## Things deliberately left as they are

- **`platform.yaml`**: voice, avatar, model, greeting and brain-mode settings are commented out, because they are
  managed in the dashboard and active values would overwrite it on deploy.
- **`public/prompts/*.md` are empty** for the same reason (an empty file is ignored on deploy). Val's prompt lives in
  the dashboard; its source is `csu-teles/navigator/` in the Unisys workspace.
- **Prompts must match the site**: this build needs Val prompt **v1.5** (`csu-teles/navigator/`), which knows the
  door and the tools below.
- **Henkel ServiceNow helpers** (incident watchdogs, call capture, auto-rendered incident cards) are in the code but
  switched off (`SERVICENOW_FEATURES = false` in `src/lib/stores/voice-session-store.ts`).
- The Mobeus Studio theming and AirVision features of the stock starter are not in this build.

## Merged from Venkat's CSU build (2026-11-18)

- **Student tools** (`src/site-functions/register.ts`), sent to the platform with the session request so Val can
  call them by name: `verifyCode`, `getStudentProfile`, `showJourney`, `showCost`, `prefillForm`, `addToCalendar`,
  `setLocale`. If the platform refuses the list, the site retries without it, so Val still connects.
- **Record-driven cards**: journey (`journey-card`, tap a step to work on it), cost (`aid-card`, no net figure while
  aid is on hold) and forms (`form-card`: verification "tax" packet, orientation, advising). All values come from
  `src/data/student.ts`, which mirrors `csu-teles/shared/demo-world.md`. Forms **save in the browser with a demo
  reference** (`CSUF-XXXXXX`) and say "Saved" (the card explains it goes to the campus system once the platform
  is integrated); nothing is sent.
- **Calendar links**: an `.ics` download and a Google Calendar link, built in the browser, only for dates on the record.
- **Page text in 6 languages** (en, es, zh, tl, vi, de) via `setLocale`; any other language keeps English page text
  while Val speaks it. Non-English text is a first draft: have a native speaker review it.
- **Approved CSU links** (`src/data/csuLinks.ts`).
- Fixed: buttons on Val's `info-card`s now send their phrase to Val (they did nothing before).
- Not merged: Venkat's `?sid=` cohort and server routes (SMS, forms, calendar, real OTP), his plaintext demo login,
  the drawn `CsuMark`, log-to-disk.

## Build

```bash
npm ci
npm run build
```

Static export to `out/`. For a local layout check without Microsoft sign-in, run `next dev` with
`NEXT_PUBLIC_DEV_FAKE_SIGNIN=1` (development mode only; ignored in production builds).
