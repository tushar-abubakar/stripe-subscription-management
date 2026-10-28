-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CUSTOMER', 'ADMIN', 'SUPER_ADMIN', 'STORE_MANAGER', 'STORE_STAFF', 'DELIVERY_PARTNER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "StoreStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'DRAFT');

-- CreateEnum
CREATE TYPE "StoreServiceMode" AS ENUM ('RADIUS', 'AREA');

-- CreateEnum
CREATE TYPE "StaffDuty" AS ENUM ('PACKING', 'SUPPORT', 'INVENTORY');

-- CreateEnum
CREATE TYPE "ApprovalType" AS ENUM ('MEMBER_ONBOARDING', 'KYC_VERIFICATION', 'KYC_DOC_REMOVAL', 'BARCODE_ADD', 'GRN_EDIT', 'CATALOG_CHANGE', 'ORDER_RETURN', 'ORDER_EXCHANGE');

-- CreateEnum
CREATE TYPE "ApprovalLevel" AS ENUM ('ADMIN', 'STORE');

-- CreateEnum
CREATE TYPE "ApprovalRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GoodsReceiptStatus" AS ENUM ('POSTED', 'EDIT_PENDING');

-- CreateEnum
CREATE TYPE "StorageProvider" AS ENUM ('LOCAL', 'S3', 'R2', 'GCS', 'CLOUDINARY', 'BUNNY');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "MediaPurpose" AS ENUM ('PRODUCT', 'CATEGORY', 'CATEGORY_BANNER', 'BRAND', 'BRAND_BANNER', 'OPTIONVALUE', 'STORE', 'BUNDLE', 'AVATAR', 'KYC', 'DELIVERY_PROOF', 'SUPPORT', 'INVOICE', 'BANNER', 'OTHER');

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "CategoryStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BrandStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DietType" AS ENUM ('VEG', 'NON_VEG', 'VEGAN', 'EGG');

-- CreateEnum
CREATE TYPE "UnitType" AS ENUM ('G', 'KG', 'ML', 'PCS', 'PACK', 'DOZEN', 'PIECE', 'GRAM', 'LITRE');

-- CreateEnum
CREATE TYPE "BarcodeType" AS ENUM ('EAN13', 'EAN8', 'UPC_A', 'CODE128', 'QR', 'OTHER');

-- CreateEnum
CREATE TYPE "OptionValueType" AS ENUM ('TEXT', 'COLOR', 'IMAGE', 'DROPDOWN');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('ACTIVE', 'QUARANTINE', 'DAMAGED', 'RECALLED', 'EXPIRED', 'DEPLETED');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('PURCHASE', 'RESERVE', 'RELEASE', 'SALE', 'RETURN', 'ADJUSTMENT', 'DAMAGE', 'EXPIRED', 'LOST', 'VENDOR_RETURN');

-- CreateEnum
CREATE TYPE "StoreListingStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'INACTIVE', 'PENDING_APPROVAL');

-- CreateEnum
CREATE TYPE "StorePriceStatus" AS ENUM ('CUSTOM', 'MRP_RESET');

-- CreateEnum
CREATE TYPE "BundlePricingType" AS ENUM ('FIXED_PRICE', 'PERCENT_OFF', 'AMOUNT_OFF');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'FLAT', 'FREE_DELIVERY');

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('APP', 'WEB');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_PAYMENT', 'PLACED', 'ACCEPTED', 'PACKING', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('UPI', 'CARD', 'NETBANKING', 'WALLET', 'COD', 'CASH');

-- CreateEnum
CREATE TYPE "PickMethod" AS ENUM ('MANUAL', 'SCAN');

