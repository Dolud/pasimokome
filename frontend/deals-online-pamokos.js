let dealsDataTable = null;
let campaignsDataTable = null;
let dealsChart = null;
let revenueChart = null;
let flatpickrInstance = null;
let dailyChart = null;

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
    document.getElementById('statRoas').textContent = 'ROAS ' + data.stats.roas.toFixed(1) + 'x';
    updatePelnasCard(data.stats.totalPelnas);
    updateCampaignAnalysis(data.stats, data.campaignStats);

    document.getElementById('dealsCountBadge').textContent = data.dealTable.length;
    const totalSuma = data.dealTable.reduce((sum, d) => sum + (d.suma || 0), 0);
    document.getElementById('dealsSumaBadge').textContent = formatCurrency(totalSuma);

    populateDealsTable(data.dealTable);
    populateCampaignsTable(data.campaignStats);

    loadPlanas(dates.startDate, dates.endDate);
    loadDealsPlanas(dates.startDate, dates.endDate);
    loadConversionPrice(dates.startDate, dates.endDate);
    loadDailyChart(dates.startDate, dates.endDate);

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

let conversionPlan = 0;

async function loadConversionPrice(startDate, endDate) {
  try {
    const response = await fetch(`/api/online-pamokos/deals/conversion-price?startDate=${startDate}&endDate=${endDate}`);
    const data = await response.json();
    if (data.success && data.conversionPrice !== null) {
      conversionPlan = data.conversionPrice;
      document.getElementById('statSumaPlanas').textContent = formatCurrency(data.conversionPrice);
      updateSumaProgressBar();
    }
  } catch (error) {}
}

async function loadDailyChart(startDate, endDate) {
  try {
    const response = await fetch(`/api/online-pamokos/deals/daily?startDate=${startDate}&endDate=${endDate}`);
    const data = await response.json();
    if (data.success) {
      renderDailyChart(data);
    }
  } catch (error) {}
}

function formatChartDate(dateStr) {
  if (!dateStr) return '-';
  const parts = dateStr.split('-');
  if (parts.length < 3) return dateStr;
  return `${parts[0]} ${parts[1]} ${parts[2]}`;
}

function renderDailyChart(data) {
  const rangeEl = document.getElementById('dailyChartRange');
  const totalEl = document.getElementById('dailyChartTotal');
  const container = document.getElementById('dailyChart');
  if (!rangeEl || !totalEl || !container) return;

  if (data.labels && data.labels.length > 0) {
    rangeEl.textContent = `${formatChartDate(data.labels[0])} - ${formatChartDate(data.labels[data.labels.length - 1])}`;
  }
  totalEl.textContent = formatCurrency(data.totalSuma);

  if (typeof ApexCharts === 'undefined') return;

  if (dailyChart) dailyChart.destroy();

  const options = {
    series: [
      { name: 'Pardavimų suma', data: data.suma },
      { name: 'Išleista marketingui', data: data.spend }
    ],
    legend: { show: false },
    colors: ['#e15159', '#9CB9FF'],
    chart: {
      fontFamily: 'Inter, sans-serif',
      height: 310,
      type: 'area',
      toolbar: { show: false }
    },
    fill: {
      gradient: { enabled: true, opacityFrom: 0.55, opacityTo: 0 }
    },
    stroke: { curve: 'smooth', width: ['2', '2'] },
    markers: { size: 0 },
    grid: {
      xaxis: { lines: { show: false } },
      yaxis: { lines: { show: true } }
    },
    dataLabels: { enabled: false },
    tooltip: {
      x: { format: 'dd MMM yyyy' },
      y: {
        formatter: function(value) {
          return formatCurrency(value);
        }
      }
    },
    xaxis: {
      type: 'category',
      categories: data.labels.map(l => formatChartDate(l)),
      axisBorder: { show: false },
      axisTicks: { show: false },
      tooltip: { enabled: false },
      labels: { rotate: -45, rotateAlways: true, style: { fontSize: '11px' } }
    },
    yaxis: {
      title: { style: { fontSize: '0px' } },
      labels: {
        formatter: function(value) {
          return Math.round(value) + ' €';
        }
      }
    }
  };

  dailyChart = new ApexCharts(container, options);
  dailyChart.render();
}

function updateSumaProgressBar() {
  const bar = document.getElementById('sumaProgressBar');
  const sumaEl = document.getElementById('statSuma');
  const planasEl = document.getElementById('statSumaPlanas');
  if (!bar || !sumaEl || !planasEl) return;

  const suma = parseEuroAmount(sumaEl.textContent);
  const planas = parseEuroAmount(planasEl.textContent);
  const percent = planas > 0 ? Math.min((suma / planas) * 100, 100) : 0;

  bar.style.width = percent + '%';
  bar.style.backgroundColor = spendGradientColor(percent);
}

function campaignBrandIcon(campaign) {
  const name = (campaign.metaCampaign || '').toLowerCase();
  const src = (campaign.crmSource || '').toLowerCase();
  if (name.includes('google') || src.includes('google')) {
    return '/brand/brand-google.svg';
  }
  return '/brand/brand-facebook.svg';
}

