let spendSumaChartInstance = null;
let pelnasChartInstance = null;

const CHART_COLORS = [
  '#2563eb',
  '#16a34a',
  '#d97706',
  '#dc2626',
  '#8b5cf6',
  '#06b6d4',
  '#f59e0b',
  '#ef4444'
];

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.substring(0, 2), 16),
    g: parseInt(clean.substring(2, 4), 16),
    b: parseInt(clean.substring(4, 6), 16)
  };
}

function mixColor(colorA, colorB, t) {
  const a = hexToRgb(colorA);
  const b = hexToRgb(colorB);
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bl = Math.round(a.b + (b.b - a.b) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

const SPEND_GRADIENT_STOPS = [
  { percent: 0, color: '#FD1D1D' },
  { percent: 50, color: '#FCB045' },
  { percent: 100, color: '#3AB493' }
];

const LEADS_GRADIENT_STOPS = [
  { percent: 0, color: '#FD1D1D' },
  { percent: 50, color: '#FCB045' },
  { percent: 100, color: '#3AB493' }
];

function gradientColor(percent, stops) {
  if (percent <= stops[0].percent) return stops[0].color;
  if (percent >= stops[stops.length - 1].percent) return stops[stops.length - 1].color;

  for (let i = 0; i < stops.length - 1; i++) {
    const from = stops[i];
    const to = stops[i + 1];
    if (percent <= to.percent) {
      const t = (percent - from.percent) / (to.percent - from.percent);
      return mixColor(from.color, to.color, t);
    }
  }
  return stops[stops.length - 1].color;
}

function spendGradientColor(percent) {
  return gradientColor(percent, SPEND_GRADIENT_STOPS);
}

function leadsGradientColor(percent) {
  return gradientColor(percent, LEADS_GRADIENT_STOPS);
}

function parseEuroAmount(text) {
  if (!text || text === '-' || text === '') return 0;
  const normalized = String(text).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const num = parseFloat(normalized);
  return isNaN(num) ? 0 : num;
}

function updateSpendProgressBar() {
  const bar = document.getElementById('spendProgressBar');
  const spendEl = document.getElementById('statSpend');
  const planasEl = document.getElementById('statPlanas');
  if (!bar || !spendEl || !planasEl) return;

  const spend = parseEuroAmount(spendEl.textContent);
  const planas = parseEuroAmount(planasEl.textContent);
  const percent = planas > 0 ? Math.min((spend / planas) * 100, 100) : 0;

  bar.style.width = percent + '%';
  bar.style.backgroundColor = spendGradientColor(percent);
}

function updateLeadsProgressBar() {
  const bar = document.getElementById('leadsProgressBar');
  const leadsEl = document.getElementById('statLeads');
  const planasEl = document.getElementById('statLeadsPlanas');
  if (!bar || !leadsEl || !planasEl) return;

  const leads = parseEuroAmount(leadsEl.textContent);
  const planas = parseEuroAmount(planasEl.textContent);
  const percent = planas > 0 ? Math.min((leads / planas) * 100, 100) : 0;

  bar.style.width = percent + '%';
  bar.style.backgroundColor = leadsGradientColor(percent);
}

function updateDealsProgressBar() {
  const bar = document.getElementById('dealsProgressBar');
  const dealsEl = document.getElementById('statKiekis');
  const planasEl = document.getElementById('statDealsPlanas');
  if (!bar || !dealsEl || !planasEl) return;

  const deals = parseEuroAmount(dealsEl.textContent);
  const planas = parseEuroAmount(planasEl.textContent);
  const percent = planas > 0 ? Math.min((deals / planas) * 100, 100) : 0;

  bar.style.width = percent + '%';
  bar.style.backgroundColor = leadsGradientColor(percent);
}

function customizeTableInfo(settings) {
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

function renderSpendSumaChart(campaigns) {
  const canvas = document.getElementById('spendSumaChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  if (spendSumaChartInstance) {
    spendSumaChartInstance.destroy();
  }

  const labels = campaigns.map(c => c.metaCampaign);

  spendSumaChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Isleista (EUR)',
          data: campaigns.map(c => c.spendWithVAT),
          backgroundColor: '#dc2626',
          borderRadius: 6
        },
        {
          label: 'Suma (EUR)',
          data: campaigns.map(c => c.suma),
          backgroundColor: '#2563eb',
          borderRadius: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        tooltip: {
          callbacks: {
            label: function(context) {
              return context.dataset.label + ': ' + new Intl.NumberFormat('lt-LT', {
                style: 'currency', currency: 'EUR'
              }).format(context.raw);
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: val => val + ' EUR' }
        },
        x: {
          ticks: { maxRotation: 45, font: { size: 11 } }
        }
      }
    }
  });
}

function renderPelnasChart(campaigns) {
  const canvas = document.getElementById('pelnasChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  if (pelnasChartInstance) {
    pelnasChartInstance.destroy();
  }

  const labels = campaigns.map(c => c.metaCampaign);
  const data = campaigns.map(c => c.pelnas);
  const colors = data.map(v => v >= 0 ? '#16a34a' : '#dc2626');

  pelnasChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Pelnas (EUR)',
        data,
        backgroundColor: colors,
        borderRadius: 6,
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(context) {
              return new Intl.NumberFormat('lt-LT', {
                style: 'currency', currency: 'EUR'
              }).format(context.raw);
            }
          }
        }
      },
      scales: {
        y: {
          ticks: { callback: val => val + ' EUR' }
        },
        x: {
          ticks: { maxRotation: 45, font: { size: 11 } }
        }
      }
    }
  });
}
