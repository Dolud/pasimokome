let dealsDataTable = null;
let campaignsDataTable = null;
let flatpickrInstance = null;

const STORAGE_KEY = 'online_pamokos_deals_dates';

function showLoading() {
  document.getElementById('loadingOverlay').classList.add('active');
}

function hideLoading() {
  document.getElementById('loadingOverlay').classList.remove('active');
}

function showError(message) {
  document.getElementById('errorContainer').innerHTML =
    `<div class="mb-4 rounded-lg bg-red-50 text-red-600 p-4 border border-red-200">${message}</div>`;
}

function clearError() {
  document.getElementById('errorContainer').innerHTML = '';
}

function formatCurrency(val) {
  if (val === null || val === undefined) return '-';
  return new Intl.NumberFormat('lt-LT', {
    style: 'currency', currency: 'EUR', minimumFractionDigits: 2
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
        loadDealsDashboard();
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

async function loadDealsDashboard() {
  const dates = getDateRange();

  clearError();
  showLoading();

  try {
    const response = await fetch(
      `/api/online-pamokos/deals?startDate=${dates.startDate}&endDate=${dates.endDate}`
    );
    const data = await response.json();

    if (!data.success) throw new Error(data.error || 'Failed to load');

    document.getElementById('statSpend').textContent = formatCurrency(data.stats.totalSpend);
    document.getElementById('statKiekis').textContent = data.stats.totalKiekis;
    document.getElementById('statSuma').textContent = formatCurrency(data.stats.totalSuma);
    document.getElementById('statPelnas').textContent = formatCurrency(data.stats.totalPelnas);
    document.getElementById('statCPL').textContent = formatCurrency(data.stats.averageCPL);
    document.getElementById('statCampaigns').textContent = data.stats.totalCampaigns;

    document.getElementById('dealsCountBadge').textContent = data.dealTable.length;
    const totalSuma = data.dealTable.reduce((sum, d) => sum + (d.suma || 0), 0);
    document.getElementById('dealsSumaBadge').textContent = formatCurrency(totalSuma);

    populateDealsTable(data.dealTable);
    populateCampaignsTable(data.campaignStats);

    loadPlanas(dates.startDate, dates.endDate);
    loadDealsPlanas(dates.startDate, dates.endDate);

  } catch (error) {
    showError(`Error: ${error.message}`);
  } finally {
    hideLoading();
  }
}

async function loadPlanas(startDate, endDate) {
  try {
    const response = await fetch(`/api/online-pamokos/deals/planas?startDate=${startDate}&endDate=${endDate}`);
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

async function loadDealsPlanas(startDate, endDate) {
  try {
    const response = await fetch(`/api/online-pamokos/deals/planas-kiekis?startDate=${startDate}&endDate=${endDate}`);
    const data = await response.json();
    if (data.success && data.planas !== null) {
      document.getElementById('statDealsPlanas').textContent = data.planas;
    } else {
      document.getElementById('statDealsPlanas').textContent = '-';
    }
  } catch (error) {
    document.getElementById('statDealsPlanas').textContent = '-';
  }
  updateDealsProgressBar();
}

function populateDealsTable(deals) {
  if (dealsDataTable) dealsDataTable.destroy();

  const tbody = document.querySelector('#dealsTable tbody');
  tbody.innerHTML = '';

  deals.forEach(deal => {
    const row = document.createElement('tr');
    row.className = 'transition hover:bg-gray-50 dark:hover:bg-gray-900';
    row.innerHTML = `
      <td class="px-6 py-3 whitespace-nowrap text-theme-sm font-medium text-gray-700 dark:text-gray-400"><a href="${deal.url}" target="_blank" class="hover:text-brand-500 dark:hover:text-brand-400 hover:underline">${deal.title || '-'}</a></td>
      <td class="px-6 py-3 whitespace-nowrap text-theme-sm text-gray-500 dark:text-gray-400">${deal.source || '-'}</td>
      <td class="px-6 py-3 whitespace-nowrap text-theme-sm text-gray-500 dark:text-gray-400">${formatDate(deal.date)}</td>
      <td class="px-6 py-3 whitespace-nowrap text-theme-sm font-medium text-gray-700 dark:text-gray-400">${formatCurrency(deal.suma)}</td>
    `;
    tbody.appendChild(row);
  });

  dealsDataTable = $('#dealsTable').DataTable({
    pageLength: 10,
    order: [[3, 'desc']],
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
      var api = this.api();
      var info = api.page.info();
      var wrapper = $(this).closest('.dataTables_wrapper');
      wrapper.find('.dataTables_length').hide();
      wrapper.find('.dataTables_info').html(
        'Rodyti <select id="pageLength_' + settings.sTableId + '" class="mx-1.5 inline-block rounded-lg border border-gray-300 bg-white py-1 px-2 text-sm font-medium text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">' +
        '<option value="10"' + (info.length === 10 ? ' selected' : '') + '>10</option>' +
        '<option value="25"' + (info.length === 25 ? ' selected' : '') + '>25</option>' +
        '<option value="50"' + (info.length === 50 ? ' selected' : '') + '>50</option>' +
        '<option value="-1"' + (info.length === -1 ? ' selected' : '') + '>Visos</option>' +
        '</select> irašų iš ' + info.recordsTotal + ' irašų'
      );
      document.getElementById('pageLength_' + settings.sTableId).addEventListener('change', function() {
        api.page.len(this.value).draw();
      });
      var paginate = wrapper.find('.dataTables_paginate');
      wrapper.find('.dataTables_info').parent().append(paginate);
    }
  });

  $('#dealsSearch').on('input', function() {
    dealsDataTable.search(this.value).draw();
  });
}

function populateCampaignsTable(campaigns) {
  if (campaignsDataTable) campaignsDataTable.destroy();

  const tbody = document.querySelector('#campaignsTable tbody');
  tbody.innerHTML = '';

  campaigns.forEach(c => {
    const row = document.createElement('tr');
    row.className = 'transition hover:bg-gray-50 dark:hover:bg-gray-900';
    row.innerHTML = `
      <td class="px-6 py-3 whitespace-nowrap text-theme-sm font-medium text-gray-700 dark:text-gray-400">${c.metaCampaign || '-'}</td>
      <td class="px-6 py-3 whitespace-nowrap text-theme-sm text-gray-500 dark:text-gray-400">${c.crmSource || '-'}</td>
      <td class="px-6 py-3 whitespace-nowrap text-theme-sm font-medium text-gray-700 dark:text-gray-400">${c.kiekis}</td>
      <td class="px-6 py-3 whitespace-nowrap text-theme-sm font-medium text-gray-700 dark:text-gray-400">${formatCurrency(c.spendWithVAT)}</td>
      <td class="px-6 py-3 whitespace-nowrap text-theme-sm text-warning-500 dark:text-warning-400">${formatCurrency(c.cpl)}</td>
      <td class="px-6 py-3 whitespace-nowrap text-theme-sm text-purple-500 dark:text-purple-400">${formatCurrency(c.suma)}</td>
      <td class="px-6 py-3 whitespace-nowrap text-theme-sm ${c.pelnas >= 0 ? 'font-medium text-success-500' : 'font-medium text-error-500'}">${formatCurrency(c.pelnas)}</td>
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
      var api = this.api();
      var info = api.page.info();
      var wrapper = $(this).closest('.dataTables_wrapper');
      wrapper.find('.dataTables_length').hide();
      wrapper.find('.dataTables_info').html(
        'Rodyti <select id="pageLength_' + settings.sTableId + '" class="mx-1.5 inline-block rounded-lg border border-gray-300 bg-white py-1 px-2 text-sm font-medium text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">' +
        '<option value="10"' + (info.length === 10 ? ' selected' : '') + '>10</option>' +
        '<option value="25"' + (info.length === 25 ? ' selected' : '') + '>25</option>' +
        '<option value="50"' + (info.length === 50 ? ' selected' : '') + '>50</option>' +
        '<option value="-1"' + (info.length === -1 ? ' selected' : '') + '>Visos</option>' +
        '</select> irašų iš ' + info.recordsTotal + ' irašų'
      );
      document.getElementById('pageLength_' + settings.sTableId).addEventListener('change', function() {
        api.page.len(this.value).draw();
      });
      var paginate = wrapper.find('.dataTables_paginate');
      wrapper.find('.dataTables_info').parent().append(paginate);
    }
  });

  $('#campaignsSearch').on('input', function() {
    campaignsDataTable.search(this.value).draw();
  });
}

function select7DayRange() {
  const today = new Date();
  const endDate = new Date(today);
  endDate.setDate(today.getDate() - 7);
  const startDate = new Date(endDate);
  startDate.setDate(endDate.getDate() - 6);

  flatpickrInstance.setDate([startDate, endDate]);
  saveDates([startDate, endDate]);
  loadDealsDashboard();
}

document.addEventListener('DOMContentLoaded', () => {
  initDateDefaults();
  setTimeout(() => loadDealsDashboard(), 300);
  document.getElementById('selectRangeBtn').addEventListener('click', select7DayRange);
});
