/**
 * Smart eBay category mapper with fuzzy matching.
 *
 * Maps Shopify product_type strings (which can be messy, e.g.
 * "camera point & shoot cameras" or "lenses slr lenses") to the correct
 * eBay category ID for UsedCameraGear store products.
 */

export interface CategoryRule {
  /** eBay category ID */
  categoryId: string;
  /** Human-readable category name */
  name: string;
  /** Keywords that trigger this category (checked against lowercased product_type) */
  keywords: string[];
  /** Priority — higher wins when multiple rules match */
  priority: number;
}

/**
 * Category rules ordered by specificity.  Higher-priority rules are checked
 * first so that "digital camera" beats the generic "camera" catch-all.
 */
export const CATEGORY_RULES: CategoryRule[] = [
  // ── Cameras ────────────────────────────────────────────────────
  {
    categoryId: '31388',
    name: 'Digital Cameras',
    keywords: [
      'digital camera',
      'digital cameras',
      'dslr',
      'mirrorless',
      'point & shoot',
      'point and shoot',
      'camera body',
      'camera bodies',
      'slr camera',
      'camera',
      'cameras',
    ],
    priority: 100,
  },

  // ── Lenses ─────────────────────────────────────────────────────
  {
    categoryId: '3323',
    name: 'Camera Lenses',
    keywords: [
      'lens',
      'lenses',
      'slr lens',
      'slr lenses',
      'camera lens',
      'camera lenses',
      'prime lens',
      'zoom lens',
      'wide angle',
      'telephoto',
      'macro lens',
    ],
    priority: 90,
  },

  // ── Film ───────────────────────────────────────────────────────
  {
    categoryId: '4201',
    name: 'Film Photography Film',
    keywords: [
      'camera film',
      'instant film',
      'film',
      '35mm film',
      'medium format film',
      '120 film',
      '110 film',
      'instant',
      'polaroid film',
      'instax',
    ],
    priority: 85,
  },

  // ── Film Cameras ───────────────────────────────────────────────
  {
    categoryId: '78997',
    name: 'Film Photography Cameras',
    keywords: [
      'film camera',
      'film cameras',
      'film slr',
      '35mm camera',
      'rangefinder',
      'medium format camera',
      'film photography camera',
    ],
    priority: 80,
  },

  // ── Flashes ────────────────────────────────────────────────────
  {
    categoryId: '183331',
    name: 'Flashes & Flash Accessories',
    keywords: [
      'flash',
      'speedlight',
      'speedlite',
      'strobe',
      'flash unit',
      'flash accessories',
    ],
    priority: 75,
  },

  // ── Tripods & Supports ─────────────────────────────────────────
  {
    categoryId: '30090',
    name: 'Tripods & Monopods',
    keywords: [
      'tripod',
      'monopod',
      'support',
      'gimbal',
      'stabilizer',
      'tripod head',
      'ball head',
    ],
    priority: 70,
  },

  // ── Bags & Cases ───────────────────────────────────────────────
  {
    categoryId: '29982',
    name: 'Camera Bags & Cases',
    keywords: [
      'bag',
      'case',
      'backpack',
      'camera bag',
      'camera case',
      'pouch',
      'holster',
      'shoulder bag',
      'sling',
    ],
    priority: 65,
  },

  // ── Binoculars & Telescopes ────────────────────────────────────
  {
    categoryId: '48446',
    name: 'Binoculars & Telescopes',
    keywords: [
      'binocular',
      'binoculars',
      'telescope',
      'spotting scope',
      'monocular',
    ],
    priority: 60,
  },

  // ── Filters ────────────────────────────────────────────────────
  {
    categoryId: '48528',
    name: 'Camera Filters',
    keywords: [
      'filter',
      'uv filter',
      'nd filter',
      'polarizer',
      'cpl',
      'graduated',
    ],
    priority: 55,
  },

  // ── Other Camera Accessories ───────────────────────────────────
  {
    categoryId: '48444',
    name: 'Other Camera Accessories',
    keywords: [
      'accessory',
      'accessories',
      'camera accessory',
      'strap',
      'remote',
      'adapter',
      'memory card',
      'sd card',
      'cf card',
      'xqd',
      'cfexpress',
      'microsd',
      'battery',
      'charger',
      'power supply',
    ],
    priority: 50,
  },
];

/** Default eBay category when nothing matches */
const DEFAULT_CATEGORY_ID = '48444';
const DEFAULT_CATEGORY_NAME = 'Other Camera Accessories';

/**
 * Get the eBay category ID for a Shopify product_type string.
 *
 * Uses fuzzy keyword matching: the product_type is lowercased and every
 * rule's keywords are checked for inclusion.  When multiple rules match
 * the one with the highest priority wins.
 */
export function getCategoryId(productType: string | null | undefined): string {
  if (!productType) return DEFAULT_CATEGORY_ID;

  const normalized = productType.toLowerCase().trim();
  if (!normalized) return DEFAULT_CATEGORY_ID;

  let bestMatch: CategoryRule | null = null;

  for (const rule of CATEGORY_RULES) {
    for (const kw of rule.keywords) {
      if (normalized.includes(kw)) {
        if (!bestMatch || rule.priority > bestMatch.priority) {
          bestMatch = rule;
        }
        break; // no need to check remaining keywords in this rule
      }
    }
  }

  return bestMatch?.categoryId ?? DEFAULT_CATEGORY_ID;
}

/**
 * Get human-readable category name (useful for logging / UI).
 */
export function getCategoryName(productType: string | null | undefined): string {
  if (!productType) return DEFAULT_CATEGORY_NAME;

  const normalized = productType.toLowerCase().trim();
  if (!normalized) return DEFAULT_CATEGORY_NAME;

  let bestMatch: CategoryRule | null = null;

  for (const rule of CATEGORY_RULES) {
    for (const kw of rule.keywords) {
      if (normalized.includes(kw)) {
        if (!bestMatch || rule.priority > bestMatch.priority) {
          bestMatch = rule;
        }
        break;
      }
    }
  }

  return bestMatch?.name ?? DEFAULT_CATEGORY_NAME;
}

/**
 * Get both category ID and name.
 */
export function getCategory(productType: string | null | undefined): { id: string; name: string } {
  return {
    id: getCategoryId(productType),
    name: getCategoryName(productType),
  };
}
