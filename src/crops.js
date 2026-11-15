'use strict';
// Built-in crop library.
// spacing = in-row plant spacing (inches), row = between-row spacing (inches).
// Timing values are WEEKS RELATIVE TO LAST SPRING FROST (negative = before). null = not applicable.
// indoor: start seeds indoors, transplant: set out, direct: direct sow outdoors.

const C = (id, name, category, family, icon, color, spacing, row, indoor, transplant, direct, dtm, extra = {}) =>
  ({ id, name, category, family, icon, color, spacing, row, indoor, transplant, direct, dtm, ...extra });

const CROPS = [
  // Nightshades
  C('tomato', 'Tomato', 'Vegetable', 'Nightshade', '🍅', '#e5484d', 24, 36, [-8, -6], [1, 3], null, 75),
  C('cherry-tomato', 'Cherry Tomato', 'Vegetable', 'Nightshade', '🍅', '#f76b15', 24, 36, [-8, -6], [1, 3], null, 65),
  C('bell-pepper', 'Bell Pepper', 'Vegetable', 'Nightshade', '🫑', '#30a46c', 18, 24, [-10, -8], [2, 4], null, 75),
  C('hot-pepper', 'Hot Pepper', 'Vegetable', 'Nightshade', '🌶️', '#dc3e42', 18, 24, [-10, -8], [2, 4], null, 80),
  C('eggplant', 'Eggplant', 'Vegetable', 'Nightshade', '🍆', '#8e4ec6', 24, 30, [-10, -8], [2, 4], null, 80),
  C('potato', 'Potato', 'Vegetable', 'Nightshade', '🥔', '#ad7f58', 12, 30, null, null, [-3, 1], 90),
  C('tomatillo', 'Tomatillo', 'Vegetable', 'Nightshade', '🟢', '#86b33a', 36, 36, [-8, -6], [1, 3], null, 75),
  // Cucurbits
  C('cucumber', 'Cucumber', 'Vegetable', 'Cucurbit', '🥒', '#3e9b4f', 12, 36, [-4, -3], [1, 3], [1, 4], 60),
  C('zucchini', 'Zucchini', 'Vegetable', 'Cucurbit', '🥒', '#2b7a3d', 36, 48, [-4, -3], [1, 3], [1, 3], 55),
  C('summer-squash', 'Summer Squash', 'Vegetable', 'Cucurbit', '🟡', '#ffc53d', 36, 48, [-4, -3], [1, 3], [1, 3], 55),
  C('winter-squash', 'Winter Squash', 'Vegetable', 'Cucurbit', '🎃', '#e2a336', 48, 72, [-4, -3], [2, 3], [2, 4], 100),
  C('pumpkin', 'Pumpkin', 'Vegetable', 'Cucurbit', '🎃', '#f76b15', 60, 96, [-4, -3], [2, 3], [2, 4], 110),
  C('watermelon', 'Watermelon', 'Fruit', 'Cucurbit', '🍉', '#e54666', 48, 72, [-4, -3], [2, 4], [2, 4], 85),
  C('cantaloupe', 'Cantaloupe', 'Fruit', 'Cucurbit', '🍈', '#f5a45a', 36, 60, [-4, -3], [2, 4], [2, 4], 85),
  // Brassicas
  C('broccoli', 'Broccoli', 'Vegetable', 'Brassica', '🥦', '#2f8f46', 18, 24, [-8, -6], [-3, -1], null, 65),
  C('cauliflower', 'Cauliflower', 'Vegetable', 'Brassica', '🥦', '#d9d2c3', 18, 24, [-8, -6], [-2, 0], null, 70),
  C('cabbage', 'Cabbage', 'Vegetable', 'Brassica', '🥬', '#7fbf6a', 18, 24, [-8, -6], [-4, -2], null, 70),
  C('brussels-sprouts', 'Brussels Sprouts', 'Vegetable', 'Brassica', '🟢', '#4b8a3a', 24, 30, [-6, -4], [-2, 0], null, 100),
  C('kale', 'Kale', 'Vegetable', 'Brassica', '🥬', '#2e6b3c', 18, 24, [-8, -6], [-4, -2], [-4, -2], 55),
  C('collards', 'Collard Greens', 'Vegetable', 'Brassica', '🥬', '#3d7f45', 18, 24, [-8, -6], [-4, -2], [-4, -2], 60),
  C('bok-choy', 'Bok Choy', 'Vegetable', 'Brassica', '🥬', '#9dd27b', 10, 18, [-6, -4], [-3, -1], [-4, 0], 45),
  C('kohlrabi', 'Kohlrabi', 'Vegetable', 'Brassica', '🟣', '#a385d6', 6, 12, null, null, [-4, -2], 50),
  C('radish', 'Radish', 'Vegetable', 'Brassica', '🔴', '#e5484d', 2, 12, null, null, [-6, -1], 25),
  C('turnip', 'Turnip', 'Vegetable', 'Brassica', '🟣', '#c792e9', 4, 12, null, null, [-4, -2], 50),
  C('arugula', 'Arugula', 'Vegetable', 'Brassica', '🌿', '#5aa05a', 6, 12, null, null, [-6, 0], 40),
  // Greens
  C('lettuce-head', 'Lettuce (head)', 'Vegetable', 'Aster', '🥬', '#8fd16a', 12, 12, [-6, -4], [-2, 2], [-4, 2], 55),
  C('lettuce-leaf', 'Lettuce (leaf)', 'Vegetable', 'Aster', '🥬', '#b6e388', 6, 12, null, null, [-4, 2], 45),
  C('spinach', 'Spinach', 'Vegetable', 'Amaranth', '🍃', '#2f7d32', 4, 12, null, null, [-6, -2], 40),
  C('swiss-chard', 'Swiss Chard', 'Vegetable', 'Amaranth', '🥬', '#d6409f', 12, 18, [-6, -4], [-2, 0], [-2, 2], 55),
  C('beet', 'Beet', 'Vegetable', 'Amaranth', '🟣', '#9e1c4f', 4, 12, null, null, [-4, -1], 55),
  // Roots / umbels
  C('carrot', 'Carrot', 'Vegetable', 'Umbel', '🥕', '#f76b15', 3, 12, null, null, [-4, -1], 70),
  C('parsnip', 'Parsnip', 'Vegetable', 'Umbel', '🥕', '#e8d8b0', 4, 18, null, null, [-4, -2], 110),
  C('celery', 'Celery', 'Vegetable', 'Umbel', '🌿', '#93c47d', 8, 24, [-12, -10], [1, 2], null, 120),
  C('sweet-potato', 'Sweet Potato', 'Vegetable', 'Morning Glory', '🍠', '#c1673d', 12, 36, null, [2, 4], null, 100),
  // Alliums
  C('onion', 'Onion', 'Vegetable', 'Allium', '🧅', '#c9a227', 4, 12, [-12, -10], [-4, -2], null, 100),
  C('green-onion', 'Green Onion', 'Vegetable', 'Allium', '🌱', '#6bbf59', 2, 6, null, null, [-4, 0], 60),
  C('leek', 'Leek', 'Vegetable', 'Allium', '🌱', '#8ab17d', 6, 12, [-12, -10], [-2, 0], null, 120),
  C('garlic', 'Garlic', 'Vegetable', 'Allium', '🧄', '#efe7d4', 6, 12, null, null, null, 240, { note: 'Plant cloves in fall, 2–4 weeks before the ground freezes.' }),
  C('shallot', 'Shallot', 'Vegetable', 'Allium', '🧅', '#b07a4f', 6, 12, null, [-4, -2], null, 90),
  // Legumes
  C('bush-bean', 'Bush Bean', 'Vegetable', 'Legume', '🫘', '#5b8c3a', 4, 18, null, null, [1, 3], 55),
  C('pole-bean', 'Pole Bean', 'Vegetable', 'Legume', '🫘', '#3e7b27', 6, 30, null, null, [1, 3], 65),
  C('lima-bean', 'Lima Bean', 'Vegetable', 'Legume', '🫘', '#a3c46c', 6, 24, null, null, [2, 4], 75),
  C('pea', 'Pea', 'Vegetable', 'Legume', '🫛', '#46a758', 2, 18, null, null, [-6, -3], 60),
  C('snap-pea', 'Snap Pea', 'Vegetable', 'Legume', '🫛', '#65ba74', 2, 18, null, null, [-6, -3], 60),
  // Others
  C('sweet-corn', 'Sweet Corn', 'Vegetable', 'Grass', '🌽', '#f5d90a', 12, 30, null, null, [1, 3], 80),
  C('okra', 'Okra', 'Vegetable', 'Mallow', '🌿', '#4c9a2a', 12, 36, [-6, -4], [3, 5], [3, 5], 60),
  C('asparagus', 'Asparagus', 'Vegetable', 'Asparagus', '🌱', '#5f9e4a', 18, 36, null, [-4, -2], null, 730, { perennial: true }),
  C('rhubarb', 'Rhubarb', 'Vegetable', 'Knotweed', '🌿', '#c2185b', 36, 36, null, [-4, -2], null, 365, { perennial: true }),
  C('artichoke', 'Artichoke', 'Vegetable', 'Aster', '🌿', '#6f8f72', 36, 48, [-10, -8], [0, 2], null, 150, { perennial: true }),
  // Fruit
  C('strawberry', 'Strawberry', 'Fruit', 'Rose', '🍓', '#e5484d', 12, 24, null, [-4, -2], null, 90, { perennial: true }),
  C('blueberry', 'Blueberry', 'Fruit', 'Heath', '🫐', '#3e63dd', 48, 72, null, [-4, -2], null, 730, { perennial: true }),
  C('raspberry', 'Raspberry', 'Fruit', 'Rose', '🍇', '#c2298a', 24, 72, null, [-4, -2], null, 365, { perennial: true }),
  // Herbs
  C('basil', 'Basil', 'Herb', 'Mint', '🌿', '#3faa54', 12, 12, [-6, -4], [1, 2], [1, 2], 60),
  C('cilantro', 'Cilantro', 'Herb', 'Umbel', '🌿', '#79c26b', 6, 12, null, null, [-2, 2], 50),
  C('parsley', 'Parsley', 'Herb', 'Umbel', '🌿', '#2f9e44', 8, 12, [-10, -8], [-2, 0], [-3, -1], 75),
  C('dill', 'Dill', 'Herb', 'Umbel', '🌿', '#b5d99c', 12, 18, null, null, [-1, 1], 50),
  C('chives', 'Chives', 'Herb', 'Allium', '🌱', '#7a9e3c', 8, 12, [-8, -6], [-2, 0], [-4, -2], 75, { perennial: true }),
  C('oregano', 'Oregano', 'Herb', 'Mint', '🌿', '#6a994e', 12, 18, [-8, -6], [0, 2], null, 80, { perennial: true }),
  C('thyme', 'Thyme', 'Herb', 'Mint', '🌿', '#8aa37b', 12, 12, [-8, -6], [0, 2], null, 85, { perennial: true }),
  C('rosemary', 'Rosemary', 'Herb', 'Mint', '🌿', '#5c7c5a', 24, 24, [-10, -8], [1, 2], null, 90, { perennial: true }),
  C('sage', 'Sage', 'Herb', 'Mint', '🌿', '#93a98a', 18, 24, [-8, -6], [0, 2], null, 75, { perennial: true }),
  C('mint', 'Mint', 'Herb', 'Mint', '🌿', '#2db67c', 18, 24, null, [-2, 0], null, 60, { perennial: true, note: 'Spreads aggressively — consider a container.' }),
  C('lavender', 'Lavender', 'Herb', 'Mint', '🪻', '#8e4ec6', 18, 24, [-10, -8], [1, 2], null, 100, { perennial: true }),
  // Flowers
  C('marigold', 'Marigold', 'Flower', 'Aster', '🌼', '#ffb224', 8, 12, [-6, -4], [0, 1], [0, 2], 50),
  C('nasturtium', 'Nasturtium', 'Flower', 'Nasturtium', '🌸', '#f76b15', 10, 12, null, null, [0, 2], 50),
  C('sunflower', 'Sunflower', 'Flower', 'Aster', '🌻', '#ffc53d', 18, 30, null, null, [1, 3], 80),
  C('zinnia', 'Zinnia', 'Flower', 'Aster', '🌺', '#e93d82', 9, 12, [-6, -4], [1, 2], [1, 2], 60),
  C('cosmos', 'Cosmos', 'Flower', 'Aster', '🌸', '#f381c2', 12, 18, [-6, -4], [0, 2], [0, 2], 70),
  C('calendula', 'Calendula', 'Flower', 'Aster', '🌼', '#ff9f1a', 10, 12, [-6, -4], [-1, 1], [-2, 1], 55),
];

