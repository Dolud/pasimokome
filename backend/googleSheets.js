const { google } = require('googleapis');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

let sheetsClient = null;

function resetSheetsClient() { sheetsClient = null; }

function getMonthSheetName(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year} ${month}`;
}

function getDaysInRange(startDate, endDate, monthSheetName) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const [year, month] = monthSheetName.split(' ').map(Number);
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);

  const rangeStart = start > monthStart ? start : monthStart;
  const rangeEnd = end < monthEnd ? end : monthEnd;

  if (rangeStart > rangeEnd) return 0;

  return Math.round((rangeEnd - rangeStart) / (1000 * 60 * 60 * 24)) + 1;
}

async function getSheetsClient() {
  if (sheetsClient) return sheetsClient;

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN
  });

  sheetsClient = google.sheets({ version: 'v4', auth: oauth2Client });
  return sheetsClient;
}

async function getSheetValue(sheetName, cell) {
  const sheets = await getSheetsClient();
  const range = `'${sheetName}'!${cell}`;

  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  const values = response.data.values;
  if (!values || values.length === 0) return null;
  return values[0][0];
}

function colIndexToLetter(index) {
  let letter = '';
  let i = index;
  while (i >= 0) {
    letter = String.fromCharCode(65 + (i % 26)) + letter;
    i = Math.floor(i / 26) - 1;
  }
  return letter;
}

const PLANAS_HEADER = 'Išleista marketingui (FB+Google su PVM) Stovyklos';

async function findColumnForHeader(sheetName, headerText) {
  const sheets = await getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheetName}'!1:1`,
  });

  const normalizedSearch = headerText.replace(/\n/g, ' ').trim().toLowerCase();

  const row = response.data.values ? response.data.values[0] : [];
  for (let i = 0; i < row.length; i++) {
    const normalizedCell = String(row[i]).replace(/\n/g, ' ').trim().toLowerCase();
    if (normalizedCell.includes(normalizedSearch)) {
      return colIndexToLetter(i);
    }
  }
  return null;
}

async function getPlanasAmount(startDate, endDate) {
  try {
    const months = new Set();
    const start = new Date(startDate);
    const end = new Date(endDate);

    const current = new Date(start);
    while (current <= end) {
      months.add(getMonthSheetName(current));
      current.setDate(current.getDate() + 1);
    }

    let totalPlanas = 0;

    for (const monthSheet of months) {
      const col = await findColumnForHeader(monthSheet, PLANAS_HEADER);
      if (!col) {
        console.error(`Header "${PLANAS_HEADER}" not found in sheet "${monthSheet}"`);
        continue;
      }

      const dailyValue = await getSheetValue(monthSheet, `${col}3`);
      if (dailyValue === null || dailyValue === undefined) continue;

      const num = parseFloat(String(dailyValue).replace(',', '.').replace(/[^\d.-]/g, ''));
      if (isNaN(num)) continue;

      const days = getDaysInRange(startDate, endDate, monthSheet);
      totalPlanas += num * days;
    }

    return Math.round(totalPlanas * 100) / 100;
  } catch (error) {
    console.error('Error getting Planas:', error.message);
    return null;
  }
}

const LEADS_HEADER = 'Gautos tikslinės užklausos (stovyklos)';

async function getLeadsPlanasAmount(startDate, endDate) {
  try {
    const months = new Set();
    const start = new Date(startDate);
    const end = new Date(endDate);

    const current = new Date(start);
    while (current <= end) {
      months.add(getMonthSheetName(current));
      current.setDate(current.getDate() + 1);
    }

    let total = 0;

    for (const monthSheet of months) {
      const col = await findColumnForHeader(monthSheet, LEADS_HEADER);
      if (!col) {
        console.error(`Header "${LEADS_HEADER}" not found in sheet "${monthSheet}"`);
        continue;
      }

      const dailyValue = await getSheetValue(monthSheet, `${col}3`);
      if (dailyValue === null || dailyValue === undefined) continue;

      const num = parseFloat(String(dailyValue).replace(',', '.').replace(/[^\d.-]/g, ''));
      if (isNaN(num)) continue;

      const days = getDaysInRange(startDate, endDate, monthSheet);
      total += num * days;
    }

    return Math.round(total * 100) / 100;
  } catch (error) {
    console.error('Error getting Leads Planas:', error.message);
    return null;
  }
}

