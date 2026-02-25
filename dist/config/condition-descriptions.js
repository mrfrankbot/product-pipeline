/**
 * Pictureline's official grading descriptions for eBay condition notes.
 *
 * These are the canonical descriptions used across the app — import from here
 * rather than hard-coding condition text elsewhere.
 */
// ── Grade descriptions ─────────────────────────────────────────────────
export const GRADE_DESCRIPTIONS = {
    'Mint / Like New': 'Items in this category will look like they have just come out of the original box. Original accessories and packaging are usually included. 99% - 100% of the original condition, even when viewed by the most discerning eyes.',
    'Like New Minus': 'Items in this category will look like they have just come out of the original box. Original accessories and packaging are usually included. 99% - 100% of the original condition, even when viewed by the most discerning eyes.',
    'Excellent Plus': 'Items in this category will look like they have had very little to no use, with any wear only visible under close inspection. 90% - 99% of original condition.',
    Excellent: 'Items in this category will have normal signs of use, or signs appropriate with the age of the item. Most items used by enthusiasts or beginning pro photographers will fall into this category. 75% - 90% of original condition.',
    'Excellent Minus': 'Items in this category will have normal signs of use, or signs appropriate with the age of the item. Most items used by enthusiasts or beginning pro photographers will fall into this category. 75% - 90% of original condition.',
    'Good Plus': 'Items in this category will have excessive signs of wear, brassing, or finish loss, but are still operational. Heavy use is apparent. 50% - 65% of original condition.',
    Good: 'Items in this category will have excessive signs of wear, brassing, or finish loss, but are still operational. Heavy use is apparent. 50% - 65% of original condition.',
    'Open Box': 'This item has been opened and inspected but shows no signs of use. Includes all original packaging and accessories.',
    Poor: 'Items in this category will have excessive signs of wear, brassing, or finish loss, but are still operational. Heavy use is apparent. 50% - 65% of original condition.',
    Ugly: 'Items in this category are either inoperable or so worn from the original condition that they cannot be counted on for reliable operation.',
};
// ── eBay condition → default Pictureline grade ─────────────────────────
/**
 * Maps an eBay condition enum value to the most appropriate Pictureline grade.
 * Used as the auto-populated default when the condition is set on a listing.
 */
export const EBAY_CONDITION_TO_GRADE = {
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
export function getConditionDescription(ebayCondition) {
    const grade = EBAY_CONDITION_TO_GRADE[ebayCondition];
    if (!grade)
        return '';
    return GRADE_DESCRIPTIONS[grade] ?? '';
}
/**
 * Returns the Pictureline grade name for a given eBay condition enum.
 * Returns null if unmapped.
 */
export function getPicturelineGrade(ebayCondition) {
    return EBAY_CONDITION_TO_GRADE[ebayCondition] ?? null;
}
/**
 * Full list of all grades with their descriptions — useful for building
 * select/autocomplete UI components.
 */
export const ALL_GRADES = Object.keys(GRADE_DESCRIPTIONS).map((grade) => ({ grade, description: GRADE_DESCRIPTIONS[grade] }));
// ── Aliases for ebay-metadata route (backward-compat names) ───────────
/** @alias GRADE_DESCRIPTIONS — expected by src/server/routes/ebay-metadata.ts */
export const CONDITION_DESCRIPTIONS = GRADE_DESCRIPTIONS;
/** @alias EBAY_CONDITION_TO_GRADE — expected by src/server/routes/ebay-metadata.ts */
export const EBAY_CONDITION_GRADE_MAP = EBAY_CONDITION_TO_GRADE;
