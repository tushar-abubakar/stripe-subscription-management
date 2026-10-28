export const P = {
    STORE_CREATE: "store.create",
    STORE_UPDATE: "store.update",
    STORE_READ: "store.read",
    STORE_DELETE: "store.delete",
    STORE_APPROVE: "store.approve",
    USER_READ: "user.read",
    USER_CREATE: "user.create",
    USER_UPDATE: "user.update",
    USER_APPROVE: "user.approve",
    USER_BLOCK: "user.block",
    USER_DELETE: "user.delete",
    WALLET_ADJUST: "wallet.adjust",
    OTP_UNBLOCK: "otp.unblock",
    ACCESS_ROLE_READ: "accessrole.read",
    ACCESS_ROLE_MANAGE: "accessrole.manage",
    CATEGORY_READ: "category.read",
    CATEGORY_CREATE: "category.create",
    CATEGORY_UPDATE: "category.update",
    CATEGORY_DELETE: "category.delete",
    BRAND_READ: "brand.read",
    BRAND_CREATE: "brand.create",
    BRAND_UPDATE: "brand.update",
    BRAND_DELETE: "brand.delete",
    PRODUCT_READ: "product.read",
    PRODUCT_CREATE: "product.create",
    PRODUCT_UPDATE: "product.update",
    PRODUCT_DELETE: "product.delete",
    PRODUCT_PUBLISH: "product.publish",
    PRODUCT_ARCHIVE: "product.archive",
    PRODUCT_RESTORE: "product.restore",
    PRODUCT_PURGE: "product.purge",
    PRODUCT_MEDIA: "product.media",
    OPTION_READ: "attribute.read",
    OPTION_CREATE: "attribute.create",
    OPTION_UPDATE: "attribute.update",
    OPTION_WRITE: "attribute.write",
    OPTION_DELETE: "attribute.delete",
    VARIANT_CREATE: "variant.create",
    VARIANT_UPDATE: "variant.update",
    VARIANT_DELETE: "variant.delete",
    MEDIA_READ: "media.read",
    MEDIA_UPLOAD: "media.upload",
    MEDIA_DELETE: "media.delete",
    BUNDLE_READ: "bundle.read",
    BUNDLE_WRITE: "bundle.write",
    COUPON_READ: "coupon.read",
    COUPON_WRITE: "coupon.write",
    INVENTORY_WRITE: "inventory.write",
    INVENTORY_READ: "inventory.read",
    INVENTORY_UPDATE: "inventory.update",
    INVENTORY_ADJUST: "inventory.adjust",
    ORDER_READ: "order.read",
    ORDER_MANAGE: "order.manage",
    ORDER_PACK: "order.pack",
    ORDER_CANCEL: "order.cancel",
    DELIVERY_READ: "delivery.read",
    DELIVERY_ASSIGN: "delivery.assign",
    DELIVERY_UPDATE: "delivery.update",
    KYC_REVIEW: "kyc.review",
    SUPPORT_READ: "support.read",
    SUPPORT_MANAGE: "support.manage",
    AUDIT_READ: "audit.read",
    ANALYTICS_READ: "analytics.read",
    APPROVAL_READ: "approval.read",
    APPROVAL_MANAGE: "approval.manage",
    RETURN_MANAGE: "return.manage",
    USER_HOLD: "user.hold",
    // ── Server-driven UI (admin/sdui/*). The customer app endpoints (app/*) are public. ──
    /** View screens, drafts, versions, diffs, rules, saved sections, custom groups, the component registry; preview a draft; test a data source. */
    SDUI_READ: "sdui.read",
    /** Create screens / pages / templates, edit and discard drafts, restore a version into the draft, create saved sections and custom groups. Nothing customers see changes. */
    SDUI_MANAGE: "sdui.manage",
    /**
     * Change what customers see: publish / schedule / cancel a schedule, make a version live (rollback),
     * targeting & A-B rules, delete screens, edit or delete saved sections and custom groups (live everywhere at once).
     * Kept separate so editors and publishers can be different people.
     */
    SDUI_PUBLISH: "sdui.publish",
} as const;

export type Permission = (typeof P)[keyof typeof P];

/**
 * Presets for admin access roles (ADMIN permissions come from AccessRole; SUPER_ADMIN has everything).
 * A designer also needs media (banners, group covers: POST /account/media, purpose BANNER) and catalogue
 * reads (picking products / categories / brands for groups and sections).
 */
export const SDUI_VIEWER_PERMISSIONS: Permission[] = [
    P.SDUI_READ,
    P.MEDIA_READ,
    P.CATEGORY_READ,
    P.BRAND_READ,
    P.PRODUCT_READ,
];
export const SDUI_EDITOR_PERMISSIONS: Permission[] = [
    ...SDUI_VIEWER_PERMISSIONS,
    P.SDUI_MANAGE,
    P.MEDIA_UPLOAD,
];
export const SDUI_PUBLISHER_PERMISSIONS: Permission[] = [
    ...SDUI_EDITOR_PERMISSIONS,
    P.SDUI_PUBLISH,
];

