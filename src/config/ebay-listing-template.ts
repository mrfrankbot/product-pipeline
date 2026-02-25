/**
 * eBay Listing HTML Template
 * 
 * Generates a professional, branded HTML description for eBay listings.
 * Uses inline CSS only (eBay strips external stylesheets).
 */

export interface EbayTemplateParams {
  title: string;
  description: string;
  conditionGrade: string;
  conditionDescription?: string;
  includes?: string;
  price?: string;
}

const CONDITION_COLORS: Record<string, string> = {
  'Mint / Like New': '#15803d',
  'Like New Minus': '#16a34a',
  'Excellent Plus': '#2563eb',
  'Excellent': '#2563eb',
  'Excellent Minus': '#2563eb',
  'Good Plus': '#d97706',
  'Good': '#d97706',
  'Poor': '#dc2626',
  'Ugly': '#991b1b',
  'Open Box': '#7c3aed',
  'Used': '#6b7280',
};

/**
 * Extract the condition grade from Shopify product tags.
 */
export function gradeFromTags(tags: string[]): string | null {
  if (!tags || tags.length === 0) return null;
  const gradePatterns = [
    'Mint / Like New', 'Like New Minus', 'Excellent Plus', 'Excellent Minus',
    'Excellent', 'Good Plus', 'Good', 'Poor', 'Ugly', 'Open Box',
  ];
  for (const tag of tags) {
    const normalized = tag.trim();
    for (const grade of gradePatterns) {
      if (normalized.toLowerCase() === grade.toLowerCase() ||
          normalized.toLowerCase().includes(grade.toLowerCase())) {
        return grade;
      }
    }
  }
  return null;
}

/**
 * Extract "Includes:" section from description text.
 */
export function extractIncludes(description: string): string | undefined {
  // Try to find "Includes:" or "What's Included" section
  const patterns = [
    /includes?:\s*(.+?)(?=\n\n|\<\/p\>|$)/is,
    /what'?s included:?\s*(.+?)(?=\n\n|\<\/p\>|$)/is,
  ];
  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (match?.[1]) {
      return match[1].replace(/<[^>]*>/g, '').trim();
    }
  }
  return undefined;
}

export function buildEbayDescriptionHtml(params: EbayTemplateParams): string {
  const { title, description, conditionGrade, conditionDescription, includes } = params;
  const badgeColor = CONDITION_COLORS[conditionGrade] || '#6b7280';

  // Clean up description — preserve HTML if present, wrap plain text in paragraphs
  const formattedDescription = description.includes('<') 
    ? description 
    : description.split('\n\n').map(p => `<p style="margin:0 0 12px;line-height:1.6;">${p}</p>`).join('');

  const includesSection = includes ? `
    <div style="margin-top:24px;padding:20px;background:#f8f9fa;border-radius:8px;">
      <h3 style="margin:0 0 8px;font-size:16px;color:#1f2937;">What's Included</h3>
      <p style="margin:0;color:#4b5563;line-height:1.6;">${includes}</p>
    </div>` : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#fff;">
<div style="max-width:800px;margin:0 auto;padding:0;">

  <!-- Header -->
  <div style="background:#103c69;padding:20px 30px;text-align:center;">
    <span style="font-size:24px;font-weight:800;color:#fff;letter-spacing:-.5px;">used<span style="background:#fff;color:#103c69;padding:2px 6px;border-radius:4px;margin:0 2px;">camera</span>gear</span>
    <p style="margin:6px 0 0;color:rgba(255,255,255,.8);font-size:13px;">Expert-Inspected • 90-Day Warranty • Free Shipping Over $99</p>
  </div>

  <!-- Title & Condition Badge -->
  <div style="padding:24px 30px 0;">
    <h2 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#1f2937;">${title}</h2>
    <span style="display:inline-block;padding:4px 12px;background:${badgeColor};color:#fff;border-radius:20px;font-size:13px;font-weight:600;">Condition: ${conditionGrade}</span>
  </div>

  <!-- Description -->
  <div style="padding:20px 30px;color:#374151;font-size:15px;">
    ${formattedDescription}
  </div>

  ${includesSection}

  <!-- Condition Details -->
  ${conditionDescription ? `
  <div style="margin:16px 30px;padding:20px;background:#f0f7ff;border-left:4px solid #103c69;border-radius:0 8px 8px 0;">
    <h3 style="margin:0 0 8px;font-size:16px;color:#103c69;">Condition Details — ${conditionGrade}</h3>
    <p style="margin:0;color:#374151;line-height:1.6;font-size:14px;">${conditionDescription}</p>
  </div>` : ''}

  <!-- Info Grid -->
  <div style="padding:24px 30px;">
    <div style="display:table;width:100%;border-spacing:12px;">
      <div style="display:table-row;">
        <div style="display:table-cell;width:33%;padding:16px;background:#f8f9fa;border-radius:8px;text-align:center;vertical-align:top;">
          <div style="font-size:20px;margin-bottom:6px;">📦</div>
          <h4 style="margin:0 0 4px;font-size:14px;color:#1f2937;">FREE Shipping</h4>
          <p style="margin:0;font-size:12px;color:#6b7280;">Orders over $99 ship free.<br>Tested, packed & insured.</p>
        </div>
        <div style="display:table-cell;width:33%;padding:16px;background:#f8f9fa;border-radius:8px;text-align:center;vertical-align:top;">
          <div style="font-size:20px;margin-bottom:6px;">💳</div>
          <h4 style="margin:0 0 4px;font-size:14px;color:#1f2937;">Secure Payment</h4>
          <p style="margin:0;font-size:12px;color:#6b7280;">All major credit cards,<br>PayPal & Google Pay.</p>
        </div>
        <div style="display:table-cell;width:33%;padding:16px;background:#f8f9fa;border-radius:8px;text-align:center;vertical-align:top;">
          <div style="font-size:20px;margin-bottom:6px;">↩️</div>
          <h4 style="margin:0 0 4px;font-size:14px;color:#1f2937;">30-Day Returns</h4>
          <p style="margin:0;font-size:12px;color:#6b7280;">Free returns within 30 days.<br>We want you to be happy.</p>
        </div>
      </div>
    </div>
  </div>

  <!-- 90-Day Warranty Banner -->
  <div style="margin:0 30px 24px;padding:16px 20px;background:#103c69;border-radius:8px;text-align:center;">
    <span style="color:#fff;font-size:15px;font-weight:600;">🛡️ Every purchase includes a 90-Day Warranty</span>
  </div>

  <!-- Footer -->
  <div style="padding:20px 30px;background:#f8f9fa;text-align:center;border-top:1px solid #e5e7eb;">
    <p style="margin:0 0 4px;font-size:14px;font-weight:600;color:#1f2937;">usedcameragear.com</p>
    <p style="margin:0;font-size:12px;color:#6b7280;">Trusted by photographers since 1989 — backed by Pictureline</p>
  </div>

</div>
</body>
</html>`;
}
