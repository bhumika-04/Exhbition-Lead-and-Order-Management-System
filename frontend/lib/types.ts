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
  status_code: string;
  created_at: string;
  updated_at: string;
  segment?: string;
  priority?: string;
  city?: string | null;
  state?: string | null;

  front_image_path?: string | null;
  back_image_path?: string | null;

  // Raw services JSON from list API (renamed to avoid conflict with LeadDetails.services array)
  services_json?: string | null;

  // Classification fields
  category?: string | null;
  turn_over?: string | null;
  team_size?: string | null;
  vertical?: string | null;

  // Joined fields
  exhibition_name?: string;
  assigned_employee_name?: string;
  source_name?: string;
  status_name?: string;
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
  services: { lead_service_id: number; service_text: string }[];
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
    services: string[];
    confidence: number;
  };
  segment?: string;
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

export interface VoiceExtractionResult {
  success: boolean;
  lead_id?: number | null;
  transcript?: string;
  summary?: string;
  topics?: string[];
  segment?: string;
  priority?: string;
  interest_level?: string;
  confidence?: number;
  requires_confirmation?: boolean;
  extracted_lead_name?: string | null;
  possible_leads?: Array<{ lead_id: number; name: string; company_name?: string; phone?: string }>;
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
  { key: 'scan_cards',          label: 'Scan Cards / Voice Notes' },
  { key: 'view_leads',          label: 'View Leads' },
  { key: 'view_dashboard',      label: 'View Dashboard' },
  { key: 'view_exhibitions',    label: 'View Exhibitions' },
  { key: 'manage_exhibitions',  label: 'Manage Exhibitions (Create / Edit / Delete)' },
  { key: 'view_report',         label: 'View Report' },
  { key: 'manage_orders',       label: 'Place & Confirm Orders' },
  { key: 'manage_users',        label: 'Manage Users' },
  { key: 'manage_roles',        label: 'Manage Roles' },
] as const;

// ── Orders ─────────────────────────────────────────────────────────────────

export const ORDER_ITEM_TYPES = ['Suit', 'Lehenga', 'Saree'] as const;
export type OrderItemType = (typeof ORDER_ITEM_TYPES)[number];

export interface OrderItem {
  order_item_id: number;
  line_no: number;
  item_type: string;
  barcode?: string | null;
  size?: string | null;
  colour?: string | null;
  pieces: number;
  rate: number;
  amount: number;           // rate × pieces, computed server-side
  customization?: string | null;
}

export interface OrderSummary {
  order_id: number;
  order_number: string;
  lead_id: number;
  status_code: 'draft' | 'confirmed' | 'cancelled';
  order_total: number;
  item_count: number;
  total_pieces: number;
  so_pdf_path?: string | null;
  confirmed_at?: string | null;
  created_at: string;
}

/**
 * Advance and coupons are derived from the lead's TOTAL across all
 * non-cancelled orders — never from a single order.
 *   band = floor(total / 100000), advance = 11000 × band, coupons = 4 × band
 * Below ₹1L: band 0, no coupons, advance is operator-entered.
 */
export interface LeadOrderSummary {
  lead_id: number;
  order_count: number;
  lead_total: number;
  band: number;
  advance: number;
  coupons: number;
  balance: number;
  is_manual_advance: boolean;
  manual_advance_amount?: number | null;
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
  notes?: string | null;
  so_pdf_path?: string | null;
  confirmed_at?: string | null;
  created_at: string;
  items: OrderItem[];
  lead_summary: LeadOrderSummary;
}

export interface CreateOrderItemRequest {
  item_type: string;
  barcode?: string | null;
  size?: string | null;
  colour?: string | null;
  pieces: number;
  rate: number;
  customization?: string | null;
}

export interface ConfirmOrderResult {
  success: boolean;
  order: OrderDetail;
  so_pdf: { path?: string | null; url?: string | null; error?: string | null };
  whatsapp: { sent: boolean; status: 'sent' | 'failed' | 'skipped'; error?: string | null };
}

export type PermissionKey = typeof ALL_PERMISSIONS[number]['key'];
