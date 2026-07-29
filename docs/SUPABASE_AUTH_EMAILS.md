# Supabase auth emails (Resend + doingsapp.com)

SMTP is configured in the **Supabase Dashboard**, not in this repo.

## Dashboard paths

Project: `ktaeljyhprsufoisqtll`

1. **Authentication → Emails → SMTP Settings** — Resend / `noreply@doingsapp.com` (or your chosen sender)
2. **Authentication → Emails → Templates** — paste HTML from `supabase/templates/`
3. **Authentication → Rate Limits** — raise **Email sent** after custom SMTP (e.g. 100–500/hour)

## Branded templates (copy into Supabase)

| Template | Subject line | Source file |
|----------|--------------|-------------|
| Confirm signup | `Confirm your Doings account` | `supabase/templates/auth-confirm-signup.html` |
| Reset password | `Reset your Doings password` | `supabase/templates/auth-reset-password.html` |

Open each file, copy the full HTML, paste into the matching template in the dashboard.

## Redirect URLs

**Authentication → URL Configuration**

- Site URL: `https://doingsapp.com` (or your production app URL)
- Redirect URLs must include:
  - `https://doingsapp.com/auth/callback`
  - `https://doingsapp.com/auth/reset-password`
  - Local dev URLs if needed

## Resend checklist

- Domain `doingsapp.com` verified (SPF, DKIM)
- Sender address matches verified domain (e.g. `noreply@doingsapp.com`)
- Test: Authentication → Users → invite, or sign up from the app

## Local dev

`supabase/config.toml` uses Mailpit for local auth emails (`http://127.0.0.1:54324`). Production templates apply only to the hosted project.
