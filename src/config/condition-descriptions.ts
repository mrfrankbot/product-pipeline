/**
 * Pictureline's official grading descriptions for eBay condition notes.
 *
 * These are the canonical descriptions used across the app — import from here
 * rather than hard-coding condition text elsewhere.
 */

// ── Pictureline grade names ────────────────────────────────────────────

export type PicturelineGrade =
  | 'Mint / Like New'
  | 'Like New Minus'
  | 'Excellent Plus'
  | 'Excellent'
  | 'Excellent Minus'
  | 'Good Plus'
  | 'Good'
  | 'Open Box';

// ── Grade descriptions ─────────────────────────────────────────────────

export const GRADE_DESCRIPTIONS: Record<PicturelineGrade, string> = {
  'Mint / Like New':
    'Virtually indistinguishable from new. No visible wear, perfect optics.',
  'Like New Minus':
    'Near-perfect with only the faintest handling marks. Optics pristine.',
  'Excellent Plus':
    'Light signs of normal use, minor cosmetic marks. Optics clean, no haze/fungus/scratches.',
  Excellent:
    'Normal cosmetic wear consistent with regular use. All functions work perfectly. Optics clear.',
  'Excellent Minus':
    'Moderate cosmetic wear, possible light marks on barrel. Optics clean and functional.',
  'Good Plus':
    'Visible wear and cosmetic marks. Fully functional, optics may show minor dust (does not affect image quality).',
  Good: 'Heavy wear, possible brassing or paint loss. Fully functional.',
  'Open Box':
    'This item has been opened and inspected but shows no signs of use. Includes all original packaging and accessories.',
};

// ── eBay condition → default Pictureline grade ─────────────────────────

/**
 * Maps an eBay condition enum value to the most appropriate Pictureline grade.
 * Used as the auto-populated default when the condition is set on a listing.
 */
export const EBAY_CONDITION_TO_GRADE: Record<string, PicturelineGrade> = {
  NEW: 'Mint / Like New',
  NEW_OTHER: 'Open Box',
  LIKE_NEW: 'Mint / Like New',
  USED_EXCELLENT: 'Excellent',
  VERY_GOOD: 'Excellent Plus',
  GOOD: 'Good Plus',
  ACCEPTABLE: 'Good',
  FOR_PARTS_OR_NOT_WORKING: 'Good',
};

/**
 * Returns the auto-suggested condition description for a given eBay condition enum.
 * Returns an empty string if the condition has no mapping.
 */
export function getConditionDescription(ebayCondition: string): string {
  const grade = EBAY_CONDITION_TO_GRADE[ebayCondition];
  if (!grade) return '';
  return GRADE_DESCRIPTIONS[grade] ?? '';
}

/**
 * Returns the Pictureline grade name for a given eBay condition enum.
 * Returns null if unmapped.
 */
export function getPicturelineGrade(ebayCondition: string): PicturelineGrade | null {
  return EBAY_CONDITION_TO_GRADE[ebayCondition] ?? null;
}

/**
 * Full list of all grades with their descriptions — useful for building
 * select/autocomplete UI components.
 */
export const ALL_GRADES: Array<{ grade: PicturelineGrade; description: string }> = (
  Object.keys(GRADE_DESCRIPTIONS) as PicturelineGrade[]
).map((grade) => ({ grade, description: GRADE_DESCRIPTIONS[grade] }));

// ── Aliases for ebay-metadata route (backward-compat names) ───────────

/** @alias GRADE_DESCRIPTIONS — expected by src/server/routes/ebay-metadata.ts */
export const CONDITION_DESCRIPTIONS = GRADE_DESCRIPTIONS;

/** @alias EBAY_CONDITION_TO_GRADE — expected by src/server/routes/ebay-metadata.ts */
export const EBAY_CONDITION_GRADE_MAP = EBAY_CONDITION_TO_GRADE;
