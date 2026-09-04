const path = require('path');
const { loadSettings } = require('./settings');
loadSettings();
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

const { getProfile, getLeadFields, getStatusList, getSourceStatusMap, getAllLeads, bitrixRequest, getContactSourceStatusMap, getContactsByIds } = require('./bitrix');
const { getNormalizedCampaigns, getDailyCampaignData, getLeads, getAdLevelInsights, prewarmAdImages, normalizeCampaignName, ONLINE_PAMOKOS_CAMPAIGNS } = require('./meta');
const { getNormalizedCampaigns: getGoogleAdsCampaigns, getDailyCampaignData: getGoogleAdsDailyCampaignData, normalizeGoogleAdsCampaign, resetOAuth2Client } = require('./googleAds');
const { buildDashboard, buildGoogleAdsRows } = require('./dashboard');
const { matchSource, getAllowedSources } = require('./sourceMatcher');
const { calculateSpendWithVAT, calculateCPL } = require('./calculations');
const { getPlanasAmount, getLeadsPlanasAmount, getOnlinePamokosPlanasAmount, getOnlinePamokosLeadsPlanasAmount, getStovyklaDealsCountPlanasAmount, getOnlinePamokosDealsCountPlanasAmount, getStovyklaSumaAmount, getMonthSheetName, getDaysInRange, getOnlinePamokosMonthData, resetSheetsClient } = require('./googleSheets');
const { worker: adImageWorker } = require('./adImageWorker');
const { getBudgetField, getBudgets, saveBudgets } = require('./onlinePamokosBudgets');

const app = express();
app.set('trust proxy', true);
const PORT = process.env.PORT || 3000;

const dealBundleCache = new Map();
const DEAL_BUNDLE_CACHE_TTL = 2 * 60 * 1000;

async function getDealBundleCached(startDate, endDate) {
  const key = `${startDate}|${endDate}`;
  const cached = dealBundleCache.get(key);
  if (cached && Date.now() - cached.ts < DEAL_BUNDLE_CACHE_TTL) {
    return cached.value;
  }
  const value = await buildStovyklaDealTable(startDate, endDate);
  dealBundleCache.set(key, { ts: Date.now(), value });
  return value;
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));
app.use('/cache', express.static(path.join(__dirname, '../cache')));

const DEAL_SOURCE_ENTITY = 'DEAL_SOURCE';

async function getDealSourceStatusMap() {
  const result = await bitrixRequest('crm.status.list', { ENTITY_ID: DEAL_SOURCE_ENTITY });
  const statuses = result.result || [];
  const map = {};
  statuses.forEach(s => {
    if (s.STATUS_ID && s.NAME && s.ENTITY_ID === 'SOURCE') {
      map[s.STATUS_ID] = s.NAME;
    }
  });
  return map;
}

async function getAllDeals(filter = {}, select = []) {
  const allDeals = [];
  let start = 0;
  const batchSize = 50;

  while (true) {
    const params = {
      order: { DATE_CREATE: 'DESC' },
      filter,
      start,
    };
    if (select.length > 0) {
      params.select = select;
    }

    const result = await bitrixRequest('crm.deal.list', params);
    const items = result.result || [];
    allDeals.push(...items);

    if (items.length < batchSize || !result.next) {
      break;
    }
    start += batchSize;
  }

  return allDeals;
}

function resolveDealSource(deal, sourceStatusMap) {
  const sourceId = deal.SOURCE_ID || '';
  const sourceDescription = deal.SOURCE_DESCRIPTION || '';

  if (sourceDescription) return sourceDescription;
  if (sourceId && sourceStatusMap[sourceId]) return sourceStatusMap[sourceId];
  return sourceId;
}

function resolveContactSource(deal, contactsMap, contactSourceMap) {
  const contactId = deal.CONTACT_ID;
  if (!contactId) return '';
  const contact = contactsMap[contactId];
  if (!contact) return '';
  const sourceId = contact.SOURCE_ID || '';
  const sourceDescription = contact.SOURCE_DESCRIPTION || '';

  if (sourceDescription) return sourceDescription;
  if (sourceId && contactSourceMap[sourceId]) return contactSourceMap[sourceId];
  return sourceId;
}

