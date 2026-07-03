// Shadow-piercing DOM capture. `outerHTML` silently drops shadow roots —
// exactly where component libraries (Material, AG-Grid, portals) put the
// elements that break. This builds a detached clone in which every OPEN
// shadow root appears as declarative shadow DOM
// (`<template shadowrootmode="open">…</template>`), the standard
// serialization a model (or a browser) can read back. Closed roots stay
// unreachable — that wall is real and documented.

export function cloneWithShadow(el: Element): Element {
  const doc = el.ownerDocument;
  const clone = el.cloneNode(false) as Element;

  if (el.shadowRoot) {
    const template = doc.createElement('template');
    template.setAttribute('shadowrootmode', 'open');
    for (const child of Array.from(el.shadowRoot.childNodes)) {
      template.content.appendChild(cloneNodeWithShadow(child, doc));
    }
    clone.appendChild(template);
  }
  for (const child of Array.from(el.childNodes)) {
    clone.appendChild(cloneNodeWithShadow(child, doc));
  }
  return clone;
}

function cloneNodeWithShadow(node: Node, doc: Document): Node {
  return node.nodeType === 1 ? cloneWithShadow(node as Element) : doc.importNode(node, true);
}