export const STORE_MANAGER_PERMISSIONS: string[] = [
    P.STORE_READ,
    P.STORE_UPDATE,
    P.USER_READ,
    P.USER_CREATE,
    P.USER_UPDATE,
    P.USER_APPROVE,
    P.CATEGORY_READ,
    P.BRAND_READ,
    P.PRODUCT_READ,
    P.PRODUCT_MEDIA,
    P.OPTION_READ,
    P.MEDIA_READ,
    P.MEDIA_UPLOAD,
    P.BUNDLE_READ,
    P.BUNDLE_WRITE,
    P.COUPON_READ,
    P.COUPON_WRITE,
    P.INVENTORY_READ,
    P.INVENTORY_UPDATE,
    P.INVENTORY_ADJUST,
    P.INVENTORY_WRITE,
    P.ORDER_READ,
    P.ORDER_MANAGE,
    P.ORDER_PACK,
    P.DELIVERY_READ,
    P.DELIVERY_ASSIGN,
    P.KYC_REVIEW,
    P.SUPPORT_READ,
    P.SUPPORT_MANAGE,
    P.ANALYTICS_READ,
    P.APPROVAL_READ,
    P.APPROVAL_MANAGE,
    P.RETURN_MANAGE,
    P.USER_HOLD,
];

/** Legacy flat list (staff without duties = packing + inventory). Kept for compatibility. */
export const STORE_STAFF_PERMISSIONS: string[] = [
    P.CATEGORY_READ,
    P.BRAND_READ,
    P.PRODUCT_READ,
    P.OPTION_READ,
    P.VARIANT_UPDATE,
    P.MEDIA_READ,
    P.INVENTORY_READ,
    P.INVENTORY_UPDATE,
    P.INVENTORY_WRITE,
    P.ORDER_READ,
    P.ORDER_PACK,
];

/** What every store staff member gets, whatever their duties. */
const STAFF_BASE: string[] = [
    P.CATEGORY_READ,
    P.BRAND_READ,
    P.PRODUCT_READ,
    P.OPTION_READ,
];

/** Extra permissions per StaffDuty. */
export const STAFF_DUTY_PERMISSIONS: Record<
    "PACKING" | "SUPPORT" | "INVENTORY",
    string[]
> = {
    PACKING: [P.ORDER_READ, P.ORDER_PACK, P.INVENTORY_READ],
    SUPPORT: [P.SUPPORT_READ, P.SUPPORT_MANAGE, P.ORDER_READ],
    INVENTORY: [P.INVENTORY_READ, P.INVENTORY_UPDATE, P.INVENTORY_WRITE],
};

/** Permissions of a store staff member from their duties (empty duties = legacy set). */
export function staffPermissions(duties: readonly string[]): string[] {
    if (!duties.length) return STORE_STAFF_PERMISSIONS;
    return [
        ...new Set([
            ...STAFF_BASE,
            ...duties.flatMap(
                (duty) =>
                    STAFF_DUTY_PERMISSIONS[
                        duty as keyof typeof STAFF_DUTY_PERMISSIONS
                    ] ?? [],
            ),
        ]),
    ];
}

// ─── Hierarchy ────────────────────────────────────────────────────────────────

/** Higher rank manages lower rank. Staff and delivery partners are peers. */
export const ROLE_RANK: Record<string, number> = {
    SUPER_ADMIN: 100,
    ADMIN: 80,
    STORE_MANAGER: 60,
    STORE_STAFF: 40,
    DELIVERY_PARTNER: 40,
    CUSTOMER: 10,
};

export const isAdminRole = (role: string) =>
    role === "ADMIN" || role === "SUPER_ADMIN";

/**
 * May `actor` manage `target` (hold, edit, approve…)?
 * - SUPER_ADMIN: everyone except other super admins.
 * - ADMIN: everyone below ADMIN.
 * - STORE_MANAGER: staff / delivery partners of their own store.
 * - Nobody manages themselves.
 */
export function canManageUser(
    actor: { id: bigint; role: string; storeId: bigint | null },
    target: { id: bigint; role: string; storeId: bigint | null },
): boolean {
    if (actor.id === target.id) return false;
    if (actor.role === "SUPER_ADMIN") return target.role !== "SUPER_ADMIN";
    if (actor.role === "ADMIN") return ROLE_RANK[target.role] < ROLE_RANK.ADMIN;
    if (actor.role === "STORE_MANAGER")
        return (
            (target.role === "STORE_STAFF" ||
                target.role === "DELIVERY_PARTNER") &&
            !!actor.storeId &&
            target.storeId === actor.storeId
        );
    return false;
}

// ─── Account holds ────────────────────────────────────────────────────────────

/** Capabilities a PARTIAL hold can switch off (a FULL hold suspends the account). */
export const HOLD_RESTRICTIONS = [
    "ORDERS",
    "WITHDRAWAL",
    "KYC_UPDATE",
    "SUPPORT",
    "INVENTORY",
    "PROFILE_UPDATE",
] as const;
export type HoldRestriction = (typeof HOLD_RESTRICTIONS)[number];

export interface AccountHold {
    scope: "FULL" | "PARTIAL";
    restrictions: HoldRestriction[];
    /** ADMIN-level holds can only be lifted by an admin. */
    level: "ADMIN" | "STORE";
    byId: string;
    byRole: string;
    note: string | null;
    at: string;
}
