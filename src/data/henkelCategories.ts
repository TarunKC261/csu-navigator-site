/**
 * Henkel's incident Category -> Subcategory list (display labels), for the
 * incident create card dropdowns (and, later, the create gate).
 *
 * Absorbed from the LE's Henkel branch (hosted-sites/templates/starter/src/data/
 * henkelCategories.ts). It mirrors sn-mcp's `HENKEL_CATEGORIES`
 * (sn-mcp/src/henkel/categories.ts), which validates again on the server, so keep
 * the two in step. Source: Henkel's reply of 2026-10-30 for henkelsand.
 */
export const HENKEL_CATEGORIES: Record<string, string[]> = {
    Hardware: ['Repair', 'Firmware/BIOS', 'Physical Damage', 'Install/Upgrade/Removal', 'Lost/Stolen', 'Error'],
    'Mobile Device': ['Support', 'Lost/Stolen', 'Error', 'Install/Upgrade/Uninstall', 'Physical Damage'],
    Network: ['Configuration', 'Performance Issue', 'Network Outage', 'Other'],
    Security: ['Intrusion Detection', 'Vulnerability', 'Malware/Virus', 'Access', 'Phishing', 'Unauthorized Access/Data Breach'],
    Server: ['Outage', 'Performance Issue', 'Support', 'Error', 'Capacity Issue', 'Access'],
    'Software/Application': ['Install/Upgrade/Uninstall', 'Error', 'Performance Issue', 'Support', 'Database', 'Access'],
    Storage: ['Node Down', 'Capacity Issue', 'Degraded Service'],
};

export const CATEGORY_NAMES = Object.keys(HENKEL_CATEGORIES);

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** Canonical category label for loose input ("hardware", "Software / Application"), else undefined. */
export function canonicalCategory(value: unknown): string | undefined {
    if (typeof value !== 'string' || !value.trim()) return undefined;
    const v = norm(value).replace(/\s*\/\s*/g, '/');
    return CATEGORY_NAMES.find((c) => norm(c) === v);
}

/** Canonical subcategory label valid for `category`, else undefined. */
export function canonicalSubcategory(category: string | undefined, value: unknown): string | undefined {
    if (!category || typeof value !== 'string' || !value.trim()) return undefined;
    const v = norm(value).replace(/\s*\/\s*/g, '/');
    return HENKEL_CATEGORIES[category]?.find((s) => norm(s) === v);
}