async function getAllDealsForProductWindow(startDate, endDate, produktasId) {
  const from = new Date(startDate + 'T00:00:00');
  from.setDate(from.getDate() - 5);
  const to = new Date(endDate + 'T00:00:00');
  to.setDate(to.getDate() + 5);
  const fromKey = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`;
  const toKey = `${to.getFullYear()}-${String(to.getMonth() + 1).padStart(2, '0')}-${String(to.getDate()).padStart(2, '0')}`;

  return getAllDeals({
    '>=DATE_CREATE': fromKey,
    '<=DATE_CREATE': toKey + ' 23:59:59',
    'UF_CRM_612F8D8B4766B': produktasId
  }, ['ID', 'CONTACT_ID', 'OPPORTUNITY', 'DATE_CREATE', 'STAGE_ID', 'TITLE']);
}

function calculateContactDealSuma(deal, allDealsByContact) {
  const contactId = deal.CONTACT_ID;
  if (!contactId) return parseFloat(deal.OPPORTUNITY || 0);

  const contactDeals = allDealsByContact[contactId];
  if (!contactDeals || contactDeals.length <= 1) return parseFloat(deal.OPPORTUNITY || 0);

  const wonDate = new Date(deal.DATE_CREATE);
  const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;

  const relatedDeals = contactDeals.filter(d => {
    const dDate = new Date(d.DATE_CREATE);
    const diff = Math.abs(dDate - wonDate);
    return diff <= FIVE_DAYS_MS;
  });

  const total = relatedDeals.reduce((sum, d) => sum + parseFloat(d.OPPORTUNITY || 0), 0);
  return total;
}

const DEAL_SELECT_FIELDS = [
  'ID', 'TITLE', 'SOURCE_ID', 'SOURCE_DESCRIPTION', 'DATE_CREATE',
  'STAGE_ID', 'OPPORTUNITY', 'CURRENCY_ID', 'CATEGORY_ID', 'CONTACT_ID',
  'UF_CRM_1591169755663', 'UF_CRM_612F8D8B4766B'
];

const DEAL_WON_STAGES = ['WON', 'C3:WON', 'C5:WON'];

const DEAL_STOVYKLOS_PRODUKTAS_ID = '125';

async function buildStovyklaDealTable(startDate, endDate) {
  const dealFilter = {
    '>=DATE_CREATE': startDate,
    '<=DATE_CREATE': endDate + ' 23:59:59',
    'UF_CRM_612F8D8B4766B': DEAL_STOVYKLOS_PRODUKTAS_ID,
    STAGE_ID: DEAL_WON_STAGES
  };

  const [deals, dealSourceMap, contactSourceMap, windowDeals] = await Promise.all([
    getAllDeals(dealFilter, DEAL_SELECT_FIELDS),
    getDealSourceStatusMap(),
    getContactSourceStatusMap(),
    getAllDealsForProductWindow(startDate, endDate, DEAL_STOVYKLOS_PRODUKTAS_ID)
  ]);

  const allDealsByContact = {};
  windowDeals.forEach(deal => {
    const key = String(deal.CONTACT_ID);
    if (!allDealsByContact[key]) allDealsByContact[key] = [];
    allDealsByContact[key].push(deal);
  });

  const dealsWithEmptySource = deals.filter(d => !resolveDealSource(d, dealSourceMap));
  const contactIds = [...new Set(dealsWithEmptySource.map(d => d.CONTACT_ID).filter(Boolean))];
  const contactsMap = await getContactsByIds(contactIds);

  const dealTableMap = {};
  deals.forEach(deal => {
    const cid = deal.CONTACT_ID || deal.ID;
    if (!dealTableMap[cid]) {
      const source = resolveDealSource(deal, dealSourceMap) || resolveContactSource(deal, contactsMap, contactSourceMap);
      const totalSuma = calculateContactDealSuma(deal, allDealsByContact);
      dealTableMap[cid] = {
        id: deal.ID,
        title: deal.TITLE || '',
        source,
        date: deal.DATE_CREATE,
        suma: totalSuma,
        url: `https://pasimokome.bitrix24.com/crm/deal/details/${deal.ID}/`
      };
    }
  });

  return {
    dealTable: Object.values(dealTableMap),
    deals,
    dealSourceMap,
    contactSourceMap,
    contactsMap,
    allDealsByContact
  };
}
const LEAD_STOVYKLOS_PRODUKTAS_ID = '101';
const LEAD_ONLINE_PAMOKOS_PRODUKTAS_ID = '97';
const DEAL_ONLINE_PAMOKOS_PRODUKTAS_ID = '121';

