/**
 * Dynamic eBay item specifics (aspects) mapper.
 *
 * Each eBay category requires different item specifics.  This module builds
 * the aspects object from Shopify product data, extracting what it can
 * (brand, model, focal length, etc.) and using safe fallbacks for the rest.
 */
// ─── Title Parsers ──────────────────────────────────────────────────────
const FOCAL_LENGTH_RE = /(\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?)\s*mm/i;
const APERTURE_RE = /f\/?(\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?)/i;
const FILTER_SIZE_RE = /(\d{2,3})\s*mm\s*(?:filter|thread)/i;
/**
 * Extract focal length like "50mm" or "24-70mm" from a title string.
 */
function parseFocalLength(title) {
    const m = title.match(FOCAL_LENGTH_RE);
    return m ? `${m[1]}mm` : null;
}
/**
 * Extract maximum aperture like "f/1.8" or "f/2.8-4" from a title string.
 */
function parseAperture(title) {
    const m = title.match(APERTURE_RE);
    return m ? `f/${m[1]}` : null;
}
/**
 * Extract filter size (e.g. "67mm filter") from a title string.
 */
function parseFilterSize(title) {
    const m = title.match(FILTER_SIZE_RE);
    return m ? `${m[1]}mm` : null;
}
/**
 * Try to extract the model from the title by removing the brand prefix.
 */
