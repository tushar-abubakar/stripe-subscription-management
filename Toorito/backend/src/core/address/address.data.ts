/**
 * Country address formats (WooCommerce style, with nested regions).
 *
 * A country lists its top-level regions (state / division / province). A
 * region may have `children` (district, county …); when it does, the child
 * is required too. The admin form cascades: country → level 1 → level 2.
 *
 * Only countries listed in `ADDRESS_COUNTRIES` are exposed; each of them must
 * have an entry here (checked at boot). To support a new country, add one
 * entry. Codes follow ISO 3166-2 without the country prefix.
 */

export interface RegionDef {
    code: string;
    name: string;
    /** Other spellings / legacy codes, used to match Google results and free text. */
    aliases?: string[];
    children?: RegionDef[];
}

export interface AddressFormat {
    code: string;
    /** Labels per region level, top-down, e.g. ["Division", "District"]. */
    levels: string[];
    cityLabel: string;
    postcode: {
        label: string;
        pattern: RegExp;
        example: string;
        required: boolean;
    };
    /** Allowed store timezones; the first one is the default. */
    timezones: string[];
    regions: RegionDef[];
}

const districts = (list: [string, string, string[]?][]): RegionDef[] =>
    list.map(([code, name, aliases]) => ({ code, name, aliases }));

