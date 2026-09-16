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

## F1 — Azure app registration: reuse or new — **DECIDED: reuse**

Confirmed by the owner. Reuses the existing Graph app registration —
add the delegated `openid`, `profile`, `email` permissions and a login
redirect URI to it (exact values in "Azure Portal steps" below). One
app, one set of secrets; `doccontrol.auth.sso.*` config points at the
*same* `DOCCONTROL_NOTIFICATION_TENANT_ID` / `_CLIENT_ID` /
`_CLIENT_SECRET` values already in the gitignored `.env` — no new
secrets needed, just one new flag to flip on.

### Azure Portal steps (manual, outside this codebase — for whoever
administers the Overclock tenant)

1. In the existing app registration (the one `GraphNotificationSender`
   already uses) → **Authentication** → Add a platform → **Web** →
   redirect URI: `{app.base-url}/api/login/oauth2/code/microsoft`
   (for the current dev stack: `http://localhost:3000/api/login/oauth2/code/microsoft`;
   a real deployment uses its real `app.base-url` instead).
2. **API permissions** → Add a permission → **Microsoft Graph** →
   **Delegated permissions** → add `openid`, `profile`, `email`. These
   are separate from the existing `Mail.Send` **application**
   permission already granted — both can coexist on one registration.
   Grant admin consent for the tenant if prompted.
3. No new client secret needed — the existing one is reused.

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
  Login gated behind `doccontrol.auth.sso.enabled` (new
  `SsoProperties`, same `@ConfigurationProperties` pattern as
  `NotificationProperties`; `tenant-id`/`client-id`/`client-secret`
  default to `${DOCCONTROL_NOTIFICATION_TENANT_ID}` etc. in
  application.yml per F1 — no new secrets in `.env`, only
  `DOCCONTROL_SSO_ENABLED`).
- **The one thing that must not be gotten wrong**: this app's
  authorization model (`CurrentUserProvider`, every `hasRole()` check
  in `SecurityConfig`, ownership checks) hard-requires
  `Authentication.getPrincipal()` to be an actual `AppUserPrincipal` —
  `CurrentUserProvider.principal()` throws 401 for anything else.
  Spring Security's default OAuth2 login produces an `OidcUser`
  principal instead, which would NOT satisfy that check — a login that
  *looks* successful (session established, redirected in) would then
  401 on every subsequent API call, or silently fail role checks for a
  real admin. The fix is a known, standard pattern, not a new
  invention: a custom `OidcUserService.loadUser()` does the email
  lookup (`UserRepository.findByEmailIgnoreCase`, mirroring
  `AppUserDetailsService`) and rejects (throws
  `OAuth2AuthenticationException`) when there's no active match; on
  success, a custom `AuthenticationSuccessHandler` then *replaces* the
  SecurityContext's Authentication with a real
  `UsernamePasswordAuthenticationToken(AppUserPrincipal, null,
  authorities)` — built exactly the way `AppUserDetailsService` builds
  it — saved via the same `HttpSessionSecurityContextRepository`
  `AuthController.login()` already uses, before redirecting. From that
  point on an SSO session and a password session are indistinguishable
  to the rest of the app. A custom `AuthenticationFailureHandler`
  handles the reject case, redirecting to `/login?error=sso_no_account`.
- Frontend: one button + a divider + one error-message branch on
  LoginPage. `AuthContext`/`/auth/me` need zero changes beyond that —
  once the principal-bridging above is correct, a session cookie is a
  session cookie regardless of how it was established.
- Tests: a service-level test for the email match/reject branching
  against a real test database (same pattern as `PasswordResetTests`),
  PLUS a test that actually asserts the post-login principal is an
  `AppUserPrincipal` with the correct authorities — the failure mode
  above is exactly the kind of thing that "the redirect worked" alone
  would not catch. The actual browser round-trip through
  login.microsoftonline.com can't be unit-tested — real end-to-end
  verification against the live Azure tenant is required before this
  is considered done, same bar as the Graph sender's real-email
  verification: log in as a real matched account, confirm `/auth/me`
  and at least one role-gated action (e.g. an admin-only page if the
  test account is Admin) both work.

## Status

F1 is decided (reuse). F2–F5 proposed defaults stand — proceeding on
that basis; say so if any should change. Remaining before this is
live: the Azure Portal steps above (owner/tenant-admin action, outside
this codebase) and the implementation itself.
