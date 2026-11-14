// The same rules as the Email and Password schemas in @triagecam/contracts, worded for a form.

export function emailError(email: string): string | null {
  const value = email.trim();
  if (value === '') return 'Enter your work email address';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 254) {
    return 'Enter an address like name@clinic.org';
  }
  return null;
}

export function newPasswordError(password: string): string | null {
  if (password.length < 8) return 'Use 8 characters or more';
  if (new TextEncoder().encode(password).length > 72) return 'Use 72 characters or fewer';
  return null;
}