const ONLINE_PAMOKOS_PLANAS_HEADER = 'Išleista marketingui (FB+Google su PVM)';
const ONLINE_PAMOKOS_LEADS_HEADER = 'Gautos tikslinės užklausos';

const DEALS_COUNT_HEADER_STOVYKLA = 'Pardavimai (stovyklos)';
const DEALS_COUNT_HEADER_ONLINE = 'Pardavimai (naujos užklausos)';
const STOVYKLA_APYVARTA_AVANSAI_HEADER = 'Apyvarta (stovyklos) Avansai';
const STOVYKLA_APYVARTA_LIKUTINE_HEADER = 'Apyvarta (stovyklos) Likutinė suma';

async function getStovyklaSumaAmount(startDate, endDate) {
  try {
    const months = new Set();
    const start = new Date(startDate);
    const end = new Date(endDate);

    const current = new Date(start);
    while (current <= end) {
      months.add(getMonthSheetName(current));
      current.setDate(current.getDate() + 1);
    }

    let avansai = 0;
    let likutine = 0;

    for (const monthSheet of months) {
      let avansaiCol = null;
      let likutineCol = null;

      for (const col of [STOVYKLA_APYVARTA_AVANSAI_HEADER, STOVYKLA_APYVARTA_LIKUTINE_HEADER]) {
        const c = await findColumnForHeader(monthSheet, col);
        if (col === STOVYKLA_APYVARTA_AVANSAI_HEADER) avansaiCol = c;
        else likutineCol = c;
      }
      if (!avansaiCol) console.error(`Header "${STOVYKLA_APYVARTA_AVANSAI_HEADER}" not found in sheet "${monthSheet}"`);
      if (!likutineCol) console.error(`Header "${STOVYKLA_APYVARTA_LIKUTINE_HEADER}" not found in sheet "${monthSheet}"`);

      const days = getDaysInRange(startDate, endDate, monthSheet);

      for (const [col, store] of [[avansaiCol, 'a'], [likutineCol, 'l']]) {
        if (!col) continue;
        const dailyValue = await getSheetValue(monthSheet, `${col}3`);
        if (dailyValue === null || dailyValue === undefined) continue;
        const num = parseFloat(String(dailyValue).replace(',', '.').replace(/[^\d.-]/g, ''));
        if (isNaN(num)) continue;
        if (store === 'a') avansai += num * days;
        else likutine += num * days;
      }
    }

    return {
      avansai: Math.round(avansai * 100) / 100,
      likutine: Math.round(likutine * 100) / 100,
      suma: Math.round((avansai + likutine) * 100) / 100
    };
  } catch (error) {
    console.error('Error getting Stovykla Suma:', error.message);
    return null;
  }
}

async function getDealsCountPlanasAmount(startDate, endDate, headerText) {
  try {
    const months = new Set();
    const start = new Date(startDate);
    const end = new Date(endDate);

    const current = new Date(start);
    while (current <= end) {
      months.add(getMonthSheetName(current));
      current.setDate(current.getDate() + 1);
    }

    let totalPlanas = 0;

    for (const monthSheet of months) {
      const col = await findColumnForHeader(monthSheet, headerText);
      if (!col) {
        console.error(`Header "${headerText}" not found in sheet "${monthSheet}"`);
        continue;
      }

      const dailyValue = await getSheetValue(monthSheet, `${col}3`);
      if (dailyValue === null || dailyValue === undefined) continue;

      let num = parseFloat(String(dailyValue).replace(',', '.').replace(/[^\d.-]/g, ''));
      if (isNaN(num)) continue;
      if (num === 0) num = 1;

      const days = getDaysInRange(startDate, endDate, monthSheet);
      totalPlanas += num * days;
    }

    return Math.round(totalPlanas * 100) / 100;
  } catch (error) {
    console.error(`Error getting Deals Count Planas (${headerText}):`, error.message);
    return null;
  }
}

async function getStovyklaDealsCountPlanasAmount(startDate, endDate) {
  return getDealsCountPlanasAmount(startDate, endDate, DEALS_COUNT_HEADER_STOVYKLA);
}

async function getOnlinePamokosDealsCountPlanasAmount(startDate, endDate) {
  return getDealsCountPlanasAmount(startDate, endDate, DEALS_COUNT_HEADER_ONLINE);
}

