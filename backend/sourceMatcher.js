const fs = require('fs');
const path = require('path');

const MAPPINGS = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../config/sourceMapping.json'), 'utf8')
);

function removeLithuanianChars(str) {
  const map = {
    'ą': 'a', 'č': 'c', 'ę': 'e', 'ė': 'e', 'į': 'i',
    'š': 's', 'ų': 'u', 'ū': 'u', 'ž': 'z'
  };
  return str.split('').map(c => map[c] || c).join('');
}

function normalizeSource(str) {
  const normalized = removeLithuanianChars(
    str
      .toLowerCase()
      .replace(/\(lead generation\)/g, '')
      .replace(/\(lead\s*generation\)/g, '')
      .replace(/\blead\b/g, '')
      .replace(/\bgeneration\b/g, '')
      .replace(/\bfacebook\b/g, '')
      .replace(/\bmeta\b/g, '')
      .replace(/\bform\b/g, '')
      .replace(/\bcampaign\b/g, '')
      .replace(/[\(\)\[\]_\-]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );

  return normalized.split(' ').sort().join(' ');
}

function calculateSimilarity(a, b) {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;

  if (longer.includes(shorter)) {
    return shorter.length / longer.length;
  }

  const matrix = Array(shorter.length + 1).fill(null)
    .map(() => Array(longer.length + 1).fill(null));

  for (let i = 0; i <= shorter.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= longer.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= shorter.length; i++) {
    for (let j = 1; j <= longer.length; j++) {
      const cost = shorter[i - 1] === longer[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  const maxLen = Math.max(a.length, b.length);
  return 1 - matrix[shorter.length][longer.length] / maxLen;
}

function matchSource(metaCampaignName, bitrixSource) {
  const normalizedMeta = normalizeSource(metaCampaignName);
  const normalizedBitrix = normalizeSource(bitrixSource);

  if (!normalizedBitrix) {
    return { confidence: 0, matched: false, normalizedMeta, normalizedBitrix };
  }

  const campaignConfig = MAPPINGS.campaigns.find(c =>
    normalizeSource(c.metaCampaign) === normalizedMeta
  );

  if (campaignConfig) {
    const matches = campaignConfig.allowedSources.some(s => {
      const normalizedAllowed = normalizeSource(s);
      return normalizedAllowed === normalizedBitrix;
    });

    if (matches) {
      return { confidence: 100, matched: true, normalizedMeta, normalizedBitrix };
    }
  }

  if (normalizedMeta === normalizedBitrix) {
    return { confidence: 100, matched: true, normalizedMeta, normalizedBitrix };
  }

  if (normalizedMeta.includes(normalizedBitrix) || normalizedBitrix.includes(normalizedMeta)) {
    return { confidence: 80, matched: true, normalizedMeta, normalizedBitrix };
  }

  const similarity = calculateSimilarity(normalizedMeta, normalizedBitrix);
  if (similarity >= 0.8) {
    return { confidence: Math.round(similarity * 100), matched: true, normalizedMeta, normalizedBitrix };
  }

  return { confidence: Math.round(similarity * 100), matched: false, normalizedMeta, normalizedBitrix };
}

function getAllowedSources(metaCampaignName) {
  const normalizedMeta = normalizeSource(metaCampaignName);
  const campaignConfig = MAPPINGS.campaigns.find(c =>
    normalizeSource(c.metaCampaign) === normalizedMeta
  );
  return campaignConfig ? campaignConfig.allowedSources : [];
}

module.exports = { matchSource, normalizeSource, removeLithuanianChars, getAllowedSources };
