import { Router, type Request, type Response } from 'express';
import { CATEGORY_RULES } from '../../sync/category-mapper.js';
import {
  CONDITION_DESCRIPTIONS,
  EBAY_CONDITION_GRADE_MAP,
} from '../../config/condition-descriptions.js';
import { error as logError } from '../../utils/logger.js';

const router = Router();

const getUniqueCategories = () => {
  const seen = new Set<string>();
  const result: Array<{ id: string; name: string }> = [];

  for (const rule of CATEGORY_RULES) {
    if (seen.has(rule.categoryId)) continue;
    seen.add(rule.categoryId);
    result.push({ id: rule.categoryId, name: rule.name });
  }

  return result;
};

/** GET /api/ebay/categories — list eBay category choices */
router.get('/api/ebay/categories', (_req: Request, res: Response) => {
  try {
    res.json({ categories: getUniqueCategories() });
  } catch (err) {
    logError(`[EbayMeta] Failed to fetch categories: ${err}`);
    res.status(500).json({ error: 'Failed to fetch eBay categories' });
  }
});

/** GET /api/ebay/condition-descriptions — list Pictureline condition grades */
router.get('/api/ebay/condition-descriptions', (_req: Request, res: Response) => {
  try {
    res.json({
      descriptions: CONDITION_DESCRIPTIONS,
      ebayConditionToGrade: EBAY_CONDITION_GRADE_MAP,
    });
  } catch (err) {
    logError(`[EbayMeta] Failed to fetch condition descriptions: ${err}`);
    res.status(500).json({ error: 'Failed to fetch condition descriptions' });
  }
});

export default router;
