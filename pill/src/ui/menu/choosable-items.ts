import { z } from "@gemini-live/protocol/zod";
import { createGuard, VOID_METHOD_SCHEMA } from "@gemini-live/protocol/zod-guard";

const isItemList = createGuard(
  z.looseObject({
    size: z.number(),
    getAt: z.function({
      input: [z.int()],
      output: z.unknown()
    })
  })
);

const clickableSchema = z.looseObject({
  onClick: z.function({
    input: [VOID_METHOD_SCHEMA],
    output: VOID_METHOD_SCHEMA
  })
});

const isClickable = createGuard(clickableSchema);

const isSubMenu = createGuard(z.looseObject({ items: z.unknown() }));

// Every item that can be chosen, sub-menus' included
export function choosableItemsOf(root: unknown) {
  const found: z.infer<typeof clickableSchema>[] = [];
  const lists = [root];
  while (lists.length > 0) {
    const items = lists.shift();
    if (!isItemList(items)) {
      continue;
    }

    for (let itemIndex = 0; itemIndex < items.size; itemIndex++) {
      const item = items.getAt(itemIndex);
      if (isClickable(item)) {
        found.push(item);
      }

      if (isSubMenu(item)) {
        lists.push(item.items);
      }
    }
  }

  return found;
}
