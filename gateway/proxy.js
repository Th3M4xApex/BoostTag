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

const writeSourceData = async (items) => {
  await fs.writeFile(dataPath, `${JSON.stringify(items, null, 2)}\n`, 'utf8');
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
      lastUpdate: scannedAt
    };
  });

  return {
    items: updatedItems,
    updatedCount: updateCount
  };
};

const updateItemName = async ({ barcode, name }) => {
  const items = await readSourceData();
  const index = items.findIndex((item) => item.barcode === barcode);

  if (index === -1) {
    throw new Error('Item not found');
  }

  items[index] = {
    ...items[index],
    name
  };

  await writeSourceData(items);
  return items[index];
};

const deleteItem = async ({ barcode }) => {
  const items = await readSourceData();
  const filtered = items.filter((item) => item.barcode !== barcode);

  if (filtered.length === items.length) {
    throw new Error('Item not found');
  }

  await writeSourceData(filtered);
  return { barcode };
};

module.exports = {
  getHubData,
  updateItemName,
  deleteItem
};
