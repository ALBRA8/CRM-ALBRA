(globalThis.TURBOPACK || (globalThis.TURBOPACK = [])).push([typeof document === "object" ? document.currentScript : undefined,
"[project]/src/lib/store.ts [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "useAppStore",
    ()=>useAppStore
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zustand$2f$esm$2f$react$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/zustand/esm/react.mjs [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zustand$2f$esm$2f$middleware$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/zustand/esm/middleware.mjs [app-client] (ecmascript)");
'use client';
;
;
const useAppStore = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zustand$2f$esm$2f$react$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__["create"])()((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zustand$2f$esm$2f$middleware$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__["persist"])((set)=>({
        view: 'landing',
        setView: (view)=>set({
                view
            }),
        user: null,
        setUser: (user)=>set({
                user,
                isAdmin: user?.role === 'owner' || user?.role === 'admin'
            }),
        token: null,
        setToken: (token)=>set({
                token
            }),
        sidebarCollapsed: false,
        toggleSidebar: ()=>set((s)=>({
                    sidebarCollapsed: !s.sidebarCollapsed
                })),
        selectedClientId: null,
        setSelectedClientId: (id)=>set({
                selectedClientId: id
            }),
        selectedOpportunityId: null,
        setSelectedOpportunityId: (id)=>set({
                selectedOpportunityId: id
            }),
        selectedQuoteId: null,
        setSelectedQuoteId: (id)=>set({
                selectedQuoteId: id
            }),
        isAdmin: false,
        setIsAdmin: (v)=>set({
                isAdmin: v
            }),
        logout: ()=>set({
                user: null,
                token: null,
                view: 'landing',
                isAdmin: false
            })
    }), {
    name: 'crm-albra-store'
}));
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/src/lib/api.ts [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "api",
    ()=>api
]);
'use client';
const API_BASE = '/api';
class ApiClient {
    token = null;
    setToken(token) {
        this.token = token;
    }
    getToken() {
        return this.token;
    }
    async request(path, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers || {}
        };
        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }
        const res = await fetch(`${API_BASE}${path}`, {
            ...options,
            headers
        });
        if (!res.ok) {
            const error = await res.json().catch(()=>({
                    error: 'Error de conexión'
                }));
            throw new Error(error.error || `Error ${res.status}`);
        }
        return res.json();
    }
    // Auth
    async register(data) {
        return this.request('/auth/register', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }
    async login(data) {
        return this.request('/auth/login', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }
    async getMe() {
        return this.request('/auth/me');
    }
    async demoLogin() {
        return this.request('/auth/demo', {
            method: 'POST'
        });
    }
    // Clients
    async getClients(params) {
        const query = params ? '?' + new URLSearchParams(params).toString() : '';
        return this.request(`/clients${query}`);
    }
    async getClient(id) {
        return this.request(`/clients/${id}`);
    }
    async createClient(data) {
        return this.request('/clients', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }
    async updateClient(id, data) {
        return this.request(`/clients/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }
    async deleteClient(id) {
        return this.request(`/clients/${id}`, {
            method: 'DELETE'
        });
    }
    async getClientPreferences(id) {
        return this.request(`/clients/${id}/preferences`);
    }
    async updateClientPreferences(id, data) {
        return this.request(`/clients/${id}/preferences`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }
    async getClientHistory(id) {
        return this.request(`/clients/${id}/history`);
    }
    async addClientHistory(id, data) {
        return this.request(`/clients/${id}/history`, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }
    // Opportunities
    async getOpportunities(params) {
        const query = params ? '?' + new URLSearchParams(params).toString() : '';
        return this.request(`/opportunities${query}`);
    }
    async getOpportunity(id) {
        return this.request(`/opportunities/${id}`);
    }
    async createOpportunity(data) {
        return this.request('/opportunities', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }
    async updateOpportunity(id, data) {
        return this.request(`/opportunities/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }
    // Pipeline
    async getPipeline() {
        return this.request('/pipeline');
    }
    // Reservations
    async getReservations(params) {
        const query = params ? '?' + new URLSearchParams(params).toString() : '';
        return this.request(`/reservations${query}`);
    }
    async createReservation(data) {
        return this.request('/reservations', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }
    async updateReservation(id, data) {
        return this.request(`/reservations/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }
    async cancelReservation(id) {
        return this.request(`/reservations/${id}`, {
            method: 'DELETE'
        });
    }
    // Quotes
    async getQuotes(params) {
        const query = params ? '?' + new URLSearchParams(params).toString() : '';
        return this.request(`/quotes${query}`);
    }
    async getQuote(id) {
        return this.request(`/quotes/${id}`);
    }
    async createQuote(data) {
        return this.request('/quotes', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }
    async updateQuoteStatus(id, data) {
        return this.request(`/quotes/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }
    async deleteQuote(id) {
        return this.request(`/quotes/${id}`, {
            method: 'DELETE'
        });
    }
    // Automations
    async getAutomations() {
        return this.request('/automations');
    }
    async createAutomation(data) {
        return this.request('/automations', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }
    async updateAutomation(id, data) {
        return this.request(`/automations/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }
    async deleteAutomation(id) {
        return this.request(`/automations/${id}`, {
            method: 'DELETE'
        });
    }
    async runAutomations() {
        return this.request('/automations/run', {
            method: 'POST'
        });
    }
    // Dashboard
    async getDashboard() {
        return this.request('/dashboard');
    }
    // Chat
    async sendChatMessage(data) {
        return this.request('/chat', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }
    // Transactions
    async getTransactions(params) {
        const query = params ? '?' + new URLSearchParams(params).toString() : '';
        return this.request(`/transactions${query}`);
    }
    async createTransaction(data) {
        return this.request('/transactions', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }
    // Services
    async getServices() {
        return this.request('/services');
    }
    async createService(data) {
        return this.request('/services', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }
    async updateService(id, data) {
        return this.request('/services', {
            method: 'PUT',
            body: JSON.stringify({
                id,
                ...data
            })
        });
    }
    async deleteService(id) {
        return this.request(`/services?id=${id}`, {
            method: 'DELETE'
        });
    }
    // WhatsApp (via daemon)
    getDaemonBase() {
        if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
        ;
        const h = window.location.hostname;
        return h === 'localhost' ? 'http://localhost:3002' : `${window.location.protocol}//${h}:3002`;
    }
    async getWhatsAppConversations(params) {
        const query = params ? '?' + new URLSearchParams(params).toString() : '';
        const res = await fetch(`${this.getDaemonBase()}/conversations${query}`);
        return res.json();
    }
    async getWhatsAppConversation(id) {
        const res = await fetch(`${this.getDaemonBase()}/conversations/${id}`);
        return res.json();
    }
    async updateWhatsAppConversation(id, data) {
        const res = await fetch(`${this.getDaemonBase()}/conversations/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        return res.json();
    }
    async sendWhatsAppMessage(data) {
        const res = await fetch(`${this.getDaemonBase()}/send`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        return res.json();
    }
    // Telegram
    async getTelegramConfig() {
        return this.request('/telegram/config');
    }
    async saveTelegramConfig(data) {
        return this.request('/telegram/config', {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }
    async disconnectTelegram() {
        return this.request('/telegram/config', {
            method: 'DELETE'
        });
    }
    async sendTelegramMessage(data) {
        return this.request('/telegram/send', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }
    async setTelegramWebhook() {
        return this.request('/telegram/set-webhook', {
            method: 'POST'
        });
    }
    // Instagram
    async getInstagramConfig() {
        return this.request('/instagram/config');
    }
    async saveInstagramConfig(data) {
        return this.request('/instagram/config', {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }
    async disconnectInstagram() {
        return this.request('/instagram/config', {
            method: 'DELETE'
        });
    }
    async sendInstagramMessage(data) {
        return this.request('/instagram/send', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }
    async getInstagramConversations() {
        return this.request('/instagram/conversations');
    }
    async getInstagramConversation(id) {
        return this.request(`/instagram/conversations/${id}`);
    }
    async updateInstagramConversation(id, data) {
        return this.request(`/instagram/conversations/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }
    // Google
    async getGoogleConfig() {
        return this.request('/google/config');
    }
    async saveGoogleConfig(data) {
        return this.request('/google/config', {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }
    async connectGoogle() {
        // This returns a redirect URL for OAuth
        const headers = {
            'Content-Type': 'application/json',
            ...this.token ? {
                Authorization: `Bearer ${this.token}`
            } : {}
        };
        const res = await fetch(`${API_BASE}/google/auth`, {
            headers
        });
        return res;
    }
    async disconnectGoogle() {
        return this.request('/google/disconnect', {
            method: 'POST'
        });
    }
    async sendGmail(data) {
        return this.request('/google/gmail/send', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }
    async getCalendarEvents() {
        return this.request('/google/calendar/events');
    }
    async createCalendarEvent(data) {
        return this.request('/google/calendar/events', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }
    async readSheet(data) {
        return this.request('/google/sheets/read', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }
    // Inventory
    async getInventoryConfig() {
        return this.request('/inventory/config');
    }
    async saveInventoryConfig(data) {
        return this.request('/inventory/config', {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }
    async syncInventory() {
        return this.request('/inventory/sync', {
            method: 'POST'
        });
    }
    async getInventoryStatus() {
        return this.request('/inventory/status');
    }
    // Suggestions
    async getSuggestions() {
        return this.request('/suggestions');
    }
    // Memory
    async getMemory() {
        return this.request('/memory');
    }
    async addMemory(data) {
        return this.request('/memory', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }
    // Settings
    async getSettings() {
        return this.request('/settings');
    }
    async updateSettings(data) {
        return this.request('/settings', {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }
    async clearSettingsApiKey() {
        return this.request('/settings', {
            method: 'DELETE'
        });
    }
    // Reports
    async getReports(period) {
        return this.request(`/reports?period=${period}`);
    }
    // Notifications
    async getNotifications() {
        return this.request('/notifications');
    }
    async createNotification(data) {
        return this.request('/notifications', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }
    async markNotificationRead(id) {
        return this.request(`/notifications/${id}`, {
            method: 'PUT',
            body: JSON.stringify({
                isRead: true
            })
        });
    }
    async markAllNotificationsRead() {
        return this.request('/notifications/read-all', {
            method: 'PUT'
        });
    }
    async clearNotifications() {
        return this.request('/notifications/all', {
            method: 'DELETE'
        });
    }
    // Templates
    async getTemplates() {
        return this.request('/templates');
    }
    async createTemplate(data) {
        return this.request('/templates', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }
    async updateTemplate(id, data) {
        return this.request(`/templates/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }
    async deleteTemplate(id) {
        return this.request(`/templates/${id}`, {
            method: 'DELETE'
        });
    }
    // Custom Fields
    async getCustomFields(entity) {
        return this.request(`/custom-fields?entity=${entity}`);
    }
    async createCustomField(data) {
        return this.request('/custom-fields', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }
    async updateCustomField(id, data) {
        return this.request(`/custom-fields/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }
    async deleteCustomField(id) {
        return this.request(`/custom-fields/${id}`, {
            method: 'DELETE'
        });
    }
    async getCustomFieldValues(entityId) {
        return this.request(`/custom-fields/values?entityId=${entityId}`);
    }
    async saveCustomFieldValues(data) {
        return this.request('/custom-fields/values', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }
    // Activity Log
    async getActivityLog(params) {
        const query = params ? '?' + new URLSearchParams(params).toString() : '';
        return this.request(`/activity${query}`);
    }
    // Import/Export
    async importCsv(file, type) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('type', type);
        const headers = {};
        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }
        const res = await fetch(`${API_BASE}/import/csv`, {
            method: 'POST',
            headers,
            body: formData
        });
        if (!res.ok) {
            const error = await res.json().catch(()=>({
                    error: 'Error de conexión'
                }));
            throw new Error(error.error || `Error ${res.status}`);
        }
        return res.json();
    }
    getExportCsvUrl(type) {
        return `${API_BASE}/export/csv?type=${type}${this.token ? '&token=' + this.token : ''}`;
    }
    // Report exports (PDF/Excel)
    getReportPdfUrl(period) {
        return `${API_BASE}/reports/pdf?period=${period}${this.token ? '&token=' + this.token : ''}`;
    }
    getReportExcelUrl(period) {
        return `${API_BASE}/reports/excel?period=${period}${this.token ? '&token=' + this.token : ''}`;
    }
    async downloadReportPdf(period) {
        const headers = {};
        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }
        const res = await fetch(`${API_BASE}/reports/pdf?period=${period}`, {
            headers
        });
        if (!res.ok) {
            const error = await res.json().catch(()=>({
                    error: 'Error de conexión'
                }));
            throw new Error(error.error || `Error ${res.status}`);
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `reporte_${period}_${new Date().toISOString().split('T')[0]}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
    }
    async downloadReportExcel(period) {
        const headers = {};
        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }
        const res = await fetch(`${API_BASE}/reports/excel?period=${period}`, {
            headers
        });
        if (!res.ok) {
            const error = await res.json().catch(()=>({
                    error: 'Error de conexión'
                }));
            throw new Error(error.error || `Error ${res.status}`);
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `reporte_${period}_${new Date().toISOString().split('T')[0]}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
    }
    // Team Management
    async getTeam() {
        return this.request('/team');
    }
    async inviteTeamMember(data) {
        return this.request('/team', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }
    async updateTeamMember(id, data) {
        return this.request(`/team/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }
    async deactivateTeamMember(id) {
        return this.request(`/team/${id}`, {
            method: 'DELETE'
        });
    }
    // Permissions
    async getPermissions() {
        return this.request('/permissions');
    }
    // Email
    async sendEmail(data) {
        return this.request('/email/send', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }
    async testEmail(email) {
        return this.request('/email/test', {
            method: 'POST',
            body: JSON.stringify({
                email
            })
        });
    }
    // Backup
    async exportBackup() {
        const headers = {};
        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }
        const res = await fetch(`${API_BASE}/backup`, {
            headers
        });
        if (!res.ok) {
            const error = await res.json().catch(()=>({
                    error: 'Error de conexión'
                }));
            throw new Error(error.error || `Error ${res.status}`);
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `crm-albra-backup-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }
    async importBackup(backupData) {
        return this.request('/backup', {
            method: 'POST',
            body: JSON.stringify(backupData)
        });
    }
    // Forgot Password
    async forgotPassword(email) {
        const res = await fetch(`${API_BASE}/auth/forgot-password`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email
            })
        });
        return res.json();
    }
    async resetPassword(token, password) {
        const res = await fetch(`${API_BASE}/auth/reset-password`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                token,
                password
            })
        });
        return res.json();
    }
}
const api = new ApiClient();
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/src/lib/utils.ts [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "cn",
    ()=>cn
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$clsx$2f$dist$2f$clsx$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/clsx/dist/clsx.mjs [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$tailwind$2d$merge$2f$dist$2f$bundle$2d$mjs$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/tailwind-merge/dist/bundle-mjs.mjs [app-client] (ecmascript)");
;
;
function cn(...inputs) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$tailwind$2d$merge$2f$dist$2f$bundle$2d$mjs$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__["twMerge"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$clsx$2f$dist$2f$clsx$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__["clsx"])(inputs));
}
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/src/lib/currency.ts [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * Currency utility - reads the active currency from localStorage
 * (set from Settings > Negocio). Falls back to COP for backward compatibility.
 */ __turbopack_context__.s([
    "CURRENCIES",
    ()=>CURRENCIES,
    "formatCurrency",
    ()=>formatCurrency,
    "getActiveCurrency",
    ()=>getActiveCurrency,
    "setActiveCurrency",
    ()=>setActiveCurrency,
    "subscribeCurrency",
    ()=>subscribeCurrency
]);
const CURRENCIES = {
    COP: {
        code: 'COP',
        symbol: '$',
        locale: 'es-CO',
        label: 'Peso Colombiano (COP)'
    },
    USD: {
        code: 'USD',
        symbol: '$',
        locale: 'en-US',
        label: 'Dólar EE.UU. (USD)'
    },
    MXN: {
        code: 'MXN',
        symbol: '$',
        locale: 'es-MX',
        label: 'Peso Mexicano (MXN)'
    },
    EUR: {
        code: 'EUR',
        symbol: '€',
        locale: 'es-ES',
        label: 'Euro (EUR)'
    },
    ARS: {
        code: 'ARS',
        symbol: '$',
        locale: 'es-AR',
        label: 'Peso Argentino (ARS)'
    },
    PEN: {
        code: 'PEN',
        symbol: 'S/',
        locale: 'es-PE',
        label: 'Sol Peruano (PEN)'
    },
    CLP: {
        code: 'CLP',
        symbol: '$',
        locale: 'es-CL',
        label: 'Peso Chileno (CLP)'
    },
    BRL: {
        code: 'BRL',
        symbol: 'R$',
        locale: 'pt-BR',
        label: 'Real Brasileño (BRL)'
    }
};
const STORAGE_KEY = 'crm-albra-currency';
const DEFAULT_CURRENCY = 'COP';
let activeCurrency = DEFAULT_CURRENCY;
let listeners = [];
// Initialize from localStorage (client-side only)
if ("TURBOPACK compile-time truthy", 1) {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved && CURRENCIES[saved]) {
            activeCurrency = saved;
        }
    } catch  {
    // ignore
    }
}
function getActiveCurrency() {
    return activeCurrency;
}
function setActiveCurrency(code) {
    if (!CURRENCIES[code]) return;
    activeCurrency = code;
    if ("TURBOPACK compile-time truthy", 1) {
        try {
            localStorage.setItem(STORAGE_KEY, code);
        } catch  {
        // ignore
        }
    }
    listeners.forEach((l)=>l());
}
function subscribeCurrency(cb) {
    listeners.push(cb);
    return ()=>{
        listeners = listeners.filter((l)=>l !== cb);
    };
}
function formatCurrency(value) {
    const info = CURRENCIES[activeCurrency] ?? CURRENCIES[DEFAULT_CURRENCY];
    try {
        return new Intl.NumberFormat(info.locale, {
            style: 'currency',
            currency: info.code,
            minimumFractionDigits: info.code === 'COP' || info.code === 'CLP' ? 0 : 2
        }).format(value);
    } catch  {
        return `${info.symbol}${value.toFixed(2)}`;
    }
}
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/src/app/page.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>Home
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$store$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/store.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/api.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$landing$2f$landing$2d$page$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/landing/landing-page.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$layout$2f$app$2d$layout$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/layout/app-layout.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$dashboard$2f$dashboard$2d$page$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/dashboard/dashboard-page.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$clients$2f$clients$2d$list$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/clients/clients-list.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$clients$2f$client$2d$detail$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/clients/client-detail.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$opportunities$2f$pipeline$2d$view$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/opportunities/pipeline-view.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$calendar$2f$calendar$2d$page$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/calendar/calendar-page.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$automations$2f$automations$2d$page$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/automations/automations-page.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$chat$2f$chat$2d$page$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/chat/chat-page.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$quotes$2f$quotes$2d$list$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/quotes/quotes-list.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$quotes$2f$quote$2d$detail$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/quotes/quote-detail.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$finances$2f$finances$2d$page$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/finances/finances-page.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$settings$2f$settings$2d$page$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/settings/settings-page.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$products$2f$products$2d$page$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/products/products-page.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$whatsapp$2f$whatsapp$2d$page$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/whatsapp/whatsapp-page.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$team$2f$team$2d$page$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/team/team-page.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$activity$2f$activity$2d$page$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/activity/activity-page.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$sonner$2f$dist$2f$index$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/sonner/dist/index.mjs [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$reports$2f$reports$2d$page$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/reports/reports-page.tsx [app-client] (ecmascript)");
;
var _s = __turbopack_context__.k.signature(), _s1 = __turbopack_context__.k.signature();
'use client';
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
function useAuthInit() {
    _s();
    const { setToken, setUser, setView } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$store$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useAppStore"])();
    const [initializing, setInitializing] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(true);
    const initialized = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(false);
    const init = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useAuthInit.useCallback[init]": ()=>{
            if (initialized.current) return;
            initialized.current = true;
            const savedToken = localStorage.getItem('crm_token');
            if (savedToken) {
                setToken(savedToken);
                __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["api"].setToken(savedToken);
                __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$api$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["api"].getMe().then({
                    "useAuthInit.useCallback[init]": (data)=>{
                        setUser(data.user);
                        setView('dashboard');
                        setInitializing(false);
                    }
                }["useAuthInit.useCallback[init]"]).catch({
                    "useAuthInit.useCallback[init]": ()=>{
                        localStorage.removeItem('crm_token');
                        setToken(null);
                        setUser(null);
                        setView('landing');
                        setInitializing(false);
                    }
                }["useAuthInit.useCallback[init]"]);
            } else {
                // Use Promise.resolve to avoid synchronous setState in effect
                Promise.resolve().then({
                    "useAuthInit.useCallback[init]": ()=>{
                        setView('landing');
                        setInitializing(false);
                    }
                }["useAuthInit.useCallback[init]"]);
            }
        }
    }["useAuthInit.useCallback[init]"], [
        setToken,
        setUser,
        setView
    ]);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "useAuthInit.useEffect": ()=>{
            init();
        }
    }["useAuthInit.useEffect"], [
        init
    ]);
    return initializing;
}
_s(useAuthInit, "FOanWsw+1KLJYLlaxO0U+HPNf00=", false, function() {
    return [
        __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$store$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useAppStore"]
    ];
});
function Home() {
    _s1();
    const { view, token } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$store$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useAppStore"])();
    const initializing = useAuthInit();
    if (initializing) {
        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
            className: "min-h-screen flex items-center justify-center bg-slate-50",
            children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "text-center",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "w-12 h-12 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-500/25",
                        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                            className: "text-white font-bold text-xl",
                            children: "A"
                        }, void 0, false, {
                            fileName: "[project]/src/app/page.tsx",
                            lineNumber: 77,
                            columnNumber: 13
                        }, this)
                    }, void 0, false, {
                        fileName: "[project]/src/app/page.tsx",
                        lineNumber: 76,
                        columnNumber: 11
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "flex items-center gap-2 text-slate-500",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "w-2 h-2 bg-emerald-500 rounded-full animate-bounce",
                                style: {
                                    animationDelay: '0ms'
                                }
                            }, void 0, false, {
                                fileName: "[project]/src/app/page.tsx",
                                lineNumber: 80,
                                columnNumber: 13
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "w-2 h-2 bg-emerald-500 rounded-full animate-bounce",
                                style: {
                                    animationDelay: '150ms'
                                }
                            }, void 0, false, {
                                fileName: "[project]/src/app/page.tsx",
                                lineNumber: 81,
                                columnNumber: 13
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "w-2 h-2 bg-emerald-500 rounded-full animate-bounce",
                                style: {
                                    animationDelay: '300ms'
                                }
                            }, void 0, false, {
                                fileName: "[project]/src/app/page.tsx",
                                lineNumber: 82,
                                columnNumber: 13
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/src/app/page.tsx",
                        lineNumber: 79,
                        columnNumber: 11
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                        className: "text-sm text-slate-400 mt-3",
                        children: "Cargando CRM ALBRA..."
                    }, void 0, false, {
                        fileName: "[project]/src/app/page.tsx",
                        lineNumber: 84,
                        columnNumber: 11
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/src/app/page.tsx",
                lineNumber: 75,
                columnNumber: 9
            }, this)
        }, void 0, false, {
            fileName: "[project]/src/app/page.tsx",
            lineNumber: 74,
            columnNumber: 7
        }, this);
    }
    // Not authenticated - show landing
    if (!token) {
        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Fragment"], {
            children: [
                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$landing$2f$landing$2d$page$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["LandingPage"], {}, void 0, false, {
                    fileName: "[project]/src/app/page.tsx",
                    lineNumber: 94,
                    columnNumber: 9
                }, this),
                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$sonner$2f$dist$2f$index$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Toaster"], {
                    position: "top-right",
                    richColors: true
                }, void 0, false, {
                    fileName: "[project]/src/app/page.tsx",
                    lineNumber: 95,
                    columnNumber: 9
                }, this)
            ]
        }, void 0, true);
    }
    // Authenticated - show app
    const renderView = ()=>{
        switch(view){
            case 'dashboard':
                return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$dashboard$2f$dashboard$2d$page$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["DashboardPage"], {}, void 0, false, {
                    fileName: "[project]/src/app/page.tsx",
                    lineNumber: 104,
                    columnNumber: 16
                }, this);
            case 'clients':
                return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$clients$2f$clients$2d$list$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ClientsList"], {}, void 0, false, {
                    fileName: "[project]/src/app/page.tsx",
                    lineNumber: 106,
                    columnNumber: 16
                }, this);
            case 'client-detail':
                return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$clients$2f$client$2d$detail$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ClientDetail"], {}, void 0, false, {
                    fileName: "[project]/src/app/page.tsx",
                    lineNumber: 108,
                    columnNumber: 16
                }, this);
            case 'opportunities':
                return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$opportunities$2f$pipeline$2d$view$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["PipelineView"], {}, void 0, false, {
                    fileName: "[project]/src/app/page.tsx",
                    lineNumber: 110,
                    columnNumber: 16
                }, this);
            case 'calendar':
                return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$calendar$2f$calendar$2d$page$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["CalendarPage"], {}, void 0, false, {
                    fileName: "[project]/src/app/page.tsx",
                    lineNumber: 112,
                    columnNumber: 16
                }, this);
            case 'products':
                return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$products$2f$products$2d$page$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ProductsPage"], {}, void 0, false, {
                    fileName: "[project]/src/app/page.tsx",
                    lineNumber: 114,
                    columnNumber: 16
                }, this);
            case 'whatsapp':
                return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$whatsapp$2f$whatsapp$2d$page$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["WhatsAppPage"], {}, void 0, false, {
                    fileName: "[project]/src/app/page.tsx",
                    lineNumber: 116,
                    columnNumber: 16
                }, this);
            case 'automations':
                return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$automations$2f$automations$2d$page$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AutomationsPage"], {}, void 0, false, {
                    fileName: "[project]/src/app/page.tsx",
                    lineNumber: 118,
                    columnNumber: 16
                }, this);
            case 'chat':
                return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$chat$2f$chat$2d$page$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ChatPage"], {}, void 0, false, {
                    fileName: "[project]/src/app/page.tsx",
                    lineNumber: 120,
                    columnNumber: 16
                }, this);
            case 'quotes':
                return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$quotes$2f$quotes$2d$list$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["QuotesList"], {}, void 0, false, {
                    fileName: "[project]/src/app/page.tsx",
                    lineNumber: 122,
                    columnNumber: 16
                }, this);
            case 'quote-detail':
                return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$quotes$2f$quote$2d$detail$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["QuoteDetail"], {}, void 0, false, {
                    fileName: "[project]/src/app/page.tsx",
                    lineNumber: 124,
                    columnNumber: 16
                }, this);
            case 'finances':
                return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$finances$2f$finances$2d$page$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["FinancesPage"], {}, void 0, false, {
                    fileName: "[project]/src/app/page.tsx",
                    lineNumber: 126,
                    columnNumber: 16
                }, this);
            case 'reports':
                return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$reports$2f$reports$2d$page$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ReportsPage"], {}, void 0, false, {
                    fileName: "[project]/src/app/page.tsx",
                    lineNumber: 128,
                    columnNumber: 16
                }, this);
            case 'team':
                return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$team$2f$team$2d$page$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["TeamPage"], {}, void 0, false, {
                    fileName: "[project]/src/app/page.tsx",
                    lineNumber: 130,
                    columnNumber: 16
                }, this);
            case 'activity':
                return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$activity$2f$activity$2d$page$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ActivityPage"], {}, void 0, false, {
                    fileName: "[project]/src/app/page.tsx",
                    lineNumber: 132,
                    columnNumber: 16
                }, this);
            case 'settings':
                return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$settings$2f$settings$2d$page$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["SettingsPage"], {}, void 0, false, {
                    fileName: "[project]/src/app/page.tsx",
                    lineNumber: 134,
                    columnNumber: 16
                }, this);
            default:
                return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$dashboard$2f$dashboard$2d$page$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["DashboardPage"], {}, void 0, false, {
                    fileName: "[project]/src/app/page.tsx",
                    lineNumber: 136,
                    columnNumber: 16
                }, this);
        }
    };
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Fragment"], {
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$layout$2f$app$2d$layout$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AppLayout"], {
                children: renderView()
            }, void 0, false, {
                fileName: "[project]/src/app/page.tsx",
                lineNumber: 142,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$sonner$2f$dist$2f$index$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Toaster"], {
                position: "top-right",
                richColors: true
            }, void 0, false, {
                fileName: "[project]/src/app/page.tsx",
                lineNumber: 145,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true);
}
_s1(Home, "LF/MdQ+sGlenRT9HcFaqIggeoz8=", false, function() {
    return [
        __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$store$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useAppStore"],
        useAuthInit
    ];
});
_c = Home;
var _c;
__turbopack_context__.k.register(_c, "Home");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
]);

//# sourceMappingURL=src_215dda79._.js.map