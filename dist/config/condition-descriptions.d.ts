/**
 * Pictureline's official grading descriptions for eBay condition notes.
 *
 * These are the canonical descriptions used across the app — import from here
 * rather than hard-coding condition text elsewhere.
 */
export type PicturelineGrade = 'Mint / Like New' | 'Like New Minus' | 'Excellent Plus' | 'Excellent' | 'Excellent Minus' | 'Good Plus' | 'Good' | 'Open Box' | 'Poor' | 'Ugly';
export declare const GRADE_DESCRIPTIONS: Record<PicturelineGrade, string>;
/**
 * Maps an eBay condition enum value to the most appropriate Pictureline grade.
 * Used as the auto-populated default when the condition is set on a listing.
 */
export declare const EBAY_CONDITION_TO_GRADE: Record<string, PicturelineGrade>;
/**
 * Returns the auto-suggested condition description for a given eBay condition enum.
 * Returns an empty string if the condition has no mapping.
 */
export declare function getConditionDescription(ebayCondition: string): string;
/**
 * Returns the Pictureline grade name for a given eBay condition enum.
 * Returns null if unmapped.
 */
export declare function getPicturelineGrade(ebayCondition: string): PicturelineGrade | null;
/**
 * Full list of all grades with their descriptions — useful for building
 * select/autocomplete UI components.
 */
export declare const ALL_GRADES: Array<{
    grade: PicturelineGrade;
    description: string;
}>;
/** @alias GRADE_DESCRIPTIONS — expected by src/server/routes/ebay-metadata.ts */
export declare const CONDITION_DESCRIPTIONS: Record<PicturelineGrade, string>;
/** @alias EBAY_CONDITION_TO_GRADE — expected by src/server/routes/ebay-metadata.ts */
export declare const EBAY_CONDITION_GRADE_MAP: Record<string, PicturelineGrade>;
