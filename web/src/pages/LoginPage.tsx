import { FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Building2,
  ClipboardCheck,
  Eye,
  EyeOff,
  FileCheck2,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import overclockLogo from '../assets/overclock-logo-transparent.png';

const BRAND_POINTS = [
  {
    icon: FileCheck2,
    text: 'Version-controlled documents with a structured approval workflow — draft, review, release, re-approval.',
  },
  {
    icon: Building2,
    text: 'Department-scoped access, so controlled documents reach exactly the teams that need them.',
  },
  {
    icon: ShieldCheck,
    text: 'A complete audit trail of every change, approval, and download.',
  },
];

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [searchParams] = useSearchParams();
  const ssoError = searchParams.get('error');

  if (!loading && user) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex flex-1">
        <aside className="relative hidden flex-col overflow-hidden bg-primary p-12 text-primary-foreground lg:flex lg:w-[45%] lg:max-w-3xl">
          <div
            className="pointer-events-none absolute inset-0 bg-linear-to-br from-primary-foreground/10 via-transparent to-transparent"
            aria-hidden="true"
          />
          <ClipboardCheck
            className="pointer-events-none absolute -bottom-20 -right-20 size-80 opacity-10"
            aria-hidden="true"
          />
          <div className="relative w-48" style={{ aspectRatio: '2842 / 1913' }}>
            <img
              src={overclockLogo}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 h-full w-full brightness-0 invert"
              style={{ clipPath: 'inset(0 42.75% 0 0)' }}
            />
            <img
              src={overclockLogo}
              alt="Overclock"
              className="absolute inset-0 h-full w-full"
              style={{ clipPath: 'inset(0 0 0 57.25%)' }}
            />
          </div>
          <div className="flex flex-1 flex-col justify-center">
          <div className="relative max-w-md">
            <h1 className="text-3xl font-semibold leading-tight">
              Controlled documents, from draft to release.
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-primary-foreground/80">
              Document control for our ISO 9001 server manufacturing quality
              system — one place to author, review, approve, and find every
              controlled document.
            </p>
            <ul className="mt-8 flex flex-col gap-5">
              {BRAND_POINTS.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-start gap-3">
                  <Icon className="mt-0.5 size-5 shrink-0 opacity-90" aria-hidden="true" />
                  <span className="text-sm leading-relaxed text-primary-foreground/90">
                    {text}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          </div>
          <p className="relative text-xs text-primary-foreground/60">
            Internal quality system · ISO 9001 document control
          </p>
        </aside>
        <main className="flex flex-1 items-center justify-center p-6">
          <Card className="w-full max-w-sm rounded-2xl border-0 shadow-md">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <ClipboardCheck className="size-5" />
                </div>
                <CardTitle className="text-xl">Document Control</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
                {ssoError === 'sso_no_account' && (
                  <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    No account found for this email. Contact your administrator.
                  </div>
                )}
                {ssoError && ssoError !== 'sso_no_account' && (
                  <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    Microsoft sign-in failed. Please try again.
                  </div>
                )}
                {error && (
                  <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="login-email">Email</Label>
                  <Input
                    id="login-email"
                    type="email"
                    value={email}
                    autoComplete="username"
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="login-password">Password</Label>
                  <div className="relative">
                    <Input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      autoComplete="current-password"
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="pr-10"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-1 top-1/2 size-7 -translate-y-1/2 border-0 text-muted-foreground"
                    >
                      {showPassword ? (
                        <EyeOff className="size-4" aria-hidden="true" />
                      ) : (
                        <Eye className="size-4" aria-hidden="true" />
                      )}
                    </Button>
                  </div>
                </div>
                <Button type="submit" size="lg" disabled={submitting} className="mt-2">
                  {submitting ? 'Signing in…' : 'Sign in'}
                </Button>
              </form>
              <div className="mt-4 flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">or</span>
                <div className="h-px flex-1 bg-border" />
              </div>
              <Button asChild variant="outline" className="mt-4 w-full">
                <a href="/api/oauth2/authorization/microsoft">
                  <svg aria-hidden="true" viewBox="0 0 23 23" className="size-4">
                    <rect x="1" y="1" width="10" height="10" fill="#f25022" />
                    <rect x="12" y="1" width="10" height="10" fill="#7fba00" />
                    <rect x="1" y="12" width="10" height="10" fill="#00a4ef" />
                    <rect x="12" y="12" width="10" height="10" fill="#ffb900" />
                  </svg>
                  Sign in with Microsoft
                </a>
              </Button>
              <p className="mt-4 border-t pt-4 text-center text-sm">
                <Link className="text-primary hover:underline" to="/forgot-password">
                  Forgot password?
                </Link>
              </p>
            </CardContent>
          </Card>
        </main>
      </div>
      <footer className="px-6 py-4 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Overclock Pte. Ltd. All rights reserved.
      </footer>
    </div>
  );
}
