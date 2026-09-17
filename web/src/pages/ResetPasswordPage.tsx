import { FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { authApi } from '../api/resources';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';

/**
 * Self-service password recovery, step 2 (ForgotPassword_PlanBack.md).
 * Reads the token from the emailed link's query string. The backend gives
 * one generic error for an invalid, expired, or already-used token —
 * this page shows that message as-is and offers a fresh link, rather than
 * guessing which case it was. A client-side password-mismatch error is
 * tracked separately (tokenInvalid stays false for it) since resubmitting
 * fixes that one — a "request a new link" hint would be actively wrong
 * advice there.
 */
export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [tokenInvalid, setTokenInvalid] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [succeeded, setSucceeded] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setTokenInvalid(false);

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (!token) {
      setError('This reset link is missing its token.');
      setTokenInvalid(true);
      return;
    }

    setSubmitting(true);
    try {
      await authApi.resetPassword(token, newPassword);
      setSucceeded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password reset failed.');
      setTokenInvalid(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm rounded-2xl border-0 shadow-md">
        <CardHeader>
          <CardTitle className="text-xl">Choose a new password</CardTitle>
        </CardHeader>
        <CardContent>
          {succeeded ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-foreground">Your password has been changed.</p>
              <Link className="text-sm text-primary hover:underline" to="/login">
                Continue to sign in →
              </Link>
            </div>
          ) : (
            <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
              {error && (
                <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                  {tokenInvalid && (
                    <>
                      {' '}
                      <Link className="underline" to="/forgot-password">
                        Request a new one
                      </Link>
                    </>
                  )}
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reset-new-password">New password</Label>
                <Input
                  id="reset-new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reset-confirm-password">Confirm new password</Label>
                <Input
                  id="reset-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={submitting} className="mt-2">
                {submitting ? 'Changing…' : 'Change password'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
