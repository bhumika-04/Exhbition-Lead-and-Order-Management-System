// Indian mobile number validation, shared by every phone field in the app.

export const PHONE_ERROR = 'Enter a 10-digit mobile number, with a country code (+91) if you like';

/**
 * Accepts a bare 10-digit mobile number, or one prefixed with the +91/91
 * country code. Anything else (too short, too long, a landline area code,
 * letters) is rejected. Returns the canonical bare 10-digit form to store —
 * the same form PhoneLast10 dedup and the WhatsApp link builder already
 * assume — or null if the input doesn't parse as a valid number.
 */
export function normaliseIndianPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');

  let ten = digits;
  if (digits.length === 12 && digits.startsWith('91')) ten = digits.slice(2);

  if (ten.length !== 10) return null;
  if (!/^[6-9]/.test(ten)) return null;

  return ten;
}
