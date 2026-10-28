/** Starting designs of new screens. The app renderer also falls back to them while a system template / shell was never published. */
import { COMPONENT_MAP } from "./component.registry";
import {
    SDUI_SCHEMA_VERSION,
    SduiLayout,
    SduiNode,
} from "./contract";
import { DEFAULT_THEME } from "./definitions";
import { SduiScreenKind } from "@prisma-client/enums";

const node = (
    id: string,
    type: string,
    extra: Record<string, unknown> = {},
): SduiNode =>
    ({
        id,
        ...(COMPONENT_MAP.get(type)!.defaults as object),
        ...extra,
    }) as SduiNode;

export function starterLayout(kind: SduiScreenKind, key: string): SduiLayout {
    const base: SduiLayout = {
        schemaVersion: SDUI_SCHEMA_VERSION,
        sections: [],
    };
    if (kind === "SHELL")
        return {
            ...base,
            appBar: node("app_bar", "location_header"),
            bottomBar: node("tabs", "bottom_nav"),
            theme: DEFAULT_THEME,
        };
    if (kind !== "TEMPLATE") return base;
    const products = node("items", "product_grid", {
        source: { type: "entity", limit: 20 },
    });
    if (key.startsWith("category_landing"))
        return {
            ...base,
            sections: [
                node("tabs", "subcategory_tabs"),
                node("filters", "filter_bar"),
                products,
            ],
        };
    if (key.startsWith("group_landing") || key.startsWith("brand_landing"))
        return {
            ...base,
            sections: [
                node("header", "entity_header"),
                node("filters", "filter_bar"),
                products,
            ],
        };
    return base;
}