export const ADDRESS_FORMATS: Record<string, AddressFormat> = {
    BD: {
        code: "BD",
        levels: ["Division", "District"],
        cityLabel: "City / Upazila / Thana",
        postcode: { label: "Postcode", pattern: /^\d{4}$/, example: "1212", required: true },
        timezones: ["Asia/Dhaka"],
        regions: [
            {
                code: "A",
                name: "Barishal",
                aliases: ["Barisal"],
                children: districts([
                    ["02", "Barguna"],
                    ["06", "Barishal", ["Barisal"]],
                    ["07", "Bhola"],
                    ["25", "Jhalokati", ["Jhalakathi"]],
                    ["51", "Patuakhali"],
                    ["50", "Pirojpur"],
                ]),
            },
            {
                code: "B",
                name: "Chattogram",
                aliases: ["Chittagong"],
                children: districts([
                    ["01", "Bandarban"],
                    ["04", "Brahmanbaria"],
                    ["09", "Chandpur"],
                    ["10", "Chattogram", ["Chittagong"]],
                    ["11", "Cox's Bazar", ["Coxs Bazar"]],
                    ["08", "Cumilla", ["Comilla"]],
                    ["16", "Feni"],
                    ["29", "Khagrachhari", ["Khagrachari"]],
                    ["31", "Lakshmipur", ["Laxmipur"]],
                    ["47", "Noakhali"],
                    ["56", "Rangamati"],
                ]),
            },
            {
                code: "C",
                name: "Dhaka",
                children: districts([
                    ["13", "Dhaka"],
                    ["15", "Faridpur"],
                    ["18", "Gazipur"],
                    ["17", "Gopalganj"],
                    ["26", "Kishoreganj"],
                    ["36", "Madaripur"],
                    ["33", "Manikganj"],
                    ["35", "Munshiganj"],
                    ["40", "Narayanganj"],
                    ["42", "Narsingdi"],
                    ["53", "Rajbari"],
                    ["62", "Shariatpur"],
                    ["63", "Tangail"],
                ]),
            },
            {
                code: "D",
                name: "Khulna",
                children: districts([
                    ["05", "Bagerhat"],
                    ["12", "Chuadanga"],
                    ["22", "Jashore", ["Jessore"]],
                    ["23", "Jhenaidah"],
                    ["27", "Khulna"],
                    ["30", "Kushtia"],
                    ["37", "Magura"],
                    ["39", "Meherpur"],
                    ["43", "Narail"],
                    ["58", "Satkhira"],
                ]),
            },
            {
                code: "E",
                name: "Rajshahi",
                children: districts([
                    ["03", "Bogura", ["Bogra"]],
                    ["45", "Chapai Nawabganj", ["Chapainawabganj", "Nawabganj"]],
                    ["24", "Joypurhat"],
                    ["48", "Naogaon"],
                    ["44", "Natore"],
                    ["49", "Pabna"],
                    ["54", "Rajshahi"],
                    ["59", "Sirajganj"],
                ]),
            },
            {
                code: "F",
                name: "Rangpur",
                children: districts([
                    ["14", "Dinajpur"],
                    ["19", "Gaibandha"],
                    ["28", "Kurigram"],
                    ["32", "Lalmonirhat"],
                    ["46", "Nilphamari"],
                    ["52", "Panchagarh"],
                    ["55", "Rangpur"],
                    ["64", "Thakurgaon"],
                ]),
            },
            {
                code: "G",
                name: "Sylhet",
                children: districts([
                    ["20", "Habiganj"],
                    ["38", "Moulvibazar", ["Maulvibazar"]],
                    ["61", "Sunamganj"],
                    ["60", "Sylhet"],
                ]),
            },
            {
                code: "H",
                name: "Mymensingh",
                children: districts([
                    ["21", "Jamalpur"],
                    ["34", "Mymensingh"],
                    ["41", "Netrokona", ["Netrakona"]],
                    ["57", "Sherpur"],
                ]),
            },
        ],
    },

    IN: {
        code: "IN",
        levels: ["State / UT"],
        cityLabel: "City",
        postcode: { label: "PIN code", pattern: /^[1-9]\d{5}$/, example: "560034", required: true },
        timezones: ["Asia/Kolkata"],
        regions: [
            { code: "AN", name: "Andaman and Nicobar Islands" },
            { code: "AP", name: "Andhra Pradesh" },
            { code: "AR", name: "Arunachal Pradesh" },
            { code: "AS", name: "Assam" },
            { code: "BR", name: "Bihar" },
            { code: "CH", name: "Chandigarh" },
            { code: "CG", name: "Chhattisgarh", aliases: ["CT", "Chattisgarh"] },
            {
                code: "DH",
                name: "Dadra and Nagar Haveli and Daman and Diu",
                aliases: ["DN", "DD", "Daman and Diu", "Dadra and Nagar Haveli"],
            },
            { code: "DL", name: "Delhi", aliases: ["National Capital Territory of Delhi", "NCT of Delhi"] },
            { code: "GA", name: "Goa" },
            { code: "GJ", name: "Gujarat" },
            { code: "HR", name: "Haryana" },
            { code: "HP", name: "Himachal Pradesh" },
            { code: "JK", name: "Jammu and Kashmir" },
            { code: "JH", name: "Jharkhand" },
            { code: "KA", name: "Karnataka" },
            { code: "KL", name: "Kerala" },
            { code: "LA", name: "Ladakh" },
            { code: "LD", name: "Lakshadweep" },
            { code: "MP", name: "Madhya Pradesh" },
            { code: "MH", name: "Maharashtra" },
            { code: "MN", name: "Manipur" },
            { code: "ML", name: "Meghalaya" },
            { code: "MZ", name: "Mizoram" },
            { code: "NL", name: "Nagaland" },
            { code: "OD", name: "Odisha", aliases: ["OR", "Orissa"] },
            { code: "PY", name: "Puducherry", aliases: ["Pondicherry"] },
            { code: "PB", name: "Punjab" },
            { code: "RJ", name: "Rajasthan" },
            { code: "SK", name: "Sikkim" },
            { code: "TN", name: "Tamil Nadu" },
            { code: "TG", name: "Telangana", aliases: ["TS"] },
            { code: "TR", name: "Tripura" },
            { code: "UP", name: "Uttar Pradesh" },
            { code: "UK", name: "Uttarakhand", aliases: ["UT", "Uttaranchal"] },
            { code: "WB", name: "West Bengal" },
        ],
    },
};
