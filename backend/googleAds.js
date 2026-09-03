const { google } = require('googleapis');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

let oauth2Client = null;

function resetOAuth2Client() { oauth2Client = null; }

function getOAuth2Client() {
  if (oauth2Client) return oauth2Client;
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;
  oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return oauth2Client;
}

async function getAccessToken() {
  const client = getOAuth2Client();
  const tokenResponse = await client.getAccessToken();
  return tokenResponse.token;
}

async function googleAdsRequest(query) {
  const token = await getAccessToken();
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  const url = `https://googleads.googleapis.com/v25/customers/${customerId}/googleAds:searchStream`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
      'login-customer-id': process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Google Ads API error: ${response.status} - ${error}`);
  }

  return response.json();
}

async function getCampaignData(startDate, endDate) {
  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.ctr,
      metrics.average_cpc,
      metrics.conversions,
      metrics.conversions_value
    FROM campaign
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
      AND campaign.status != 'REMOVED'
  `;

  const response = await googleAdsRequest(query);
  const results = [];
  if (Array.isArray(response)) {
    response.forEach(page => {
      if (page.results) results.push(...page.results);
    });
  } else if (response.results) {
    results.push(...response.results);
  }
  return results;
}

function normalizeGoogleAdsCampaign(result) {
  const campaign = result.campaign;
  const metrics = result.metrics;

  const spend = parseFloat(metrics.costMicros || 0) / 1000000;
  const cpc = parseFloat(metrics.averageCpc || 0) / 1000000;

  return {
    campaignId: campaign.id,
    campaignName: campaign.name,
    status: campaign.status,
    spend: Math.round(spend * 100) / 100,
    impressions: parseInt(metrics.impressions || 0, 10),
    clicks: parseInt(metrics.clicks || 0, 10),
    conversions: parseFloat(metrics.conversions || 0),
    conversionValue: parseFloat(metrics.conversionsValue || 0),
    ctr: parseFloat(metrics.ctr || 0),
    cpc: Math.round(cpc * 100) / 100,
    source: 'google'
  };
}

async function getNormalizedCampaigns(startDate, endDate) {
  const results = await getCampaignData(startDate, endDate);
  return results.map(normalizeGoogleAdsCampaign);
}

async function getDailyCampaignData(startDate, endDate) {
  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      metrics.cost_micros,
      segments.date
    FROM campaign
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
      AND campaign.status != 'REMOVED'
  `;

  const response = await googleAdsRequest(query);
  const results = [];
  if (Array.isArray(response)) {
    response.forEach(page => {
      if (page.results) results.push(...page.results);
    });
  } else if (response.results) {
    results.push(...response.results);
  }

  return results.map(r => ({
    campaignId: r.campaign.id,
    campaignName: r.campaign.name,
    date: r.segments.date,
    spend: Math.round((parseFloat(r.metrics.costMicros || 0) / 1000000) * 100) / 100
  }));
}

module.exports = { getNormalizedCampaigns, getDailyCampaignData, resetOAuth2Client };
