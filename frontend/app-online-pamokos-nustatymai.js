function budgetApp() {
  return {
    budgets: {},
    saving: false,
    saveMessage: '',
    saveError: false,
    months: [],

    init() {
      this.generateMonths();
      this.loadBudgets();
    },

    generateMonths() {
      const now = new Date();
      const year = now.getFullYear();
      const monthNames = [
        'Sausis', 'Vasaris', 'Kovas', 'Balandis', 'Gegužė', 'Birželis',
        'Liepa', 'Rugpjūtis', 'Rugsėjis', 'Spalis', 'Lapkritis', 'Gruodis'
      ];
      this.months = [];
      for (let m = 1; m <= 12; m++) {
        const key = `${year} ${String(m).padStart(2, '0')}`;
        this.months.push({ key, label: `${monthNames[m - 1]} ${year}` });
      }
    },

    async loadBudgets() {
      try {
        const res = await fetch('/api/online-pamokos/budgets');
        const data = await res.json();
        if (data.success) {
          for (const [key, entry] of Object.entries(data.budgets)) {
            this.budgets[key] = entry.daily !== undefined && entry.daily !== null ? String(entry.daily) : '';
          }
        }
      } catch (e) {}
    },

    async save() {
      this.saving = true;
      this.saveMessage = '';
      this.saveError = false;

      const payload = {};
      for (const month of this.months) {
        const val = this.budgets[month.key];
        if (val !== undefined && val !== null && String(val).trim() !== '') {
          payload[month.key] = { daily: val };
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
  };
}
