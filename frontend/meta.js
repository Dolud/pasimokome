let adsGrid = null;
let adsCampaignFilter = '';
let adsSort = 'tiksPriceAsc';
let adsSearchQuery = '';
let leadsDataTable = null;
let flatpickrInstance = null;

const STORAGE_KEY = 'meta_dates';

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
  if (val === null || val === undefined || isNaN(val)) return '-';
  return new Intl.NumberFormat('lt-LT', {
    style: 'currency', currency: 'EUR', minimumFractionDigits: 2
  }).format(val);
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
        loadMetaDashboard();
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

function thumbnailCell(thumbnail, adName) {
  if (!thumbnail) return '<div class="flex h-12 w-12 items-center justify-center rounded-lg bg-gray-100 text-theme-xs font-medium text-gray-400 dark:bg-gray-800">-</div>';
  return `<div class="flex items-center gap-3">
    <img src="${thumbnail}" alt="" class="thumb-img h-12 w-12 rounded-lg object-cover cursor-pointer" loading="lazy" data-full="${thumbnail}" data-name="${(adName || '').replace(/"/g, '&quot;')}">
  </div>`;
}

let thumbPop = null;
function ensureThumbPop() {
  if (thumbPop) return;
  thumbPop = document.createElement('img');
  thumbPop.className = 'thumb-pop';
  thumbPop.alt = '';
  thumbPop.style.display = 'none';
  document.body.appendChild(thumbPop);
}

function bindAdTextToggles(scope) {
  const run = () => {
    scope.querySelectorAll('.ad-text-wrap').forEach(wrap => {
      const p = wrap.querySelector('.ad-text');
      const btn = wrap.querySelector('.ad-text-toggle');
      if (!p || !btn) return;
      if (btn.dataset.bound) return;
      if (p.scrollHeight > p.clientHeight + 4) {
        btn.classList.remove('hidden');
        btn.addEventListener('click', function() {
          const expanded = p.classList.toggle('line-clamp-none');
          this.textContent = expanded ? 'Mažiau' : 'Daugiau';
          p.classList.toggle('line-clamp-4', !expanded);
        });
        btn.dataset.bound = '1';
      }
    });
  };
  run();
  requestAnimationFrame(() => setTimeout(run, 0));
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => setTimeout(run, 0));
  }
}

function bindThumbHover(scope) {  ensureThumbPop();
  const img = thumbPop;

  scope.querySelectorAll('.thumb-img').forEach(el => {
    el.addEventListener('mouseenter', function() {
      img.src = this.dataset.full;
      img.style.display = 'block';
      img.style.maxWidth = '320px';
      img.style.maxHeight = '320px';
      positionThumb(img);
      document.addEventListener('mousemove', positionThumb);
    });
    el.addEventListener('mouseleave', function() {
      img.style.display = 'none';
      document.removeEventListener('mousemove', positionThumb);
    });
  });
}

function positionThumb(e) {
  if (!thumbPop) return;
  const x = e.clientX;
  const y = e.clientY;
  const w = 320;
  const h = Math.min(320, thumbPop.naturalHeight || 320);
  let left = x + 20;
  let top = y - h - 10;
  if (left + w > window.innerWidth - 10) left = x - w - 20;
  if (top < 10) top = y + 20;
  if (top + h > window.innerHeight - 10) top = window.innerHeight - h - 10;
  thumbPop.style.left = left + 'px';
  thumbPop.style.top = top + 'px';
}