-- CreateEnum
CREATE TYPE "PickStatus" AS ENUM ('PENDING', 'PICKED', 'PARTIAL', 'OUT_OF_STOCK');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('ASSIGNED', 'ACCEPTED', 'REACHED_STORE', 'PICKED_UP', 'REACHED_CUSTOMER', 'DELIVERED', 'REJECTED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('BICYCLE', 'SCOOTER', 'BIKE', 'EV');

-- CreateEnum
CREATE TYPE "KycDocType" AS ENUM ('NID', 'AADHAAR', 'PAN', 'DRIVING_LICENSE', 'VOTER_ID', 'PASSPORT', 'SELFIE', 'VEHICLE_RC', 'OTHER');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('PAYMENT', 'REFUND', 'COD_COLLECTION');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('ORDER_ISSUE', 'PAYMENT', 'REFUND', 'DELIVERY', 'PRODUCT_QUALITY', 'ACCOUNT', 'OTHER');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "AuthEvent" AS ENUM ('OTP_SENT', 'OTP_VERIFIED', 'OTP_FAILED', 'OTP_RATE_LIMITED', 'OTP_UNBLOCKED', 'PASSWORD_OK', 'PASSWORD_FAILED', 'LOGIN_SUCCESS', 'LOGOUT', 'TOKEN_REFRESH', 'ACCOUNT_BLOCKED');

-- CreateEnum
CREATE TYPE "WalletTxnType" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "WalletTxnReason" AS ENUM ('REFUND', 'CASHBACK', 'TOPUP', 'ORDER_PAYMENT', 'ADMIN_ADJUSTMENT', 'EXPIRY');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED');

-- CreateEnum
CREATE TYPE "SduiScreenKind" AS ENUM ('SCREEN', 'PAGE', 'TEMPLATE', 'SHELL');

-- CreateEnum
CREATE TYPE "SduiVersionStatus" AS ENUM ('SCHEDULED', 'PUBLISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SduiGroupKind" AS ENUM ('MANUAL', 'RULE');

-- CreateTable
CREATE TABLE "User" (
    "id" BIGSERIAL NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "role" "UserRole" NOT NULL,
    "passwordHash" VARCHAR(255),
    "failedPasswordCount" INTEGER NOT NULL DEFAULT 0,
    "passwordLockedUntil" TIMESTAMP(3),
    "name" VARCHAR(120),
    "email" VARCHAR(191),
    "language" VARCHAR(10) NOT NULL DEFAULT 'en',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "avatarId" BIGINT,
    "walletBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "accessRoleId" BIGINT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "statusReason" VARCHAR(255),
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'APPROVED',
    "approvedById" BIGINT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" VARCHAR(255),
    "storeId" BIGINT,
    "createdById" BIGINT,
    "staffDuties" "StaffDuty"[] DEFAULT ARRAY[]::"StaffDuty"[],
    "hold" JSONB,
    "phoneVerifiedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Otp" (
    "id" BIGSERIAL NOT NULL,
    "destination" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "codeHash" VARCHAR(255),
    "expiresAt" TIMESTAMP(3),
    "verifyAttempts" INTEGER NOT NULL DEFAULT 0,
    "sendCountToday" INTEGER NOT NULL DEFAULT 0,
    "sendDate" DATE NOT NULL,
    "lastSentAt" TIMESTAMP(3),
    "nextSendAt" TIMESTAMP(3),
    "consecutiveFailedDays" INTEGER NOT NULL DEFAULT 0,
    "lastFailedDate" DATE,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "blockedAt" TIMESTAMP(3),
    "blockedUntil" TIMESTAMP(3),
    "blockedReason" VARCHAR(255),
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Otp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "refreshTokenHash" VARCHAR(64) NOT NULL,
    "accessTokenJti" VARCHAR(64),
    "deviceId" VARCHAR(100),
    "deviceName" VARCHAR(120),
    "platform" VARCHAR(20),
    "appVersion" VARCHAR(20),
    "pushToken" VARCHAR(512),
    "ipAddress" VARCHAR(45),
    "userAgent" VARCHAR(255),
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Address" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "label" VARCHAR(40),
    "receiverName" VARCHAR(120) NOT NULL,
    "receiverPhone" VARCHAR(20) NOT NULL,
    "line1" VARCHAR(255) NOT NULL,
    "line2" VARCHAR(255),
    "landmark" VARCHAR(255),
    "countryCode" CHAR(2),
    "stateCode" VARCHAR(10),
    "state" VARCHAR(100) NOT NULL,
    "districtCode" VARCHAR(10),
    "district" VARCHAR(100),
    "city" VARCHAR(100) NOT NULL,
    "pincode" VARCHAR(12) NOT NULL,
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "placeId" VARCHAR(255),
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Address_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WishlistItem" (
    "userId" BIGINT NOT NULL,
    "productId" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WishlistItem_pkey" PRIMARY KEY ("userId","productId")
);

-- CreateTable
CREATE TABLE "DeliveryPartnerProfile" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "vehicleType" "VehicleType" NOT NULL,
    "vehicleNumber" VARCHAR(20),
    "kycStatus" "KycStatus" NOT NULL DEFAULT 'PENDING',
    "kycVerifiedById" BIGINT,
    "kycVerifiedAt" TIMESTAMP(3),
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "activeOrderCount" INTEGER NOT NULL DEFAULT 0,
    "lastLatitude" DECIMAL(10,7),
    "lastLongitude" DECIMAL(10,7),
    "lastLocationAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryPartnerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycDocument" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "type" "KycDocType" NOT NULL,
    "documentNumber" VARCHAR(255),
    "frontMediaId" BIGINT NOT NULL,
    "backMediaId" BIGINT,
    "status" "KycStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" BIGINT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" VARCHAR(255),
    "expiresAt" DATE,
    "uploadedById" BIGINT,
    "title" VARCHAR(120),
    "submittedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "removedReason" VARCHAR(30),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaFile" (
    "id" BIGSERIAL NOT NULL,
    "purpose" "MediaPurpose" NOT NULL,
    "type" "MediaType" NOT NULL DEFAULT 'IMAGE',
    "provider" "StorageProvider" NOT NULL DEFAULT 'LOCAL',
    "status" "MediaStatus" NOT NULL DEFAULT 'READY',
    "bucket" VARCHAR(100) NOT NULL DEFAULT '',
    "key" VARCHAR(191) NOT NULL,
    "originalName" VARCHAR(255),
    "title" JSONB,
    "mimeType" VARCHAR(100) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "checksum" VARCHAR(64),
    "variants" JSONB,
    "alt" JSONB,
    "metadata" JSONB,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "failureReason" VARCHAR(255),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedById" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MediaFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Store" (
    "id" BIGSERIAL NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" JSONB NOT NULL,
    "nameSearch" VARCHAR(500) NOT NULL DEFAULT '',
    "phone" VARCHAR(20),
    "email" VARCHAR(191),
    "licenseNumber" VARCHAR(60),
    "logoId" BIGINT,
    "countryCode" CHAR(2) NOT NULL,
    "stateCode" VARCHAR(10) NOT NULL,
    "state" VARCHAR(100) NOT NULL,
    "districtCode" VARCHAR(10),
    "district" VARCHAR(100),
    "city" VARCHAR(100) NOT NULL,
    "addressLine" VARCHAR(255) NOT NULL,
    "addressLine2" VARCHAR(255),
    "pincode" VARCHAR(12) NOT NULL,
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "placeId" VARCHAR(255),
    "serviceMode" "StoreServiceMode" NOT NULL DEFAULT 'RADIUS',
    "serviceRadiusM" INTEGER,
    "bboxMinLat" DECIMAL(10,7) NOT NULL,
    "bboxMaxLat" DECIMAL(10,7) NOT NULL,
    "bboxMinLng" DECIMAL(10,7) NOT NULL,
    "bboxMaxLng" DECIMAL(10,7) NOT NULL,
    "status" "StoreStatus" NOT NULL DEFAULT 'DRAFT',
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "acceptingOrders" BOOLEAN NOT NULL DEFAULT true,
    "openingHours" JSONB,
    "timezone" VARCHAR(50) NOT NULL DEFAULT 'Asia/Dhaka',
    "avgPrepMinutes" INTEGER NOT NULL DEFAULT 8,
    "minOrderValue" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "deliveryFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "freeDeliveryAbove" DECIMAL(10,2),
    "handlingFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "smallCartLimit" DECIMAL(10,2),
    "smallCartFee" DECIMAL(10,2),
    "charges" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreServiceArea" (
    "id" BIGSERIAL NOT NULL,
    "storeId" BIGINT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "placeId" VARCHAR(255),
    "polygon" JSONB NOT NULL,
    "minLat" DECIMAL(10,7) NOT NULL,
    "maxLat" DECIMAL(10,7) NOT NULL,
    "minLng" DECIMAL(10,7) NOT NULL,
    "maxLng" DECIMAL(10,7) NOT NULL,
    "deliveryFeeOverride" DECIMAL(10,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreServiceArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" BIGSERIAL NOT NULL,
    "parentId" BIGINT,
    "slug" VARCHAR(150) NOT NULL,
    "name" JSONB NOT NULL,
    "description" JSONB,
    "status" "CategoryStatus" NOT NULL DEFAULT 'ACTIVE',
    "iconId" BIGINT,
    "bannerId" BIGINT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdById" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryGroup" (
    "id" BIGSERIAL NOT NULL,
    "slug" VARCHAR(150) NOT NULL,
    "name" JSONB NOT NULL,
    "description" JSONB,
    "status" "CategoryStatus" NOT NULL DEFAULT 'ACTIVE',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryGroupItem" (
    "groupId" BIGINT NOT NULL,
    "categoryId" BIGINT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CategoryGroupItem_pkey" PRIMARY KEY ("groupId","categoryId")
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" BIGSERIAL NOT NULL,
    "slug" VARCHAR(150) NOT NULL,
    "name" JSONB NOT NULL,
    "description" JSONB,
    "status" "BrandStatus" NOT NULL DEFAULT 'ACTIVE',
    "logoId" BIGINT,
    "bannerId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" BIGSERIAL NOT NULL,
    "slug" VARCHAR(191) NOT NULL,
    "brandId" BIGINT,
    "categoryId" BIGINT NOT NULL,
    "thumbnailId" BIGINT,
    "audioMediaId" BIGINT,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "dietType" "DietType",
    "hsnCode" VARCHAR(10),
    "gstRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "countryOfOrigin" VARCHAR(2),
    "shelfLifeDays" INTEGER,
    "isPerishable" BOOLEAN NOT NULL DEFAULT false,
    "manufacturerName" VARCHAR(191),
    "nutrition" JSONB,
    "createdById" BIGINT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedPreviousStatus" "ProductStatus",
    "deletedPreviousSlug" VARCHAR(191),

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductTranslation" (
    "id" BIGSERIAL NOT NULL,
    "productId" BIGINT NOT NULL,
    "lang" VARCHAR(10) NOT NULL,
    "title" VARCHAR(255) NOT NULL DEFAULT '',
    "shortDescription" VARCHAR(500),
    "description" TEXT,
    "keyFeatures" JSONB,
    "ingredients" TEXT,
    "storageInstructions" VARCHAR(500),
    "manufacturerAddress" VARCHAR(500),
    "allergens" JSONB,
    "attributes" JSONB,
    "nutrition" JSONB,
    "keywords" JSONB,
    "seoTitle" VARCHAR(255),
    "seoDescription" VARCHAR(500),
    "searchText" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ProductTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OptionGroup" (
    "id" BIGSERIAL NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" JSONB NOT NULL,
    "valueType" "OptionValueType" NOT NULL DEFAULT 'TEXT',
    "position" INTEGER NOT NULL DEFAULT 0,
    "isFilterable" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "OptionGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OptionValue" (
    "id" BIGSERIAL NOT NULL,
    "optionGroupId" BIGINT NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "label" JSONB NOT NULL,
    "swatch" VARCHAR(20),
    "imageId" BIGINT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OptionValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductOption" (
    "id" BIGSERIAL NOT NULL,
    "productId" BIGINT NOT NULL,
    "optionGroupId" BIGINT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" BIGSERIAL NOT NULL,
    "productId" BIGINT NOT NULL,
    "sku" VARCHAR(64) NOT NULL,
    "optionHash" VARCHAR(100) NOT NULL DEFAULT 'default',
    "mrp" DECIMAL(10,2) NOT NULL,
    "unit" "UnitType",
    "unitValue" DECIMAL(10,3),
    "weightGrams" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedWithProduct" BOOLEAN NOT NULL DEFAULT false,
    "deletedPreviousSku" VARCHAR(64),
    "deletedPreviousOptionHash" VARCHAR(100),
    "deletedPreviousIsActive" BOOLEAN,
    "audioMediaId" BIGINT,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VariantOptionValue" (
    "variantId" BIGINT NOT NULL,
    "optionGroupId" BIGINT NOT NULL,
    "optionValueId" BIGINT NOT NULL,
    "imageId" BIGINT,

    CONSTRAINT "VariantOptionValue_pkey" PRIMARY KEY ("variantId","optionGroupId")
);

-- CreateTable
CREATE TABLE "ProductBarcode" (
    "id" BIGSERIAL NOT NULL,
    "variantId" BIGINT NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "type" "BarcodeType" NOT NULL DEFAULT 'EAN13',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductBarcode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductMedia" (
    "id" BIGSERIAL NOT NULL,
    "productId" BIGINT NOT NULL,
    "variantId" BIGINT,
    "mediaId" BIGINT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreProduct" (
    "id" BIGSERIAL NOT NULL,
    "storeId" BIGINT NOT NULL,
    "variantId" BIGINT NOT NULL,
    "productId" BIGINT NOT NULL,
    "categoryId" BIGINT NOT NULL,
    "sellingPrice" DECIMAL(10,2) NOT NULL,
    "currentMrp" DECIMAL(10,2),
    "availableQty" INTEGER NOT NULL DEFAULT 0,
    "reservedQty" INTEGER NOT NULL DEFAULT 0,
    "lowStockThreshold" INTEGER NOT NULL DEFAULT 5,
    "minOrderQty" INTEGER NOT NULL DEFAULT 1,
    "maxOrderQty" INTEGER,
    "trackBatches" BOOLEAN NOT NULL DEFAULT true,
    "minSellableDays" INTEGER NOT NULL DEFAULT 0,
    "shelfLocation" VARCHAR(50),
    "status" "StoreListingStatus" NOT NULL DEFAULT 'ACTIVE',
    "publishAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedPreviousIsActive" BOOLEAN,
    "priceStatus" "StorePriceStatus" NOT NULL DEFAULT 'CUSTOM',
    "priceResetAt" TIMESTAMP(3),
    "flashPrice" DECIMAL(10,2),
    "flashStartsAt" TIMESTAMP(3),
    "flashEndsAt" TIMESTAMP(3),
    "flashQtyLimit" INTEGER,
    "flashSoldQty" INTEGER NOT NULL DEFAULT 0,
    "flashMaxPerOrder" INTEGER,
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "listedById" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryBatch" (
    "id" BIGSERIAL NOT NULL,
    "storeProductId" BIGINT NOT NULL,
    "storeId" BIGINT NOT NULL,
    "variantId" BIGINT NOT NULL,
    "batchNumber" VARCHAR(60) NOT NULL,
    "manufacturedAt" DATE,
    "expiryDate" DATE,
    "shelfLifeDays" INTEGER,
    "mrp" DECIMAL(10,2) NOT NULL,
    "costPrice" DECIMAL(10,2),
    "clearancePrice" DECIMAL(10,2),
    "receivedQty" INTEGER NOT NULL,
    "availableQty" INTEGER NOT NULL,
    "status" "BatchStatus" NOT NULL DEFAULT 'ACTIVE',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supplierName" VARCHAR(150),
    "note" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItemBatch" (
    "id" BIGSERIAL NOT NULL,
    "orderItemId" BIGINT NOT NULL,
    "batchId" BIGINT NOT NULL,
    "batchNumber" VARCHAR(60) NOT NULL,
    "mrp" DECIMAL(10,2) NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "manufacturedAt" DATE,
    "expiryDate" DATE,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItemBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" BIGSERIAL NOT NULL,
    "storeId" BIGINT NOT NULL,
    "storeProductId" BIGINT NOT NULL,
    "batchId" BIGINT,
    "type" "StockMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "batchBalanceAfter" INTEGER,
    "unitCost" DECIMAL(10,2),
    "orderItemId" BIGINT,
    "refType" VARCHAR(20),
    "refId" BIGINT,
    "idempotencyKey" VARCHAR(64),
    "actorId" BIGINT,
    "note" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorePriceHistory" (
    "id" BIGSERIAL NOT NULL,
    "storeProductId" BIGINT NOT NULL,
    "oldPrice" DECIMAL(10,2) NOT NULL,
    "newPrice" DECIMAL(10,2) NOT NULL,
    "oldMrp" DECIMAL(10,2),
    "newMrp" DECIMAL(10,2),
    "reason" VARCHAR(30),
    "changedById" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorePriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" BIGSERIAL NOT NULL,
    "grnNumber" VARCHAR(30) NOT NULL,
    "storeId" BIGINT NOT NULL,
    "supplierName" VARCHAR(150) NOT NULL,
    "supplierPhone" VARCHAR(20),
    "supplierInvoiceNo" VARCHAR(60),
    "supplierInvoiceDate" DATE,
    "receivedById" BIGINT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" VARCHAR(255),
    "invoiceMediaIds" JSONB NOT NULL DEFAULT '[]',
    "status" "GoodsReceiptStatus" NOT NULL DEFAULT 'POSTED',
    "editCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptItem" (
    "id" BIGSERIAL NOT NULL,
    "goodsReceiptId" BIGINT NOT NULL,
    "storeProductId" BIGINT NOT NULL,
    "variantId" BIGINT NOT NULL,
    "batchNumber" VARCHAR(60) NOT NULL,
    "manufacturedAt" DATE,
    "expiryDate" DATE,
    "shelfLifeDays" INTEGER,
    "receivedQty" INTEGER NOT NULL,
    "rejectedQty" INTEGER NOT NULL DEFAULT 0,
    "rejectReason" VARCHAR(255),
    "costPrice" DECIMAL(10,2),
    "mrp" DECIMAL(10,2) NOT NULL,
    "batchId" BIGINT,

    CONSTRAINT "GoodsReceiptItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bundle" (
    "id" BIGSERIAL NOT NULL,
    "storeId" BIGINT,
    "slug" VARCHAR(191) NOT NULL,
    "title" JSONB NOT NULL,
    "description" JSONB,
    "thumbnailId" BIGINT,
    "pricingType" "BundlePricingType" NOT NULL,
    "fixedPrice" DECIMAL(10,2),
    "discountValue" DECIMAL(10,2),
    "maxQtyPerOrder" INTEGER NOT NULL DEFAULT 5,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bundle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BundleItem" (
    "id" BIGSERIAL NOT NULL,
    "bundleId" BIGINT NOT NULL,
    "variantId" BIGINT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "BundleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cart" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT,
    "guestToken" VARCHAR(64),
    "storeId" BIGINT,
    "couponCode" VARCHAR(40),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartItem" (
    "id" BIGSERIAL NOT NULL,
    "cartId" BIGINT NOT NULL,
    "variantId" BIGINT,
    "bundleId" BIGINT,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coupon" (
    "id" BIGSERIAL NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "description" JSONB,
    "discountType" "DiscountType" NOT NULL,
    "discountValue" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "maxDiscount" DECIMAL(10,2),
    "minOrderValue" DECIMAL(10,2),
    "usageLimit" INTEGER,
    "perUserLimit" INTEGER NOT NULL DEFAULT 1,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "firstOrderOnly" BOOLEAN NOT NULL DEFAULT false,
    "storeId" BIGINT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" BIGSERIAL NOT NULL,
    "orderNumber" VARCHAR(30) NOT NULL,
    "userId" BIGINT NOT NULL,
    "storeId" BIGINT NOT NULL,
    "source" "OrderSource" NOT NULL DEFAULT 'APP',
    "status" "OrderStatus" NOT NULL DEFAULT 'PLACED',
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paymentMethod" "PaymentMethod" NOT NULL,
    "customerName" VARCHAR(120),
    "customerPhone" VARCHAR(20),
    "addressId" BIGINT,
    "deliveryAddress" JSONB,
    "deliveryLat" DECIMAL(10,7),
    "deliveryLng" DECIMAL(10,7),
    "instructions" VARCHAR(500),
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discountTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "deliveryFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "handlingFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tip" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "roundOff" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "walletAmountUsed" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "couponId" BIGINT,
    "couponCode" VARCHAR(40),
    "deliveryPartnerId" BIGINT,
    "pickerId" BIGINT,
    "packedById" BIGINT,
    "packingStartedAt" TIMESTAMP(3),
    "paymentExpiresAt" TIMESTAMP(3),
    "estimatedAt" TIMESTAMP(3),
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "packedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledByRole" "UserRole",
    "cancelReason" VARCHAR(255),
    "rating" INTEGER,
    "deliveryRating" INTEGER,
    "ratingNote" VARCHAR(500),
    "idempotencyKey" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" BIGSERIAL NOT NULL,
    "orderId" BIGINT NOT NULL,
    "parentId" BIGINT,
    "variantId" BIGINT,
    "bundleId" BIGINT,
    "productId" BIGINT,
    "storeProductId" BIGINT,
    "title" JSONB NOT NULL,
    "variantLabel" VARCHAR(150),
    "sku" VARCHAR(64),
    "hsnCode" VARCHAR(10),
    "imageKey" VARCHAR(191),
    "mrp" DECIMAL(10,2) NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "discountAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(12,2) NOT NULL,
    "pickedQty" INTEGER NOT NULL DEFAULT 0,
    "pickStatus" "PickStatus" NOT NULL DEFAULT 'PENDING',
    "pickMethod" "PickMethod",
    "pickedById" BIGINT,
    "pickedAt" TIMESTAMP(3),
    "returnedQty" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderEvent" (
    "id" BIGSERIAL NOT NULL,
    "orderId" BIGINT NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "title" VARCHAR(120),
    "note" VARCHAR(255),
    "actorId" BIGINT,
    "actorRole" "UserRole",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" BIGSERIAL NOT NULL,
    "orderId" BIGINT NOT NULL,
    "partnerId" BIGINT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'ASSIGNED',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "reachedStoreAt" TIMESTAMP(3),
    "pickedUpAt" TIMESTAMP(3),
    "reachedCustomerAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" VARCHAR(255),
    "handoverCodeHash" VARCHAR(64),
    "proofMediaId" BIGINT,
    "distanceMeters" INTEGER,
    "partnerEarning" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "cashToCollect" DECIMAL(10,2),
    "cashCollected" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" BIGSERIAL NOT NULL,
    "txnNumber" VARCHAR(40) NOT NULL,
    "orderId" BIGINT,
    "userId" BIGINT,
    "parentId" BIGINT,
    "type" "TransactionType" NOT NULL,
    "method" "PaymentMethod",
    "gateway" VARCHAR(30),
    "gatewayOrderId" VARCHAR(100),
    "gatewayPaymentId" VARCHAR(100),
    "gatewayRefundId" VARCHAR(100),
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "failureCode" VARCHAR(60),
    "failureReason" VARCHAR(255),
    "gatewayResponse" JSONB,
    "idempotencyKey" VARCHAR(64),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" BIGSERIAL NOT NULL,
    "gateway" VARCHAR(30) NOT NULL,
    "eventId" VARCHAR(100) NOT NULL,
    "eventType" VARCHAR(80) NOT NULL,
    "payload" JSONB NOT NULL,
    "signatureOk" BOOLEAN NOT NULL DEFAULT false,
    "status" "WebhookStatus" NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" VARCHAR(500),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "type" "WalletTxnType" NOT NULL,
    "reason" "WalletTxnReason" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "balanceAfter" DECIMAL(12,2) NOT NULL,
    "orderId" BIGINT,
    "note" VARCHAR(255),
    "actorId" BIGINT,
    "idempotencyKey" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" BIGSERIAL NOT NULL,
    "ticketNumber" VARCHAR(30) NOT NULL,
    "userId" BIGINT NOT NULL,
    "orderId" BIGINT,
    "storeId" BIGINT,
    "category" "TicketCategory" NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "TicketPriority" NOT NULL DEFAULT 'MEDIUM',
    "assignedToId" BIGINT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstResponseAt" TIMESTAMP(3),
    "resolution" VARCHAR(1000),
    "resolvedAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "escalatedById" BIGINT,
    "escalationNote" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportMessage" (
    "id" BIGSERIAL NOT NULL,
    "ticketId" BIGINT NOT NULL,
    "senderId" BIGINT NOT NULL,
    "senderRole" "UserRole" NOT NULL,
    "body" TEXT NOT NULL,
    "attachmentIds" JSONB,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "title" VARCHAR(191) NOT NULL,
    "body" VARCHAR(500) NOT NULL,
    "data" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" BIGSERIAL NOT NULL,
    "type" "ApprovalType" NOT NULL,
    "level" "ApprovalLevel" NOT NULL,
    "status" "ApprovalRequestStatus" NOT NULL DEFAULT 'PENDING',
    "storeId" BIGINT,
    "targetType" VARCHAR(30) NOT NULL,
    "targetId" BIGINT NOT NULL,
    "requestedById" BIGINT NOT NULL,
    "requestedByRole" "UserRole" NOT NULL,
    "note" VARCHAR(1000),
    "payload" JSONB NOT NULL DEFAULT '{}',
    "snapshot" JSONB,
    "result" JSONB,
    "reviewedById" BIGINT,
    "reviewedByRole" "UserRole",
    "reviewNote" VARCHAR(1000),
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" BIGSERIAL NOT NULL,
    "actorId" BIGINT,
    "actorRole" "UserRole",
    "storeId" BIGINT,
    "action" VARCHAR(80) NOT NULL,
    "entityType" VARCHAR(50) NOT NULL,
    "entityId" VARCHAR(64),
    "before" JSONB,
    "after" JSONB,
    "ipAddress" VARCHAR(45),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthLog" (
    "id" BIGSERIAL NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "role" "UserRole",
    "userId" BIGINT,
    "event" "AuthEvent" NOT NULL,
    "success" BOOLEAN NOT NULL,
    "reason" VARCHAR(120),
    "ipAddress" VARCHAR(45),
    "deviceId" VARCHAR(100),
    "userAgent" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessRole" (
    "id" BIGSERIAL NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "permissions" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SduiScreen" (
    "id" BIGSERIAL NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "kind" "SduiScreenKind" NOT NULL,
    "title" JSONB NOT NULL,
    "description" JSONB,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "draftLayout" JSONB NOT NULL DEFAULT '{"schemaVersion":1,"sections":[]}',
    "draftRevision" INTEGER NOT NULL DEFAULT 0,
    "draftUpdatedById" BIGINT,
    "draftUpdatedAt" TIMESTAMP(3),
    "liveVersionId" BIGINT,
    "rules" JSONB NOT NULL DEFAULT '[]',
    "createdById" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SduiScreen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SduiScreenVersion" (
    "id" BIGSERIAL NOT NULL,
    "screenId" BIGINT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "SduiVersionStatus" NOT NULL DEFAULT 'PUBLISHED',
    "layout" JSONB NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "minAppVersion" VARCHAR(20),
    "checksum" VARCHAR(64) NOT NULL,
    "sectionKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "groupKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "note" VARCHAR(500),
    "publishAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "publishedById" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SduiScreenVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SduiSection" (
    "id" BIGSERIAL NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "name" JSONB NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "node" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "updatedById" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SduiSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SduiGroup" (
    "id" BIGSERIAL NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "title" JSONB NOT NULL,
    "subtitle" JSONB,
    "media" JSONB,
    "kind" "SduiGroupKind" NOT NULL,
    "items" JSONB NOT NULL DEFAULT '[]',
    "rule" JSONB,
    "schedule" JSONB,
    "landingScreenId" BIGINT,
    "landing" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SduiGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ProductCategories" (
    "A" BIGINT NOT NULL,
    "B" BIGINT NOT NULL,

    CONSTRAINT "_ProductCategories_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "User_role_status_approvalStatus_idx" ON "User"("role", "status", "approvalStatus");

-- CreateIndex
CREATE INDEX "User_storeId_role_approvalStatus_idx" ON "User"("storeId", "role", "approvalStatus");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_role_key" ON "User"("phone", "role");

-- CreateIndex
CREATE INDEX "Otp_isBlocked_idx" ON "Otp"("isBlocked");

-- CreateIndex
CREATE UNIQUE INDEX "Otp_destination_role_key" ON "Otp"("destination", "role");

-- CreateIndex
CREATE UNIQUE INDEX "Session_refreshTokenHash_key" ON "Session"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_revokedAt_idx" ON "Session"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Address_userId_isDefault_idx" ON "Address"("userId", "isDefault");

-- CreateIndex
CREATE INDEX "WishlistItem_userId_createdAt_idx" ON "WishlistItem"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryPartnerProfile_userId_key" ON "DeliveryPartnerProfile"("userId");

-- CreateIndex
CREATE INDEX "DeliveryPartnerProfile_isOnline_isAvailable_idx" ON "DeliveryPartnerProfile"("isOnline", "isAvailable");

-- CreateIndex
CREATE INDEX "KycDocument_userId_type_idx" ON "KycDocument"("userId", "type");

-- CreateIndex
CREATE INDEX "KycDocument_userId_submittedAt_idx" ON "KycDocument"("userId", "submittedAt");

-- CreateIndex
CREATE INDEX "KycDocument_status_createdAt_idx" ON "KycDocument"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MediaFile_status_createdAt_idx" ON "MediaFile"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MediaFile_status_lockedAt_idx" ON "MediaFile"("status", "lockedAt");

-- CreateIndex
CREATE INDEX "MediaFile_checksum_idx" ON "MediaFile"("checksum");

-- CreateIndex
CREATE INDEX "MediaFile_uploadedById_purpose_createdAt_idx" ON "MediaFile"("uploadedById", "purpose", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Store_code_key" ON "Store"("code");

-- CreateIndex
CREATE INDEX "Store_status_isOpen_idx" ON "Store"("status", "isOpen");

-- CreateIndex
CREATE INDEX "Store_bboxMinLat_bboxMaxLat_idx" ON "Store"("bboxMinLat", "bboxMaxLat");

-- CreateIndex
CREATE INDEX "Store_bboxMinLng_bboxMaxLng_idx" ON "Store"("bboxMinLng", "bboxMaxLng");

-- CreateIndex
CREATE INDEX "Store_countryCode_stateCode_idx" ON "Store"("countryCode", "stateCode");

-- CreateIndex
CREATE INDEX "StoreServiceArea_storeId_isActive_idx" ON "StoreServiceArea"("storeId", "isActive");

-- CreateIndex
CREATE INDEX "StoreServiceArea_minLat_maxLat_idx" ON "StoreServiceArea"("minLat", "maxLat");

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE INDEX "Category_parentId_status_position_idx" ON "Category"("parentId", "status", "position");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryGroup_slug_key" ON "CategoryGroup"("slug");

-- CreateIndex
CREATE INDEX "CategoryGroup_status_position_idx" ON "CategoryGroup"("status", "position");

-- CreateIndex
CREATE INDEX "CategoryGroupItem_categoryId_idx" ON "CategoryGroupItem"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_slug_key" ON "Brand"("slug");

-- CreateIndex
CREATE INDEX "Brand_status_idx" ON "Brand"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Product_slug_key" ON "Product"("slug");

-- CreateIndex
CREATE INDEX "Product_categoryId_status_idx" ON "Product"("categoryId", "status");

-- CreateIndex
CREATE INDEX "Product_brandId_status_idx" ON "Product"("brandId", "status");

-- CreateIndex
CREATE INDEX "Product_status_createdAt_idx" ON "Product"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Product_deletedAt_status_idx" ON "Product"("deletedAt", "status");

-- CreateIndex
CREATE INDEX "ProductTranslation_lang_title_idx" ON "ProductTranslation"("lang", "title");

-- CreateIndex
CREATE UNIQUE INDEX "ProductTranslation_productId_lang_key" ON "ProductTranslation"("productId", "lang");

-- CreateIndex
CREATE UNIQUE INDEX "OptionGroup_code_key" ON "OptionGroup"("code");

-- CreateIndex
CREATE UNIQUE INDEX "OptionValue_optionGroupId_code_key" ON "OptionValue"("optionGroupId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ProductOption_productId_optionGroupId_key" ON "ProductOption"("productId", "optionGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_sku_key" ON "ProductVariant"("sku");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_isActive_idx" ON "ProductVariant"("productId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_productId_optionHash_key" ON "ProductVariant"("productId", "optionHash");

-- CreateIndex
CREATE INDEX "VariantOptionValue_optionValueId_idx" ON "VariantOptionValue"("optionValueId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductBarcode_code_key" ON "ProductBarcode"("code");

-- CreateIndex
CREATE INDEX "ProductBarcode_variantId_idx" ON "ProductBarcode"("variantId");

-- CreateIndex
CREATE INDEX "ProductMedia_productId_position_idx" ON "ProductMedia"("productId", "position");

-- CreateIndex
CREATE INDEX "ProductMedia_variantId_idx" ON "ProductMedia"("variantId");

-- CreateIndex
CREATE INDEX "ProductMedia_mediaId_idx" ON "ProductMedia"("mediaId");

-- CreateIndex
CREATE INDEX "StoreProduct_storeId_categoryId_isActive_idx" ON "StoreProduct"("storeId", "categoryId", "isActive");

-- CreateIndex
CREATE INDEX "StoreProduct_storeId_productId_idx" ON "StoreProduct"("storeId", "productId");

-- CreateIndex
CREATE INDEX "StoreProduct_storeId_priceStatus_idx" ON "StoreProduct"("storeId", "priceStatus");

-- CreateIndex
CREATE INDEX "StoreProduct_storeId_status_idx" ON "StoreProduct"("storeId", "status");

-- CreateIndex
CREATE INDEX "StoreProduct_status_publishAt_idx" ON "StoreProduct"("status", "publishAt");

-- CreateIndex
CREATE INDEX "StoreProduct_storeId_flashEndsAt_idx" ON "StoreProduct"("storeId", "flashEndsAt");

-- CreateIndex
CREATE INDEX "StoreProduct_variantId_idx" ON "StoreProduct"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreProduct_storeId_variantId_key" ON "StoreProduct"("storeId", "variantId");

-- CreateIndex
CREATE INDEX "InventoryBatch_storeProductId_status_expiryDate_idx" ON "InventoryBatch"("storeProductId", "status", "expiryDate");

-- CreateIndex
CREATE INDEX "InventoryBatch_storeId_status_expiryDate_idx" ON "InventoryBatch"("storeId", "status", "expiryDate");

-- CreateIndex
CREATE INDEX "InventoryBatch_variantId_batchNumber_idx" ON "InventoryBatch"("variantId", "batchNumber");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryBatch_storeProductId_batchNumber_key" ON "InventoryBatch"("storeProductId", "batchNumber");

-- CreateIndex
CREATE INDEX "OrderItemBatch_orderItemId_idx" ON "OrderItemBatch"("orderItemId");

-- CreateIndex
CREATE INDEX "OrderItemBatch_batchId_idx" ON "OrderItemBatch"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_idempotencyKey_key" ON "StockMovement"("idempotencyKey");

-- CreateIndex
CREATE INDEX "StockMovement_storeProductId_createdAt_idx" ON "StockMovement"("storeProductId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_storeId_type_createdAt_idx" ON "StockMovement"("storeId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_orderItemId_idx" ON "StockMovement"("orderItemId");

-- CreateIndex
CREATE INDEX "StockMovement_batchId_idx" ON "StockMovement"("batchId");

-- CreateIndex
CREATE INDEX "StockMovement_refType_refId_idx" ON "StockMovement"("refType", "refId");

-- CreateIndex
CREATE INDEX "StorePriceHistory_storeProductId_createdAt_idx" ON "StorePriceHistory"("storeProductId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_grnNumber_key" ON "GoodsReceipt"("grnNumber");

-- CreateIndex
CREATE INDEX "GoodsReceipt_storeId_receivedAt_idx" ON "GoodsReceipt"("storeId", "receivedAt");

-- CreateIndex
CREATE INDEX "GoodsReceipt_storeId_supplierInvoiceNo_idx" ON "GoodsReceipt"("storeId", "supplierInvoiceNo");

-- CreateIndex
CREATE INDEX "GoodsReceiptItem_goodsReceiptId_idx" ON "GoodsReceiptItem"("goodsReceiptId");

-- CreateIndex
CREATE INDEX "GoodsReceiptItem_storeProductId_idx" ON "GoodsReceiptItem"("storeProductId");

-- CreateIndex
CREATE UNIQUE INDEX "Bundle_slug_key" ON "Bundle"("slug");

-- CreateIndex
CREATE INDEX "Bundle_storeId_isActive_idx" ON "Bundle"("storeId", "isActive");

-- CreateIndex
CREATE INDEX "BundleItem_variantId_idx" ON "BundleItem"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "BundleItem_bundleId_variantId_key" ON "BundleItem"("bundleId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "Cart_userId_key" ON "Cart"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Cart_guestToken_key" ON "Cart"("guestToken");

-- CreateIndex
CREATE INDEX "Cart_expiresAt_idx" ON "Cart"("expiresAt");

-- CreateIndex
CREATE INDEX "CartItem_variantId_idx" ON "CartItem"("variantId");

-- CreateIndex
CREATE INDEX "CartItem_bundleId_idx" ON "CartItem"("bundleId");

-- CreateIndex
CREATE UNIQUE INDEX "CartItem_cartId_variantId_key" ON "CartItem"("cartId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "CartItem_cartId_bundleId_key" ON "CartItem"("cartId", "bundleId");

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");

-- CreateIndex
CREATE INDEX "Coupon_isActive_startsAt_endsAt_idx" ON "Coupon"("isActive", "startsAt", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Order_userId_createdAt_idx" ON "Order"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_storeId_status_createdAt_idx" ON "Order"("storeId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Order_storeId_placedAt_idx" ON "Order"("storeId", "placedAt");

-- CreateIndex
CREATE INDEX "Order_deliveryPartnerId_status_idx" ON "Order"("deliveryPartnerId", "status");

-- CreateIndex
CREATE INDEX "Order_userId_couponId_idx" ON "Order"("userId", "couponId");

-- CreateIndex
CREATE INDEX "Order_status_paymentExpiresAt_idx" ON "Order"("status", "paymentExpiresAt");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_parentId_idx" ON "OrderItem"("parentId");

-- CreateIndex
CREATE INDEX "OrderItem_variantId_idx" ON "OrderItem"("variantId");

-- CreateIndex
CREATE INDEX "OrderItem_bundleId_idx" ON "OrderItem"("bundleId");

-- CreateIndex
CREATE INDEX "OrderEvent_orderId_createdAt_idx" ON "OrderEvent"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "Delivery_orderId_idx" ON "Delivery"("orderId");

-- CreateIndex
CREATE INDEX "Delivery_partnerId_status_idx" ON "Delivery"("partnerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_txnNumber_key" ON "Transaction"("txnNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_idempotencyKey_key" ON "Transaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Transaction_orderId_idx" ON "Transaction"("orderId");

-- CreateIndex
CREATE INDEX "Transaction_userId_createdAt_idx" ON "Transaction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_gatewayOrderId_idx" ON "Transaction"("gatewayOrderId");

-- CreateIndex
CREATE INDEX "Transaction_status_createdAt_idx" ON "Transaction"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_gateway_gatewayPaymentId_key" ON "Transaction"("gateway", "gatewayPaymentId");

-- CreateIndex
CREATE INDEX "WebhookEvent_status_receivedAt_idx" ON "WebhookEvent"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_gateway_eventId_key" ON "WebhookEvent"("gateway", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_idempotencyKey_key" ON "WalletTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "WalletTransaction_userId_createdAt_idx" ON "WalletTransaction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "WalletTransaction_orderId_idx" ON "WalletTransaction"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "SupportTicket_ticketNumber_key" ON "SupportTicket"("ticketNumber");

-- CreateIndex
CREATE INDEX "SupportTicket_userId_createdAt_idx" ON "SupportTicket"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_status_priority_createdAt_idx" ON "SupportTicket"("status", "priority", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_assignedToId_status_idx" ON "SupportTicket"("assignedToId", "status");

-- CreateIndex
CREATE INDEX "SupportTicket_storeId_status_idx" ON "SupportTicket"("storeId", "status");

-- CreateIndex
CREATE INDEX "SupportTicket_storeId_createdAt_idx" ON "SupportTicket"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_escalatedAt_status_idx" ON "SupportTicket"("escalatedAt", "status");

-- CreateIndex
CREATE INDEX "SupportMessage_ticketId_createdAt_idx" ON "SupportMessage"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ApprovalRequest_level_status_createdAt_idx" ON "ApprovalRequest"("level", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ApprovalRequest_storeId_status_createdAt_idx" ON "ApprovalRequest"("storeId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ApprovalRequest_targetType_targetId_status_idx" ON "ApprovalRequest"("targetType", "targetId", "status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_requestedById_createdAt_idx" ON "ApprovalRequest"("requestedById", "createdAt");

-- CreateIndex
CREATE INDEX "ApprovalRequest_type_status_idx" ON "ApprovalRequest"("type", "status");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_storeId_createdAt_idx" ON "AuditLog"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuthLog_phone_createdAt_idx" ON "AuthLog"("phone", "createdAt");

-- CreateIndex
CREATE INDEX "AuthLog_userId_createdAt_idx" ON "AuthLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuthLog_ipAddress_createdAt_idx" ON "AuthLog"("ipAddress", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AccessRole_code_key" ON "AccessRole"("code");

-- CreateIndex
CREATE UNIQUE INDEX "SduiScreen_key_key" ON "SduiScreen"("key");

-- CreateIndex
CREATE UNIQUE INDEX "SduiScreen_liveVersionId_key" ON "SduiScreen"("liveVersionId");

-- CreateIndex
CREATE INDEX "SduiScreen_kind_deletedAt_idx" ON "SduiScreen"("kind", "deletedAt");

-- CreateIndex
CREATE INDEX "SduiScreenVersion_status_publishAt_idx" ON "SduiScreenVersion"("status", "publishAt");

-- CreateIndex
CREATE INDEX "SduiScreenVersion_sectionKeys_idx" ON "SduiScreenVersion" USING GIN ("sectionKeys");

-- CreateIndex
CREATE INDEX "SduiScreenVersion_groupKeys_idx" ON "SduiScreenVersion" USING GIN ("groupKeys");

-- CreateIndex
CREATE UNIQUE INDEX "SduiScreenVersion_screenId_version_key" ON "SduiScreenVersion"("screenId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "SduiSection_key_key" ON "SduiSection"("key");

-- CreateIndex
CREATE INDEX "SduiSection_type_deletedAt_idx" ON "SduiSection"("type", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SduiGroup_key_key" ON "SduiGroup"("key");

-- CreateIndex
CREATE INDEX "SduiGroup_kind_isActive_idx" ON "SduiGroup"("kind", "isActive");

-- CreateIndex
CREATE INDEX "_ProductCategories_B_index" ON "_ProductCategories"("B");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_avatarId_fkey" FOREIGN KEY ("avatarId") REFERENCES "MediaFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_accessRoleId_fkey" FOREIGN KEY ("accessRoleId") REFERENCES "AccessRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WishlistItem" ADD CONSTRAINT "WishlistItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WishlistItem" ADD CONSTRAINT "WishlistItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryPartnerProfile" ADD CONSTRAINT "DeliveryPartnerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycDocument" ADD CONSTRAINT "KycDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaFile" ADD CONSTRAINT "MediaFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Store" ADD CONSTRAINT "Store_logoId_fkey" FOREIGN KEY ("logoId") REFERENCES "MediaFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreServiceArea" ADD CONSTRAINT "StoreServiceArea_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_iconId_fkey" FOREIGN KEY ("iconId") REFERENCES "MediaFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_bannerId_fkey" FOREIGN KEY ("bannerId") REFERENCES "MediaFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryGroupItem" ADD CONSTRAINT "CategoryGroupItem_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CategoryGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryGroupItem" ADD CONSTRAINT "CategoryGroupItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_logoId_fkey" FOREIGN KEY ("logoId") REFERENCES "MediaFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_bannerId_fkey" FOREIGN KEY ("bannerId") REFERENCES "MediaFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_thumbnailId_fkey" FOREIGN KEY ("thumbnailId") REFERENCES "MediaFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_audioMediaId_fkey" FOREIGN KEY ("audioMediaId") REFERENCES "MediaFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTranslation" ADD CONSTRAINT "ProductTranslation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptionValue" ADD CONSTRAINT "OptionValue_optionGroupId_fkey" FOREIGN KEY ("optionGroupId") REFERENCES "OptionGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptionValue" ADD CONSTRAINT "OptionValue_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "MediaFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductOption" ADD CONSTRAINT "ProductOption_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductOption" ADD CONSTRAINT "ProductOption_optionGroupId_fkey" FOREIGN KEY ("optionGroupId") REFERENCES "OptionGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_audioMediaId_fkey" FOREIGN KEY ("audioMediaId") REFERENCES "MediaFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantOptionValue" ADD CONSTRAINT "VariantOptionValue_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "MediaFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantOptionValue" ADD CONSTRAINT "VariantOptionValue_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantOptionValue" ADD CONSTRAINT "VariantOptionValue_optionValueId_fkey" FOREIGN KEY ("optionValueId") REFERENCES "OptionValue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductBarcode" ADD CONSTRAINT "ProductBarcode_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMedia" ADD CONSTRAINT "ProductMedia_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMedia" ADD CONSTRAINT "ProductMedia_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMedia" ADD CONSTRAINT "ProductMedia_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreProduct" ADD CONSTRAINT "StoreProduct_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreProduct" ADD CONSTRAINT "StoreProduct_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreProduct" ADD CONSTRAINT "StoreProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBatch" ADD CONSTRAINT "InventoryBatch_storeProductId_fkey" FOREIGN KEY ("storeProductId") REFERENCES "StoreProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemBatch" ADD CONSTRAINT "OrderItemBatch_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemBatch" ADD CONSTRAINT "OrderItemBatch_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "InventoryBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptItem" ADD CONSTRAINT "GoodsReceiptItem_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "GoodsReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bundle" ADD CONSTRAINT "Bundle_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bundle" ADD CONSTRAINT "Bundle_thumbnailId_fkey" FOREIGN KEY ("thumbnailId") REFERENCES "MediaFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BundleItem" ADD CONSTRAINT "BundleItem_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "Bundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BundleItem" ADD CONSTRAINT "BundleItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "Bundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "OrderItem"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "Bundle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SduiScreen" ADD CONSTRAINT "SduiScreen_liveVersionId_fkey" FOREIGN KEY ("liveVersionId") REFERENCES "SduiScreenVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SduiScreenVersion" ADD CONSTRAINT "SduiScreenVersion_screenId_fkey" FOREIGN KEY ("screenId") REFERENCES "SduiScreen"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SduiGroup" ADD CONSTRAINT "SduiGroup_landingScreenId_fkey" FOREIGN KEY ("landingScreenId") REFERENCES "SduiScreen"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProductCategories" ADD CONSTRAINT "_ProductCategories_A_fkey" FOREIGN KEY ("A") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProductCategories" ADD CONSTRAINT "_ProductCategories_B_fkey" FOREIGN KEY ("B") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
