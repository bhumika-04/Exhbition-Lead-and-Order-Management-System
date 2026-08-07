// API Client for ELCS Backend

import axios, { AxiosInstance, AxiosError } from 'axios';
import type {
  LoginRequest,
  LoginResponse,
  Employee,
  Lead,
  LeadDetails,
  Exhibition,
  AnalyticsSummary,
  CardExtractionResult,
  Role,
  UserDto,
  OrderSummary,
  OrderDetail,
  LeadOrderSummary,
  CreateOrderItemRequest,
  ConfirmOrderResult,
  SlabOption,
  OrderListItem,
  OrderListTotals,
  CouponHolder,
  Product,
  SaveProductRequest,
  LeadMedia,
  AppSettings,
  WhatsAppSendOutcome,
} from './types';

class ApiClient {
  private client: AxiosInstance;
  private token: string | null = null;

  constructor() {
    // Use NEXT_PUBLIC_API_BASE_URL when set (production/Vercel).
    // On local dev (no env var), auto-detect host so desktop + mobile LAN work without config.
    const envUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
    const backendBase = envUrl && envUrl !== 'http://localhost:5008'
      ? envUrl
      : typeof window !== 'undefined'
        ? `${window.location.protocol}//${window.location.hostname}:5008`
        : 'http://localhost:5008';

    this.client = axios.create({
      baseURL: backendBase,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor — add auth token + employee-id so the API can identify the caller
    this.client.interceptors.request.use((config) => {
      if (this.token) {
        config.headers.Authorization = `Bearer ${this.token}`;
        // Extract employee_id from token (format: emp_{id})
        const match = this.token.match(/^emp_(\d+)$/);
        if (match) {
          config.headers['X-Employee-Id'] = match[1];
        }
      }
      return config;
    });

    // Response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        if (error.response?.status === 401) {
          this.clearToken();
          if (typeof window !== 'undefined') {
            window.location.href = '/auth/login';
          }
        }
        return Promise.reject(error);
      }
    );

