// Type definitions for ELCS Frontend

export interface Employee {
  employee_id: number;
  full_name: string;
  phone?: string;
  email: string;
  designation?: string;
  company_name?: string;
  login_name?: string;
}

export interface Exhibition {
  exhibition_id: number;
  name: string;
  location: string;
  start_date: string;
  end_date: string;
  description?: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;

  // Self-service ordering: opaque token behind the printed QR
  public_token?: string | null;
  self_service_enabled?: boolean;
}

export interface Lead {
  lead_id: number;
  exhibition_id: number;
  source_code: string;
  assigned_employee_id?: number;
  company_name?: string;
  primary_visitor_name?: string;
  primary_visitor_designation?: string;
  primary_visitor_phone?: string;
  primary_visitor_email?: string;
  discussion_summary?: string;
  /** Optional GST registration number, captured on the Scan form. */
  gst_number?: string | null;
  status_code: string;
  created_at: string;
  updated_at: string;
  priority?: string;
  city?: string | null;
  state?: string | null;

  front_image_path?: string | null;
  back_image_path?: string | null;

  /** Admin override that REPLACES the earned-from-advance coupon count. Null = no override. */
  coupon_override_slab?: number | null;
  /** Raw JSON array of physical coupon numbers, e.g. '["A-102","A-103"]'. Parse before use. */
  coupon_numbers?: string | null;
  /** This lead's personal ordering QR token, once generated. Null until then. */
  public_token?: string | null;

  // Joined fields
  exhibition_name?: string;
  assigned_employee_name?: string;
  source_name?: string;
  status_name?: string;

  /** Combined value of this lead's non-cancelled orders. 0 when it has none. */
  order_value?: number;
  /** Most recently created order's status — null when the lead has no orders yet. */
  order_status?: string | null;
}

/**
 * What POST /api/leads accepts. Separate from `Lead` because a lead is created
 * with flat lists and one address, while a saved lead reads those back as
 * parsed objects — the two shapes are genuinely different, and sharing one type
 * was how `phones`, `websites` and the address came to be dropped on create.
 */
export interface CreateLeadPayload {
  exhibition_id: number;
  source_code?: string;
  assigned_employee_id?: number;
  company_name?: string;
  primary_visitor_name?: string;
  primary_visitor_phone?: string;
  primary_visitor_email?: string;
  primary_visitor_designation?: string;
  discussion_summary?: string;
  priority?: string;
  gst_number?: string;
  phones?: string[];
  emails?: string[];
  websites?: string[];
  address?: string;
  city?: string;
  state?: string;
}

export interface LeadPerson {
  lead_person_id: number;
  lead_id: number;
  name: string;
  designation?: string;
  phone?: string;
  email?: string;
  is_primary: boolean;
}

export interface LeadAddress {
  lead_address_id: number;
  lead_id: number;
  address_type?: string;
  address_text: string;
  city?: string;
  state?: string;
  country?: string;
  pin_code?: string;
}

export interface LeadMessage {
  message_id: number;
  lead_id: number;
  sender_type: 'employee' | 'visitor' | 'system';
  sender_employee_id?: number;
  message_text: string;
  created_at: string;
  sender_employee_name?: string;
}

export interface LeadBrand {
  lead_brand_id: number;
  lead_id: number;
  brand_name: string;
  relationship?: string;
}

export interface LeadPhone {
  lead_phone_id: number;
  lead_id: number;
  phone_number: string;
  phone_type?: string;
  is_primary?: boolean;
}

export interface LeadEmail {
  lead_email_id: number;
  lead_id: number;
  email_address: string;
  is_primary?: boolean;
}

export interface LeadDetails extends Lead {
  persons: LeadPerson[];
  addresses: LeadAddress[];
  websites: { lead_website_id: number; website_url: string }[];
  topics: { lead_topic_id: number; topic_text: string }[];
  messages: LeadMessage[];
  brands?: LeadBrand[];
  phones?: LeadPhone[];
  emails?: LeadEmail[];
}

