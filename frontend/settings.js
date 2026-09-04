function settingsApp() {
  return {
    authenticated: false,
    token: null,
    loginPassword: '',
    loginError: '',
    loginLoading: false,

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
            this.loadExistingCampaigns();
            this.loadProducts();
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

    async loadExistingCampaigns() {
      try {
        const res = await this.api('GET', '/api/campaigns');
        if (res.success && res.mappings) {
          this.campaigns = Object.entries(res.mappings).map(([name, category]) => ({
            name, category
          }));
        }
      } catch (e) {}
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
        const res = await this.api('GET', '/api/campaigns/scan');
        if (res.success) {
          this.campaigns = res.campaigns;
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

  };
}
