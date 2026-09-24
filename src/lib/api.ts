'use client'

const API_BASE = '/api'

class ApiClient {
  private token: string | null = null

  setToken(token: string | null) {
    this.token = token
  }

  private async request(path: string, options: RequestInit = {}) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    }
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`
    }
    const res = await fetch(`${API_BASE}${path}`, { ...options, headers })
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Error de conexión' }))
      throw new Error(error.error || `Error ${res.status}`)
    }
    return res.json()
  }

  // Auth
  async register(data: { name: string; email: string; password: string; company?: string; phone?: string }) {
    return this.request('/auth/register', { method: 'POST', body: JSON.stringify(data) })
  }

  async login(data: { email: string; password: string }) {
    return this.request('/auth/login', { method: 'POST', body: JSON.stringify(data) })
  }

  async getMe() {
    return this.request('/auth/me')
  }

  async demoLogin() {
    return this.request('/auth/demo', { method: 'POST' })
  }

  // Clients
  async getClients(params?: Record<string, string>) {
    const query = params ? '?' + new URLSearchParams(params).toString() : ''
    return this.request(`/clients${query}`)
  }

  async getClient(id: string) {
    return this.request(`/clients/${id}`)
  }

  async createClient(data: Record<string, unknown>) {
    return this.request('/clients', { method: 'POST', body: JSON.stringify(data) })
  }

  async updateClient(id: string, data: Record<string, unknown>) {
    return this.request(`/clients/${id}`, { method: 'PUT', body: JSON.stringify(data) })
  }

  async deleteClient(id: string) {
    return this.request(`/clients/${id}`, { method: 'DELETE' })
  }

  async getClientPreferences(id: string) {
    return this.request(`/clients/${id}/preferences`)
  }

  async updateClientPreferences(id: string, data: Record<string, unknown>) {
    return this.request(`/clients/${id}/preferences`, { method: 'PUT', body: JSON.stringify(data) })
  }

  async getClientHistory(id: string) {
    return this.request(`/clients/${id}/history`)
  }

  async addClientHistory(id: string, data: Record<string, unknown>) {
    return this.request(`/clients/${id}/history`, { method: 'POST', body: JSON.stringify(data) })
  }

  // Opportunities
  async getOpportunities(params?: Record<string, string>) {
    const query = params ? '?' + new URLSearchParams(params).toString() : ''
    return this.request(`/opportunities${query}`)
  }

  async getOpportunity(id: string) {
    return this.request(`/opportunities/${id}`)
  }

  async createOpportunity(data: Record<string, unknown>) {
    return this.request('/opportunities', { method: 'POST', body: JSON.stringify(data) })
  }

  async updateOpportunity(id: string, data: Record<string, unknown>) {
    return this.request(`/opportunities/${id}`, { method: 'PUT', body: JSON.stringify(data) })
  }

  // Pipeline
  async getPipeline() {
    return this.request('/pipeline')
  }

  // Reservations
  async getReservations(params?: Record<string, string>) {
    const query = params ? '?' + new URLSearchParams(params).toString() : ''
    return this.request(`/reservations${query}`)
  }

  async createReservation(data: Record<string, unknown>) {
    return this.request('/reservations', { method: 'POST', body: JSON.stringify(data) })
  }

  async updateReservation(id: string, data: Record<string, unknown>) {
    return this.request(`/reservations/${id}`, { method: 'PUT', body: JSON.stringify(data) })
  }

  async cancelReservation(id: string) {
    return this.request(`/reservations/${id}`, { method: 'DELETE' })
  }

  // Quotes
  async getQuotes(params?: Record<string, string>) {
    const query = params ? '?' + new URLSearchParams(params).toString() : ''
    return this.request(`/quotes${query}`)
  }

  async getQuote(id: string) {
    return this.request(`/quotes/${id}`)
  }

  async createQuote(data: Record<string, unknown>) {
    return this.request('/quotes', { method: 'POST', body: JSON.stringify(data) })
  }

  async updateQuoteStatus(id: string, data: { status: string }) {
    return this.request(`/quotes/${id}`, { method: 'PUT', body: JSON.stringify(data) })
  }

  // Automations
  async getAutomations() {
    return this.request('/automations')
  }

  async createAutomation(data: Record<string, unknown>) {
    return this.request('/automations', { method: 'POST', body: JSON.stringify(data) })
  }

  async updateAutomation(id: string, data: Record<string, unknown>) {
    return this.request(`/automations/${id}`, { method: 'PUT', body: JSON.stringify(data) })
  }

  async deleteAutomation(id: string) {
    return this.request(`/automations/${id}`, { method: 'DELETE' })
  }

  async runAutomations() {
    return this.request('/automations/run', { method: 'POST' })
  }

  // Dashboard
  async getDashboard() {
    return this.request('/dashboard')
  }

  // Chat
  async sendChatMessage(data: { message: string; clientId?: string }) {
    return this.request('/chat', { method: 'POST', body: JSON.stringify(data) })
  }

  // Transactions
  async getTransactions(params?: Record<string, string>) {
    const query = params ? '?' + new URLSearchParams(params).toString() : ''
    return this.request(`/transactions${query}`)
  }

  async createTransaction(data: Record<string, unknown>) {
    return this.request('/transactions', { method: 'POST', body: JSON.stringify(data) })
  }

  // Services
  async getServices() {
    return this.request('/services')
  }

  async createService(data: Record<string, unknown>) {
    return this.request('/services', { method: 'POST', body: JSON.stringify(data) })
  }

  async updateService(id: string, data: Record<string, unknown>) {
    return this.request('/services', { method: 'PUT', body: JSON.stringify({ id, ...data }) })
  }

  async deleteService(id: string) {
    return this.request(`/services?id=${id}`, { method: 'DELETE' })
  }

  // WhatsApp (via daemon)
  private getDaemonBase() {
    if (typeof window === 'undefined') return 'http://localhost:3002'
    const h = window.location.hostname
    return h === 'localhost' ? 'http://localhost:3002' : `${window.location.protocol}//${h}:3002`
  }

  async getWhatsAppConversations(params?: Record<string, string>) {
    const query = params ? '?' + new URLSearchParams(params).toString() : ''
    const res = await fetch(`${this.getDaemonBase()}/conversations${query}`)
    return res.json()
  }

  async getWhatsAppConversation(id: string) {
    const res = await fetch(`${this.getDaemonBase()}/conversations/${id}`)
    return res.json()
  }

  async updateWhatsAppConversation(id: string, data: Record<string, unknown>) {
    const res = await fetch(`${this.getDaemonBase()}/conversations/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return res.json()
  }

  async sendWhatsAppMessage(data: Record<string, unknown>) {
    const res = await fetch(`${this.getDaemonBase()}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return res.json()
  }

  // Telegram
  async getTelegramConfig() {
    return this.request('/telegram/config')
  }

  async saveTelegramConfig(data: Record<string, unknown>) {
    return this.request('/telegram/config', { method: 'PUT', body: JSON.stringify(data) })
  }

  async disconnectTelegram() {
    return this.request('/telegram/config', { method: 'DELETE' })
  }

  async sendTelegramMessage(data: Record<string, unknown>) {
    return this.request('/telegram/send', { method: 'POST', body: JSON.stringify(data) })
  }

  async setTelegramWebhook() {
    return this.request('/telegram/set-webhook', { method: 'POST' })
  }

  // Google
  async getGoogleConfig() {
    return this.request('/google/config')
  }

  async saveGoogleConfig(data: Record<string, unknown>) {
    return this.request('/google/config', { method: 'PUT', body: JSON.stringify(data) })
  }

  async connectGoogle() {
    // This returns a redirect URL for OAuth
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
    }
    const res = await fetch(`${API_BASE}/google/auth`, { headers })
    return res
  }

  async disconnectGoogle() {
    return this.request('/google/disconnect', { method: 'POST' })
  }

  async sendGmail(data: Record<string, unknown>) {
    return this.request('/google/gmail/send', { method: 'POST', body: JSON.stringify(data) })
  }

  async getCalendarEvents() {
    return this.request('/google/calendar/events')
  }

  async createCalendarEvent(data: Record<string, unknown>) {
    return this.request('/google/calendar/events', { method: 'POST', body: JSON.stringify(data) })
  }

  async readSheet(data: Record<string, unknown>) {
    return this.request('/google/sheets/read', { method: 'POST', body: JSON.stringify(data) })
  }

  // Inventory
  async getInventoryConfig() {
    return this.request('/inventory/config')
  }

  async saveInventoryConfig(data: Record<string, unknown>) {
    return this.request('/inventory/config', { method: 'PUT', body: JSON.stringify(data) })
  }

  async syncInventory() {
    return this.request('/inventory/sync', { method: 'POST' })
  }

  async getInventoryStatus() {
    return this.request('/inventory/status')
  }

  // Suggestions
  async getSuggestions() {
    return this.request('/suggestions')
  }

  // Memory
  async getMemory() {
    return this.request('/memory')
  }

  async addMemory(data: Record<string, unknown>) {
    return this.request('/memory', { method: 'POST', body: JSON.stringify(data) })
  }

  // Settings
  async getSettings() {
    return this.request('/settings')
  }

  async updateSettings(data: { llm: { apiKey?: string; baseUrl?: string; model?: string } }) {
    return this.request('/settings', { method: 'PUT', body: JSON.stringify(data) })
  }

  async clearSettingsApiKey() {
    return this.request('/settings', { method: 'DELETE' })
  }

  // Reports
  async getReports(period: string) {
    return this.request(`/reports?period=${period}`)
  }

  // Notifications
  async getNotifications() {
    return this.request('/notifications')
  }

  async createNotification(data: Record<string, unknown>) {
    return this.request('/notifications', { method: 'POST', body: JSON.stringify(data) })
  }

  async markNotificationRead(id: string) {
    return this.request(`/notifications/${id}`, { method: 'PUT', body: JSON.stringify({ isRead: true }) })
  }

  async markAllNotificationsRead() {
    return this.request('/notifications/read-all', { method: 'PUT' })
  }

  async clearNotifications() {
    return this.request('/notifications/all', { method: 'DELETE' })
  }

  // Templates
  async getTemplates() {
    return this.request('/templates')
  }

  async createTemplate(data: Record<string, unknown>) {
    return this.request('/templates', { method: 'POST', body: JSON.stringify(data) })
  }

  async updateTemplate(id: string, data: Record<string, unknown>) {
    return this.request(`/templates/${id}`, { method: 'PUT', body: JSON.stringify(data) })
  }

  async deleteTemplate(id: string) {
    return this.request(`/templates/${id}`, { method: 'DELETE' })
  }

  // Custom Fields
  async getCustomFields(entity: string) {
    return this.request(`/custom-fields?entity=${entity}`)
  }

  async createCustomField(data: Record<string, unknown>) {
    return this.request('/custom-fields', { method: 'POST', body: JSON.stringify(data) })
  }

  async updateCustomField(id: string, data: Record<string, unknown>) {
    return this.request(`/custom-fields/${id}`, { method: 'PUT', body: JSON.stringify(data) })
  }

  async deleteCustomField(id: string) {
    return this.request(`/custom-fields/${id}`, { method: 'DELETE' })
  }

  async getCustomFieldValues(entityId: string) {
    return this.request(`/custom-fields/values?entityId=${entityId}`)
  }

  async saveCustomFieldValues(data: Record<string, unknown>) {
    return this.request('/custom-fields/values', { method: 'POST', body: JSON.stringify(data) })
  }

  // Activity Log
  async getActivityLog(params?: Record<string, string>) {
    const query = params ? '?' + new URLSearchParams(params).toString() : ''
    return this.request(`/activity${query}`)
  }

  // Import/Export
  async importCsv(file: File, type: string) {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('type', type)
    const headers: Record<string, string> = {}
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`
    }
    const res = await fetch(`${API_BASE}/import/csv`, { method: 'POST', headers, body: formData })
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Error de conexión' }))
      throw new Error(error.error || `Error ${res.status}`)
    }
    return res.json()
  }

  getExportCsvUrl(type: string) {
    return `${API_BASE}/export/csv?type=${type}${this.token ? '&token=' + this.token : ''}`
  }

  // Report exports (PDF/Excel)
  getReportPdfUrl(period: string) {
    return `${API_BASE}/reports/pdf?period=${period}${this.token ? '&token=' + this.token : ''}`
  }

  getReportExcelUrl(period: string) {
    return `${API_BASE}/reports/excel?period=${period}${this.token ? '&token=' + this.token : ''}`
  }

  async downloadReportPdf(period: string) {
    const headers: Record<string, string> = {}
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`
    }
    const res = await fetch(`${API_BASE}/reports/pdf?period=${period}`, { headers })
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Error de conexión' }))
      throw new Error(error.error || `Error ${res.status}`)
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `reporte_${period}_${new Date().toISOString().split('T')[0]}.pdf`
    a.click()
    URL.revokeObjectURL(url)
  }

  async downloadReportExcel(period: string) {
    const headers: Record<string, string> = {}
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`
    }
    const res = await fetch(`${API_BASE}/reports/excel?period=${period}`, { headers })
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Error de conexión' }))
      throw new Error(error.error || `Error ${res.status}`)
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `reporte_${period}_${new Date().toISOString().split('T')[0]}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Team Management
  async getTeam() {
    return this.request('/team')
  }

  async inviteTeamMember(data: { name: string; email: string; password: string; role: string; phone?: string }) {
    return this.request('/team', { method: 'POST', body: JSON.stringify(data) })
  }

  async updateTeamMember(id: string, data: Record<string, unknown>) {
    return this.request(`/team/${id}`, { method: 'PUT', body: JSON.stringify(data) })
  }

  async deactivateTeamMember(id: string) {
    return this.request(`/team/${id}`, { method: 'DELETE' })
  }

  // Permissions
  async getPermissions() {
    return this.request('/permissions')
  }

  // Email
  async sendEmail(data: { to: string; subject: string; html: string; text?: string; templateId?: string; variables?: Record<string, string> }) {
    return this.request('/email/send', { method: 'POST', body: JSON.stringify(data) })
  }

  async testEmail(email: string) {
    return this.request('/email/test', { method: 'POST', body: JSON.stringify({ email }) })
  }

  // Backup
  async exportBackup() {
    const headers: Record<string, string> = {}
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`
    }
    const res = await fetch(`${API_BASE}/backup`, { headers })
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Error de conexión' }))
      throw new Error(error.error || `Error ${res.status}`)
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `crm-albra-backup-${new Date().toISOString().split('T')[0]}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async importBackup(backupData: Record<string, unknown>) {
    return this.request('/backup', { method: 'POST', body: JSON.stringify(backupData) })
  }

  // Forgot Password
  async forgotPassword(email: string) {
    const res = await fetch(`${API_BASE}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    return res.json()
  }

  async resetPassword(token: string, password: string) {
    const res = await fetch(`${API_BASE}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    })
    return res.json()
  }
}

export const api = new ApiClient()
