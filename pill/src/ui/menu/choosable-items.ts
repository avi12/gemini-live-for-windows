interface ItemList {
  size: number;
  getAt(index: number): unknown;
}

function isItemList(value: unknown): value is ItemList {
  return typeof value === "object" && value !== null && "getAt" in value && "size" in value;
}

function isClickable(value: unknown): value is { onClick(callback: () => void): () => void } {
  return typeof value === "object" && value !== null && "onClick" in value;
}

// Every item that can be chosen, sub-menus' included
export function choosableItemsOf(root: unknown) {
  const found: { onClick(callback: () => void): () => void }[] = [];
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

      const isSubMenu = typeof item === "object" && item !== null && "items" in item;
      if (isSubMenu) {
        lists.push(item.items);
      }
    }
  }

  return found;
}