app.get('/api/bitrix/debug/profile', async (req, res) => {
  try {
    const profile = await getProfile();
    res.json({ success: true, data: profile });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/bitrix/debug/fields', async (req, res) => {
  try {
    const fields = await getLeadFields();
    const statuses = await getStatusList();

    let sampleLeads = [];
    try {
      const sampleFilter = { '>=DATE_CREATE': '2026-07-01', '<=DATE_CREATE': '2026-07-31 23:59:59' };
      const leads = await getAllLeads(sampleFilter, []);
      sampleLeads = leads.slice(0, 3);
    } catch (e) {
      sampleLeads = [{ error: e.message }];
    }

    res.json({
      success: true,
      fields: fields.result || fields,
      statuses: statuses.result || statuses,
      sampleLeads
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/meta/campaigns', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'startDate and endDate are required' });
    }

    const campaigns = await getNormalizedCampaigns(startDate, endDate);
    res.json({ success: true, campaigns });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

const adInsightsCache = new Map();
const AD_INSIGHTS_CACHE_TTL = 5 * 60 * 1000;

adImageWorker.onBatchComplete = () => {
  adInsightsCache.clear();
  if (typeof leadBundleCache !== 'undefined' && leadBundleCache) leadBundleCache.clear();
  if (typeof dealBundleCache !== 'undefined' && dealBundleCache) dealBundleCache.clear();
};

app.get('/api/meta/ads', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'startDate and endDate are required' });
    }
    const key = `${startDate}|${endDate}`;
    const cached = adInsightsCache.get(key);
    if (cached && Date.now() - cached.ts < AD_INSIGHTS_CACHE_TTL) {
      return res.json({ success: true, ads: cached.ads, totals: cached.totals });
    }
    const ads = await getAdLevelInsights(startDate, endDate);

    const totals = {
      spend: +(ads.reduce((s, a) => s + a.spend, 0)).toFixed(2),
      leads: ads.reduce((s, a) => s + a.leads, 0),
      cpl: null
    };
    totals.cpl = totals.leads > 0 ? +(totals.spend / totals.leads).toFixed(2) : null;

    adInsightsCache.set(key, { ts: Date.now(), ads, totals });

    res.json({ success: true, ads, totals });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

const leadBundleCache = new Map();
const LEAD_BUNDLE_CACHE_TTL = 5 * 60 * 1000;

function normalizeContactValue(s) {
  return (s || '').toLowerCase().trim().replace(/^\+?\s*/, '').replace(/[\s\-()]/g, '');
}

function normalizeName(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

function pickClosestLead(linkedLeads, createdTime) {
  if (!linkedLeads || !linkedLeads.length) return null;
  const t = new Date(createdTime).getTime();
  let best = linkedLeads[0];
  let bestDiff = Infinity;
  for (const l of linkedLeads) {
    const diff = Math.abs(new Date(l.DATE_CREATE).getTime() - t);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = l;
    }
  }
  return best;
}

async function getLeadBundleCached(startDate, endDate) {
  const key = `${startDate}|${endDate}`;
  const cached = leadBundleCache.get(key);
  if (cached && Date.now() - cached.ts < LEAD_BUNDLE_CACHE_TTL) {
    return cached.value;
  }
  const value = await buildLeadMatch(startDate, endDate);
  leadBundleCache.set(key, { ts: Date.now(), value });
  return value;
}

async function buildLeadMatch(startDate, endDate) {
  const metaLeads = await getLeads(startDate, endDate);

  const bitrixLeads = await getAllLeads(
    { '>=DATE_CREATE': `${startDate}T00:00:00` },
    ['ID', 'CONTACT_ID', 'TITLE', 'DATE_CREATE', 'STATUS_ID', 'STATUS_SEMANTIC_ID', 'SOURCE_ID', 'NAME', 'LAST_NAME', 'EMAIL', 'PHONE', 'UTM_SOURCE', 'UTM_MEDIUM', 'UTM_CAMPAIGN', 'UTM_CONTENT', 'UTM_TERM', 'COMMENTS', 'SOURCE_DESCRIPTION']
  );

  const statusList = await getStatusList();
  const statusNameMap = {};
  (statusList || []).forEach(s => {
    if (s.ENTITY_ID === 'STATUS' && s.STATUS_ID && !statusNameMap[s.STATUS_ID]) {
      statusNameMap[s.STATUS_ID] = s.NAME;
    }
  });

  const contactIds = [...new Set(bitrixLeads.map(l => l.CONTACT_ID).filter(Boolean))];
  const contacts = {};
  for (let i = 0; i < contactIds.length; i += 50) {
    const chunk = contactIds.slice(i, i + 50);
    const c = await bitrixRequest('crm.contact.list', {
      filter: { ID: chunk },
      select: ['ID', 'NAME', 'LAST_NAME', 'EMAIL', 'PHONE', 'SOURCE_ID', 'SOURCE_DESCRIPTION']
    });
    (c.result || []).forEach(x => { contacts[x.ID] = x; });
  }

  const emailMap = new Map();
  const phoneMap = new Map();
  const nameMap = new Map();
  for (const c of Object.values(contacts)) {
    (c.EMAIL || []).forEach(e => {
      const k = normalizeContactValue(e.VALUE);
      if (k) emailMap.set(k, c);
    });
    (c.PHONE || []).forEach(p => {
      const k = normalizeContactValue(p.VALUE);
      if (k) phoneMap.set(k, c);
    });
    const n = normalizeName(`${c.NAME || ''} ${c.LAST_NAME || ''}`);
    if (n.length >= 5 && !nameMap.has(n)) nameMap.set(n, c);
  }

  const leadEmailMap = new Map();
  const leadPhoneMap = new Map();
  const leadNameMap = new Map();
  for (const l of bitrixLeads) {
    (l.EMAIL || []).forEach(e => {
      const k = normalizeContactValue(e.VALUE);
      if (k) leadEmailMap.set(k, l);
    });
    (l.PHONE || []).forEach(p => {
      const k = normalizeContactValue(p.VALUE);
      if (k) leadPhoneMap.set(k, l);
    });
    const n = normalizeName(`${l.NAME || ''} ${l.LAST_NAME || ''}`);
    if (n.length >= 5 && !leadNameMap.has(n)) leadNameMap.set(n, l);
  }

  const leadsByContact = new Map();
  bitrixLeads.forEach(l => {
    if (!l.CONTACT_ID) return;
    if (!leadsByContact.has(l.CONTACT_ID)) leadsByContact.set(l.CONTACT_ID, []);
    leadsByContact.get(l.CONTACT_ID).push(l);
  });

  function resolveContact(contactId) {
    return contactId ? contacts[contactId] : null;
  }

  function leadStatus(l) {
    if (!l) return null;
    return {
      statusId: l.STATUS_ID,
      statusName: statusNameMap[l.STATUS_ID] || l.STATUS_ID,
      semanticId: l.STATUS_SEMANTIC_ID
    };
  }

  const matched = [];
  const unmatched = [];
  for (const lead of metaLeads) {
    const em = normalizeContactValue(lead.fields.email);
    const ph = normalizeContactValue(lead.fields.phone);
    const nm = normalizeName(lead.fields.fullName);

    let contact = null;
    let directLead = null;
    let matchKey = null;

    if (em && emailMap.has(em)) {
      contact = emailMap.get(em);
      matchKey = 'email';
    } else if (em && leadEmailMap.has(em)) {
      directLead = leadEmailMap.get(em);
      matchKey = 'lead_email';
    } else if (ph && phoneMap.has(ph)) {
      contact = phoneMap.get(ph);
      matchKey = 'phone';
    } else if (ph && leadPhoneMap.has(ph)) {
      directLead = leadPhoneMap.get(ph);
      matchKey = 'lead_phone';
    } else if (nm && nameMap.has(nm)) {
      contact = nameMap.get(nm);
      matchKey = 'name';
    } else if (nm && leadNameMap.has(nm)) {
      directLead = leadNameMap.get(nm);
      matchKey = 'lead_name';
    }

    if (!contact && directLead && directLead.CONTACT_ID) {
      contact = resolveContact(directLead.CONTACT_ID);
    }

    const linkedLeads = directLead ? [directLead] : (contact ? (leadsByContact.get(contact.ID) || []) : []);
    const statusLead = directLead || pickClosestLead(linkedLeads, lead.createdTime);

    const entry = {
      ...lead,
      matched: !!(contact || statusLead),
      matchKey,
      status: leadStatus(statusLead),
      bitrixContact: contact ? {
        id: contact.ID,
        name: `${contact.NAME || ''} ${contact.LAST_NAME || ''}`.trim() || null,
        sourceId: contact.SOURCE_ID,
        sourceDescription: contact.SOURCE_DESCRIPTION,
        email: (contact.EMAIL || []).map(e => e.VALUE),
        phone: (contact.PHONE || []).map(p => p.VALUE)
      } : null,
      bitrixLeadIds: linkedLeads.map(l => l.ID),
      bitrixLeadCount: linkedLeads.length
    };
    (contact || statusLead ? matched : unmatched).push(entry);
  }

  return {
    total: metaLeads.length,
    matchedCount: matched.length,
    matched,
    unmatched
  };
}

app.get('/api/leads', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'startDate and endDate are required' });
    }
    const data = await getLeadBundleCached(startDate, endDate);

    const EXCLUDED_SEMANTIC = new Set(['P', 'F']);
    const leads = (data.matched || []).filter(l => {
      if (!l.status || !l.status.semanticId) return false;
      return !EXCLUDED_SEMANTIC.has(l.status.semanticId);
    });

    res.json({
      success: true,
      total: data.total,
      matchedCount: data.matchedCount,
      displayedCount: leads.length,
      leads,
      unmatchedCount: (data.unmatched || []).length
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/google-ads/campaigns', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'startDate and endDate are required' });
    }

    const campaigns = await getGoogleAdsCampaigns(startDate, endDate);
    res.json({ success: true, campaigns });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/dashboard', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'startDate and endDate are required' });
    }

    const bitrixFilter = {
      '>=DATE_CREATE': startDate,
      '<=DATE_CREATE': endDate + ' 23:59:59',
      STATUS_ID: 'CONVERTED',
      UF_CRM_1630505818393: LEAD_STOVYKLOS_PRODUKTAS_ID
    };

    const [metaCampaigns, googleAdsCampaigns, bitrixLeads, sourceStatusMap] = await Promise.all([
      getNormalizedCampaigns(startDate, endDate),
      getGoogleAdsCampaigns(startDate, endDate).catch(() => []),
      getAllLeads(bitrixFilter),
      getSourceStatusMap()
    ]);

    const dashboard = buildDashboard(metaCampaigns, bitrixLeads, sourceStatusMap);

    const googleAdsRows = buildGoogleAdsRows(googleAdsCampaigns, bitrixLeads, sourceStatusMap);
    dashboard.campaignTable.push(...googleAdsRows);

    let totalSpend = dashboard.campaignTable.reduce((s, c) => s + (c.spendWithVAT || 0), 0);
    let totalLeads = dashboard.campaignTable.reduce((s, c) => s + (c.leads || 0), 0);
    dashboard.stats.totalSpend = Math.round(totalSpend * 100) / 100;
    dashboard.stats.totalLeads = totalLeads;
    dashboard.stats.averageCPL = totalLeads > 0 ? Math.round((totalSpend / totalLeads) * 100) / 100 : 0;
    dashboard.stats.totalCampaigns = dashboard.campaignTable.length;

    res.json({ success: true, ...dashboard });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
app.get('/api/deals', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'startDate and endDate are required' });
    }

    const { dealTable, deals, dealSourceMap, contactSourceMap, contactsMap } = await getDealBundleCached(startDate, endDate);
    const [metaCampaigns, googleAdsCampaigns] = await Promise.all([
      getNormalizedCampaigns(startDate, endDate),
      getGoogleAdsCampaigns(startDate, endDate).catch(() => [])
    ]);
    const matchingResults = [];

    // Build matchingResults for debugging (all deal-campaign comparisons)
    deals.forEach(deal => {
      const resolvedSource = resolveDealSource(deal, dealSourceMap) || resolveContactSource(deal, contactsMap, contactSourceMap);
      metaCampaigns.forEach(campaign => {
        const result = matchSource(campaign.campaignName, resolvedSource);
        matchingResults.push({
          metaCampaign: campaign.campaignName,
          bitrixSource: resolvedSource,
          ...result,
          dealId: deal.ID,
          dealTitle: deal.TITLE
        });
      });
    });

    // Assign each dealTable entry to exactly one campaign (no double-counting)
    const assignedDealIds = new Set();

    const campaignStats = metaCampaigns.map(campaign => {
      const matchedEntries = [];

      dealTable.forEach(entry => {
        if (assignedDealIds.has(entry.id)) return;
        const result = matchSource(campaign.campaignName, entry.source);
        if (result.confidence >= 80) {
          matchedEntries.push(entry);
        }
      });

      matchedEntries.forEach(e => assignedDealIds.add(e.id));

      const kiekis = matchedEntries.length;
      const spendWithVAT = calculateSpendWithVAT(campaign.spend);
      const cpl = calculateCPL(spendWithVAT, kiekis);
      const totalSuma = matchedEntries.reduce((sum, e) => sum + e.suma, 0);
      const pelnas = totalSuma - spendWithVAT;

      const allowedSources = getAllowedSources(campaign.campaignName);
      const expectedSource = allowedSources.length > 0 ? allowedSources[0] : '';

      return {
        metaCampaign: campaign.campaignName,
        crmSource: matchedEntries.length > 0
          ? matchedEntries[0].source
          : expectedSource,
        kiekis,
        spendWithVAT: Math.round(spendWithVAT * 100) / 100,
        cpl: Math.round(cpl * 100) / 100,
        suma: Math.round(totalSuma * 100) / 100,
        pelnas: Math.round(pelnas * 100) / 100
      };
    });

    // Google Stovykla campaign (skip already assigned)
    const stovyklaCampaign = googleAdsCampaigns.find(c =>
      c.campaignName.toLowerCase().includes('stovykla') && c.spend > 0
    );

    if (stovyklaCampaign) {
      const googleEntries = dealTable.filter(entry => {
        if (assignedDealIds.has(entry.id)) return false;
        return entry.source.toLowerCase().includes('google');
      });
      googleEntries.forEach(e => assignedDealIds.add(e.id));

      const spendWithVAT = calculateSpendWithVAT(stovyklaCampaign.spend);
      const kiekis = googleEntries.length;
      const cpl = calculateCPL(spendWithVAT, kiekis);
      const totalSuma = googleEntries.reduce((sum, e) => sum + e.suma, 0);
      const pelnas = totalSuma - spendWithVAT;

      campaignStats.push({
        metaCampaign: 'Google Ads',
        crmSource: 'Google',
        kiekis,
        spendWithVAT: Math.round(spendWithVAT * 100) / 100,
        cpl: Math.round(cpl * 100) / 100,
        suma: Math.round(totalSuma * 100) / 100,
        pelnas: Math.round(pelnas * 100) / 100
      });
    }

    // Unmatched sources (skip already assigned)
    const unmatchedEntries = dealTable.filter(e => !assignedDealIds.has(e.id));

    const unmatchedSourceDeals = {};
    unmatchedEntries.forEach(entry => {
      const src = (entry.source || '').toLowerCase();
      if (src) {
        if (!unmatchedSourceDeals[src]) {
          unmatchedSourceDeals[src] = { deals: [], suma: 0, crmSource: entry.source };
        }
        unmatchedSourceDeals[src].deals.push(entry);
        unmatchedSourceDeals[src].suma += entry.suma;
      }
    });

    Object.values(unmatchedSourceDeals).forEach(group => {
      const kiekis = group.deals.length;
      const totalSuma = group.suma;
      campaignStats.push({
        metaCampaign: '-',
        crmSource: group.crmSource,
        kiekis,
        spendWithVAT: 0,
        cpl: 0,
        suma: Math.round(totalSuma * 100) / 100,
        pelnas: Math.round(totalSuma * 100) / 100
      });
    });

    const totalSpend = campaignStats.reduce((s, c) => s + c.spendWithVAT, 0);
    const totalKiekis = campaignStats.reduce((s, c) => s + c.kiekis, 0);
    const totalSuma = campaignStats.reduce((s, c) => s + c.suma, 0);
    const totalPelnas = totalSuma - totalSpend;

    res.json({
      success: true,
      stats: {
        totalSpend: Math.round(totalSpend * 100) / 100,
        totalKiekis,
        totalSuma: Math.round(totalSuma * 100) / 100,
        totalPelnas: Math.round(totalPelnas * 100) / 100,
        roas: totalSpend > 0 ? Math.round((totalSuma / totalSpend) * 100) / 100 : 0,
        averageCPL: totalKiekis > 0 ? Math.round((totalSpend / totalKiekis) * 100) / 100 : 0,
        totalCampaigns: campaignStats.length
      },
      dealTable,
      campaignStats,
      matchingResults
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/deals/daily', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'startDate and endDate are required' });
    }

    const [metaDaily, googleDaily, bundle] = await Promise.all([
      getDailyCampaignData(startDate, endDate),
      getGoogleAdsDailyCampaignData(startDate, endDate).catch(() => []),
      getDealBundleCached(startDate, endDate)
    ]);
    const dealTable = bundle.dealTable;

    const spendByDate = {};
    const addSpend = (rows, isGoogle) => {
      rows.forEach(r => {
        const key = r.date ? r.date.substring(0, 10) : null;
        if (!key) return;
        if (isGoogle && !String(r.campaignName || '').toLowerCase().includes('stovykla')) return;
        spendByDate[key] = (spendByDate[key] || 0) + calculateSpendWithVAT(r.spend);
      });
    };
    addSpend(metaDaily, false);
    addSpend(googleDaily, true);

    const sumaByDate = {};
    dealTable.forEach(entry => {
      const key = entry.date ? entry.date.substring(0, 10) : null;
      if (!key) return;
      sumaByDate[key] = (sumaByDate[key] || 0) + entry.suma;
    });

    const labels = [];
    const spend = [];
    const suma = [];
    const cursor = new Date(startDate + 'T00:00:00');
    const last = new Date(endDate + 'T00:00:00');
    while (cursor <= last) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
      labels.push(key);
      spend.push(Math.round((spendByDate[key] || 0) * 100) / 100);
      suma.push(Math.round((sumaByDate[key] || 0) * 100) / 100);
      cursor.setDate(cursor.getDate() + 1);
    }

    const totalSuma = suma.reduce((s, v) => s + v, 0);

    res.json({
      success: true,
      labels,
      spend,
      suma,
      totalSuma: Math.round(totalSuma * 100) / 100
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// === Online Pamokos API Endpoints ===

app.get('/api/online-pamokos/dashboard', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'startDate and endDate are required' });
    }

    const bitrixFilter = {
      '>=DATE_CREATE': startDate,
      '<=DATE_CREATE': endDate + ' 23:59:59',
      STATUS_ID: 'CONVERTED',
      UF_CRM_1630505818393: LEAD_ONLINE_PAMOKOS_PRODUKTAS_ID
    };

    const [metaCampaigns, googleAdsCampaigns, bitrixLeads, sourceStatusMap] = await Promise.all([
      getNormalizedCampaigns(startDate, endDate, ONLINE_PAMOKOS_CAMPAIGNS),
      getGoogleAdsCampaigns(startDate, endDate).catch(() => []),
      getAllLeads(bitrixFilter),
      getSourceStatusMap()
    ]);

    const dashboard = buildDashboard(metaCampaigns, bitrixLeads, sourceStatusMap);

    const googleAdsRows = buildGoogleAdsRows(googleAdsCampaigns, bitrixLeads, sourceStatusMap, { excludeStovykla: true });
    dashboard.campaignTable.push(...googleAdsRows);

    let totalSpend = dashboard.campaignTable.reduce((s, c) => s + (c.spendWithVAT || 0), 0);
    let totalLeads = dashboard.campaignTable.reduce((s, c) => s + (c.leads || 0), 0);
    dashboard.stats.totalSpend = Math.round(totalSpend * 100) / 100;
    dashboard.stats.totalLeads = totalLeads;
    dashboard.stats.averageCPL = totalLeads > 0 ? Math.round((totalSpend / totalLeads) * 100) / 100 : 0;
    dashboard.stats.totalCampaigns = dashboard.campaignTable.length;

    res.json({ success: true, ...dashboard });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/online-pamokos/deals', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'startDate and endDate are required' });
    }

    const DEAL_WON_STAGES = ['WON', 'C3:WON', 'C5:WON'];

    const dealFilter = {
      '>=DATE_CREATE': startDate,
      '<=DATE_CREATE': endDate + ' 23:59:59',
      'UF_CRM_612F8D8B4766B': DEAL_ONLINE_PAMOKOS_PRODUKTAS_ID,
      STAGE_ID: DEAL_WON_STAGES
    };

    const [metaCampaigns, googleAdsCampaigns, deals, dealSourceMap, contactSourceMap] = await Promise.all([
      getNormalizedCampaigns(startDate, endDate, ONLINE_PAMOKOS_CAMPAIGNS),
      getGoogleAdsCampaigns(startDate, endDate).catch(() => []),
      getAllDeals(dealFilter, DEAL_SELECT_FIELDS),
      getDealSourceStatusMap(),
      getContactSourceStatusMap()
    ]);

    const dealsWithEmptySource = deals.filter(d => !resolveDealSource(d, dealSourceMap));
    const contactIds = [...new Set(dealsWithEmptySource.map(d => d.CONTACT_ID).filter(Boolean))];
    const contactsMap = await getContactsByIds(contactIds);

    const allDealsByContact = {};
    const windowDeals = await getAllDealsForProductWindow(startDate, endDate, DEAL_ONLINE_PAMOKOS_PRODUKTAS_ID);
    windowDeals.forEach(deal => {
      const key = String(deal.CONTACT_ID);
      if (!allDealsByContact[key]) allDealsByContact[key] = [];
      allDealsByContact[key].push(deal);
    });

    const matchingResults = [];

    const dealTableMap = {};
    deals.forEach(deal => {
      const cid = deal.CONTACT_ID || deal.ID;
      if (!dealTableMap[cid]) {
        const source = resolveDealSource(deal, dealSourceMap) || resolveContactSource(deal, contactsMap, contactSourceMap);
        const totalSuma = calculateContactDealSuma(deal, allDealsByContact);
        dealTableMap[cid] = {
          id: deal.ID,
          title: deal.TITLE || '',
          source,
          date: deal.DATE_CREATE,
          suma: totalSuma,
          url: `https://pasimokome.bitrix24.com/crm/deal/details/${deal.ID}/`
        };
      }
    });
    const dealTable = Object.values(dealTableMap);

    // Build matchingResults for debugging (all deal-campaign comparisons)
    deals.forEach(deal => {
      const resolvedSource = resolveDealSource(deal, dealSourceMap) || resolveContactSource(deal, contactsMap, contactSourceMap);
      metaCampaigns.forEach(campaign => {
        const result = matchSource(campaign.campaignName, resolvedSource);
        matchingResults.push({
          metaCampaign: campaign.campaignName,
          bitrixSource: resolvedSource,
          ...result,
          dealId: deal.ID,
          dealTitle: deal.TITLE
        });
      });
    });

    // Assign each dealTable entry to exactly one campaign (no double-counting)
    const assignedDealIds = new Set();

    const campaignStats = metaCampaigns.map(campaign => {
      const matchedEntries = [];

      dealTable.forEach(entry => {
        if (assignedDealIds.has(entry.id)) return;
        const result = matchSource(campaign.campaignName, entry.source);
        if (result.confidence >= 80) {
          matchedEntries.push(entry);
        }
      });

      matchedEntries.forEach(e => assignedDealIds.add(e.id));

      const kiekis = matchedEntries.length;
      const spendWithVAT = calculateSpendWithVAT(campaign.spend);
      const cpl = calculateCPL(spendWithVAT, kiekis);
      const totalSuma = matchedEntries.reduce((sum, e) => sum + e.suma, 0);
      const pelnas = totalSuma - spendWithVAT;

      const allowedSources = getAllowedSources(campaign.campaignName);
      const expectedSource = allowedSources.length > 0 ? allowedSources[0] : '';

      return {
        metaCampaign: campaign.campaignName,
        crmSource: matchedEntries.length > 0
          ? matchedEntries[0].source
          : expectedSource,
        kiekis,
        spendWithVAT: Math.round(spendWithVAT * 100) / 100,
        cpl: Math.round(cpl * 100) / 100,
        suma: Math.round(totalSuma * 100) / 100,
        pelnas: Math.round(pelnas * 100) / 100
      };
    });

    // Google campaigns (non-Stovykla) - combine into one row (skip already assigned)
    const nonStovyklaGoogleCampaigns = googleAdsCampaigns.filter(c =>
      !c.campaignName.toLowerCase().includes('stovykla') && c.spend > 0
    );

    if (nonStovyklaGoogleCampaigns.length > 0) {
      const totalGoogleSpend = nonStovyklaGoogleCampaigns.reduce((sum, c) => sum + c.spend, 0);
      const googleEntries = dealTable.filter(entry => {
        if (assignedDealIds.has(entry.id)) return false;
        return entry.source.toLowerCase().includes('google');
      });
      googleEntries.forEach(e => assignedDealIds.add(e.id));

      const spendWithVAT = calculateSpendWithVAT(totalGoogleSpend);
      const kiekis = googleEntries.length;
      const cpl = calculateCPL(spendWithVAT, kiekis);
      const totalSuma = googleEntries.reduce((sum, e) => sum + e.suma, 0);
      const pelnas = totalSuma - spendWithVAT;

      campaignStats.push({
        metaCampaign: 'Google Ads',
        crmSource: 'Google',
        kiekis,
        spendWithVAT: Math.round(spendWithVAT * 100) / 100,
        cpl: Math.round(cpl * 100) / 100,
        suma: Math.round(totalSuma * 100) / 100,
        pelnas: Math.round(pelnas * 100) / 100
      });
    }

    // Unmatched sources (skip already assigned)
    const unmatchedEntries = dealTable.filter(e => !assignedDealIds.has(e.id));

    const unmatchedSourceDeals = {};
    unmatchedEntries.forEach(entry => {
      const src = (entry.source || '').toLowerCase();
      if (src) {
        if (!unmatchedSourceDeals[src]) {
          unmatchedSourceDeals[src] = { deals: [], suma: 0, crmSource: entry.source };
        }
        unmatchedSourceDeals[src].deals.push(entry);
        unmatchedSourceDeals[src].suma += entry.suma;
      }
    });

    Object.values(unmatchedSourceDeals).forEach(group => {
      const kiekis = group.deals.length;
      const totalSuma = group.suma;
      campaignStats.push({
        metaCampaign: '-',
        crmSource: group.crmSource,
        kiekis,
        spendWithVAT: 0,
        cpl: 0,
        suma: Math.round(totalSuma * 100) / 100,
        pelnas: Math.round(totalSuma * 100) / 100
      });
    });

    const totalSpend = campaignStats.reduce((s, c) => s + c.spendWithVAT, 0);
    const totalKiekis = campaignStats.reduce((s, c) => s + c.kiekis, 0);
    const totalSuma = campaignStats.reduce((s, c) => s + c.suma, 0);
    const totalPelnas = totalSuma - totalSpend;

    res.json({
      success: true,
      stats: {
        totalSpend: Math.round(totalSpend * 100) / 100,
        totalKiekis,
        totalSuma: Math.round(totalSuma * 100) / 100,
        totalPelnas: Math.round(totalPelnas * 100) / 100,
        averageCPL: totalKiekis > 0 ? Math.round((totalSpend / totalKiekis) * 100) / 100 : 0,
        totalCampaigns: campaignStats.length
      },
      dealTable,
      campaignStats,
      matchingResults
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

function getLocalOnlinePamokosValue(startDate, endDate, field) {
  const months = new Set();
  const start = new Date(startDate);
  const end = new Date(endDate);
  const current = new Date(start);
  while (current <= end) {
    months.add(getMonthSheetName(current));
    current.setDate(current.getDate() + 1);
  }
  let total = 0;
  for (const monthKey of months) {
    const daily = getBudgetField(monthKey, field);
    if (daily === null) continue;
    const days = getDaysInRange(startDate, endDate, monthKey);
    total += daily * days;
  }
  return Math.round(total * 100) / 100;
}

app.get('/api/online-pamokos/planas', (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'startDate and endDate are required' });
    }
    const planas = getLocalOnlinePamokosValue(startDate, endDate, 'daily');
    res.json({ success: true, planas });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/online-pamokos/leads-planas', (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'startDate and endDate are required' });
    }

    const leadsPlanas = getLocalOnlinePamokosValue(startDate, endDate, 'leads_daily');
    res.json({ success: true, leadsPlanas });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/online-pamokos/budgets', (req, res) => {
  res.json({ success: true, budgets: getBudgets() });
});

