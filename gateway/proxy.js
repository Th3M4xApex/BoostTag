const fs = require('fs/promises');
const path = require('path');

const dataPath = path.join(__dirname, 'data.json');

const timestampFormat = {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: true
};

const locationPools = [
  'Restaurant Cellar - Shelf A1',
  'Restaurant Main Bar - Rack 2',
  'Restaurant Patio Bar - Cooler 1',
  'Restaurant Rooftop Bar - Cooler 3',
  'Restaurant VIP Lounge - Rack 1',
  'Liquor Store Downtown - Aisle 4',
  'Liquor Store Uptown - Chiller B',
  'Liquor Store Eastside - Aisle 6',
  'Liquor Store West End - Display Table',
  'Liquor Store Northpoint - Reserve Cabinet'
];

const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const pickRandomIndexes = (length, count) => {
  const picked = new Set();
  while (picked.size < count) {
    picked.add(randomInt(0, length - 1));
  }
  return [...picked];
};

const readSourceData = async () => {
  const rawData = await fs.readFile(dataPath, 'utf8');
  const items = JSON.parse(rawData);

  if (!Array.isArray(items)) {
    throw new Error('data.json must contain an array');
  }

  return items;
};

const getHubData = async ({ simulateScan = false } = {}) => {
  const items = await readSourceData();

  if (!simulateScan) {
    return items;
  }

  const scannedAt = new Date().toLocaleString('en-US', timestampFormat);
  const updateCount = randomInt(1, Math.min(5, items.length));
  const indexesToUpdate = pickRandomIndexes(items.length, updateCount);

  const updatedItems = items.map((item, index) => {
    if (!indexesToUpdate.includes(index)) {
      return item;
    }

    return {
      ...item,
      lastLocation: locationPools[randomInt(0, locationPools.length - 1)],
      lastUpdate: scannedAt
    };
  });

  return {
    items: updatedItems,
    updatedCount: updateCount
  };
};

module.exports = {
  getHubData
};