async function loadMetaDashboard() {
  const dates = getDateRange();

  clearError();
  showLoading();

  try {
    const [adsRes, leadsRes] = await Promise.all([
      fetch(`/api/meta/ads?startDate=${dates.startDate}&endDate=${dates.endDate}`),
      fetch(`/api/leads?startDate=${dates.startDate}&endDate=${dates.endDate}`)
    ]);

    const adsData = await adsRes.json();
    if (!adsData.success) throw new Error(adsData.error || 'Failed to load ads');

    const leadsData = await leadsRes.json();
    if (!leadsData.success) throw new Error(leadsData.error || 'Failed to load leads');

    _lastAdsForGrid = adsData.ads;
    _lastLeadsForGrid = leadsData;
    updateStats(adsData.totals, adsData.ads, leadsData);
    updateCampaignBreakdown(adsData.ads);
    populateAdsGrid(adsData.ads, leadsData);
    populateLeadsTable(leadsData, adsData.ads);

  } catch (error) {
    showError(`Error: ${error.message}`);
  } finally {
    hideLoading();
  }
}

function updateStats(totals, ads, leadsData) {
  document.getElementById('statSpend').textContent = formatCurrency(totals.spend);
  document.getElementById('statLeads').textContent = totals.leads || 0;
  document.getElementById('statCPL').textContent = totals.cpl !== null && totals.cpl !== undefined ? formatCurrency(totals.cpl) : '-';

  const activeAds = ads.filter(a => a.status === 'ACTIVE').length;
  document.getElementById('statActiveAds').textContent = activeAds;
}

function updateCampaignBreakdown(ads) {
  const container = document.getElementById('campaignBreakdown');
  container.innerHTML = '';

  const byCampaign = {};
  for (const a of ads) {
    if (!byCampaign[a.campaignName]) {
      byCampaign[a.campaignName] = { name: a.campaignName, spend: 0, leads: 0 };
    }
    byCampaign[a.campaignName].spend += a.spend;
    byCampaign[a.campaignName].leads += a.leads;
  }

  const entries = Object.values(byCampaign).sort((a, b) => b.spend - a.spend);

  if (entries.length === 0) {
    container.innerHTML = '<p class="col-span-full text-sm text-gray-500 dark:text-gray-400">Nerasta duomenų šiam laikotarpiui</p>';
    return;
  }

  for (const c of entries) {
    const cpl = c.leads > 0 ? formatCurrency(c.spend / c.leads) : '-';
    const card = document.createElement('div');
    card.className = 'rounded-xl border border-gray-200 p-4 dark:border-gray-800';
    card.innerHTML = `
      <p class="text-sm font-medium text-gray-700 dark:text-gray-300">${c.name || '-'}</p>
      <div class="mt-3 flex items-end justify-between">
        <div>
          <p class="text-theme-xs text-gray-500 dark:text-gray-400">Išleista</p>
          <p class="mt-1 text-lg font-bold text-gray-800 dark:text-white/90">${formatCurrency(c.spend)}</p>
        </div>
        <div class="text-right">
          <p class="text-theme-xs text-gray-500 dark:text-gray-400">Leadai</p>
          <p class="mt-1 text-lg font-bold text-gray-800 dark:text-white/90">${c.leads}</p>
        </div>
      </div>
      <div class="mt-3 border-t border-gray-100 pt-3 dark:border-gray-800">
        <p class="text-theme-xs text-gray-500 dark:text-gray-400">CPL</p>
        <p class="mt-1 text-sm font-semibold text-brand-600 dark:text-brand-400">${cpl}</p>
      </div>
    `;
    container.appendChild(card);
  }
}

function populateCampaignFilter(ads) {
  const select = document.getElementById('campaignFilter');
  const campaigns = [...new Set(ads.map(a => a.campaignName).filter(Boolean))].sort();
  const currentValue = select.value;
  select.innerHTML = '<option value="">Visi</option>' +
    campaigns.map(c => `<option value="${c.replace(/"/g, '&quot;')}">${c.replace(/"/g, '&quot;')}</option>`).join('');
  if ([...select.options].some(o => o.value === currentValue)) select.value = currentValue;
  else select.value = '';
  adsCampaignFilter = select.value;
}

