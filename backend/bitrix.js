const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const BITRIX_WEBHOOK = process.env.BITRIX_WEBHOOK;

async function bitrixRequest(method, params = {}) {
  const url = `${BITRIX_WEBHOOK}${method}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });

  if (!response.ok) {
    throw new Error(`Bitrix API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`Bitrix API error: ${data.error} - ${data.error_description || ''}`);
  }
  return data;
}

async function getProfile() {
  return bitrixRequest('profile.json');
}

async function getLeadFields() {
  return bitrixRequest('crm.lead.fields');
}

async function getStatusList() {
  const result = await bitrixRequest('crm.status.list', { ENTITY_ID: 'LEAD' });
  return result.result || [];
}

async function getSourceStatusMap() {
  const result = await bitrixRequest('crm.status.list', { ENTITY_ID: 'LEAD_SOURCE' });
  const statuses = result.result || [];
  const map = {};
  statuses.forEach(s => {
    if (s.STATUS_ID && s.NAME && s.ENTITY_ID === 'SOURCE') {
      map[s.STATUS_ID] = s.NAME;
    }
  });
  return map;
}

async function getAllLeads(filter = {}, select = []) {
  const allLeads = [];
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

    const result = await bitrixRequest('crm.lead.list', params);
    const items = result.result || [];
    allLeads.push(...items);

    if (items.length < batchSize || !result.next) {
      break;
    }
    start += batchSize;
  }

  return allLeads;
}

async function getDealSourceStatusMap() {
  const result = await bitrixRequest('crm.status.list', { ENTITY_ID: 'DEAL_SOURCE' });
  const statuses = result.result || [];
  const map = {};
  statuses.forEach(s => {
    if (s.STATUS_ID && s.NAME && s.ENTITY_ID === 'SOURCE') {
      map[s.STATUS_ID] = s.NAME;
    }
  });
  return map;
}

async function getContactSourceStatusMap() {
  const result = await bitrixRequest('crm.status.list', { ENTITY_ID: 'SOURCE' });
  const statuses = result.result || [];
  const map = {};
  statuses.forEach(s => {
    if (s.STATUS_ID && s.NAME && s.ENTITY_ID === 'SOURCE') {
      map[s.STATUS_ID] = s.NAME;
    }
  });
  return map;
}

async function getContactsByIds(ids) {
  if (!ids.length) return {};
  const result = await bitrixRequest('crm.contact.list', {
    filter: { ID: ids },
    select: ['ID', 'SOURCE_ID', 'SOURCE_DESCRIPTION']
  });
  const contacts = result.result || [];
  const map = {};
  contacts.forEach(c => { map[c.ID] = c; });
  return map;
}

module.exports = { bitrixRequest, getProfile, getLeadFields, getStatusList, getSourceStatusMap, getAllLeads, getDealSourceStatusMap, getContactSourceStatusMap, getContactsByIds };
