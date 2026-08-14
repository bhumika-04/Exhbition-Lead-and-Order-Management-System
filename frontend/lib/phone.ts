// Phone number validation, shared by every phone field in the app.
// India is the default and the only format stored bare (10 digits, no
// country code) — every other country is stored as "+<dial><local>" so
// InteraktWhatsAppService (which already splits on these calling codes;
// see its CallingCodes1/2/3 tables) can route the WhatsApp send correctly.
// Keep this list of dial codes in step with that backend table.

export interface DialCountry { dial: string; label: string; flag: string }

export const DIAL_COUNTRIES: DialCountry[] = [
  { dial: '91',  label: 'India',          flag: '🇮🇳' },
  { dial: '1',   label: 'US / Canada',    flag: '🇺🇸' },
  { dial: '44',  label: 'UK',             flag: '🇬🇧' },
  { dial: '971', label: 'UAE',            flag: '🇦🇪' },
  { dial: '966', label: 'Saudi Arabia',   flag: '🇸🇦' },
  { dial: '974', label: 'Qatar',          flag: '🇶🇦' },
  { dial: '965', label: 'Kuwait',         flag: '🇰🇼' },
  { dial: '973', label: 'Bahrain',        flag: '🇧🇭' },
  { dial: '968', label: 'Oman',           flag: '🇴🇲' },
  { dial: '65',  label: 'Singapore',      flag: '🇸🇬' },
  { dial: '60',  label: 'Malaysia',       flag: '🇲🇾' },
  { dial: '61',  label: 'Australia',      flag: '🇦🇺' },
  { dial: '86',  label: 'China',          flag: '🇨🇳' },
  { dial: '81',  label: 'Japan',          flag: '🇯🇵' },
  { dial: '49',  label: 'Germany',        flag: '🇩🇪' },
  { dial: '33',  label: 'France',         flag: '🇫🇷' },
  { dial: '27',  label: 'South Africa',   flag: '🇿🇦' },
  { dial: '7',   label: 'Russia',         flag: '🇷🇺' },
];

export const DEFAULT_DIAL = '91';

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

/**
 * Country-aware version: India keeps the bare 10-digit format above; any
 * other dial code is validated as a plausible local number length and
 * returned as "+<dial><local>" — explicit, so it round-trips through
 * storage and back into the WhatsApp send without guessing.
 */
export function normalisePhoneForCountry(raw: string, dial: string): string | null {
  if (dial === DEFAULT_DIAL) return normaliseIndianPhone(raw);

  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith(dial)) digits = digits.slice(dial.length);

  if (digits.length < 4 || digits.length > 14) return null;
  return `+${dial}${digits}`;
}

/**
 * For values with no known country selected yet — an OCR'd card, or a
 * number folded in from a draft before the operator touched the country
 * picker. Tries India first (the common case, and the only bare format),
 * otherwise accepts anything explicitly international ("+" plus 8-15
 * digits) as-is, without requiring it to match a specific dial code.
 */
export function normaliseAnyPhone(raw: string): string | null {
  const india = normaliseIndianPhone(raw);
  if (india) return india;

  const hasPlus = raw.trim().startsWith('+');
  const digits = raw.replace(/\D/g, '');
  if (hasPlus && digits.length >= 8 && digits.length <= 15 && !digits.startsWith('91')) return '+' + digits;

  return null;
}
