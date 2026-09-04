const fs = require('fs');
const path = require('path');

const MAPPING_PATH = path.join(__dirname, '../config/campaignMapping.json');

function loadMapping() {
  try {
    if (fs.existsSync(MAPPING_PATH)) {
      return JSON.parse(fs.readFileSync(MAPPING_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('[campaignMapping] Error loading:', e.message);
  }
  return { campaigns: {} };
}

function saveMapping(data) {
  const dir = path.dirname(MAPPING_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(MAPPING_PATH, JSON.stringify(data, null, 2));
}

function getCampaignsForProduct(product) {
  const mapping = loadMapping();
  return Object.entries(mapping.campaigns)
    .filter(([_, cat]) => cat === product)
    .map(([name]) => name);
}

function autoDetectCategory(campaignName) {
  const lower = campaignName.toLowerCase();
  if (lower.includes('stovykla')) return '101';
  return '97';
}

function getAllMappings() {
  return loadMapping().campaigns || {};
}

module.exports = { loadMapping, saveMapping, getCampaignsForProduct, autoDetectCategory, getAllMappings };