// Companion planting (kept intentionally conservative; common garden lore).
const COMPANIONS = {
  tomato: { good: ['basil', 'marigold', 'carrot', 'onion', 'parsley', 'chives', 'nasturtium', 'lettuce-leaf', 'calendula'], bad: ['potato', 'fennel', 'cabbage', 'broccoli', 'cauliflower', 'kohlrabi', 'sweet-corn'] },
  'cherry-tomato': { good: ['basil', 'marigold', 'carrot', 'onion', 'parsley', 'chives'], bad: ['potato', 'cabbage', 'broccoli', 'sweet-corn'] },
  'bell-pepper': { good: ['basil', 'onion', 'carrot', 'spinach', 'marigold'], bad: ['bush-bean', 'pole-bean', 'kohlrabi'] },
  'hot-pepper': { good: ['basil', 'onion', 'carrot', 'spinach'], bad: ['bush-bean', 'pole-bean'] },
  potato: { good: ['bush-bean', 'sweet-corn', 'cabbage', 'marigold'], bad: ['tomato', 'cherry-tomato', 'cucumber', 'winter-squash', 'pumpkin', 'sunflower', 'raspberry'] },
  cucumber: { good: ['bush-bean', 'pole-bean', 'pea', 'radish', 'sunflower', 'dill', 'nasturtium', 'sweet-corn'], bad: ['potato', 'sage'] },
  zucchini: { good: ['sweet-corn', 'bush-bean', 'nasturtium', 'radish'], bad: ['potato'] },
  'winter-squash': { good: ['sweet-corn', 'pole-bean', 'nasturtium', 'radish'], bad: ['potato'] },
  pumpkin: { good: ['sweet-corn', 'pole-bean', 'nasturtium'], bad: ['potato'] },
  'sweet-corn': { good: ['pole-bean', 'bush-bean', 'winter-squash', 'pumpkin', 'cucumber', 'zucchini', 'pea'], bad: ['tomato', 'cherry-tomato'] },
  'bush-bean': { good: ['sweet-corn', 'cucumber', 'potato', 'carrot', 'strawberry'], bad: ['onion', 'garlic', 'leek', 'chives', 'shallot', 'green-onion', 'bell-pepper'] },
  'pole-bean': { good: ['sweet-corn', 'cucumber', 'winter-squash', 'radish'], bad: ['onion', 'garlic', 'leek', 'chives', 'shallot', 'beet', 'green-onion'] },
  pea: { good: ['carrot', 'radish', 'cucumber', 'sweet-corn', 'lettuce-leaf'], bad: ['onion', 'garlic', 'leek', 'chives', 'shallot', 'green-onion'] },
  'snap-pea': { good: ['carrot', 'radish', 'cucumber', 'lettuce-leaf'], bad: ['onion', 'garlic', 'leek', 'chives', 'shallot'] },
  carrot: { good: ['onion', 'leek', 'chives', 'tomato', 'lettuce-leaf', 'pea', 'radish'], bad: ['dill', 'parsnip'] },
  onion: { good: ['carrot', 'beet', 'lettuce-head', 'tomato', 'cabbage', 'broccoli'], bad: ['bush-bean', 'pole-bean', 'pea', 'snap-pea'] },
  garlic: { good: ['tomato', 'carrot', 'beet', 'strawberry', 'cabbage'], bad: ['bush-bean', 'pole-bean', 'pea', 'snap-pea'] },
  cabbage: { good: ['onion', 'dill', 'sage', 'thyme', 'beet', 'celery'], bad: ['tomato', 'strawberry', 'pole-bean'] },
  broccoli: { good: ['onion', 'dill', 'beet', 'celery', 'rosemary'], bad: ['tomato', 'strawberry', 'pole-bean'] },
  kale: { good: ['beet', 'celery', 'onion', 'dill'], bad: ['strawberry', 'tomato'] },
  'lettuce-head': { good: ['carrot', 'radish', 'strawberry', 'chives', 'onion'], bad: [] },
  'lettuce-leaf': { good: ['carrot', 'radish', 'strawberry', 'chives'], bad: [] },
  basil: { good: ['tomato', 'cherry-tomato', 'bell-pepper', 'hot-pepper'], bad: ['sage', 'rosemary'] },
  strawberry: { good: ['bush-bean', 'lettuce-head', 'spinach', 'onion', 'thyme'], bad: ['cabbage', 'broccoli', 'cauliflower', 'kale'] },
  beet: { good: ['onion', 'lettuce-head', 'cabbage', 'garlic'], bad: ['pole-bean'] },
  dill: { good: ['cabbage', 'broccoli', 'cucumber', 'lettuce-head', 'onion'], bad: ['carrot', 'tomato'] },
  sunflower: { good: ['cucumber', 'sweet-corn'], bad: ['potato', 'pole-bean'] },
};

module.exports = { CROPS, COMPANIONS };