function populateAdsGrid(ads, leadsData) {
  populateCampaignFilter(ads);

  const leads = (leadsData && leadsData.leads) || [];
  const tiksCountByAdId = new Map();
  leads.forEach(entry => {
    tiksCountByAdId.set(entry.adId, (tiksCountByAdId.get(entry.adId) || 0) + 1);
  });

  const grid = document.getElementById('adsGrid');
  grid.innerHTML = '';

  const filteredAds = ads.filter(a => {
    if (adsCampaignFilter && a.campaignName !== adsCampaignFilter) return false;
    if (adsSearchQuery && !((a.adName || '') + ' ' + (a.text || '')).toLowerCase().includes(adsSearchQuery.toLowerCase())) return false;
    return true;
  });

  const sortedAds = filteredAds.map(a => {
    const tiksLeads = tiksCountByAdId.get(a.adId) || 0;
    const tiksPrice = (tiksLeads > 0 && a.spend > 0) ? a.spend / tiksLeads : null;
    const metaPrice = (a.leads > 0 && a.spend > 0) ? a.spend / a.leads : null;
    return { ad: a, tiksLeads, tiksPrice, metaPrice };
  });

  const nullLast = (a, b) => {
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return 0;
  };

  switch (adsSort) {
    case 'metaPriceAsc':
      sortedAds.sort((x, y) => nullLast(x.metaPrice, y.metaPrice) || (x.metaPrice === null ? 0 : (x.metaPrice - y.metaPrice)));
      break;
    case 'tiksLeadsDesc':
      sortedAds.sort((x, y) => (y.tiksLeads - x.tiksLeads));
      break;
    case 'metaLeadsDesc':
      sortedAds.sort((x, y) => (y.ad.leads - x.ad.leads));
      break;
    case 'spendDesc':
      sortedAds.sort((x, y) => (y.ad.spend - x.ad.spend));
      break;
    case 'tiksPriceAsc':
    default:
      sortedAds.sort((x, y) => nullLast(x.tiksPrice, y.tiksPrice) || (x.tiksPrice === null ? 0 : (x.tiksPrice - y.tiksPrice)));
      break;
  }

  if (filteredAds.length === 0) {
    grid.innerHTML = '<p class="col-span-full text-sm text-gray-500 dark:text-gray-400">Nerasta duomenų šiam laikotarpiui</p>';
    return;
  }

  sortedAds.forEach(({ ad: a, tiksLeads, tiksPrice, metaPrice }) => {
    tiksPrice = tiksPrice !== null ? formatCurrency(tiksPrice) : '-';
    metaPrice = metaPrice !== null ? formatCurrency(metaPrice) : '-';
    const statusBadge = a.status === 'ACTIVE'
      ? `<span class="inline-flex items-center gap-1.5 rounded-full bg-success-50 px-2.5 py-1 text-theme-xs font-medium text-success-600 dark:bg-success-500/15 dark:text-success-500"><span class="h-1.5 w-1.5 rounded-full bg-success-600 dark:bg-success-500"></span>Aktyvus</span>`
      : `<span class="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-theme-xs font-medium text-gray-500 dark:bg-white/10 dark:text-gray-400"><span class="h-1.5 w-1.5 rounded-full bg-gray-400"></span>Neaktyvus</span>`;

    const preview = a.thumbnail
      ? `<div class="group relative aspect-square overflow-hidden bg-gray-100 dark:bg-gray-800"><img src="${a.thumbnail}" data-full="${a.thumbnail}" data-name="${(a.adName || '').replace(/"/g, '&quot;')}" alt="" loading="lazy" class="thumb-img h-full w-full object-cover cursor-pointer"></div>`
      : `<div class="flex aspect-square items-center justify-center bg-gray-100 text-theme-xs font-medium text-gray-400 dark:bg-gray-800">-</div>`;

    const text = a.text && !a.text.includes('{{')
      ? `<div class="ad-text-wrap">
          <p class="ad-text line-clamp-4 text-sm text-gray-700 dark:text-gray-300" title="${a.text.replace(/"/g, '&quot;')}">${escapeHtml(a.text)}</p>
          <button type="button" class="ad-text-toggle mt-1 hidden text-theme-xs font-medium text-brand-500 hover:underline dark:text-brand-400">Daugiau</button>
        </div>`
      : `<p class="line-clamp-2 text-sm text-gray-500 dark:text-gray-400 italic">Nėra skelbimo teksto</p>`;

    const card = document.createElement('div');
    card.className = 'flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white transition hover:shadow-lg dark:border-gray-800 dark:bg-white/[0.03]';
    card.innerHTML = `
      <div class="relative">${preview}
        <div class="absolute top-2 right-2">${statusBadge}</div>
      </div>
      <div class="flex flex-1 flex-col p-4">
        <p class="mb-3 text-theme-sm font-semibold text-gray-800 dark:text-white/90" title="${(a.adName || '').replace(/"/g, '&quot;')}">${a.adName || '-'}</p>
        ${text}
        <div class="mt-auto pt-4">
          <div class="mb-3 flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-800/60">
            <span class="text-theme-xs text-gray-500 dark:text-gray-400">Išleista</span>
            <span class="text-theme-sm font-semibold text-gray-800 dark:text-white/90">${formatCurrency(a.spend)}</span>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <p class="text-theme-xs text-gray-500 dark:text-gray-400">Užklausos</p>
              <p class="mt-1 text-theme-sm font-semibold text-gray-800 dark:text-white/90">${a.leads}</p>
            </div>
            <div>
              <p class="text-theme-xs text-gray-500 dark:text-gray-400">Tiksl. užklausos</p>
              <p class="mt-1 text-theme-sm font-semibold text-gray-800 dark:text-white/90">${tiksLeads}</p>
            </div>
            <div>
              <p class="text-theme-xs text-gray-500 dark:text-gray-400">Užklausos kaina</p>
              <p class="mt-1 text-theme-sm font-semibold text-warning-500 dark:text-warning-400">${metaPrice}</p>
            </div>
            <div>
              <p class="text-theme-xs text-gray-500 dark:text-gray-400">Kaina tiksl. užkl.</p>
              <p class="mt-1 text-theme-sm font-semibold text-success-600 dark:text-success-500">${tiksPrice}</p>
            </div>
          </div>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });

  bindThumbHover(grid);
  bindAdTextToggles(grid);
}

function statusBadge(status) {
  if (!status) return '<span class="bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-400 rounded-full px-2.5 py-1 text-theme-xs font-medium">-</span>';
  const semantic = status.semanticId;
  if (semantic === 'S') {
    return `<span class="bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-500 rounded-full px-2.5 py-1 text-theme-xs font-medium cursor-help" title="${(status.statusId || '').replace(/"/g, '&quot;')}">${status.statusName || 'Sėkmė'}</span>`;
  }
  if (semantic === 'P') {
    return `<span class="bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-warning-500 rounded-full px-2.5 py-1 text-theme-xs font-medium cursor-help" title="${(status.statusId || '').replace(/"/g, '&quot;')}">${status.statusName || 'Vykdoma'}</span>`;
  }
  if (semantic === 'F') {
    return `<span class="bg-error-50 text-error-600 dark:bg-error-500/15 dark:text-error-500 rounded-full px-2.5 py-1 text-theme-xs font-medium cursor-help" title="${(status.statusId || '').replace(/"/g, '&quot;')}">${status.statusName || 'Nepavyko'}</span>`;
  }
  return `<span class="bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-400 rounded-full px-2.5 py-1 text-theme-xs font-medium">${status.statusName || '-'}</span>`;
}

