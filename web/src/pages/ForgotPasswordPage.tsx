import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { authApi } from '../api/resources';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';

/**
 * Self-service password recovery, step 1 (ForgotPassword_PlanBack.md).
 * The backend always returns 202 regardless of whether the email is
 * registered — this page must never show a different message for
 * "found" vs. "not found", or it would undermine that guarantee. The
 * only error path here is a genuine request failure (network/server
 * error), never "email not found".
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await authApi.forgotPassword(email.trim());
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex flex-1 items-center justify-center p-6">
        <Card className="w-full max-w-sm rounded-2xl border-0 shadow-md">
          <CardHeader>
            <CardTitle className="text-xl">Reset your password</CardTitle>
          </CardHeader>
          <CardContent>
            {submitted ? (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-foreground">
                  If an account exists for that email, we've sent a password reset link. Please check your inbox.
                </p>
                <Link className="text-sm text-primary hover:underline" to="/login">
                  ← Back to sign in
                </Link>
              </div>
            ) : (
              <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
                <p className="text-sm text-muted-foreground">
                  Enter your email and we'll send you a link to reset your password.
                </p>
                {error && (
                  <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="forgot-email">Email</Label>
                  <Input
                    id="forgot-email"
                    type="email"
                    value={email}
                    autoComplete="username"
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" disabled={submitting} className="mt-2">
                  {submitting ? 'Sending…' : 'Send reset link'}
                </Button>
                <Link className="text-center text-sm text-primary hover:underline" to="/login">
                  ← Back to sign in
                </Link>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
      <footer className="border-t border-border/40 px-6 py-4 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Overclock Pte. Ltd. All rights reserved.
      </footer>
    </div>
  );
}
