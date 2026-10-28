import { PrismaClient } from "@prisma-client/client";
import { PrismaPg } from "@prisma/adapter-pg";
import * as argon2 from "argon2";
import "dotenv/config";

const pool = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter: pool });

async function main() {
    await prisma.user.upsert({
        where: { phone_role: { phone: "+919999999999", role: "SUPER_ADMIN" } },
        update: {},
        create: {
            phone: "+919999999999",
            role: "SUPER_ADMIN",
            name: "Super Admin",
            passwordHash: await argon2.hash("ChangeMe123!"),
            approvalStatus: "APPROVED",
        },
    });

    /*const store = await prisma.store.upsert({
        where: { slug: "downtown" },
        update: {},
        create: {
            name: "Downtown Store",
            slug: "downtown",
            lat: 12.9716,
            lng: 77.5946,
            radiusKm: 5,
        },
    });

    const brand = await prisma.brand.upsert({
        where: { slug: "generic" },
        update: {},
        create: { name: "Generic", slug: "generic" },
    });
    const category = await prisma.category.upsert({
        where: { slug: "groceries" },
        update: {},
        create: { name: "Groceries", slug: "groceries" },
    });

    const product = await prisma.product.upsert({
        where: { slug: "rice" },
        update: {},
        create: {
            name: "Rice",
            slug: "rice",
            brandId: brand.id,
            categoryId: category.id,
            status: "ACTIVE",
            isPerishable: false,
        },
    });

    const variant = await prisma.productVariant.upsert({
        where: { sku: "RICE-1KG" },
        update: {},
        create: {
            productId: product.id,
            name: "1kg",
            sku: "RICE-1KG",
            unit: "kg",
            weight: 1,
        },
    });

    await prisma.storeProduct.upsert({
        where: {
            storeId_variantId: { storeId: store.id, variantId: variant.id },
        },
        update: {},
        create: {
            storeId: store.id,
            variantId: variant.id,
            sellingPrice: 60,
            compareAtPrice: 70,
        },
    });
	*/

    console.log(
        "Seeded: 1 admin (phone +910000000000 / pwd ChangeMe123!), 1 store, 1 product+variant.",
    );
}

main()
    .catch((error: Error) => {
        console.error("Seeding failed:", error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
