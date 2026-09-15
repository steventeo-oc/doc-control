# Plan-Back — "Sign in with Microsoft" (Entra ID / Azure AD)

Found during the Login page redesign review; owner has confirmed the
core account-linking policy already (below). This document exists to
get the remaining decisions (flagged F1–F5) signed off before any code,
matching how every other real feature in this project has been built.

## Why this, not generic SSO

The redesign feedback that started this asked for generic "Sign in with
Okta/Google/Microsoft." Rejected that as-is: this org has no
relationship with Okta or Google, and adding buttons for providers with
no backing configuration would be non-functional UI. Overclock does
have its own domain (`overclock.sg`) and this app already holds real
Azure/Entra credentials for `GraphNotificationSender` — so "Sign in
with Microsoft" against the org's actual tenant is the one SSO option
that's real. Scope is exactly that: one provider, this org's tenant.

## Decided (owner, this session)

**Account-linking policy**: on a successful Microsoft sign-in, look up
the local `user` by email (case-insensitive, same uniqueness rule the
`user` table already enforces).
- **Match found** → authenticate as that existing user. Same session,
  same roles/departments/history — Microsoft is just a second door into
  the same account. The existing local password (if any) is untouched
  and stays usable — this is additive, not exclusive-or.
- **No match** → reject the sign-in with a clear, specific message
  ("No account found for `{email}`. Ask an administrator to create your
  account first.") and send them back to the login page. No
  auto-provisioning, no automatic admin notification pipeline — an
  admin creates the account the normal way (Users admin screen), same
  as onboarding anyone today, and the person retries.

This needs no new table or column: it's a lookup at login time against
data that already exists.

## F1 — Azure app registration: reuse or new

The existing Graph integration's app registration almost certainly
holds an **application permission** (`Mail.Send`, client-credentials
flow, no user ever signs into it) — a different permission model from
an **interactive login** (`openid`/`profile`/`email`, delegated,
authorization-code flow with a browser redirect). Azure AD supports
both on one app registration.

- **Recommended default**: reuse the existing app registration. Add the
  delegated `openid`, `profile`, `email` permissions and a new redirect
  URI (`{base-url}/api/login/oauth2/code/microsoft`) to it. One app to
  manage, one set of secrets already handled correctly (gitignored
  `.env`, real values only at deployment).
- **Alternative**: a separate app registration for login, isolating
  "can send mail as the service" from "can authenticate users" so a
  problem with one credential can't affect the other.
- **This step happens in the Azure Portal, outside this codebase** —
  whichever way you go, that's a manual step for whoever administers
  the Overclock tenant (you, or IT). I'll document the exact redirect
  URI and permissions needed once this is picked.

## F2 — Feature flag

Recommend `doccontrol.auth.sso.enabled` (default `false`), matching the
existing `doccontrol.notification.enabled` pattern for the Graph
sender. The "Sign in with Microsoft" button only renders (and the
backend OAuth2 client only activates) when this is on. Deployments that
haven't configured Azure credentials see no change at all.

## F3 — Audit logging

Password login currently has no `audit_log` entry (checked — no
existing "user logged in" action). Recommend staying consistent rather
than making SSO an exception: don't audit successful SSO logins either.
**Do** audit the rejection case (`sso_login_rejected`, email attempted,
no `user_id` since none matched) — that's a security-relevant event
worth a record, and it's a new/rare code path rather than every-login
noise. Flag if you'd rather audit successful SSO logins too, or not
audit rejections either.

## F4 — Frontend placement

A "Sign in with Microsoft" button on LoginPage, with a labeled divider
("or") between it and the email/password form — standard placement,
either above or below the form. It's a plain link/full-page navigation
to the backend's authorization endpoint (Spring Security exposes this
automatically once configured, conventionally
`/api/oauth2/authorization/microsoft`), not an API call — no CSRF
handling needed for that hop. A `?error=sso_no_account` query param on
return renders the rejection message from F-decided above in the
existing error-banner style already on the page.

## F5 — Scope confirmation

Out of scope for this pass (say so if any should be in):
- No change to the existing password-based login, forgot-password, or
  admin password-reset flows — all untouched, remain fully available.
- No group/role mapping from Azure AD claims — roles and departments
  stay exactly as assigned locally, Microsoft only proves identity.
- No "disconnect SSO" self-service UI — there's nothing stored to
  disconnect, per the stateless-matching design above.

## Technical shape (for reference, not itself a decision)

- Backend: `spring-boot-starter-oauth2-client`, Spring Security OAuth2
  Login configured against Microsoft's OIDC endpoints for the org's
  tenant. A custom `OidcUserService` wraps the default one: after
  Microsoft returns the authenticated identity, look up `user` by the
  email claim; found+active → proceed (Spring Security establishes the
  normal session cookie, identical to password login from here on);
  not found → throw `OAuth2AuthenticationException`, caught by a
  failure handler that redirects to `/login?error=sso_no_account`.
- New env vars (gitignored `.env`, matching the existing Graph secret
  discipline): `DOCCONTROL_OAUTH2_MICROSOFT_CLIENT_ID`,
  `_CLIENT_SECRET`, `_TENANT_ID` (reuse the existing Graph
  client id/secret if F1 goes with "reuse the app registration" and
  they're the same values — tenant id likely already implicit in the
  Graph config, will confirm).
- Frontend: one button + a divider + one error-message branch on
  LoginPage. `AuthContext`/`/auth/me` need zero changes — a session
  cookie is a session cookie regardless of how it was established.
- Tests: `SsoLoginServiceTests` (or similar) for the match/reject
  branching against a real test database, same pattern as
  `PasswordResetTests`. The actual browser round-trip through
  login.microsoftonline.com can't be unit-tested — real end-to-end
  verification against the live Azure tenant, same as how the Graph
  sender itself was verified with a real email.

## What I need from you before any code

1. F1: reuse the existing app registration, or a new one?
2. Anything to change in F2–F5, or approve the recommended defaults?
3. Once F1 is picked, you'll need to go into the Azure Portal yourself
   and add the redirect URI + delegated permissions (or create the new
   app) — I'll give you the exact values to enter once F1 is settled.
