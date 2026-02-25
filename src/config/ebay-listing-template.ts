/**
 * eBay Listing HTML Template
 *
 * Generates professional branded HTML for eBay item descriptions.
 * Uses inline CSS only (eBay strips external stylesheets).
 */

export interface EbayTemplateParams {
  title: string;
  description: string;
  conditionGrade?: string;
  conditionDescription?: string;
  includes?: string;
  price?: string;
}

const CONDITION_COLORS: Record<string, string> = {
  'Mint / Like New': '#059669',
  'Like New Minus': '#059669',
  'Excellent Plus': '#0284c7',
  'Excellent': '#0284c7',
  'Excellent Minus': '#0284c7',
  'Good Plus': '#d97706',
  'Good': '#d97706',
  'Poor': '#dc2626',
  'Ugly': '#dc2626',
  'Open Box': '#7c3aed',
  'Used': '#6b7280',
};

/**
 * Extract "Includes:" or "What's Included:" section from description text.
 */
export function extractIncludes(description: string): string | undefined {
  // Try to find includes section in the text
  const text = description.replace(/<[^>]*>/g, '');
  const match = text.match(/(?:includes|what'?s included|in the box)[:\s]*([^\n]+(?:\n[^\n]+)*)/i);
  if (match) {
    return match[1].trim();
  }
  return undefined;
}

/**
 * Try to detect condition grade from Shopify product tags.
 */
export function gradeFromTags(tags: string[]): string | undefined {
  const gradePatterns = [
    'Like New', 'Mint', 'Excellent Plus', 'Excellent Minus', 'Excellent',
    'Good Plus', 'Good', 'Poor', 'Ugly', 'Open Box',
  ];
  for (const tag of tags) {
    for (const grade of gradePatterns) {
      if (tag.toLowerCase().includes(grade.toLowerCase())) {
        return grade;
      }
    }
  }
  return undefined;
}

export function buildEbayDescriptionHtml(params: EbayTemplateParams): string {
  const {
    title,
    description,
    conditionGrade = 'Used',
    conditionDescription,
    includes,
  } = params;

  const badgeColor = CONDITION_COLORS[conditionGrade] || '#6b7280';

  // Clean up description — preserve HTML if present, wrap plain text in paragraphs
  const formattedDescription = description.includes('<')
    ? description
    : description.split('\n\n').map(p => `<p style="margin:0 0 12px 0;line-height:1.6;">${p.trim()}</p>`).join('\n');

  const includesSection = includes ? `
    <div style="margin-top:24px;padding:20px;background:#f8f9fa;border-radius:8px;">
      <h3 style="margin:0 0 8px 0;font-size:16px;color:#1f2937;">What's Included</h3>
      <p style="margin:0;color:#4b5563;line-height:1.6;">${includes}</p>
    </div>
  ` : '';

  const conditionSection = conditionDescription ? `
    <div style="margin-top:24px;padding:20px;background:#f0f9ff;border-left:4px solid ${badgeColor};border-radius:0 8px 8px 0;">
      <h3 style="margin:0 0 4px 0;font-size:16px;color:#1f2937;">Condition: ${conditionGrade}</h3>
      <p style="margin:0;color:#4b5563;line-height:1.6;">${conditionDescription}</p>
    </div>
  ` : '';

  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#fff;">
<div style="max-width:800px;margin:0 auto;padding:0;">

  <!-- Header -->
  <div style="background:#fff;border-bottom:3px solid #103c69;padding:20px 24px;text-align:center;">
    <div style="font-size:28px;font-weight:800;color:#1f2937;letter-spacing:-0.5px;">
      used<span style="background:#103c69;color:#fff;padding:2px 8px;border-radius:4px;">camera</span>gear
    </div>
    <p style="margin:4px 0 0;font-size:13px;color:#6b7280;">Trusted by photographers since 1989 · Backed by Pictureline</p>
  </div>

  <!-- Product Title + Condition Badge -->
  <div style="padding:24px 24px 0;">
    <h2 style="margin:0 0 12px;font-size:22px;color:#1f2937;font-weight:700;">${title}</h2>
    <span style="display:inline-block;padding:4px 14px;background:${badgeColor};color:#fff;border-radius:20px;font-size:13px;font-weight:600;">${conditionGrade}</span>
  </div>

  <!-- Description -->
  <div style="padding:20px 24px;color:#374151;font-size:15px;">
    ${formattedDescription}
  </div>

  ${includesSection}
  ${conditionSection}

  <!-- Trust Badges -->
  <div style="margin-top:32px;display:flex;border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;">
    <div style="flex:1;padding:20px;text-align:center;border-right:1px solid #e5e7eb;">
      <div style="font-size:20px;">🔍</div>
      <div style="font-size:13px;font-weight:700;color:#1f2937;margin-top:4px;">Expert Inspected</div>
      <div style="font-size:12px;color:#6b7280;">Tested & graded by<br>Pictureline's camera experts</div>
    </div>
    <div style="flex:1;padding:20px;text-align:center;border-right:1px solid #e5e7eb;">
      <div style="font-size:20px;">🛡️</div>
      <div style="font-size:13px;font-weight:700;color:#1f2937;margin-top:4px;">90-Day Warranty</div>
      <div style="font-size:12px;color:#6b7280;">Shop with confidence —<br>all purchases covered</div>
    </div>
    <div style="flex:1;padding:20px;text-align:center;">
      <div style="font-size:20px;">📦</div>
      <div style="font-size:13px;font-weight:700;color:#1f2937;margin-top:4px;">Free Shipping</div>
      <div style="font-size:12px;color:#6b7280;">Orders over $99<br>ship free & insured</div>
    </div>
  </div>

  <!-- Shipping / Payment / Returns -->
  <div style="padding:24px;">
    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="padding:16px;vertical-align:top;width:33%;border:1px solid #e5e7eb;background:#fafafa;">
          <div style="font-weight:700;font-size:14px;color:#1f2937;margin-bottom:8px;">📦 SHIPPING</div>
          <div style="font-size:13px;color:#4b5563;line-height:1.5;">
            FREE shipping on orders over $99.<br>
            All items carefully packed and insured.<br>
            Ships from Salt Lake City, UT.
          </div>
        </td>
        <td style="padding:16px;vertical-align:top;width:33%;border:1px solid #e5e7eb;background:#fafafa;">
          <div style="font-weight:700;font-size:14px;color:#1f2937;margin-bottom:8px;">💳 PAYMENT</div>
          <div style="font-size:13px;color:#4b5563;line-height:1.5;">
            We accept PayPal and all major credit cards.<br>
            Immediate payment required on Buy It Now.
          </div>
        </td>
        <td style="padding:16px;vertical-align:top;width:33%;border:1px solid #e5e7eb;background:#fafafa;">
          <div style="font-weight:700;font-size:14px;color:#1f2937;margin-bottom:8px;">↩️ RETURNS</div>
          <div style="font-size:13px;color:#4b5563;line-height:1.5;">
            30-day return policy.<br>
            Seller pays return shipping.<br>
            We want you to be happy with your purchase.
          </div>
        </td>
      </tr>
    </table>
  </div>

  <!-- Footer -->
  <div style="background:#f8f9fa;padding:20px 24px;text-align:center;border-top:1px solid #e5e7eb;">
    <div style="font-size:20px;font-weight:800;color:#1f2937;">
      used<span style="background:#103c69;color:#fff;padding:1px 6px;border-radius:3px;font-size:18px;">camera</span>gear<span style="color:#6b7280;font-size:14px;">.com</span>
    </div>
    <p style="margin:6px 0 0;font-size:12px;color:#9ca3af;">Backed by Pictureline since 1989 · Salt Lake City, UT</p>
  </div>

</div>
</body>
</html>`.trim();
}