    // Load token from localStorage on init
    if (typeof window !== 'undefined') {
      this.token = localStorage.getItem('auth_token');
    }
  }

  setToken(token: string) {
    this.token = token;
    if (typeof window !== 'undefined') {
      localStorage.setItem('auth_token', token);
    }
  }

  clearToken() {
    this.token = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('employee');
    }
  }

  // Authentication
  async login(credentials: LoginRequest): Promise<LoginResponse> {
    const { data } = await this.client.post<LoginResponse>('/api/auth/login', {
      email:    credentials.email,
      password: credentials.password,
    });
    if (typeof window !== 'undefined' && data.success) {
      let permissionsArray: string[] | null = null;
      if (data.permissions !== undefined && data.permissions !== null) {
        try { permissionsArray = JSON.parse(data.permissions); } catch { permissionsArray = []; }
      }
      const emp = {
        employee_id:   data.employee_id,
        full_name:     data.full_name,
        email:         data.email,
        phone:         data.phone         ?? null,
        designation:   data.designation   ?? null,
        company_name:  data.company_name  ?? null,
        role_id:       data.role_id       ?? null,
        role_name:     data.role_name     ?? null,
        permissions:   permissionsArray,
      };
      localStorage.setItem('employee', JSON.stringify(emp));
      // Use employee_id as token so backend can identify the caller
      this.setToken(`emp_${data.employee_id}`);
    }
    return data;
  }

  logout() {
    this.clearToken();
  }

  // Profile
  async getProfile(employeeId: number): Promise<Employee> {
    const { data } = await this.client.get(`/api/auth/profile/${employeeId}`);
    return data;
  }

  async updateProfile(employeeId: number, profile: {
    full_name: string;
    phone?: string;
    designation?: string;
    company_name?: string;
  }): Promise<{ success: boolean; message: string }> {
    const { data } = await this.client.put(`/api/auth/profile/${employeeId}`, {
      full_name:    profile.full_name,
      phone:        profile.phone        ?? null,
      designation:  profile.designation  ?? null,
      company_name: profile.company_name ?? null,
    });
    return data;
  }

  // Exhibitions
  async getExhibitions(): Promise<Exhibition[]> {
    const { data } = await this.client.get('/api/exhibitions/');
    return data.exhibitions || [];
  }

  async createExhibition(exhibition: {
    name: string;
    location?: string;
    start_date: string;
    end_date: string;
    description?: string;
  }): Promise<{ success: boolean; exhibition_id: number }> {
    const { data } = await this.client.post('/api/exhibitions/', {
      name: exhibition.name,
      location: exhibition.location,
      start_date: new Date(exhibition.start_date).toISOString(),
      end_date: new Date(exhibition.end_date).toISOString(),
      description: exhibition.description
    });
    return data;
  }

  async updateExhibition(exhibitionId: number, exhibition: {
    name?: string;
    location?: string;
    start_date?: string;
    end_date?: string;
    description?: string;
  }): Promise<{ success: boolean; message: string }> {
    const { data } = await this.client.put(`/api/exhibitions/${exhibitionId}`, {
      name: exhibition.name,
      location: exhibition.location,
      start_date: exhibition.start_date,
      end_date: exhibition.end_date,
      description: exhibition.description
    });
    return data;
  }

  async deleteExhibition(exhibitionId: number): Promise<{ success: boolean; message: string }> {
    const { data } = await this.client.delete(`/api/exhibitions/${exhibitionId}`);
    return data;
  }

  // Leads
  async getLeads(params?: {
    exhibition_id?: number;
    source_code?: string;
    status_code?: string;
    assigned_employee_id?: number;
    service?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ leads: Lead[]; count: number }> {
    const { data } = await this.client.get('/api/leads', { params });
    return data;
  }

  async getLead(leadId: number): Promise<LeadDetails> {
    const { data } = await this.client.get(`/api/leads/${leadId}`);
    return {
      ...data.lead,
      persons: data.persons || [],
      addresses: data.addresses || [],
      websites: data.websites || [],
      services: data.services || [],
      topics: data.topics || [],
      messages: data.messages || [],
      brands: data.brands || [],
      phones: data.phones || [],
      emails: data.emails || [],
    };
  }

  async createLead(leadData: Partial<Lead>): Promise<{ lead_id: number }> {
    const { data } = await this.client.post('/api/leads', {
      exhibition_id: leadData.exhibition_id,
      source_code: leadData.source_code || 'manual_entry',
      assigned_employee_id: leadData.assigned_employee_id,
      company_name: leadData.company_name,
      primary_visitor_name: leadData.primary_visitor_name,
      primary_visitor_phone: leadData.primary_visitor_phone,
      primary_visitor_designation: leadData.primary_visitor_designation,
      primary_visitor_email: leadData.primary_visitor_email,
      discussion_summary: leadData.discussion_summary,
      segment: leadData.segment,
      priority: leadData.priority,
    });
    return data;
  }

  async updateLead(leadId: number, updates: Partial<Lead>): Promise<void> {
    await this.client.put(`/api/leads/${leadId}`, updates);
  }

  async deleteLead(leadId: number): Promise<void> {
    await this.client.delete(`/api/leads/${leadId}`);
  }

  // Card Extraction (immediate — creates lead)
  async extractCard(
    frontImage: File,
    backImage: File | null,
    exhibitionId: number,
    employeeId: number
  ): Promise<CardExtractionResult> {
    const formData = new FormData();
    formData.append('frontImage', frontImage);
    if (backImage) formData.append('backImage', backImage);
    formData.append('exhibitionId', exhibitionId.toString());
    formData.append('employeeId', employeeId.toString());
    const { data } = await this.client.post<CardExtractionResult>(
      '/api/extraction/card',
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 }
    );
    return data;
  }

  // Card Extraction Preview (does NOT create lead — returns data for confirmation)
  async extractCardPreview(
    frontImage: File,
    backImage: File | null,
    exhibitionId: number
  ): Promise<CardExtractionResult> {
    const formData = new FormData();
    formData.append('frontImage', frontImage);
    if (backImage) formData.append('backImage', backImage);
    formData.append('exhibitionId', exhibitionId.toString());
    const { data } = await this.client.post<CardExtractionResult>(
      '/api/extraction/card/preview',
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 }
    );
    return data;
  }

  // Confirm and save lead after preview
  async confirmAndSaveLead(
    extraction: any,
    exhibitionId: number,
    employeeId: number,
    tempId?: string
  ): Promise<CardExtractionResult> {
    const { data } = await this.client.post<CardExtractionResult>(
      '/api/extraction/card/confirm',
      {
        extraction,
        exhibition_id: exhibitionId,
        employee_id: employeeId,
        temp_id: tempId,
      },
      { timeout: 30000 }
    );
    return data;
  }

  // Analytics
  async getAnalyticsSummary(exhibitionId?: number): Promise<AnalyticsSummary> {
    const { data } = await this.client.get('/api/analytics/summary', {
      params: exhibitionId ? { exhibition_id: exhibitionId } : undefined,
    });
    return data;
  }

  async getEmployeePerformance(exhibitionId?: number) {
    const { data } = await this.client.get('/api/analytics/employee-performance', {
      params: exhibitionId ? { exhibition_id: exhibitionId } : undefined,
    });
    return data.data || [];
  }

  // Orders
  async getOrdersForLead(leadId: number): Promise<{ orders: OrderSummary[]; summary: LeadOrderSummary }> {
    const { data } = await this.client.get(`/api/orders/lead/${leadId}`);
    return { orders: data.orders || [], summary: data.summary };
  }

  async getLeadOrderSummary(leadId: number): Promise<LeadOrderSummary> {
    const { data } = await this.client.get(`/api/orders/lead/${leadId}/summary`);
    return data;
  }

  async getOrder(orderId: number): Promise<OrderDetail> {
    const { data } = await this.client.get(`/api/orders/${orderId}`);
    return data;
  }

  async createOrder(req: {
    lead_id: number;
    items: CreateOrderItemRequest[];
    notes?: string | null;
  }): Promise<{ success: boolean; order_id: number; order: OrderDetail }> {
    const { data } = await this.client.post('/api/orders', req);
    return data;
  }

  async updateOrder(orderId: number, req: {
    items: CreateOrderItemRequest[];
    notes?: string | null;
    status_code?: string | null;
  }): Promise<{ success: boolean; order: OrderDetail }> {
    const { data } = await this.client.put(`/api/orders/${orderId}`, req);
    return data;
  }

  async deleteOrder(orderId: number): Promise<{ success: boolean }> {
    const { data } = await this.client.delete(`/api/orders/${orderId}`);
    return data;
  }

  /** Confirms the order, renders the SO PDF and sends the WhatsApp confirmation. */
  async confirmOrder(orderId: number): Promise<ConfirmOrderResult> {
    const { data } = await this.client.post(`/api/orders/${orderId}/confirm`);
    return data;
  }

  /**
   * Enables/disables self-service ordering for an exhibition and mints its
   * public QR token. Pass rotate to invalidate an already-printed QR.
   */
  async setSelfService(exhibitionId: number, enabled: boolean, rotateToken = false): Promise<{
    success: boolean; self_service_enabled: boolean; public_token: string | null;
  }> {
    const { data } = await this.client.post(`/api/exhibitions/${exhibitionId}/self-service`, {
      enabled, rotate_token: rotateToken,
    });
    return data;
  }

  /** Slab options for the payment step — each suggests ₹11,000 × slab. */
  async getOrderSlabs(count = 6): Promise<SlabOption[]> {
    const { data } = await this.client.get('/api/orders/slabs', { params: { count } });
    return data.slabs || [];
  }

  /** Records the slab, order value and the advance actually taken. */
  async setOrderPayment(orderId: number, req: {
    slab_band: number;
    order_value?: number | null;
    advance_amount: number;
  }): Promise<{ success: boolean; order: OrderDetail }> {
    const { data } = await this.client.put(`/api/orders/${orderId}/payment`, req);
    return data;
  }

  /** Orders page — filters, barcode search, and totals across the whole filter. */
  async searchOrders(params?: {
    exhibition_id?: number;
    status_code?: string;
    search?: string;
    source?: string;
    from_date?: string;
    to_date?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ orders: OrderListItem[]; count: number; totals: OrderListTotals }> {
    const { data } = await this.client.get('/api/orders', { params });
    return { orders: data.orders || [], count: data.count ?? 0, totals: data.totals };
  }

  /** Leads ranked by lucky-draw coupons. */
  async getCouponHolders(exhibitionId?: number): Promise<CouponHolder[]> {
    const { data } = await this.client.get('/api/orders/coupons', {
      params: exhibitionId ? { exhibition_id: exhibitionId } : undefined,
    });
    return data.holders || [];
  }

  // Lead media — team photos + testimonial
  async getLeadMedia(leadId: number): Promise<LeadMedia> {
    const { data } = await this.client.get(`/api/leads/${leadId}/media`);
    return data;
  }

  async uploadLeadPhoto(leadId: number, file: File, caption?: string): Promise<{ success: boolean; lead_photo_id: number; file_path: string }> {
    const form = new FormData();
    form.append('photo', file);
    if (caption) form.append('caption', caption);
    const { data } = await this.client.post(`/api/leads/${leadId}/photos`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data;
  }

  async addLeadPhotoLink(leadId: number, url: string, caption?: string): Promise<{ success: boolean; lead_photo_id: number }> {
    const { data } = await this.client.post(`/api/leads/${leadId}/photos/link`, { url, caption: caption ?? null });
    return data;
  }

  async deleteLeadPhoto(leadPhotoId: number): Promise<{ success: boolean }> {
    const { data } = await this.client.delete(`/api/leads/photos/${leadPhotoId}`);
    return data;
  }

  async setTestimonial(leadId: number, url: string | null): Promise<{ success: boolean }> {
    const { data } = await this.client.put(`/api/leads/${leadId}/testimonial`, { url });
    return data;
  }

  async sendWelcomeWhatsApp(leadId: number): Promise<WhatsAppSendOutcome> {
    const { data } = await this.client.post(`/api/leads/${leadId}/whatsapp/welcome`);
    return data;
  }

  async sendTestimonialWhatsApp(leadId: number): Promise<WhatsAppSendOutcome> {
    const { data } = await this.client.post(`/api/leads/${leadId}/whatsapp/testimonial`);
    return data;
  }

  // Settings
  async getSettings(): Promise<AppSettings> {
    const { data } = await this.client.get('/api/settings');
    return data.settings || {};
  }

  async saveSettings(values: AppSettings): Promise<AppSettings> {
    const { data } = await this.client.put('/api/settings', values);
    return data.settings || {};
  }

  // Products
  async searchProducts(params?: {
    search?: string;
    product_type?: string;
    category?: string;
    include_inactive?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ products: Product[]; count: number }> {
    const { data } = await this.client.get('/api/products', { params });
    return { products: data.products || [], count: data.count ?? 0 };
  }

  /** Barcode lookup — the counter's fast path when scanning. */
  /** Distinct sizes and colours in the catalogue, for the order form's pickers. */
  async getProductOptions(): Promise<{ sizes: string[]; colours: string[] }> {
    const { data } = await this.client.get('/api/products/options');
    return { sizes: data.sizes || [], colours: data.colours || [] };
  }

  async getProductByBarcode(barcode: string): Promise<Product> {
    const { data } = await this.client.get(`/api/products/barcode/${encodeURIComponent(barcode)}`);
    return data;
  }

  async createProduct(req: SaveProductRequest): Promise<{ success: boolean; product_id: number; product: Product }> {
    const { data } = await this.client.post('/api/products', req);
    return data;
  }

  async updateProduct(productId: number, req: SaveProductRequest): Promise<{ success: boolean; product: Product }> {
    const { data } = await this.client.put(`/api/products/${productId}`, req);
    return data;
  }

  /** Soft delete — order history references products and must survive. */
  async deactivateProduct(productId: number): Promise<{ success: boolean }> {
    const { data } = await this.client.delete(`/api/products/${productId}`);
    return data;
  }

  async uploadProductImage(productId: number, file: File): Promise<{ success: boolean; image_path: string }> {
    const form = new FormData();
    form.append('image', file);
    const { data } = await this.client.post(`/api/products/${productId}/image`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data;
  }

  /**
   * Absolute URL for a file under the backend's /uploads root.
   *
   * Legacy rows hold a full Windows path from whichever machine wrote them
   * (`C:\Projects\...\uploads\cards\42\front.jpg`), so take everything after the
   * last `uploads/` rather than assuming the value is already relative.
   */
  uploadUrl(path: string): string {
    const normalised = path.replace(/\\/g, '/');
    const relative = normalised.includes('uploads/')
      ? normalised.split('uploads/').pop()!
      : normalised;
    return `${this.client.defaults.baseURL}/uploads/${relative.replace(/^\/+/, '')}`;
  }

  // Health Check
  async healthCheck(): Promise<{ status: string; database: string }> {
    const { data } = await this.client.get('/health');
    return data;
  }

  // Roles
  async getRoles(): Promise<Role[]> {
    const { data } = await this.client.get('/api/roles');
    return data.roles || [];
  }

  async createRole(role: { role_name: string; description?: string; permissions: string[] }): Promise<{ success: boolean; role_id: number }> {
    const { data } = await this.client.post('/api/roles', {
      role_name: role.role_name,
      description: role.description,
      permissions: role.permissions,
    });
    return data;
  }

  async updateRole(roleId: number, role: { role_name: string; description?: string; permissions: string[] }): Promise<{ success: boolean }> {
    const { data } = await this.client.put(`/api/roles/${roleId}`, {
      role_name: role.role_name,
      description: role.description,
      permissions: role.permissions,
    });
    return data;
  }

  async deleteRole(roleId: number): Promise<{ success: boolean }> {
    const { data } = await this.client.delete(`/api/roles/${roleId}`);
    return data;
  }

  // Users
  async getUsers(): Promise<UserDto[]> {
    const { data } = await this.client.get('/api/users');
    return data.users || [];
  }

  async createUser(user: {
    full_name: string;
    email: string;
    password: string;
    phone?: string;
    designation?: string;
    company_name?: string;
    role_id?: number | null;
  }): Promise<{ success: boolean; employee_id: number }> {
    const { data } = await this.client.post('/api/users', {
      full_name: user.full_name,
      email: user.email,
      password: user.password,
      phone: user.phone,
      designation: user.designation,
      company_name: user.company_name,
      role_id: user.role_id,
    });
    return data;
  }

  async updateUser(employeeId: number, user: {
    full_name: string;
    email: string;
    phone?: string;
    designation?: string;
    company_name?: string;
    role_id?: number | null;
    password?: string;
  }): Promise<{ success: boolean }> {
    const { data } = await this.client.put(`/api/users/${employeeId}`, {
      full_name: user.full_name,
      email: user.email,
      phone: user.phone,
      designation: user.designation,
      company_name: user.company_name,
      role_id: user.role_id,
      password: user.password || null,
    });
    return data;
  }

  async deleteUser(employeeId: number): Promise<{ success: boolean }> {
    const { data } = await this.client.delete(`/api/users/${employeeId}`);
    return data;
  }

  async resetUserPassword(employeeId: number, newPassword: string): Promise<{ success: boolean }> {
    const { data } = await this.client.post(`/api/users/${employeeId}/reset-password`, { new_password: newPassword });
    return data;
  }

}

// Export singleton instance
export const api = new ApiClient();
