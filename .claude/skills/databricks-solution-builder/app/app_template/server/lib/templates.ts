/** First token → firstname, rest → lastname. One-token names get empty lastname. */
export function splitName(full: string): { firstname: string; lastname: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { firstname: parts[0], lastname: '' };
  return { firstname: parts[0], lastname: parts.slice(1).join(' ') };
}

/** Fill {firstname}, {lastname}, {product_name}, {coupon_code} placeholders. */
export function fillTemplate(
  template: string,
  vars: {
    firstname: string;
    lastname: string;
    product_name: string;
    coupon_code: string;
  },
): string {
  return template
    .replace(/\{firstname\}/g, vars.firstname)
    .replace(/\{lastname\}/g, vars.lastname)
    .replace(/\{product_name\}/g, vars.product_name)
    .replace(/\{coupon_code\}/g, vars.coupon_code);
}