function shortCampaignName(campaign) {
  let name = campaign.metaCampaign || campaign.crmSource || '-';
  name = name.replace(/\s*\(lead generation\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  return name || '-';
}

function updateCampaignAnalysis(stats, campaignStats) {
  const funded = (campaignStats || []).filter(c => (c.spendWithVAT || 0) > 0);

  const totalSpend = stats && stats.totalSpend != null ? stats.totalSpend : funded.reduce((s, c) => s + c.spendWithVAT, 0);
  const totalKiekis = stats && stats.totalKiekis != null ? stats.totalKiekis : funded.reduce((s, c) => s + c.kiekis, 0);
  const avgCPL = totalKiekis > 0 ? totalSpend / totalKiekis : 0;

  const avgCPLEl = document.getElementById('statAvgCPL');
  if (avgCPLEl) {
    avgCPLEl.textContent = totalKiekis > 0 ? formatCurrency(avgCPL) : '-';
    if (totalKiekis > 0) {
      avgCPLEl.style.color = avgCPL > conversionPlan ? '#f46565' : '';
    }
  }

  const cplPlanEl = document.getElementById('statAvgCPLPlan');
  if (cplPlanEl) {
    cplPlanEl.textContent = formatCurrency(conversionPlan);
  }

  updateCplProgressBar(avgCPL);

  const withCPL = funded.filter(c => (c.cpl || 0) > 0 && (c.kiekis || 0) > 0);
  const bestCpl = withCPL.length
    ? withCPL.reduce((a, b) => (a.cpl <= b.cpl ? a : b))
    : null;

  const withSuma = funded.filter(c => (c.suma || 0) > 0);
  const bestSuma = withSuma.length
    ? withSuma.reduce((a, b) => (a.suma >= b.suma ? a : b))
    : null;

  let worst = null;
  let worstScore = -Infinity;
  funded.forEach(c => {
    const hurt = (c.suma || 0) === 0 ? 1 : 0;
    const score = hurt * 1000 + (c.spendWithVAT || 0);
    const losArt = (c.pelnas || 0) < 0 ? -(c.pelnas || 0) : 0;
    const total = score + losArt;
    if (total > worstScore) {
      worstScore = total;
      worst = c;
    }
  });

  if (bestCpl) {
    document.getElementById('effIcon').src = campaignBrandIcon(bestCpl);
    document.getElementById('effIcon').alt = bestCpl.metaCampaign || 'kampanija';
    document.getElementById('effName').textContent = shortCampaignName(bestCpl);
    document.getElementById('effValue').textContent = formatCurrency(bestCpl.cpl);
    setAnalysisCount('effCount', bestCpl.kiekis);
  }

  if (bestSuma) {
    document.getElementById('salesIcon').src = campaignBrandIcon(bestSuma);
    document.getElementById('salesIcon').alt = bestSuma.metaCampaign || 'kampanija';
    document.getElementById('salesName').textContent = shortCampaignName(bestSuma);
    document.getElementById('salesValue').textContent = formatCurrency(bestSuma.suma);
    setAnalysisCount('salesCount', bestSuma.kiekis);
  }

  if (worst) {
    document.getElementById('worstIcon').src = campaignBrandIcon(worst);
    document.getElementById('worstIcon').alt = worst.metaCampaign || 'kampanija';
    document.getElementById('worstName').textContent = shortCampaignName(worst);
    document.getElementById('worstValue').textContent = formatCurrency(worst.spendWithVAT || 0);
    setAnalysisCount('worstCount', worst.kiekis);
  }
}

function setAnalysisCount(id, kiekis) {
  const el = document.getElementById(id);
  if (!el) return;
  const n = Number(kiekis || 0);
  el.textContent = n;
  if (n === 0) {
    el.classList.add('text-error-600', 'bg-error-50');
    el.classList.remove('text-success-600', 'bg-success-50');
  } else {
    el.classList.add('text-success-600', 'bg-success-50');
    el.classList.remove('text-error-600', 'bg-error-50');
  }
}

function updateCplProgressBar(avgCPL) {
  const bar = document.getElementById('cplProgressBar');
  if (!bar) return;
  const percent = conversionPlan > 0 ? Math.min((avgCPL / conversionPlan) * 100, 100) : 0;
  bar.style.width = percent + '%';
  bar.style.backgroundColor = avgCPL > conversionPlan ? '#f46565' : '#3AB493';
}

function updatePelnasCard(pelnas) {
  const iconBox = document.getElementById('pelnasIconBox');
  const icon = document.getElementById('pelnasIcon');
  const sumaEl = document.getElementById('statPelnas');
  const roasEl = document.getElementById('statRoas');
  const slashEl = document.getElementById('pelnasSlash');
  if (!iconBox || !icon || !sumaEl) return;

  const negative = pelnas < 0;
  if (negative) {
    iconBox.style.backgroundColor = '#f565650f';
    icon.classList.remove('text-success-500');
    icon.classList.add('text-error-500');
    icon.style.transform = 'scaleY(-1)';
    icon.style.color = '#f56565';
    sumaEl.style.color = '#f56565';
    if (roasEl) roasEl.style.display = 'none';
    if (slashEl) slashEl.style.display = 'none';
  } else {
    iconBox.style.backgroundColor = '';
    icon.classList.add('text-success-500');
    icon.classList.remove('text-error-500');
    icon.style.transform = '';
    icon.style.color = '';
    sumaEl.style.color = '#3AB493';
    if (roasEl) roasEl.style.display = '';
    if (slashEl) slashEl.style.display = '';
  }
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
