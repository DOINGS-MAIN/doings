/**
 * Public business contact on doingsapp.com — must match Monnify KYC / CAC for Black Mat Limited.
 */
export const companyContact = {
  legalName: "Black Mat Limited",
  productName: "Doings",
  website: "https://doingsapp.com",
  email: "hello@doingsapp.com",
  phone: "+234 813 735 2526",
  address: {
    line1: "4 Strawberry, Still Waters Garden Estate",
    line2: "Lekki, Lagos, Nigeria",
  },
} as const;

export function companyFullAddress(): string {
  return [companyContact.address.line1, companyContact.address.line2].filter(Boolean).join(", ");
}

export function companyTelHref(): string {
  return `tel:${companyContact.phone.replace(/\s/g, "")}`;
}

export function hasPublicPhone(): boolean {
  return companyContact.phone.replace(/\D/g, "").length >= 10;
}

export function hasPublicAddress(): boolean {
  return companyContact.address.line1.trim().length > 0;
}