function parseModel(title, brand) {
    if (!title)
        return 'Does Not Apply';
    // Remove brand from start of title to isolate model info
    let model = title;
    if (brand && brand !== 'Unbranded') {
        const brandRe = new RegExp(`^${escapeRegex(brand)}\\s+`, 'i');
        model = model.replace(brandRe, '');
    }
    // Remove common condition/status words
    model = model
        .replace(/\*?(USED|DISPLAY|NEW|MINT|EXCELLENT|GOOD|FAIR)\*?/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    // Take the first meaningful chunk (up to ~60 chars) as the model
    if (model.length > 60) {
        model = model.slice(0, 57) + '...';
    }
    return model || 'Does Not Apply';
}
function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/**
 * Infer camera type from title/product_type keywords.
 */
function inferCameraType(title, productType) {
    const combined = `${title} ${productType}`.toLowerCase();
    if (combined.includes('mirrorless'))
        return 'Mirrorless';
    if (combined.includes('dslr') || combined.includes('slr'))
        return 'DSLR';
    if (combined.includes('point & shoot') || combined.includes('point and shoot') || combined.includes('compact'))
        return 'Point & Shoot';
    if (combined.includes('bridge'))
        return 'Bridge/Superzoom';
    if (combined.includes('medium format'))
        return 'Medium Format';
    if (combined.includes('rangefinder'))
        return 'Rangefinder';
    if (combined.includes('film camera'))
        return 'Film Camera';
    if (combined.includes('instant'))
        return 'Instant Print';
    return 'Digital Camera';
}
/**
 * Infer lens mount from title keywords.
 */
function inferMount(title) {
    const t = title.toLowerCase();
    if (t.includes('ef-m'))
        return 'Canon EF-M';
    if (t.includes('rf mount') || t.includes('rf-s') || /\brf\b/.test(t))
        return 'Canon RF';
    if (t.includes('ef-s'))
        return 'Canon EF-S';
    if (t.includes('ef mount') || t.includes('canon ef'))
        return 'Canon EF';
    if (t.includes('z mount') || t.includes('nikon z'))
        return 'Nikon Z';
    if (t.includes('f mount') || t.includes('nikon f') || t.includes('nikkor'))
        return 'Nikon F';
    if (t.includes('e-mount') || t.includes('e mount') || t.includes('sony e'))
        return 'Sony E';
    if (t.includes('a-mount') || t.includes('a mount') || t.includes('sony a'))
        return 'Sony A';
    if (t.includes('x mount') || t.includes('fuji x') || t.includes('fujifilm x'))
        return 'Fujifilm X';
    if (t.includes('gf mount') || t.includes('fuji gf'))
        return 'Fujifilm G';
    if (t.includes('micro four thirds') || t.includes('mft') || t.includes('m4/3') || t.includes('micro 4/3'))
        return 'Micro Four Thirds';
    if (t.includes('l-mount') || t.includes('l mount'))
        return 'Leica L';
    if (t.includes('m mount') || t.includes('leica m'))
        return 'Leica M';
    if (t.includes('pentax k') || t.includes('k mount'))
        return 'Pentax K';
    if (t.includes('sigma sa'))
        return 'Sigma SA';
    return 'Does Not Apply';
}
/**
 * Infer focus type from title.
 */
function inferFocusType(title) {
    const t = title.toLowerCase();
    if (t.includes('manual focus') || t.includes(' mf ') || /\bmf\b/.test(t))
        return 'Manual Focus';
    if (t.includes('autofocus') || t.includes('auto focus') || t.includes(' af ') || /\baf\b/.test(t))
        return 'Auto & Manual Focus';
    // Most modern lenses are AF
    return 'Auto & Manual Focus';
}
/**
 * Infer compatible brand from title or vendor.
 */
function inferCompatibleBrand(title, vendor) {
    const t = `${title} ${vendor}`.toLowerCase();
    if (t.includes('canon'))
        return 'Canon';
    if (t.includes('nikon'))
        return 'Nikon';
    if (t.includes('sony'))
        return 'Sony';
    if (t.includes('fuji'))
        return 'Fujifilm';
    if (t.includes('panasonic') || t.includes('lumix'))
        return 'Panasonic';
    if (t.includes('olympus') || t.includes('om system'))
        return 'Olympus';
    if (t.includes('leica'))
        return 'Leica';
    if (t.includes('pentax') || t.includes('ricoh'))
        return 'Pentax/Ricoh';
    if (t.includes('sigma'))
        return 'Sigma';
    if (t.includes('tamron'))
        return 'Tamron';
    if (t.includes('hasselblad'))
        return 'Hasselblad';
    return 'Universal';
}
/**
 * Infer film type from title / product type.
 */
function inferFilmType(title, productType) {
    const t = `${title} ${productType}`.toLowerCase();
    if (t.includes('instant') || t.includes('instax') || t.includes('polaroid'))
        return 'Instant Film';
    if (t.includes('35mm') || t.includes('135'))
        return '35mm';
    if (t.includes('120') || t.includes('medium format'))
        return 'Medium Format';
    if (t.includes('large format') || t.includes('4x5') || t.includes('8x10'))
        return 'Large Format';
    if (t.includes('110'))
        return '110 Film';
    return 'Film';
}
// ─── MPN Extraction ──────────────────────────────────────────────────────
/**
 * Attempt to extract a meaningful MPN from the variant SKU.
 * Strips common condition suffixes like -U123, -N, -LN, etc.
 */
function extractMpn(sku) {
    if (!sku)
        return 'Does Not Apply';
    // Strip trailing condition codes like -U, -U1, -N, -LN, -EX, etc.
    const cleaned = sku.replace(/-(U\d*|N|LN|EX|G|F|FP|AS)$/i, '').trim();
    return cleaned || 'Does Not Apply';
}
// ─── Category-specific Aspect Builders ──────────────────────────────────
/**
 * Digital Cameras (31388)
 */
function buildCameraAspects(product, variant) {
    const title = product.title || '';
    const brand = product.vendor || 'Unbranded';
    const productType = product.productType || '';
    return {
        'Brand': [brand],
        'Model': [parseModel(title, brand)],
        'Type': [inferCameraType(title, productType)],
        'MPN': [extractMpn(variant.sku)],
        'Color': ['Black'],
        'Connectivity': ['USB'],
    };
}
/**
 * Camera Lenses (3323)
 */
function buildLensAspects(product, variant) {
    const title = product.title || '';
    const brand = product.vendor || 'Unbranded';
    const aspects = {
        'Brand': [brand],
        'MPN': [extractMpn(variant.sku)],
        'Compatible Brand': [inferCompatibleBrand(title, brand)],
        'Focus Type': [inferFocusType(title)],
        'Mount': [inferMount(title)],
    };
    const focalLength = parseFocalLength(title);
    if (focalLength) {
        aspects['Focal Length'] = [focalLength];
    }
    const aperture = parseAperture(title);
    if (aperture) {
        aspects['Maximum Aperture'] = [aperture];
    }
    const filterSize = parseFilterSize(title);
    if (filterSize) {
        aspects['Filter Size'] = [filterSize];
    }
    return aspects;
}
/**
 * Film (4201)
 */
function buildFilmAspects(product, variant) {
    const title = product.title || '';
    const brand = product.vendor || 'Unbranded';
    const productType = product.productType || '';
    return {
        'Brand': [brand],
        'Type': [inferFilmType(title, productType)],
        'MPN': [extractMpn(variant.sku)],
        'Format': [inferFilmType(title, productType)],
    };
}
/**
 * Flashes (78997)
 */
function buildFlashAspects(product, variant) {
    const title = product.title || '';
    const brand = product.vendor || 'Unbranded';
    return {
        'Brand': [brand],
        'MPN': [extractMpn(variant.sku)],
        'Type': ['Flash Unit'],
        'Compatible Brand': [inferCompatibleBrand(title, brand)],
        'Color': ['Black'],
    };
}
/**
 * Tripods & Monopods (30090)
 */
function buildTripodAspects(product, variant) {
    const title = product.title || '';
    const brand = product.vendor || 'Unbranded';
    const t = title.toLowerCase();
    const type = t.includes('monopod') ? 'Monopod' : t.includes('head') ? 'Tripod Head' : 'Tripod';
    return {
        'Brand': [brand],
        'MPN': [extractMpn(variant.sku)],
        'Type': [type],
        'Color': ['Black'],
        'Compatible Brand': ['Universal'],
    };
}
/**
 * Bags & Cases (29982)
 */
function buildBagAspects(product, variant) {
    const title = product.title || '';
    const brand = product.vendor || 'Unbranded';
    const t = title.toLowerCase();
    let type = 'Camera Bag';
    if (t.includes('backpack'))
        type = 'Backpack';
    else if (t.includes('shoulder') || t.includes('sling'))
        type = 'Shoulder Bag/Sling';
    else if (t.includes('case') || t.includes('hard case') || t.includes('pouch'))
        type = 'Camera Case';
    return {
        'Brand': [brand],
        'MPN': [extractMpn(variant.sku)],
        'Type': [type],
        'Color': ['Black'],
        'Compatible Brand': ['Universal'],
    };
}
/**
 * Batteries & Chargers (48446)
 */
function buildBatteryAspects(product, variant) {
    const title = product.title || '';
    const brand = product.vendor || 'Unbranded';
    const t = title.toLowerCase();
    const type = t.includes('charger') ? 'Charger' : 'Battery';
    return {
        'Brand': [brand],
        'MPN': [extractMpn(variant.sku)],
        'Type': [type],
        'Compatible Brand': [inferCompatibleBrand(title, brand)],
        'Compatible Model': ['Universal'],
    };
}
/**
 * Camera Filters (48528)
 */
function buildFilterAspects(product, variant) {
    const title = product.title || '';
    const brand = product.vendor || 'Unbranded';
    const t = title.toLowerCase();
    let type = 'Filter';
    if (t.includes('uv'))
        type = 'UV Filter';
    else if (t.includes('polariz') || t.includes('cpl'))
        type = 'Polarizer';
    else if (t.includes('nd'))
        type = 'ND/Neutral Density Filter';
    else if (t.includes('graduated'))
        type = 'Graduated Filter';
    const aspects = {
        'Brand': [brand],
        'MPN': [extractMpn(variant.sku)],
        'Type': [type],
    };
    const filterSize = parseFilterSize(title);
    if (filterSize) {
        aspects['Filter Size'] = [filterSize];
    }
    return aspects;
}
/**
 * Memory Cards (48444)
 */
function buildMemoryCardAspects(product, variant) {
    const title = product.title || '';
    const brand = product.vendor || 'Unbranded';
    const t = title.toLowerCase();
    let type = 'Memory Card';
    if (t.includes('sd') && !t.includes('micro'))
        type = 'SD';
    else if (t.includes('microsd') || t.includes('micro sd'))
        type = 'MicroSD';
    else if (t.includes('cf ') || t.includes('compact flash'))
        type = 'CompactFlash';
    else if (t.includes('cfexpress'))
        type = 'CFexpress';
    else if (t.includes('xqd'))
        type = 'XQD';
    return {
        'Brand': [brand],
        'MPN': [extractMpn(variant.sku)],
        'Type': [type],
        'Compatible Brand': ['Universal'],
    };
}
/**
 * Default / Other Camera Accessories (48519 etc.)
 */
function buildDefaultAspects(product, variant) {
    const brand = product.vendor || 'Unbranded';
    return {
        'Brand': [brand],
        'MPN': [extractMpn(variant.sku)],
        'Type': [product.productType || 'Camera Accessory'],
        'Compatible Brand': ['Universal'],
        'Compatible Model': ['Universal'],
        'Color': ['Black'],
    };
}
const ASPECT_BUILDERS = {
    '31388': buildCameraAspects,
    '3323': buildLensAspects,
    '4201': buildFilmAspects,
    '78997': buildFlashAspects,
    '48519': buildDefaultAspects, // Other Camera Accessories (also default)
    '183331': buildDefaultAspects, // Lighting & Studio → use default
    '30090': buildTripodAspects,
    '29982': buildBagAspects,
    '48446': buildBatteryAspects,
    '48528': buildFilterAspects,
    '48444': buildMemoryCardAspects,
};
// ─── Public API ─────────────────────────────────────────────────────────
/**
 * Get eBay item specifics (aspects) for a given category and Shopify product.
 *
 * @param categoryId  eBay category ID (from getCategoryId)
 * @param product     Shopify product data
 * @param variant     Shopify variant data (for SKU → MPN)
 * @returns           Record of aspect name → value array
 */
export function getAspects(categoryId, product, variant) {
    const builder = ASPECT_BUILDERS[categoryId] || buildDefaultAspects;
    return builder(product, variant);
}
