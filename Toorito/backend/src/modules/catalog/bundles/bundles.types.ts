import { BundlePricingType } from "@prisma-client/enums";

/** Plain input types of the bundles services (no decorators; the HTTP DTOs in src/api implement them). */


export interface BundleItemInput {
    variantId: number;
    quantity: number;
}

export interface BundleInput {
    slug?: string;
    title: Record<string, string>;
    description?: Record<string, string>;
    thumbnailId?: number;
    pricingType: BundlePricingType;
    fixedPrice?: number;
    discountValue?: number;
    maxQtyPerOrder?: number;
    /**
     * Omitted = global bundle.
     * Only admins can create global bundles.
     */
    storeId?: number;
    startsAt?: string;
    endsAt?: string;
    isActive?: boolean;
    items: BundleItemInput[];
}
