const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { worker: adImageWorker, CACHE_DIR } = require('./adImageWorker');
const { getCampaignsForProduct } = require('./campaignMapping');

function getAccessToken() { return process.env.META_ACCESS_TOKEN; }
function getPageAccessToken() { return process.env.META_PAGE_ACCESS_TOKEN; }
function getAdAccountId() { return process.env.META_AD_ACCOUNT_ID; }

function getStovyklaCampaigns() { return getCampaignsForProduct('stovykla'); }
function getOnlinePamokosCampaigns() { return getCampaignsForProduct('online_pamokos'); }

async function metaRequest(endpoint, params = {}) {
  const accessToken = getAccessToken();
  const adAccountId = getAdAccountId();
  if (!accessToken || !adAccountId) {
    throw new Error('META_ACCESS_TOKEN and META_AD_ACCOUNT_ID must be set');
  }

  const url = new URL(`https://graph.facebook.com/v21.0/${adAccountId}/${endpoint}`);
  url.searchParams.set('access_token', accessToken);
  Object.entries(params).forEach(([key, val]) => {
    if (val !== undefined && val !== null) url.searchParams.set(key, val);
  });

  const response = await fetch(url.toString());
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(`Meta API error: ${response.status} - ${JSON.stringify(errorBody)}`);
  }

  return response.json();
}

async function metaNodeRequest(path, params = {}) {
  const accessToken = getAccessToken();
  if (!accessToken) {
    throw new Error('META_ACCESS_TOKEN must be set');
  }

  const url = new URL(`https://graph.facebook.com/v21.0/${path}`);
  url.searchParams.set('access_token', accessToken);
  Object.entries(params).forEach(([key, val]) => {
    if (val !== undefined && val !== null) url.searchParams.set(key, val);
  });

  const response = await fetch(url.toString());
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(`Meta API error: ${response.status} - ${JSON.stringify(errorBody)}`);
  }

  return response.json();
}

async function paginate(path, params = {}) {
  const rows = [];
  const accessToken = getAccessToken();
  let url = new URL(`https://graph.facebook.com/v21.0/${path}`);
  url.searchParams.set('access_token', accessToken);
  Object.entries(params).forEach(([key, val]) => {
    if (val !== undefined && val !== null) url.searchParams.set(key, val);
  });

  while (url) {
    const response = await fetch(url.toString());
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(`Meta API error: ${response.status} - ${JSON.stringify(errorBody)}`);
    }
    const page = await response.json();
    rows.push(...(page.data || []));
    url = page.paging && page.paging.next ? new URL(page.paging.next) : null;
  }

  return rows;
}

async function getAllCampaigns() {
  const adAccountId = getAdAccountId();
  const rows = await paginate(`${adAccountId}/campaigns`, {
    fields: 'name,id,status',
    limit: '100'
  });
  return rows.filter(c => c.status !== 'ARCHIVED').map(c => ({
    campaignId: c.id,
    campaignName: c.name,
    status: c.status,
  }));
}

async function pageRequest(path, params = {}) {
  const pageAccessToken = getPageAccessToken();
  if (!pageAccessToken) {
    throw new Error('META_PAGE_ACCESS_TOKEN must be set');
  }

  const url = new URL(`https://graph.facebook.com/v21.0/${path}`);
  url.searchParams.set('access_token', pageAccessToken);
  Object.entries(params).forEach(([key, val]) => {
    if (val !== undefined && val !== null) url.searchParams.set(key, val);
  });

  const response = await fetch(url.toString());
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(`Meta page API error: ${response.status} - ${JSON.stringify(errorBody)}`);
  }

  return response.json();
}

async function getCampaignData(startDate, endDate) {
  const fields = [
    'campaign_id', 'campaign_name', 'spend', 'impressions', 'clicks',
    'ctr', 'cpc', 'actions'
  ].join(',');

  const params = {
    'time_range[since]': startDate,
    'time_range[until]': endDate,
    time_increment: 'all_days',
    level: 'campaign',
    fields,
    limit: '100'
  };

  const data = await metaRequest('insights', params);
  return data.data || [];
}

