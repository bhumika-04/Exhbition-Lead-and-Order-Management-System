import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * The customer-facing origin to bake into QR codes and copied links.
 *
 * Prefers NEXT_PUBLIC_SITE_URL — set in Vercel to the real production domain
 * — over window.location.origin. Without it, a QR generated while browsing a
 * preview deployment, a LAN IP used for phone testing, or plain localhost
 * bakes that origin into the code, and a printed or downloaded QR does not
 * update itself once the mistake is noticed; every scan just fails.
 */
export function siteOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/+$/, '');
  return typeof window !== 'undefined' ? window.location.origin : '';
}
