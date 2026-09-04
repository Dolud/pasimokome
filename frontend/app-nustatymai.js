function nustatymaiApp() {
  return {
    authenticated: false,
    token: null,
    loginPassword: '',
    loginError: '',
    loginLoading: false,

    activeTab: 'biudzetas',

    settings: {},
    showFields: {},
    newPassword: '',
    testResults: null,
    testingAll: false,
    testingGroup: null,

    saving: false,
    saveMessage: '',
    saveError: false,

    campaigns: [],
    products: [],
    scanningCampaigns: false,
    savingCampaigns: false,
    campaignSort: { field: 'createdTime', dir: 'desc' },

    budgets: {},
    budgetSaving: false,
    budgetSaveMessage: '',
    budgetSaveError: false,
    importing: false,
    months: [],
    years: [],
    selectedYear: new Date().getFullYear(),

    get allOk() {
      if (!this.testResults) return false;
      return Object.values(this.testResults).every(r => r.ok);
    },

    getStatusClass(groupKey) {
      if (!this.testResults || !this.testResults[groupKey]) return 'bg-gray-100 text-gray-500';
      return this.testResults[groupKey].ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700';
    },

    getStatusDotClass(groupKey) {
      if (!this.testResults || !this.testResults[groupKey]) return 'bg-gray-400';
      return this.testResults[groupKey].ok ? 'bg-green-500' : 'bg-red-500';
    },

    getStatusText(groupKey) {
      if (!this.testResults || !this.testResults[groupKey]) return 'Nepatikrinta';
      return this.testResults[groupKey].ok ? 'Veikia' : 'Klaida';
    },

    async init() {
      this.token = localStorage.getItem('settings_token');
      if (this.token) {
        try {
          const res = await this.api('GET', '/api/settings');
          if (res.success) {
            this.authenticated = true;
            this.settings = res.settings;
            this.initShowFields();
            this.loadProducts();
            this.testAll();
            this.generateYears();
            this.generateMonths();
            this.loadBudgets();
            this.scanCampaigns();
          } else {
            this.token = null;
            localStorage.removeItem('settings_token');
          }
        } catch (e) {
          this.token = null;
          localStorage.removeItem('settings_token');
        }
      }
    },

    initShowFields() {
      for (const group of Object.values(this.settings)) {
        for (const field of group.fields) {
          if (!(field.key in this.showFields)) {
            this.showFields[field.key] = false;
          }
        }
      }
    },

    async loadProducts() {
      try {
        const res = await this.api('GET', '/api/products');
        if (res.success) {
          this.products = res.products;
        }
      } catch (e) {}
    },

    async login() {
      this.loginError = '';
      this.loginLoading = true;
      try {
        const res = await fetch('/api/settings/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: this.loginPassword })
        });
        const data = await res.json();
        if (data.success) {
          this.token = data.token;
          localStorage.setItem('settings_token', data.token);
          this.authenticated = true;
          await this.loadSettings();
          this.loadProducts();
          this.testAll();
          this.generateYears();
          this.generateMonths();
          this.loadBudgets();
          this.scanCampaigns();
        } else {
          this.loginError = data.error || 'Klaida';
        }
      } catch (e) {
        this.loginError = 'Nepavyko prisijungti';
      }
      this.loginLoading = false;
    },

    async logout() {
      try {
        await this.api('POST', '/api/settings/logout');
      } catch (e) {}
      this.token = null;
      this.authenticated = false;
      this.settings = {};
      this.testResults = null;
      this.loginPassword = '';
      localStorage.removeItem('settings_token');
    },

    async loadSettings() {
      try {
        const res = await this.api('GET', '/api/settings');
        if (res.success) {
          this.settings = res.settings;
          this.initShowFields();
        }
      } catch (e) {}
    },

    async testAll() {
      this.testingAll = true;
      this.testResults = null;
      try {
        const res = await this.api('POST', '/api/settings/test');
        if (res.success) {
          this.testResults = res.results;
        }
      } catch (e) {}
      this.testingAll = false;
    },

    async testGroup(groupKey) {
      this.testingGroup = groupKey;
      try {
        const res = await this.api('POST', '/api/settings/test');
        if (res.success) {
          this.testResults = res.results;
        }
      } catch (e) {}
      this.testingGroup = null;
    },

    async save() {
      this.saving = true;
      this.saveMessage = '';
      this.saveError = false;

      const payload = {};
      for (const group of Object.values(this.settings)) {
        for (const field of group.fields) {
          if (field.value !== undefined && field.value !== null) {
            payload[field.key] = field.value;
          }
        }
      }
      if (this.newPassword.trim()) {
        payload.password = this.newPassword.trim();
      }

      try {
        const res = await this.api('POST', '/api/settings', payload);
        if (res.success) {
          this.saveMessage = 'Išsaugota! Serveris paleidžiamas iš naujo...';
          this.saveError = false;
          this.newPassword = '';
          setTimeout(() => {
            this.saveMessage = '';
            this.loadProducts();
          }, 3000);
        } else {
          this.saveMessage = res.error || 'Klaida saugant';
          this.saveError = true;
        }
      } catch (e) {
        this.saveMessage = 'Nepavyko išsaugoti';
        this.saveError = true;
      }
      this.saving = false;
    },

    async scanCampaigns() {
      this.scanningCampaigns = true;
      try {
        const [scanRes, mapRes] = await Promise.all([
          this.api('GET', '/api/campaigns/scan'),
          this.api('GET', '/api/campaigns'),
        ]);
        const savedCategories = (mapRes.success && mapRes.mappings) ? mapRes.mappings : {};
        if (scanRes.success) {
          this.campaigns = scanRes.campaigns.map(c => ({
            name: c.name,
            id: c.id,
            status: c.status,
            createdTime: c.createdTime,
            category: savedCategories[c.name] || c.category,
          }));
        }
      } catch (e) {}
      this.scanningCampaigns = false;
    },

    async saveCampaigns() {
      this.savingCampaigns = true;
      try {
        const payload = {};
        for (const c of this.campaigns) {
          payload[c.name] = c.category;
        }
        const res = await this.api('POST', '/api/campaigns', { campaigns: payload });
        if (res.success) {
          this.saveMessage = 'Kampanijos išsaugotos!';
          this.saveError = false;
          setTimeout(() => { this.saveMessage = ''; }, 3000);
        }
      } catch (e) {}
      this.savingCampaigns = false;
    },

    sortCampaigns(field) {
      if (this.campaignSort.field === field) {
        this.campaignSort.dir = this.campaignSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        this.campaignSort.field = field;
        this.campaignSort.dir = field === 'createdTime' ? 'desc' : 'asc';
      }
    },

    get sortedCampaigns() {
      const sorted = [...this.campaigns].sort((a, b) => {
        const field = this.campaignSort.field;
        let valA = a[field] || '';
        let valB = b[field] || '';
        if (field === 'createdTime') {
          valA = valA ? new Date(valA).getTime() : 0;
          valB = valB ? new Date(valB).getTime() : 0;
        } else {
          valA = String(valA).toLowerCase();
          valB = String(valB).toLowerCase();
        }
        if (valA < valB) return this.campaignSort.dir === 'asc' ? -1 : 1;
        if (valA > valB) return this.campaignSort.dir === 'asc' ? 1 : -1;
        return 0;
      });
      return sorted;
    },

    getCampaignDate(campaign) {
      if (!campaign.createdTime) return '';
      try {
        return new Date(campaign.createdTime).toLocaleDateString('lt-LT');
      } catch (e) {
        return '';
      }
    },

    async api(method, url, body) {
      const opts = {
        method,
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
      };
      if (body) opts.body = JSON.stringify(body);
      const res = await fetch(url, opts);
      return res.json();
    },

    generateYears() {
      const currentYear = new Date().getFullYear();
      this.years = [];
      for (let y = 2025; y <= currentYear + 1; y++) {
        this.years.push(y);
      }
    },

    generateMonths() {
      const monthNames = [
        'Sausis', 'Vasaris', 'Kovas', 'Balandis', 'Gegužė', 'Birželis',
        'Liepa', 'Rugpjūtis', 'Rugsėjis', 'Spalis', 'Lapkritis', 'Gruodis'
      ];
      this.months = [];
      for (let m = 1; m <= 12; m++) {
        const key = `${this.selectedYear} ${String(m).padStart(2, '0')}`;
        this.months.push({ key, label: monthNames[m - 1] });
      }
    },

    getField(monthKey, field) {
      const entry = this.budgets[monthKey];
      if (!entry || entry[field] === undefined || entry[field] === null) return '';
      return String(entry[field]);
    },

    setField(monthKey, field, value) {
      if (!this.budgets[monthKey]) {
        this.budgets[monthKey] = {};
      }
      this.budgets[monthKey][field] = value;
    },

    getConversion(monthKey) {
      const entry = this.budgets[monthKey];
      if (!entry) return '—';
      const leads = parseFloat(entry.leads_daily) || 0;
      const deals = parseFloat(entry.deals_daily) || 0;
      if (leads === 0) return '—';
      return ((deals / leads) * 100).toFixed(1) + '%';
    },

    getAutoConversionPrice(monthKey) {
      const entry = this.budgets[monthKey];
      if (!entry) return '';
      const daily = parseFloat(entry.daily) || 0;
      const leads = parseFloat(entry.leads_daily) || 0;
      const deals = parseFloat(entry.deals_daily) || 0;
      if (deals === 0 || leads === 0) return '';
      const conversion = (deals / leads) * 100;
      return ((daily / deals) * (100 / conversion)).toFixed(2);
    },

    async loadBudgets() {
      this.generateMonths();
      try {
        const res = await fetch('/api/online-pamokos/budgets');
        const data = await res.json();
        if (data.success) {
          this.budgets = data.budgets || {};
        }
      } catch (e) {}
    },

    async saveBudget() {
      this.budgetSaving = true;
      this.budgetSaveMessage = '';
      this.budgetSaveError = false;

      const payload = {};
      for (const month of this.months) {
        const entry = this.budgets[month.key];
        if (entry) {
          const cleaned = {};
          for (const [k, v] of Object.entries(entry)) {
            if (v !== undefined && v !== null && String(v).trim() !== '') {
              cleaned[k] = v;
            }
          }
          if (Object.keys(cleaned).length > 0) {
            payload[month.key] = cleaned;
          }
        }
      }

      try {
        const res = await fetch('/api/online-pamokos/budgets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ budgets: payload })
        });
        const data = await res.json();
        if (data.success) {
          this.budgetSaveMessage = 'Išsaugota!';
          this.budgetSaveError = false;
          setTimeout(() => { this.budgetSaveMessage = ''; }, 3000);
        } else {
          this.budgetSaveMessage = data.error || 'Klaida';
          this.budgetSaveError = true;
        }
      } catch (e) {
        this.budgetSaveMessage = 'Nepavyko išsaugoti';
        this.budgetSaveError = true;
      }
      this.budgetSaving = false;
    },

    async importFromSheets() {
      this.importing = true;
      this.budgetSaveMessage = '';
      this.budgetSaveError = false;
      try {
        const res = await fetch('/api/online-pamokos/budgets/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ year: this.selectedYear })
        });
        const data = await res.json();
        if (data.success) {
          for (const [monthKey, values] of Object.entries(data.imported)) {
            if (!this.budgets[monthKey]) {
              this.budgets[monthKey] = {};
            }
            if (values.daily !== null) this.budgets[monthKey].daily = values.daily;
            if (values.leads_daily !== null) this.budgets[monthKey].leads_daily = values.leads_daily;
            if (values.deals_daily !== null) this.budgets[monthKey].deals_daily = values.deals_daily;
          }
          this.budgetSaveMessage = 'Duomenys importuoti. Nepamirškite išsaugoti!';
          this.budgetSaveError = false;
          setTimeout(() => { this.budgetSaveMessage = ''; }, 5000);
        } else {
          this.budgetSaveMessage = data.error || 'Importo klaida';
          this.budgetSaveError = true;
        }
      } catch (e) {
        this.budgetSaveMessage = 'Nepavyko importuoti: ' + e.message;
        this.budgetSaveError = true;
      }
      this.importing = false;
    },
  };
}
