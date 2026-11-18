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
3. **Welcome page.** Four quick actions send the same phrases Val's prompt uses on her own card buttons.
4. **Greeting.** Once the avatar is ready, the site makes Val say the greeting, then tells the agent it has already
   greeted. **Leave the Greeting field in the Mobeus dashboard empty**, or she greets twice.
5. **Status.** The avatar column shows "Connecting… Xs", then "Agent engaged in Xs", plus the AI disclaimer.

## Settings without a rebuild: `public/config.js`

| Key | What it does |
|---|---|
| `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID` | Unisys Entra app registration used for SSO (public identifiers). |
| `ALLOWED_EMAIL_DOMAIN` | Accounts allowed through SSO (`unisys.com` and its subdomains). `''` = any account the registration admits. |
| `PASSWORD_LOGIN_ENABLED` | `'true'` shows the username/password form. |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` | The demo admin account. **Only a salted PBKDF2-SHA256 hash is stored** (this repo is public); the password is kept outside the repo. |
| `GREETING_NAME` | Name in the spoken greeting. `'Maria'` matches the demo student in Val's prompt; `''` greets the signed-in user by first name. |
| `BRAND_LOGO_URL` | Official CSU logo file, e.g. `'/brand/csu-wordmark.svg'` in `public/brand/`. `''` shows a text label. CSU asks that its wordmark is never recreated or generated, so request the file from CSU Marketing Communications. |
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
- **Site functions**: only `setTheme` is registered, as before, so the agent's tool list does not change.
- **Henkel ServiceNow helpers** (incident watchdogs, call capture, auto-rendered incident cards) are in the code but
  switched off (`SERVICENOW_FEATURES = false` in `src/lib/stores/voice-session-store.ts`).
- The Mobeus Studio theming and AirVision features of the stock starter are not in this build.

## Build

```bash
npm ci
npm run build
```

Static export to `out/`. For a local layout check without Microsoft sign-in, run `next dev` with
`NEXT_PUBLIC_DEV_FAKE_SIGNIN=1` (development mode only; ignored in production builds).