app.post('/api/online-pamokos/budgets', (req, res) => {
  try {
    const { budgets } = req.body;
    if (!budgets || typeof budgets !== 'object') {
      return res.status(400).json({ success: false, error: 'Invalid budgets data' });
    }
    saveBudgets(budgets);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/online-pamokos/budgets/import', async (req, res) => {
  try {
    const { year } = req.body;
    if (!year) {
      return res.status(400).json({ success: false, error: 'Year is required' });
    }

    const imported = {};
    for (let m = 1; m <= 12; m++) {
      const monthKey = `${year} ${String(m).padStart(2, '0')}`;
      try {
        const data = await getOnlinePamokosMonthData(monthKey);
        imported[monthKey] = data;
      } catch (e) {
        console.error(`[import] Error reading ${monthKey}:`, e.message);
        imported[monthKey] = { daily: null, leads_daily: null, deals_daily: null };
      }
    }

    res.json({ success: true, imported });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/auth/google', (req, res) => {
  const base = `${req.protocol}://${req.headers.host}`;
  const redirectUri = `${base}/auth/google/callback`;
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );
  const scopes = ['https://www.googleapis.com/auth/spreadsheets.readonly'];
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent'
  });
  res.redirect(url);
});

app.get('/auth/google/callback', async (req, res) => {
  console.log('[oauth] callback hit with URL:', req.originalUrl);
  const { code } = req.query;
  if (!code) {
    return res.status(400).send('No authorization code provided');
  }

  const base = `${req.protocol}://${req.headers.host}`;
  const redirectUri = `${base}/auth/google/callback`;

  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      redirectUri
    );

    const { tokens } = await oauth2Client.getToken(code);
    console.log('\n=== Google OAuth Token Received ===');

    const { saveSettings: saveSettingsData } = require('./settings');
    saveSettingsData({ GOOGLE_REFRESH_TOKEN: tokens.refresh_token });
    console.log('Refresh token saved to settings.json');

    resetSheetsClient();

    res.send(`
      <html><body style="font-family:system-ui;padding:40px;text-align:center">
        <h2>Autorizacija sėkminga!</h2>
        <p>Galite uždaryti šį langą.</p>
        <script>setTimeout(() => window.close(), 1500)</script>
      </body></html>
    `);
  } catch (error) {
    console.error('OAuth error:', error.message);
    res.status(500).send('Authorization failed: ' + error.message);
  }
});

