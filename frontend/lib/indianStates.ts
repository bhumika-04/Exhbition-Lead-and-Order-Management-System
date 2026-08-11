/**
 * Indian states and union territories.
 *
 * 28 states + 8 union territories, as constituted after the 2019 reorganisation
 * of Jammu & Kashmir and the 2020 merger of Daman & Diu with Dadra & Nagar
 * Haveli.
 */

export const INDIAN_STATES = [
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
] as const;

export const INDIAN_UNION_TERRITORIES = [
  'Andaman and Nicobar Islands',
  'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Jammu and Kashmir',
  'Ladakh',
  'Lakshadweep',
  'Puducherry',
] as const;

/**
 * What a card actually carries — abbreviations, old names, and the spellings
 * GPT returns when the card is smudged. Keys are lower-cased and stripped of
 * everything but letters, so "J&K", "j and k" and "J. & K." all collapse to the
 * same lookup.
 */
const ALIASES: Record<string, string> = {
  // Postal / vehicle abbreviations
  ap: 'Andhra Pradesh',      ar: 'Arunachal Pradesh',  as: 'Assam',
  br: 'Bihar',               cg: 'Chhattisgarh',       ct: 'Chhattisgarh',
  ga: 'Goa',                 gj: 'Gujarat',            hr: 'Haryana',
  hp: 'Himachal Pradesh',    jh: 'Jharkhand',          ka: 'Karnataka',
  kl: 'Kerala',              mp: 'Madhya Pradesh',     mh: 'Maharashtra',
  mn: 'Manipur',             ml: 'Meghalaya',          mz: 'Mizoram',
  nl: 'Nagaland',            od: 'Odisha',             or: 'Odisha',
  pb: 'Punjab',              rj: 'Rajasthan',          sk: 'Sikkim',
  tn: 'Tamil Nadu',          tg: 'Telangana',          ts: 'Telangana',
  tr: 'Tripura',             up: 'Uttar Pradesh',      uk: 'Uttarakhand',
  ua: 'Uttarakhand',         wb: 'West Bengal',
  an: 'Andaman and Nicobar Islands',
  ch: 'Chandigarh',          dl: 'Delhi',              nd: 'Delhi',
  jk: 'Jammu and Kashmir',   la: 'Ladakh',
  ld: 'Lakshadweep',         py: 'Puducherry',         pu: 'Puducherry',
  dd: 'Dadra and Nagar Haveli and Daman and Diu',
  dn: 'Dadra and Nagar Haveli and Daman and Diu',

  // Renamed, and still printed the old way on plenty of stationery
  orissa: 'Odisha',
  pondicherry: 'Puducherry',
  uttaranchal: 'Uttarakhand',
  uttaranchalstate: 'Uttarakhand',

  // Common spellings and expansions
  newdelhi: 'Delhi',
  delhincr: 'Delhi',
  nationalcapitalterritoryofdelhi: 'Delhi',
  maharastra: 'Maharashtra',
  maharashtrastate: 'Maharashtra',
  tamilnad: 'Tamil Nadu',
  jammukashmir: 'Jammu and Kashmir',
  jandk: 'Jammu and Kashmir',
  damananddiu: 'Dadra and Nagar Haveli and Daman and Diu',
  dadranagarhaveli: 'Dadra and Nagar Haveli and Daman and Diu',
  andaman: 'Andaman and Nicobar Islands',
  andamannicobar: 'Andaman and Nicobar Islands',
};

const key = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

const CANONICAL = new Map<string, string>();
for (const s of [...INDIAN_STATES, ...INDIAN_UNION_TERRITORIES]) CANONICAL.set(key(s), s);

/**
 * Best-effort canonical name for whatever was extracted from a card.
 *
 * Returns null when it cannot be matched, so the caller can decide — the Scan
 * form keeps the raw text as a selectable option rather than dropping it, since
 * a value the dropdown silently discards is worse than an odd-looking one.
 */
export function normaliseIndianState(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const k = key(raw);
  if (!k) return null;

  return CANONICAL.get(k) ?? ALIASES[k] ?? null;
}

/** True when the value is already one of the official names. */
export const isKnownIndianState = (v: string) => CANONICAL.has(key(v));