function normalizeCampaignName(name) {
  return name
    .toLowerCase()
    .replace(/[ąàáâãäå]/g, 'a')
    .replace(/[čć]/g, 'c')
    .replace(/[ęèéêë]/g, 'e')
    .replace(/[ė]/g, 'e')
    .replace(/[įìíîï]/g, 'i')
    .replace(/[š]/g, 's')
    .replace(/[ųùúûü]/g, 'u')
    .replace(/[ū]/g, 'u')
    .replace(/[ž]/g, 'z')
    .replace(/\(lead generation\)/g, '')
    .replace(/lead/g, '')
    .replace(/generation/g, '')
    .replace(/facebook/g, '')
    .replace(/meta/g, '')
    .replace(/form/g, '')
    .replace(/campaign/g, '')
    .replace(/[\(\)\[\]_\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function getNormalizedCampaigns(startDate, endDate, targetCampaigns = null) {
  const insights = await getCampaignData(startDate, endDate);
  const filter = targetCampaigns || getStovyklaCampaigns();

  return insights
    .filter(c => filter.includes(c.campaign_name))
    .map(c => {
      const leadsAction = (c.actions || []).find(a => a.action_type === 'onsite_conversion.lead_grouped');
      const leadsCount = leadsAction ? parseInt(leadsAction.value, 10) : 0;

      return {
        campaignName: c.campaign_name,
        normalizedCampaign: normalizeCampaignName(c.campaign_name),
        spend: parseFloat(c.spend || 0),
        impressions: parseInt(c.impressions || 0, 10),
        clicks: parseInt(c.clicks || 0, 10),
        leads: leadsCount,
        ctr: parseFloat(c.ctr || 0),
        cpc: parseFloat(c.cpc || 0)
      };
    });
}

async function getDailyCampaignData(startDate, endDate, targetCampaigns = null) {
  const fields = ['campaign_name', 'spend', 'date_start'].join(',');

  const params = {
    'time_range[since]': startDate,
    'time_range[until]': endDate,
    time_increment: '1',
    level: 'campaign',
    fields,
    limit: '500'
  };

  let rows = [];
  let response = await metaRequest('insights', params);
  rows = rows.concat(response.data || []);

  let nextUrl = response.paging && response.paging.next;
  while (nextUrl) {
    const pageResponse = await fetch(nextUrl);
    if (!pageResponse.ok) break;
    const pageData = await pageResponse.json();
    rows = rows.concat(pageData.data || []);
    nextUrl = pageData.paging && pageData.paging.next;
  }

  const filter = targetCampaigns || getStovyklaCampaigns();

  return rows
    .filter(r => filter.includes(r.campaign_name))
    .map(r => ({
      campaignName: r.campaign_name,
      date: r.date_start,
      spend: parseFloat(r.spend || 0)
    }));
}

async function getAdLevelInsights(startDate, endDate, targetCampaigns = null) {
  const params = {
    'time_range[since]': startDate,
    'time_range[until]': endDate,
    time_increment: 'all_days',
    level: 'ad',
    fields: 'ad_id,ad_name,campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,actions',
    limit: '500'
  };

  let rows = [];
  let response = await metaRequest('insights', params);
  rows = rows.concat(response.data || []);

  let nextUrl = response.paging && response.paging.next;
  while (nextUrl) {
    const pageResponse = await fetch(nextUrl);
    if (!pageResponse.ok) break;
    const pageData = await pageResponse.json();
    rows = rows.concat(pageData.data || []);
    nextUrl = pageData.paging && pageData.paging.next;
  }

  const filter = targetCampaigns || [...getStovyklaCampaigns(), ...getOnlinePamokosCampaigns()];
  const adsByCampaign = await getAdsByCampaign(targetCampaigns);

  const cacheThumb = (adId) => {
    if (adsByCampaign[adId]) return adsByCampaign[adId].thumbnail;
    const cached = path.join(CACHE_DIR, `${adId}.jpg`);
    return fs.existsSync(cached) ? `/cache/ads/${adId}.jpg` : null;
  };

  const cacheText = (adId, creativeText) => {
    if (creativeText && !creativeText.includes('{{')) return creativeText;
    const txt = path.join(CACHE_DIR, `${adId}.txt`);
    if (!fs.existsSync(txt)) return creativeText || null;
    const rendered = fs.readFileSync(txt, 'utf8').trim();
    return rendered && !rendered.includes('{{') ? rendered : null;
  };

  return rows
    .filter(r => filter.includes(r.campaign_name))
    .map(r => {
      const leadsAction = (r.actions || []).find(a => a.action_type === 'onsite_conversion.lead_grouped');
      const leadsCount = leadsAction ? parseInt(leadsAction.value, 10) : 0;
      const spend = parseFloat(r.spend || 0);
      const adInfo = adsByCampaign[r.ad_id] || {};
      return {
        adId: r.ad_id,
        adName: r.ad_name,
        campaignId: r.campaign_id,
        campaignName: r.campaign_name,
        adsetName: adInfo.adsetName || null,
        status: adInfo.status || null,
        thumbnail: cacheThumb(r.ad_id),
        text: cacheText(r.ad_id, adInfo.text),
        spend,
        leads: leadsCount,
        impressions: parseInt(r.impressions || 0, 10),
        clicks: parseInt(r.clicks || 0, 10),
        ctr: parseFloat(r.ctr || 0),
        cpc: parseFloat(r.cpc || 0),
        cpl: leadsCount > 0 ? +(spend / leadsCount).toFixed(2) : (spend > 0 ? null : 0)
      };
    });
}

async function getAdsByCampaign(targetCampaigns = null) {
  const filter = targetCampaigns || [...getStovyklaCampaigns(), ...getOnlinePamokosCampaigns()];
  const campaigns = await getCampaignData('2025-01-01', new Date().toISOString().slice(0, 10));
  const adsByCampaign = {};

  for (const camp of campaigns) {
    if (!filter.includes(camp.campaign_name)) continue;
    const params = {
      fields: 'id,name,status,effective_status,adset{name},creative{body,title,image_url,image_hash,object_story_spec{page_id,link_data{call_to_action,message,picture,image_hash},video_data{message,image_url}},thumbnail_url}',
      limit: '100'
    };
    const ads = await paginate(`${camp.campaign_id}/ads`, params);
    for (const ad of ads) {
      const creative = ad.creative || {};
      const storySpec = creative.object_story_spec;
      const linkMessage = storySpec && storySpec.link_data && storySpec.link_data.message;
      const videoMessage = storySpec && storySpec.video_data && storySpec.video_data.message;
      const text = linkMessage || videoMessage || creative.body || creative.title || null;
      const imageHash = creative.image_hash
        || (storySpec && storySpec.link_data && storySpec.link_data.image_hash);
      adsByCampaign[ad.id] = {
        adId: ad.id,
        adName: ad.name,
        status: ad.effective_status || ad.status,
        campaignId: camp.campaign_id,
        campaignName: camp.campaign_name,
        adsetName: ad.adset && ad.adset.name,
        text: text && !text.includes('{{') ? text : null,
        thumbnail: null,
        imageUrl: creative.image_url || (storySpec && storySpec.video_data && storySpec.video_data.image_url) || (storySpec && storySpec.link_data && storySpec.link_data.picture) || null,
        imageHash,
        thumbUrl: creative.thumbnail_url || null
      };
    }
  }

  await resolveAdImages(adsByCampaign);
  return adsByCampaign;
}

function decodeExternalCdnUrl(url) {
  if (!url || !url.includes('external.')) return null;
  try {
    const parsed = new URL(url);
    const inner = parsed.searchParams.get('url');
    if (!inner) return null;
    const decoded = decodeURIComponent(inner);
    return decoded.includes('facebook.com/ads/image/') ? decoded : null;
  } catch (e) {
    return null;
  }
}

const adImagesCache = new Map();
const AD_IMAGES_CACHE_TTL = 60 * 60 * 1000;

async function resolveAdImages(adsByCampaign) {
  const hashes = [...new Set(Object.values(adsByCampaign).map(a => a.imageHash).filter(Boolean))];

  const hashUrlMap = new Map();
  const freshHashes = hashes.filter(h => {
    const cached = adImagesCache.get(h);
    if (cached && Date.now() - cached.ts < AD_IMAGES_CACHE_TTL) {
      hashUrlMap.set(h, cached.url);
      return false;
    }
    return true;
  });

  if (freshHashes.length) {
    const chunkSize = 50;
    for (let i = 0; i < freshHashes.length; i += chunkSize) {
      const chunk = freshHashes.slice(i, i + chunkSize);
      try {
        const url = new URL(`https://graph.facebook.com/v21.0/${getAdAccountId()}/adimages`);
        url.searchParams.set('access_token', getAccessToken());
        chunk.forEach((h, idx) => url.searchParams.set(`hashes[${idx}]`, h));
        url.searchParams.set('fields', 'url,width,height');
        const r = await (await fetch(url.toString())).json();
        const data = r.data || {};
        for (const item of data) {
          if (item && item.hash && item.url) {
            hashUrlMap.set(item.hash, item.url);
            adImagesCache.set(item.hash, { ts: Date.now(), url: item.url });
          }
        }
      } catch (e) {}
    }
  }

  for (const ad of Object.values(adsByCampaign)) {
    const cached = path.join(CACHE_DIR, `${ad.adId}.jpg`);
    const txtCached = path.join(CACHE_DIR, `${ad.adId}.txt`);
    if (fs.existsSync(cached)) {
      ad.thumbnail = `/cache/ads/${ad.adId}.jpg`;
      if (!ad.text && !txtCached) adImageWorker.enqueue(ad.adId);
      continue;
    }
    const big = ad.imageUrl
      || (ad.imageHash && hashUrlMap.get(ad.imageHash))
      || decodeExternalCdnUrl(ad.thumbUrl)
      || ad.thumbUrl;
    ad.thumbnail = big;
    const candidate = /p64x64|_t15\.|q75_tt6/.test(big) ? null : big;
    adImageWorker.enqueue(ad.adId, candidate);
  }
}

function extractLeadFields(fieldData = []) {
  const result = {};
  for (const f of fieldData) {
    const key = f.name;
    const value = (f.values || [])[0];
    result[key] = value;
    if (key === 'email') result.email = value;
    else if (key === 'full_name') result.fullName = value;
    else if (key === 'phone_number') result.phone = value;
    else if (key === 'phone') result.phone = value;
  }
  return result;
}

async function getLeads(startDate, endDate, targetCampaigns = null) {
  const adsByCampaign = await getAdsByCampaign(targetCampaigns);
  const adIds = Object.keys(adsByCampaign);
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T23:59:59');
  const leads = [];

  const CONCURRENCY = 15;
  for (let i = 0; i < adIds.length; i += CONCURRENCY) {
    const batch = adIds.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(async (adId) => {
      const rows = [];
      let path = `${adId}/leads`;
      let params = {
        fields: 'id,created_time,ad_id,ad_name,form_id,field_data',
        limit: '100'
      };

      try {
        let data = await pageRequest(path, params);
        rows.push(...(data.data || []));
        let nextUrl = data.paging && data.paging.next;
        while (nextUrl) {
          const pageResponse = await fetch(nextUrl);
          if (!pageResponse.ok) break;
          const pageData = await pageResponse.json();
          rows.push(...(pageData.data || []));
          nextUrl = pageData.paging && pageData.paging.next;
        }
      } catch (err) {
        return [];
      }

      return rows
        .filter(row => {
          const created = new Date(row.created_time);
          return created >= start && created <= end;
        })
        .map(row => ({
          leadId: row.id,
          createdTime: row.created_time,
          adId: row.ad_id,
          adName: adsByCampaign[row.ad_id] ? adsByCampaign[row.ad_id].adName : row.ad_name,
          adsetName: adsByCampaign[row.ad_id] && adsByCampaign[row.ad_id].adsetName,
          campaignId: adsByCampaign[row.ad_id] && adsByCampaign[row.ad_id].campaignId,
          campaignName: adsByCampaign[row.ad_id] && adsByCampaign[row.ad_id].campaignName,
          thumbnail: adsByCampaign[row.ad_id] && adsByCampaign[row.ad_id].thumbnail,
          fields: extractLeadFields(row.field_data)
        }));
    }));

    for (const batchLeads of results) leads.push(...batchLeads);
  }

  leads.sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime));
  return leads;
}