app.get('/auth/google-ads', (req, res) => {
  const base = `${req.protocol}://${req.headers.host}`;
  const redirectUri = `${base}/oauth2callback`;
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_ADS_CLIENT_ID,
    process.env.GOOGLE_ADS_CLIENT_SECRET,
    redirectUri
  );

  const scopes = ['https://www.googleapis.com/auth/adwords'];
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent'
  });

  res.redirect(url);
});

app.get('/oauth2callback', async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).send('No authorization code provided');
  }

  const base = `${req.protocol}://${req.headers.host}`;
  const redirectUri = `${base}/oauth2callback`;

  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_ADS_CLIENT_ID,
      process.env.GOOGLE_ADS_CLIENT_SECRET,
      redirectUri
    );

    const { tokens } = await oauth2Client.getToken(code);
    console.log('\n=== Google Ads OAuth Token Received ===');

    const { saveSettings: saveSettingsData } = require('./settings');
    saveSettingsData({ GOOGLE_ADS_REFRESH_TOKEN: tokens.refresh_token });
    console.log('Google Ads refresh token saved to settings.json');

    resetOAuth2Client();

    res.send(`
      <html><body style="font-family:system-ui;padding:40px;text-align:center">
        <h2>Google Ads autorizacija sėkminga!</h2>
        <p>Galite uždaryti šį langą.</p>
        <script>setTimeout(() => window.close(), 1500)</script>
      </body></html>
    `);
  } catch (error) {
    console.error('OAuth error:', error.message);
    res.status(500).send('Authorization failed: ' + error.message);
  }
});

