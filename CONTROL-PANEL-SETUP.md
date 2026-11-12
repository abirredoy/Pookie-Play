# Pookie Play Control Panel setup

Deploy this repository to Vercel with Framework Preset **Other**, Root Directory **./**, and Output Directory **public**. Vercel automatically deploys serverless functions from the root `api/` directory.

## Required Vercel environment variables

- `GITHUB_TOKEN`: fine-grained PAT for only `abirredoy/Pookie-Play`, with Actions Read and write and Metadata Read-only.
- `DISCORD_OAUTH_CLIENT_ID`: Discord application client ID.
- `DISCORD_OAUTH_CLIENT_SECRET`: Discord OAuth2 client secret. Keep server-side only.
- `DISCORD_OAUTH_REDIRECT_URI`: `https://YOUR-VERCEL-DOMAIN/api/auth/callback`.
- `SESSION_SECRET`: random secret string of at least 32 characters.
- `OWNER_DISCORD_IDS`: comma-separated Discord user IDs that own the control panel.
- `CONTROL_ALLOWED_IDS`: optional comma-separated Discord user IDs also allowed to start the bot.

## Discord OAuth2 setup

Add `https://YOUR-VERCEL-DOMAIN/api/auth/callback` to OAuth2 Redirects for the Discord application. The website requests only the `identify` scope.

The dashboard status is public. Only allowlisted Discord users can start the workflow. There is no shutdown endpoint or shutdown button.

GitHub Actions has a six-hour job timeout; this is not 24/7 hosting. Never put GitHub or Discord secrets in frontend code or chat.
