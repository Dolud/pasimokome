const API_BASE = '';

let leadsDataTable = null;
let campaignsDataTable = null;
let flatpickrInstance = null;

const STORAGE_KEY = 'dashboard_dates';

function showLoading() {
  document.getElementById('loadingOverlay').classList.add('active');
}

function hideLoading() {
  document.getElementById('loadingOverlay').classList.remove('active');
}

function showError(containerId, message) {
  const container = document.getElementById(containerId);
  container.innerHTML = `<div class="rounded-lg bg-red-50 text-red-600 p-4 mb-4 border border-red-200">${message}</div>`;
}

function clearError(containerId) {
  document.getElementById(containerId).innerHTML = '';
}

function formatCurrency(val) {
  return new Intl.NumberFormat('lt-LT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2
  }).format(val);
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  return dateStr.substring(0, 10);
}

function formatDateForAPI(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function loadSavedDates() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return [new Date(parsed[0]), new Date(parsed[1])];
    }
  } catch (e) {}
  return null;
}

function saveDates(dates) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([formatDateForAPI(dates[0]), formatDateForAPI(dates[1])]));
  } catch (e) {}
}

function getDefaultDates() {
  const saved = loadSavedDates();
  if (saved && !isNaN(saved[0]) && !isNaN(saved[1])) {
    return saved;
  }
  const today = new Date();
  const weekAgo = new Date();
  weekAgo.setDate(today.getDate() - 6);
  return [weekAgo, today];
}

function initDateDefaults() {
  const [startDate, endDate] = getDefaultDates();

  flatpickrInstance = flatpickr("#dateRange", {
    mode: "range",
    static: true,
    monthSelectorType: "static",
    dateFormat: "Y-m-d",
    defaultDate: [startDate, endDate],
    maxDate: "today",
    disableMobile: true,
    prevArrow:
      '<svg class="stroke-current" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M15.25 6L9 12.25L15.25 18.5" stroke="" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    nextArrow:
      '<svg class="stroke-current" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8.75 19L15 12.75L8.75 6.5" stroke="" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    onChange: (selectedDates, dateStr, instance) => {
      if (selectedDates.length === 2) {
        instance.element.value = `${formatDateForAPI(selectedDates[0])} to ${formatDateForAPI(selectedDates[1])}`;
        saveDates(selectedDates);
      }
    },
    onClose: (selectedDates, dateStr, instance) => {
      if (selectedDates.length === 2) {
        saveDates(selectedDates);
        loadDashboard();
      }
    },
  });

  document.getElementById('dateRange').value = `${formatDateForAPI(startDate)} to ${formatDateForAPI(endDate)}`;
}

function getDateRange() {
  if (flatpickrInstance && flatpickrInstance.selectedDates && flatpickrInstance.selectedDates.length === 2) {
    return {
      startDate: formatDateForAPI(flatpickrInstance.selectedDates[0]),
      endDate: formatDateForAPI(flatpickrInstance.selectedDates[1])
    };
  }
  const saved = loadSavedDates();
  if (saved && !isNaN(saved[0]) && !isNaN(saved[1])) {
    return {
      startDate: formatDateForAPI(saved[0]),
      endDate: formatDateForAPI(saved[1])
    };
  }
  const today = new Date();
  const weekAgo = new Date();
  weekAgo.setDate(today.getDate() - 6);
  return {
    startDate: formatDateForAPI(weekAgo),
    endDate: formatDateForAPI(today)
  };
}