app.get('/api/settings/auth-url/:service', (req, res) => {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!isValidSession(token)) {
    return res.status(401).json({ success: false, error: 'Prisijunkite' });
  }

  const base = `${req.protocol}://${req.headers.host}`;
  const { service } = req.params;

  if (service === 'google-sheets') {
    const redirectUri = `${base}/auth/google/callback`;
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      redirectUri
    );
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
      prompt: 'consent'
    });
    return res.json({ success: true, url });
  }

  if (service === 'google-ads') {
    const redirectUri = `${base}/oauth2callback`;
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_ADS_CLIENT_ID,
      process.env.GOOGLE_ADS_CLIENT_SECRET,
      redirectUri
    );
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/adwords'],
      prompt: 'consent'
    });
    return res.json({ success: true, url });
  }

  res.status(400).json({ success: false, error: 'Nežinomas servisas' });
});

app.get('/api/planas', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'startDate and endDate are required' });
    }

    const planas = await getPlanasAmount(startDate, endDate);
    res.json({ success: true, planas });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/leads-planas', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'startDate and endDate are required' });
    }

    const leadsPlanas = await getLeadsPlanasAmount(startDate, endDate);
    res.json({ success: true, leadsPlanas });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/deals/planas', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'startDate and endDate are required' });
    }

    const planas = await getPlanasAmount(startDate, endDate);
    res.json({ success: true, planas });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/deals/planas-kiekis', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'startDate and endDate are required' });
    }

    const planas = await getStovyklaDealsCountPlanasAmount(startDate, endDate);
    res.json({ success: true, planas });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/deals/suma', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'startDate and endDate are required' });
    }

    const result = await getStovyklaSumaAmount(startDate, endDate);
    if (!result) {
      return res.json({ success: true, avansai: 0, likutine: 0, suma: 0 });
    }
    res.json({ success: true, avansai: result.avansai, likutine: result.likutine, suma: result.suma });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/online-pamokos/deals/planas-kiekis', (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'startDate and endDate are required' });
    }

    const planas = getLocalOnlinePamokosValue(startDate, endDate, 'deals_daily');
    res.json({ success: true, planas });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/online-pamokos/deals/planas', (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'startDate and endDate are required' });
    }
    const planas = getLocalOnlinePamokosValue(startDate, endDate, 'daily');
    res.json({ success: true, planas });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.get('/deals', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/deals.html'));
});

