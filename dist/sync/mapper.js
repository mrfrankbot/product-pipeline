/**
 * Maps Shopify product condition tags to eBay condition values.
 * eBay Inventory API condition enum values.
 */
export const mapCondition = (tags) => {
    const tagStr = tags.join(',').toLowerCase();
    if (tagStr.includes('new') && !tagStr.includes('like new'))
        return 'NEW';
    if (tagStr.includes('like new') || tagStr.includes('mint'))
        return 'LIKE_NEW';
    if (tagStr.includes('excellent'))
        return 'VERY_GOOD';
    if (tagStr.includes('good'))
        return 'GOOD';
    if (tagStr.includes('fair') || tagStr.includes('acceptable'))
        return 'ACCEPTABLE';
    if (tagStr.includes('parts') || tagStr.includes('for parts'))
        return 'FOR_PARTS_OR_NOT_WORKING';
    // Default for used camera gear
    return 'GOOD';
};
/**
 * Map Shopify product type to eBay category ID.
 * These are the most common camera gear categories on eBay.
 */
export const mapCategory = (productType) => {
    const type = productType.toLowerCase();
    // Camera Bodies
    if (type.includes('camera') && (type.includes('body') || type.includes('digital')))
        return '31388';
    if (type.includes('mirrorless'))
        return '31388';
    if (type.includes('dslr'))
        return '31388';
    // Lenses
    if (type.includes('lens'))
        return '3323';
    // Flashes & Lighting
    if (type.includes('flash') || type.includes('strobe'))
        return '48515';
    if (type.includes('light') || type.includes('led'))
        return '183331';
    // Tripods & Supports
    if (type.includes('tripod') || type.includes('monopod'))
        return '30090';
    if (type.includes('gimbal') || type.includes('stabilizer'))
        return '183329';
    if (type.includes('head'))
        return '30090';
    // Bags & Cases
    if (type.includes('bag') || type.includes('case') || type.includes('backpack'))
        return '16031';
    // Filters
    if (type.includes('filter'))
        return '48518';
    // Memory Cards
    if (type.includes('memory') || type.includes('card') || type.includes('sd'))
        return '96991';
    // Batteries & Chargers
    if (type.includes('battery') || type.includes('charger'))
        return '48511';
    // Video/Cinema
    if (type.includes('video') || type.includes('cinema') || type.includes('monitor'))
        return '29996';
    // Cables & Adapters
    if (type.includes('cable') || type.includes('adapter') || type.includes('converter'))
        return '182094';
    // Default: Other Camera Accessories
    return '48519';
};
/**
 * Map Shopify shipping carrier names to eBay carrier codes.
 */
export const mapShippingCarrier = (carrier) => {
    const c = carrier.toLowerCase();
    if (c.includes('usps'))
        return 'USPS';
    if (c.includes('ups'))
        return 'UPS';
    if (c.includes('fedex'))
        return 'FedEx';
    if (c.includes('dhl'))
        return 'DHL';
    return 'OTHER';
};
/**
 * Clean and truncate title for eBay (80 char max).
 */
export const cleanTitle = (title) => {
    // Remove common Shopify suffixes
    let clean = title
        .replace(/\*USED\*/gi, '')
        .replace(/\*DISPLAY\*/gi, '')
        .replace(/\*NEW\*/gi, '')
        .trim();
    if (clean.length > 80) {
        clean = clean.slice(0, 77) + '...';
    }
    return clean;
};
/**
 * Parse price string to number.
 */
export const parsePrice = (price) => {
    return parseFloat(price.replace(/[^0-9.]/g, '')) || 0;
};