async function loadDashboard() {
  const dates = getDateRange();

  clearError('errorContainer');
  showLoading();

  try {
    const response = await fetch(
      `${API_BASE}/api/dashboard?startDate=${dates.startDate}&endDate=${dates.endDate}`
    );
    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to load dashboard data');
    }

    document.getElementById('statSpend').textContent = formatCurrency(data.stats.totalSpend);
    document.getElementById('statLeads').textContent = data.stats.totalLeads;
    document.getElementById('statCPL').textContent = formatCurrency(data.stats.averageCPL);
    document.getElementById('statCampaigns').textContent = data.stats.totalCampaigns;
    document.getElementById('leadsCountBadge').textContent = data.leadTable.length;

    populateLeadsTable(data.leadTable);
    populateCampaignsTable(data.campaignTable);

    loadPlanas(dates.startDate, dates.endDate);
    loadLeadsPlanas(dates.startDate, dates.endDate);

  } catch (error) {
    showError('errorContainer', `Error: ${error.message}`);
  } finally {
    hideLoading();
  }
}

function populateLeadsTable(leads) {
  if (leadsDataTable) {
    leadsDataTable.destroy();
  }

  const tbody = document.querySelector('#leadsTable tbody');
  tbody.innerHTML = '';

  leads.forEach(lead => {
    const row = document.createElement('tr');
    row.className = 'transition hover:bg-gray-50 dark:hover:bg-gray-900';
    row.innerHTML = `
      <td class="px-6 py-3 whitespace-nowrap text-theme-sm font-medium text-gray-700 dark:text-gray-400"><a href="${lead.url}" target="_blank" class="hover:text-brand-500 dark:hover:text-brand-400 hover:underline">${lead.name || '-'}</a></td>
      <td class="px-6 py-3 whitespace-nowrap text-theme-sm text-gray-500 dark:text-gray-400">${lead.source || '-'}</td>
      <td class="px-6 py-3 whitespace-nowrap text-theme-sm text-gray-500 dark:text-gray-400">${formatDate(lead.date)}</td>
    `;
    tbody.appendChild(row);
  });

  leadsDataTable = $('#leadsTable').DataTable({
    pageLength: 10,
    order: [[2, 'desc']],
    dom: 't<"flex items-center justify-between border-t border-gray-200 px-5 py-4 dark:border-gray-800"li>p',
    language: {
      search: "",
      lengthMenu: "Rodyti _MENU_ irašų",
      info: "Rodo _START_-_END_ iš _TOTAL_ irašų",
      infoEmpty: "Nerasta irašų",
      infoFiltered: "(atfiltruota iš _MAX_)",
      emptyTable: "Nerasta irašų",
      paginate: { first: "", last: "", next: "Kitas", previous: "Ankstesnis" }
    },
    drawCallback: function(settings) {
      customizeTableInfo.call(this, settings);
    }
  });

  $('#leadsSearch').on('input', function() {
    leadsDataTable.search(this.value).draw();
  });
}

function populateCampaignsTable(campaigns) {
  if (campaignsDataTable) {
    campaignsDataTable.destroy();
  }

  const tbody = document.querySelector('#campaignsTable tbody');
  tbody.innerHTML = '';

  campaigns.forEach(c => {
    const row = document.createElement('tr');
    row.className = 'transition hover:bg-gray-50 dark:hover:bg-gray-900';
    row.innerHTML = `
      <td class="px-6 py-3 whitespace-nowrap text-theme-sm font-medium text-gray-700 dark:text-gray-400">${c.metaCampaign || '-'}</td>
      <td class="px-6 py-3 whitespace-nowrap text-theme-sm text-gray-500 dark:text-gray-400">${c.crmSource || '-'}</td>
      <td class="px-6 py-3 whitespace-nowrap text-theme-sm font-medium text-gray-700 dark:text-gray-400">${c.leads}</td>
      <td class="px-6 py-3 whitespace-nowrap text-theme-sm font-medium text-gray-700 dark:text-gray-400">${formatCurrency(c.spendWithVAT)}</td>
      <td class="px-6 py-3 whitespace-nowrap text-theme-sm text-warning-500 dark:text-warning-400">${formatCurrency(c.cpl)}</td>
    `;
    tbody.appendChild(row);
  });

  campaignsDataTable = $('#campaignsTable').DataTable({
    pageLength: 10,
    order: [[2, 'desc']],
    dom: 't<"flex items-center justify-between border-t border-gray-200 px-5 py-4 dark:border-gray-800"li>p',
    language: {
      search: "",
      lengthMenu: "Rodyti _MENU_ irašų",
      info: "Rodo _START_-_END_ iš _TOTAL_ irašų",
      infoEmpty: "Nerasta irašų",
      infoFiltered: "(atfiltruota iš _MAX_)",
      emptyTable: "Nerasta irašų",
      paginate: { first: "", last: "", next: "Kitas", previous: "Ankstesnis" }
    },
    drawCallback: function(settings) {
      customizeTableInfo.call(this, settings);
    }
  });

  $('#campaignsSearch').on('input', function() {
    campaignsDataTable.search(this.value).draw();
  });
}