app.get('/meta', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/meta.html'));
});

app.get('/online-pamokos', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/leads-online-pamokos.html'));
});

app.get('/online-pamokos/deals', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/deals-online-pamokos.html'));
});

app.get('/online-pamokos/nustatymai', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/online-pamokos-nustatymai.html'));
});

// === Settings ===

const crypto = require('crypto');
const { getSettings: getSettingsData, saveSettings: saveSettingsData, verifyPassword: verifySettingsPassword, testBitrix, testMeta, testGoogleSheets, testGoogleAds } = require('./settings');

const settingsSessions = new Map();
const SESSION_TTL = 24 * 60 * 60 * 1000;

function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function isValidSession(token) {
  if (!token) return false;
  const session = settingsSessions.get(token);
  if (!session) return false;
  if (Date.now() - session.ts > SESSION_TTL) {
    settingsSessions.delete(token);
    return false;
  }
  return true;
}

app.get('/settings', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/settings.html'));
});

app.post('/api/settings/login', (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ success: false, error: 'Slaptažodis privalomas' });
  }
  if (!verifySettingsPassword(password)) {
    return res.status(401).json({ success: false, error: 'Neteisingas slaptažodis' });
  }
  const token = generateSessionToken();
  settingsSessions.set(token, { ts: Date.now() });
  res.json({ success: true, token });
});

