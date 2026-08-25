function calculateSpendWithVAT(spend) {
  return spend * 1.21;
}

function calculateCPL(spend, leads) {
  if (!leads || leads === 0) return 0;
  return spend / leads;
}

function calculateStats(campaigns) {
  let totalSpend = 0;
  let totalLeads = 0;

  campaigns.forEach(c => {
    totalSpend += c.spendWithVAT || 0;
    totalLeads += c.leads || 0;
  });

  return {
    totalSpend: Math.round(totalSpend * 100) / 100,
    totalLeads,
    averageCPL: totalLeads > 0 ? Math.round((totalSpend / totalLeads) * 100) / 100 : 0,
    totalCampaigns: campaigns.length
  };
}

module.exports = { calculateSpendWithVAT, calculateCPL, calculateStats };