async function loadPlanas(startDate, endDate) {
  try {
    const response = await fetch(`${API_BASE}/api/planas?startDate=${startDate}&endDate=${endDate}`);
    const data = await response.json();
    if (data.success && data.planas !== null) {
      document.getElementById('statPlanas').textContent = formatCurrency(data.planas);
    } else {
      document.getElementById('statPlanas').textContent = '-';
    }
  } catch (error) {
    document.getElementById('statPlanas').textContent = '-';
  }
  updateSpendProgressBar();
}

async function loadLeadsPlanas(startDate, endDate) {
  try {
    const response = await fetch(`${API_BASE}/api/leads-planas?startDate=${startDate}&endDate=${endDate}`);
    const data = await response.json();
    if (data.success && data.leadsPlanas !== null) {
      document.getElementById('statLeadsPlanas').textContent = data.leadsPlanas;
    } else {
      document.getElementById('statLeadsPlanas').textContent = '-';
    }
  } catch (error) {
    document.getElementById('statLeadsPlanas').textContent = '-';
  }
  updateLeadsProgressBar();
}

async function loadDebugData() {
  clearError('debugError');
  showLoading();

  try {
    const [profileRes, fieldsRes] = await Promise.all([
      fetch(`${API_BASE}/api/bitrix/debug/profile`),
      fetch(`${API_BASE}/api/bitrix/debug/fields`)
    ]);

    const profile = await profileRes.json();
    const fields = await fieldsRes.json();

    let html = '';

    html += buildDebugCard('Bitrix Profile', profile);
    html += buildDebugCard('Lead Fields', fields.fields, 'Lead fields define what data is available from Bitrix24.');
    html += buildDebugCard('Lead Statuses', fields.statuses, 'Statuses determine which leads are considered converted.');
    html += buildDebugCard('Sample Leads (first 3)', fields.sampleLeads, 'These are actual leads from your Bitrix24.');

    document.getElementById('debugContainer').innerHTML = html;

    document.querySelectorAll('.debug-header').forEach(header => {
      header.addEventListener('click', function() {
        const content = this.nextElementSibling;
        content.classList.toggle('visible');
        this.querySelector('.toggle-icon').textContent = content.classList.contains('visible') ? '[-]' : '[+]';
      });
    });

  } catch (error) {
    showError('debugError', `Error loading debug data: ${error.message}`);
  } finally {
    hideLoading();
  }
}

function buildDebugCard(title, data, description) {
  const id = 'debug-' + title.toLowerCase().replace(/[^a-z0-9]/g, '-');
  return `
    <div class="mb-4 overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <div class="debug-header flex cursor-pointer items-center justify-between bg-amber-100 px-5 py-3 font-semibold text-amber-900 hover:bg-amber-200">
        <span>[+] ${title}</span>
        <span class="toggle-icon">[+]</span>
      </div>
      <div class="debug-content hidden bg-gray-900 p-4 font-mono text-sm text-gray-400" id="${id}">
        ${description ? `<div class="mb-2 text-amber-400">${description}</div>\n` : ''}
        ${JSON.stringify(data, null, 2)}
      </div>
    </div>
  `;
}

document.addEventListener('DOMContentLoaded', () => {
  initDateDefaults();
  setTimeout(() => loadDashboard(), 300);
});