export interface CardExtractionResult {
  success: boolean;
  lead_id?: number;
  extraction?: {
    company_name?: string;
    persons: Array<{
      name: string;
      designation?: string;
      phones: string[];
      email?: string;
    }>;
    phones: string[];
    emails: string[];
    websites: string[];
    addresses: Array<{
      address_type?: string;
      address: string;
      city?: string;
      state?: string;
    }>;
    confidence: number;
  };
  priority?: string;
  duplicate_check?: {
    is_duplicate: boolean;
    duplicate_count: number;
    duplicates: Array<{
      lead_id: number;
      company_name?: string;
      visitor_name?: string;
      phone?: string;
      email?: string;
      similarity_score: number;
      created_at?: string;
    }>;
  };
  message?: string;
  task_id?: string;
  temp_id?: string;
  error?: string;
}

export interface AnalyticsSummary {
  total_leads: number;
  confirmed_count: number;
  pending_count: number;
  total_exhibitions: number;
  conversion_rate: number;
  lead_sources?: Record<string, number>;
  leads_by_source?: Array<{ source: string; count: number }>;
  leads_today?: number;
  leads_this_week?: number;
  leads_this_month?: number;
  needs_correction?: number;
  new_leads?: number;
  daily_leads?: Array<{ date: string; count: number }>;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  success: boolean;
  employee_id: number;
  full_name: string;
  email: string;
  phone?: string;
  designation?: string;
  company_name?: string;
  role_id?: number | null;
  role_name?: string | null;
  permissions?: string | null;  // JSON array string, null = no role = full access
}

export interface ApiError {
  detail: string;
}

export interface Role {
  role_id: number;
  role_name: string;
  description?: string;
  permissions: string;   // JSON array string e.g. '["view_leads","scan_cards"]'
  created_at?: string;
}

export interface UserDto {
  employee_id: number;
  full_name: string;
  email: string;
  phone?: string;
  designation?: string;
  company_name?: string;
  role_id?: number | null;
  role_name?: string | null;
  is_active: boolean;
  created_at?: string;
}

export const ALL_PERMISSIONS = [
  { key: 'scan_cards',          label: 'Capture Leads' },
  { key: 'view_leads',          label: 'View Leads' },
  { key: 'view_dashboard',      label: 'View Dashboard' },
  { key: 'view_exhibitions',    label: 'View Exhibitions' },
  { key: 'manage_exhibitions',  label: 'Manage Exhibitions (Create / Edit / Delete)' },
  { key: 'view_report',         label: 'View Report' },
  { key: 'manage_orders',       label: 'Place & Confirm Orders' },
  { key: 'manage_products',     label: 'Manage Product Master' },
  { key: 'manage_users',        label: 'Manage Users' },
  { key: 'manage_roles',        label: 'Manage Roles' },
  { key: 'manage_settings',     label: 'Manage Settings (WhatsApp / Social)' },
] as const;

// ── Product Master ─────────────────────────────────────────────────────────

/**
 * A design is identified by its barcode and described by fabric, colour and
 * size. There is no type and no category: the supplier's catalogue sheet
 * carries neither, and the shape rules that tied them together rejected rows
 * the real sheet contains (every row has a size, including "FREE SIZE").
 */
export interface Product {
  product_id: number;
  barcode: string;
  size?: string | null;
  colour?: string | null;
  fabric?: string | null;
  price: number;
  name?: string | null;
  image_path?: string | null;   // local file under uploads/, used by the SO PDF
  image_url?: string | null;    // external link from the import sheet
  // A bracketed list in the sheet ships whole rather than offering a choice,
  // so these set the minimum pieces per combination on the order form.
  colour_is_set: boolean;
  size_is_set: boolean;
  is_active: boolean;
  created_at: string;
}

export interface SaveProductRequest {
  barcode: string;
  size?: string | null;
  colour?: string | null;
  fabric?: string | null;
  price: number;
  name?: string | null;
  image_url?: string | null;
  colour_is_set?: boolean;
  size_is_set?: boolean;
}

// ── Orders ─────────────────────────────────────────────────────────────────

export interface OrderItem {
  order_item_id: number;
  line_number: number;
  barcode?: string | null;
  size?: string | null;
  colour?: string | null;
  fabric?: string | null;     // snapshot
  pieces: number;
  rate?: number | null;       // optional — value can come from the slab instead
  amount?: number | null;     // rate × pieces, computed server-side
  customization?: string | null;
  product_id?: number | null; // pointer only; the snapshot above is authoritative
  product_image_path?: string | null;   // local file under uploads/
  product_image_url?: string | null;    // external link from the import sheet
}