async function getOnlinePamokosPlanasAmount(startDate, endDate) {
  try {
    const months = new Set();
    const start = new Date(startDate);
    const end = new Date(endDate);

    const current = new Date(start);
    while (current <= end) {
      months.add(getMonthSheetName(current));
      current.setDate(current.getDate() + 1);
    }

    let totalPlanas = 0;

    for (const monthSheet of months) {
      const col = await findColumnForHeader(monthSheet, ONLINE_PAMOKOS_PLANAS_HEADER);
      if (!col) {
        console.error(`Header "${ONLINE_PAMOKOS_PLANAS_HEADER}" not found in sheet "${monthSheet}"`);
        continue;
      }

      const dailyValue = await getSheetValue(monthSheet, `${col}3`);
      if (dailyValue === null || dailyValue === undefined) continue;

      const num = parseFloat(String(dailyValue).replace(',', '.').replace(/[^\d.-]/g, ''));
      if (isNaN(num)) continue;

      const days = getDaysInRange(startDate, endDate, monthSheet);
      totalPlanas += num * days;
    }

    return Math.round(totalPlanas * 100) / 100;
  } catch (error) {
    console.error('Error getting Online Pamokos Planas:', error.message);
    return null;
  }
}

async function getOnlinePamokosLeadsPlanasAmount(startDate, endDate) {
  try {
    const months = new Set();
    const start = new Date(startDate);
    const end = new Date(endDate);

    const current = new Date(start);
    while (current <= end) {
      months.add(getMonthSheetName(current));
      current.setDate(current.getDate() + 1);
    }

    let total = 0;

    for (const monthSheet of months) {
      const col = await findColumnForHeader(monthSheet, ONLINE_PAMOKOS_LEADS_HEADER);
      if (!col) {
        console.error(`Header "${ONLINE_PAMOKOS_LEADS_HEADER}" not found in sheet "${monthSheet}"`);
        continue;
      }

      const dailyValue = await getSheetValue(monthSheet, `${col}3`);
      if (dailyValue === null || dailyValue === undefined) continue;

      const num = parseFloat(String(dailyValue).replace(',', '.').replace(/[^\d.-]/g, ''));
      if (isNaN(num)) continue;

      const days = getDaysInRange(startDate, endDate, monthSheet);
      total += num * days;
    }

    return Math.round(total * 100) / 100;
  } catch (error) {
    console.error('Error getting Online Pamokos Leads Planas:', error.message);
    return null;
  }
}

async function getOnlinePamokosMonthData(monthSheetName) {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${monthSheetName}'!1:1`,
  });
  const headers = headerRes.data.values ? headerRes.data.values[0] : [];

  const normalizedSearch = (h) => h.replace(/\n/g, ' ').trim().toLowerCase();
  const findCol = (search) => {
    const s = normalizedSearch(search);
    for (let i = 0; i < headers.length; i++) {
      if (normalizedSearch(String(headers[i])).includes(s)) {
        return colIndexToLetter(i);
      }
    }
    return null;
  };

  const budgetCol = findCol(ONLINE_PAMOKOS_PLANAS_HEADER);
  const leadsCol = findCol(ONLINE_PAMOKOS_LEADS_HEADER);
  const dealsCol = findCol(DEALS_COUNT_HEADER_ONLINE);

  const getVal = async (col) => {
    if (!col) return null;
    for (const row of [2, 3]) {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${monthSheetName}'!${col}${row}`,
      });
      const vals = res.data.values;
      if (!vals || !vals[0] || vals[0][0] === undefined || vals[0][0] === '') continue;
      const raw = String(vals[0][0]);
      const match = raw.match(/[\d]+([.,]\d+)?/);
      if (!match) continue;
      const num = parseFloat(match[0].replace(',', '.'));
      if (!isNaN(num) && num !== 0) return num;
    }
    return null;
  };

  return {
    daily: await getVal(budgetCol),
    leads_daily: await getVal(leadsCol),
    deals_daily: await getVal(dealsCol),
  };
}

module.exports = { getSheetValue, getPlanasAmount, getLeadsPlanasAmount, getOnlinePamokosPlanasAmount, getOnlinePamokosLeadsPlanasAmount, getStovyklaDealsCountPlanasAmount, getOnlinePamokosDealsCountPlanasAmount, getStovyklaSumaAmount, getMonthSheetName, getDaysInRange, getOnlinePamokosMonthData, resetSheetsClient };
