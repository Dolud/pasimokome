const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SETTINGS_PATH = path.join(__dirname, '../config/settings.json');
const DEFAULT_PASSWORD = 'pasimokome';

const SETTINGS_SCHEMA = {
  bitrix: {
    label: 'Bitrix24',
    fields: [
      { key: 'BITRIX_WEBHOOK', label: 'Webhook URL', type: 'text' },
    ]
  },
  meta: {
    label: 'Meta Ads',
    fields: [
      { key: 'META_ACCESS_TOKEN', label: 'Access Token', type: 'password' },
      { key: 'META_PAGE_ACCESS_TOKEN', label: 'Page Access Token', type: 'password' },
      { key: 'META_PAGE_ID', label: 'Page ID', type: 'text' },
      { key: 'META_APP_SECRET', label: 'App Secret', type: 'password' },
      { key: 'META_LONG_LIVED_USER_TOKEN', label: 'Long-Lived Token', type: 'password' },
      { key: 'META_AD_ACCOUNT_ID', label: 'Ad Account ID', type: 'text' },
    ]
  },
  googleSheets: {
    label: 'Google Sheets',
    fields: [
      { key: 'GOOGLE_CLIENT_ID', label: 'Client ID', type: 'text' },
      { key: 'GOOGLE_CLIENT_SECRET', label: 'Client Secret', type: 'password' },
      { key: 'GOOGLE_REFRESH_TOKEN', label: 'Refresh Token', type: 'password' },
      { key: 'GOOGLE_SPREADSHEET_ID', label: 'Spreadsheet ID', type: 'text' },
    ]
  },
  googleAds: {
    label: 'Google Ads',
    fields: [
      { key: 'GOOGLE_ADS_DEVELOPER_TOKEN', label: 'Developer Token', type: 'password' },
      { key: 'GOOGLE_ADS_CLIENT_ID', label: 'Client ID', type: 'text' },
      { key: 'GOOGLE_ADS_CLIENT_SECRET', label: 'Client Secret', type: 'password' },
      { key: 'GOOGLE_ADS_REFRESH_TOKEN', label: 'Refresh Token', type: 'password' },
      { key: 'GOOGLE_ADS_CUSTOMER_ID', label: 'Customer ID', type: 'text' },
      { key: 'GOOGLE_ADS_LOGIN_CUSTOMER_ID', label: 'Login Customer ID', type: 'text' },
    ]
  },
  general: {
    label: 'Bendri nustatymai',
    fields: [
      { key: 'PORT', label: 'Port', type: 'number', default: '3000' },
      { key: 'BITRIX_CONVERTED_STATUS_ID', label: 'Converted Status ID', type: 'text' },
    ]
  }
};

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
      for (const [key, value] of Object.entries(settings)) {
        if (key !== 'password' && value) {
          process.env[key] = String(value);
        }
      }
      return settings;
    }
  } catch (e) {
    console.error('[settings] Error loading settings:', e.message);
  }
  return null;
}

function readSettingsFile() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function getSettings() {
  const saved = readSettingsFile();
  const result = {};
  for (const [group, config] of Object.entries(SETTINGS_SCHEMA)) {
    result[group] = {
      label: config.label,
      fields: config.fields.map(f => ({
        key: f.key,
        label: f.label,
        type: f.type,
        value: saved[f.key] || process.env[f.key] || f.default || '',
      }))
    };
  }
  return result;
}

function getSettingsForSave() {
  const saved = readSettingsFile();
  const result = {};
  for (const [group, config] of Object.entries(SETTINGS_SCHEMA)) {
    result[group] = {
      label: config.label,
      fields: config.fields.map(f => ({
        key: f.key,
        label: f.label,
        type: f.type,
        value: saved[f.key] || process.env[f.key] || f.default || '',
      }))
    };
  }
  return result;
}

function saveSettings(newSettings) {
  let existing = readSettingsFile();

  if (newSettings.password && newSettings.password.trim()) {
    existing.password = hashPassword(newSettings.password.trim());
  }
  delete newSettings.password;

  for (const [key, value] of Object.entries(newSettings)) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      existing[key] = String(value).trim();
    }
  }

  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(existing, null, 2));

  for (const [key, value] of Object.entries(existing)) {
    if (key !== 'password' && value) {
      process.env[key] = String(value);
    }
  }

  return existing;
}

function verifyPassword(password) {
  const settings = readSettingsFile();
  const stored = settings.password || hashPassword(DEFAULT_PASSWORD);
  return hashPassword(password) === stored;
}

async function testBitrix() {
  const webhook = process.env.BITRIX_WEBHOOK;
  if (!webhook) return { ok: false, error: 'Nesukonfigūruota' };
  try {
    const response = await fetch(`${webhook}crm.status.list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ENTITY_ID: 'LEAD' })
    });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    const data = await response.json();
    if (data.error) return { ok: false, error: data.error };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function testMeta() {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return { ok: false, error: 'Nesukonfigūruota' };
  try {
    const response = await fetch(`https://graph.facebook.com/v21.0/me?access_token=${token}`);
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    const data = await response.json();
    if (data.error) return { ok: false, error: data.error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function testGoogleSheets() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
  if (!clientId || !clientSecret || !refreshToken) {
    return { ok: false, error: 'Nesukonfigūruota' };
  }
  try {
    const { google } = require('googleapis');
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "'2026 09'!1:1",
    });
    if (!response.data.values || response.data.values.length === 0) {
      return { ok: false, error: 'Lentelė tuščia' };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function testGoogleAds() {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    return { ok: false, error: 'Nesukonfigūruota' };
  }
  try {
    const { google } = require('googleapis');
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    await oauth2Client.getAccessToken();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = {
  SETTINGS_SCHEMA,
  hashPassword,
  loadSettings,
  getSettings,
  getSettingsForSave,
  saveSettings,
  verifyPassword,
  testBitrix,
  testMeta,
  testGoogleSheets,
  testGoogleAds,
};