export interface OrderSummary {
  order_id: number;
  order_number: string;
  lead_id: number;
  status_code: 'draft' | 'confirmed' | 'cancelled';
  order_total: number;
  order_value?: number | null;
  effective_value: number;
  slab_band: number;
  advance_amount: number;
  item_count: number;
  total_pieces: number;
  so_pdf_path?: string | null;
  confirmed_at?: string | null;
  created_at: string;
}

/**
 * Lead-level money position across all non-cancelled orders.
 *
 * Coupons follow the advance ACTUALLY TAKEN, not the order value:
 *   coupons = 4 × floor(total_advance / 11000)
 * A ₹2.5L order with only ₹11k advance earns 4 coupons, not 8.
 * The slab only suggests an advance (₹11,000 × slab); the operator may edit it.
 */
export interface LeadOrderSummary {
  lead_id: number;
  order_count: number;
  lead_total: number;
  total_advance: number;
  slab: number;
  coupons: number;
  balance: number;
  is_overpaid: boolean;
}

export interface OrderDetail {
  order_id: number;
  order_number: string;
  lead_id: number;
  lead_name?: string | null;
  lead_company_name?: string | null;
  lead_phone?: string | null;
  exhibition_id?: number | null;
  exhibition_name?: string | null;
  status_code: 'draft' | 'confirmed' | 'cancelled';
  order_total: number;
  order_value?: number | null;
  effective_value: number;
  slab_band: number;
  advance_amount: number;
  suggested_advance: number;
  order_coupons: number;
  notes?: string | null;
  so_pdf_path?: string | null;
  payment_proof_path?: string | null;
  confirmed_at?: string | null;
  created_at: string;
  items: OrderItem[];
  lead_summary: LeadOrderSummary;
}

export interface CreateOrderItemRequest {
  barcode?: string | null;
  size?: string | null;
  colour?: string | null;
  pieces: number;
  rate?: number | null;
  customization?: string | null;
  /** When set, the server re-reads the product and snapshots it onto the line. */
  product_id?: number | null;
}

export interface SlabOption {
  slab: number;
  from_value: number;
  to_value: number;
  suggested_advance: number;
  coupons_if_paid: number;
}

export type OrderSource = 'staff' | 'self_service';

export interface OrderListItem {
  order_id: number;
  order_number: string;
  lead_id: number;
  lead_name?: string | null;
  lead_company_name?: string | null;
  lead_phone?: string | null;
  exhibition_name?: string | null;
  status_code: 'draft' | 'confirmed' | 'cancelled';
  source: OrderSource;
  effective_value: number;
  advance_amount: number;
  item_count: number;
  total_pieces: number;
  so_pdf_path?: string | null;
  created_at: string;
}

export interface OrderListTotals {
  order_count: number;
  total_value: number;
  total_advance: number;
  total_coupons: number;
  /** Customer-placed orders still waiting on a team member. */
  pending_self_service: number;
}

// ── Lead media ─────────────────────────────────────────────────────────────

export interface LeadPhoto {
  lead_photo_id: number;
  lead_id: number;
  source_type: 'file' | 'link';
  file_path?: string | null;
  external_url?: string | null;
  caption?: string | null;
  created_at: string;
}

export interface LeadMedia {
  lead_id: number;
  front_image_path?: string | null;
  back_image_path?: string | null;
  testimonial_url?: string | null;
  testimonial_added_at?: string | null;
  photos: LeadPhoto[];
}

// ── Settings ───────────────────────────────────────────────────────────────

export const SETTING_KEYS = {
  socialInstagram: 'social.instagram',
  socialFacebook: 'social.facebook',
  socialWebsite: 'social.website',
  socialYoutube: 'social.youtube',
} as const;

export type AppSettings = Record<string, string | null>;

export interface WhatsAppSendOutcome {
  sent: boolean;
  status: 'sent' | 'failed' | 'skipped';
  error?: string | null;
}

export interface CouponHolder {
  lead_id: number;
  lead_name?: string | null;
  company_name?: string | null;
  phone?: string | null;
  total_value: number;
  total_advance: number;
  coupons: number;
  order_count: number;
}

export interface ConfirmOrderResult {
  success: boolean;
  order: OrderDetail;
  so_pdf: { path?: string | null; url?: string | null; error?: string | null };
  whatsapp: { sent: boolean; status: 'sent' | 'failed' | 'skipped'; error?: string | null };
}

export type PermissionKey = typeof ALL_PERMISSIONS[number]['key'];
