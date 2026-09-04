const fs = require('fs');
const path = require('path');

const BUDGETS_PATH = path.join(__dirname, '../config/online-pamokos-budgets.json');

function loadBudgets() {
  try {
    if (fs.existsSync(BUDGETS_PATH)) {
      return JSON.parse(fs.readFileSync(BUDGETS_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('[budgets] Error loading:', e.message);
  }
  return {};
}

function saveBudgets(data) {
  const dir = path.dirname(BUDGETS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(BUDGETS_PATH, JSON.stringify(data, null, 2));
}

function getBudgetField(monthKey, field) {
  const budgets = loadBudgets();
  const entry = budgets[monthKey];
  if (!entry || entry[field] === undefined || entry[field] === null || entry[field] === '') return null;
  const num = parseFloat(String(entry[field]).replace(',', '.').replace(/[^\d.-]/g, ''));
  return isNaN(num) ? null : num;
}

function getBudgets() {
  return loadBudgets();
}

module.exports = { loadBudgets, saveBudgets, getBudgetField, getBudgets };