app.get('/api/settings', (req, res) => {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!isValidSession(token)) {
    return res.status(401).json({ success: false, error: 'Prisijunkite' });
  }
  res.json({ success: true, settings: getSettingsData() });
});

app.post('/api/settings', (req, res) => {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!isValidSession(token)) {
    return res.status(401).json({ success: false, error: 'Prisijunkite' });
  }
  try {
    saveSettingsData(req.body);
    resetSheetsClient();
    resetOAuth2Client();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/settings/test', async (req, res) => {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!isValidSession(token)) {
    return res.status(401).json({ success: false, error: 'Prisijunkite' });
  }
  try {
    const [r1, r2, r3, r4] = await Promise.all([
      testBitrix(),
      testMeta(),
      testGoogleSheets(),
      testGoogleAds(),
    ]);
    res.json({
      success: true,
      results: { bitrix: r1, meta: r2, googleSheets: r3, googleAds: r4 }
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/settings/logout', (req, res) => {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (token) settingsSessions.delete(token);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Dashboard server running on http://localhost:${PORT}`);
  setTimeout(async () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const start = new Date();
      start.setDate(start.getDate() - 90);
      const count = await prewarmAdImages(start.toISOString().slice(0, 10), today);
      console.log(`[pre-warm] enqueued ad images for ${count} ads`);
    } catch (e) {
      console.log('[pre-warm] skip:', e.message);
    }
  }, 2000);
});

app.get('/api/debug/sheets', async (req, res) => {
  try {
    const { google } = require('googleapis');
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

    const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
    const sheetNames = meta.data.sheets.map(s => s.properties.title);

    const firstSheet = sheetNames[0];
    const headerRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${firstSheet}'!1:1`,
    });
    const headers = headerRes.data.values ? headerRes.data.values[0] : [];

    res.json({ success: true, sheetCount: sheetNames.length, sheetNames, firstSheet, headers });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err.message);
});
