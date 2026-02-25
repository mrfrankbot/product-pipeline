/**
 * folder-parser.ts — Parse StyleShoots folder names into product info.
 *
 * Naming convention: "product name #lastThreeSerialDigits"
 * Examples:
 *   "sigma 24-70 #624"       → { productName: "sigma 24-70", serialSuffix: "624" }
 *   "sony a7iv #331"         → { productName: "sony a7iv", serialSuffix: "331" }
 *   "hasselblad x2d"         → { productName: "hasselblad x2d", serialSuffix: null }
 *   "nikon z 180-600 #12"    → { productName: "nikon z 180-600", serialSuffix: "12" }
 */
export interface ParsedFolder {
    /** Product name extracted from the folder name (before the # serial) */
    productName: string;
    /** Last digits of the serial number, or null if not present */
    serialSuffix: string | null;
    /** Original folder name, trimmed */
    raw: string;
}
/**
 * Parse a folder name into product name and serial suffix.
 *
 * Rules:
 * 1. Look for `#` followed by digits at the end → serial suffix
 * 2. Everything before the last `#digits` (trimmed) → product name
 * 3. No `#` → entire name is product name, serial is null
 * 4. Multiple `#` → last one with digits is serial
 * 5. Leading/trailing whitespace → trim
 */
export declare function parseFolderName(folderName: string): ParsedFolder;
/**
 * Check if a filename is an image we care about (not hidden, valid extension).
 */
export declare function isImageFile(filename: string): boolean;
