const { matchSource, getAllowedSources } = require('./sourceMatcher');
const { calculateSpendWithVAT, calculateCPL, calculateStats } = require('./calculations');

function resolveLeadSource(lead, sourceStatusMap) {
  const sourceId = lead.SOURCE_ID || '';
  const sourceDescription = lead.SOURCE_DESCRIPTION || '';

  if (sourceDescription) return sourceDescription;
  if (sourceId && sourceStatusMap[sourceId]) return sourceStatusMap[sourceId];
  return sourceId;
}

function isGoogleSource(source) {
  return source.toLowerCase().includes('google');
}

function enrichCampaignsWithBitrix(campaigns, bitrixLeads, sourceStatusMap) {
  const matchingResults = [];

  const enriched = campaigns.map(campaign => {
    const matchedLeads = [];
    let totalConfidence = 0;

    bitrixLeads.forEach(lead => {
      const resolvedSource = resolveLeadSource(lead, sourceStatusMap);
      const result = matchSource(campaign.campaignName, resolvedSource);

      matchingResults.push({
        metaCampaign: campaign.campaignName,
        bitrixSource: resolvedSource,
        sourceId: lead.SOURCE_ID,
        ...result,
        leadId: lead.ID,
        leadName: lead.NAME
      });

      if (result.confidence >= 80) {
        matchedLeads.push(lead);
        totalConfidence += result.confidence;
      }
    });

    const leads = matchedLeads.length;
    const spendWithVAT = calculateSpendWithVAT(campaign.spend);
    const cpl = calculateCPL(spendWithVAT, leads);

    return {
      campaignName: campaign.campaignName,
      normalizedCampaign: campaign.normalizedCampaign,
      spend: campaign.spend,
      spendWithVAT,
      impressions: campaign.impressions,
      clicks: campaign.clicks,
      leads,
      cpl,
      ctr: campaign.ctr,
      cpc: campaign.cpc,
      matchedLeads,
      avgConfidence: leads > 0 ? Math.round(totalConfidence / leads) : 0
    };
  });

  return { enriched, matchingResults };
}

function buildGoogleAdsRows(googleAdsCampaigns, bitrixLeads, sourceStatusMap, options = {}) {
  if (!googleAdsCampaigns || googleAdsCampaigns.length === 0) return [];

  const { excludeStovykla = false } = options;

  let filteredCampaigns;
  if (excludeStovykla) {
    filteredCampaigns = googleAdsCampaigns.filter(c =>
      !c.campaignName.toLowerCase().includes('stovykla') && c.spend > 0
    );
  } else {
    const stovyklaCampaign = googleAdsCampaigns.find(c =>
      c.campaignName.toLowerCase().includes('stovykla') && c.spend > 0
    );
    filteredCampaigns = stovyklaCampaign ? [stovyklaCampaign] : [];
  }

  if (filteredCampaigns.length === 0) return [];

  const googleLeads = bitrixLeads.filter(lead => {
    const source = resolveLeadSource(lead, sourceStatusMap);
    return isGoogleSource(source);
  });

  const totalSpend = filteredCampaigns.reduce((sum, c) => sum + c.spend, 0);
  const spendWithVAT = calculateSpendWithVAT(totalSpend);
  const kiekis = googleLeads.length;
  const cpl = calculateCPL(spendWithVAT, kiekis);

  return [{
    metaCampaign: 'Google Ads',
    crmSource: 'Google',
    leads: kiekis,
    spendWithVAT: Math.round(spendWithVAT * 100) / 100,
    cpl: Math.round(cpl * 100) / 100
  }];
}

function buildDashboard(metaCampaigns, bitrixLeads, sourceStatusMap) {
  const { enriched, matchingResults } = enrichCampaignsWithBitrix(metaCampaigns, bitrixLeads, sourceStatusMap);

  const stats = calculateStats(enriched);

  const campaignTable = enriched.map(c => {
    const allowedSources = getAllowedSources(c.campaignName);
    return {
      metaCampaign: c.campaignName,
      crmSource: c.matchedLeads.length > 0
        ? resolveLeadSource(c.matchedLeads[0], sourceStatusMap)
        : allowedSources.length > 0 ? allowedSources[0] : '',
      leads: c.leads,
      spendWithVAT: c.spendWithVAT,
      cpl: c.cpl
    };
  });

  const leadTable = bitrixLeads.map(lead => ({
    id: lead.ID,
    name: lead.TITLE || lead.NAME || '',
    source: resolveLeadSource(lead, sourceStatusMap),
    date: lead.DATE_CREATE,
    url: `https://pasimokome.bitrix24.com/crm/lead/details/${lead.ID}/`
  }));

  return {
    stats,
    campaignTable,
    leadTable,
    matchingResults
  };
}

module.exports = { enrichCampaignsWithBitrix, buildDashboard, buildGoogleAdsRows, resolveLeadSource };