async function prewarmAdImages(startDate, endDate, targetCampaigns = null) {
  const filter = targetCampaigns || [...getStovyklaCampaigns(), ...getOnlinePamokosCampaigns()];
  const params = {
    'time_range[since]': startDate,
    'time_range[until]': endDate,
    time_increment: 'all_days',
    level: 'ad',
    fields: 'ad_id,campaign_name',
    limit: '500'
  };

  let rows = [];
  let response = await metaRequest('insights', params);
  rows = rows.concat(response.data || []);

  let nextUrl = response.paging && response.paging.next;
  while (nextUrl) {
    const pageResponse = await fetch(nextUrl);
    if (!pageResponse.ok) break;
    const pageData = await pageResponse.json();
    rows = rows.concat(pageData.data || []);
    nextUrl = pageData.paging && pageData.paging.next;
  }

  const adIds = [...new Set(rows.filter(r => filter.includes(r.campaign_name)).map(r => r.ad_id))];
  for (const adId of adIds) {
    const cached = path.join(CACHE_DIR, `${adId}.jpg`);
    const txtCached = path.join(CACHE_DIR, `${adId}.txt`);
    if (!fs.existsSync(cached) || !fs.existsSync(txtCached)) {
      adImageWorker.enqueue(adId);
    }
  }
  return adIds.length;
}

module.exports = { getNormalizedCampaigns, getDailyCampaignData, getLeads, getAdsByCampaign, getAdLevelInsights, prewarmAdImages, normalizeCampaignName, getStovyklaCampaigns, getOnlinePamokosCampaigns, getAllCampaigns };
