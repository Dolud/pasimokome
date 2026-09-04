function budgetApp() {
  return {
    budgets: {},
    saving: false,
    saveMessage: '',
    saveError: false,
    importing: false,
    months: [],
    years: [],
    selectedYear: new Date().getFullYear(),

    init() {
      this.generateYears();
      this.generateMonths();
      this.loadBudgets();
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

    async save() {
      this.saving = true;
      this.saveMessage = '';
      this.saveError = false;

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
          this.saveMessage = 'Išsaugota!';
          this.saveError = false;
          setTimeout(() => { this.saveMessage = ''; }, 3000);
        } else {
          this.saveMessage = data.error || 'Klaida';
          this.saveError = true;
        }
      } catch (e) {
        this.saveMessage = 'Nepavyko išsaugoti';
        this.saveError = true;
      }
      this.saving = false;
    },

    async importFromSheets() {
      this.importing = true;
      this.saveMessage = '';
      this.saveError = false;
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
          this.saveMessage = 'Duomenys importuoti. Nepamirškite išsaugoti!';
          this.saveError = false;
          setTimeout(() => { this.saveMessage = ''; }, 5000);
        } else {
          this.saveMessage = data.error || 'Importo klaida';
          this.saveError = true;
        }
      } catch (e) {
        this.saveMessage = 'Nepavyko importuoti: ' + e.message;
        this.saveError = true;
      }
      this.importing = false;
    },
  };
}