function populateLeadsTable(leadsData, ads) {
  if (leadsDataTable) leadsDataTable.destroy();

  const tbody = document.querySelector('#leadsTable tbody');
  tbody.innerHTML = '';

  const spendByAdId = new Map((ads || []).map(a => [a.adId, a.spend]));
  const leads = leadsData.leads || [];

  const displayedCountByAdId = new Map();
  leads.forEach(entry => {
    displayedCountByAdId.set(entry.adId, (displayedCountByAdId.get(entry.adId) || 0) + 1);
  });

  function computeLeadCost(entry) {
    if (!spendByAdId.has(entry.adId)) return null;
    const spend = spendByAdId.get(entry.adId);
    const count = displayedCountByAdId.get(entry.adId) || 0;
    if (count === 0 || spend === null || spend === undefined) return null;
    return +(spend / count).toFixed(2);
  }

  document.getElementById('leadsCountBadge').textContent = leads.length;
  document.getElementById('matchedCountBadge').textContent = leadsData.displayedCount + ' / ' + (leadsData.matchedCount || 0);

  leads.forEach(entry => {
    const row = document.createElement('tr');
    row.className = 'transition hover:bg-gray-50 dark:hover:bg-gray-900';
    const f = entry.fields || {};
    const leadName = f.fullName || (entry.bitrixContact && entry.bitrixContact.name) || '-';
    const leadCost = computeLeadCost(entry);
    row.innerHTML = `
      <td class="px-6 py-3 whitespace-nowrap">${thumbnailCell(entry.thumbnail, entry.adName)}</td>
      <td class="px-6 py-3 whitespace-nowrap text-theme-sm font-medium text-gray-700 dark:text-gray-400 max-w-[240px] truncate" title="${(entry.adName || '').replace(/"/g, '&quot;')}">${entry.adName || '-'}</td>
      <td class="px-6 py-3 whitespace-nowrap text-theme-sm text-gray-500 dark:text-gray-400">${entry.campaignName || '-'}</td>
      <td class="px-6 py-3 whitespace-nowrap">
        <span class="text-theme-sm font-medium text-gray-700 dark:text-gray-400">${leadName}</span>
        ${f.email || f.phone ? `<span class="block text-theme-xs text-gray-500 dark:text-gray-400">${f.email || ''}${f.email && f.phone ? ' · ' : ''}${f.phone || ''}</span>` : ''}
      </td>
      <td class="px-6 py-3 whitespace-nowrap">${statusBadge(entry.status)}</td>
      <td class="px-6 py-3 whitespace-nowrap text-theme-sm ${leadCost !== null && leadCost !== undefined ? 'font-medium text-warning-500 dark:text-warning-400' : 'text-gray-400 dark:text-gray-600'}">${leadCost !== null && leadCost !== undefined ? formatCurrency(leadCost) : '-'}</td>
      <td class="px-6 py-3 whitespace-nowrap text-theme-sm text-gray-500 dark:text-gray-400">${formatDate(entry.createdTime)}</td>
    `;
    tbody.appendChild(row);
  });

  leadsDataTable = $('#leadsTable').DataTable({
    pageLength: 10,
    order: [[6, 'desc']],
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
      bindThumbHover(this.api().table().container());
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

  $('#leadsSearch').on('input', function() {
    leadsDataTable.search(this.value).draw();
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
  loadMetaDashboard();
}

document.addEventListener('DOMContentLoaded', () => {
  initDateDefaults();
  setTimeout(() => loadMetaDashboard(), 300);
  document.getElementById('selectRangeBtn').addEventListener('click', select7DayRange);
  document.getElementById('refreshBtn').addEventListener('click', loadMetaDashboard);
  document.getElementById('campaignFilter').addEventListener('change', (e) => {
    adsCampaignFilter = e.target.value;
    reRenderAdsGrid();
  });
  document.getElementById('adsSort').addEventListener('change', (e) => {
    adsSort = e.target.value;
    reRenderAdsGrid();
  });
  document.getElementById('adsSearch').addEventListener('input', (e) => {
    adsSearchQuery = e.target.value;
    reRenderAdsGrid();
  });
});

let _lastAdsForGrid = null;
let _lastLeadsForGrid = null;

function reRenderAdsGrid() {
  if (_lastAdsForGrid) populateAdsGrid(_lastAdsForGrid, _lastLeadsForGrid);
}
