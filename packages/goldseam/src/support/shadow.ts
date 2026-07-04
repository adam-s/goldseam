// Shadow- and frame-piercing DOM capture. `outerHTML` silently drops
// shadow roots and iframe documents — exactly where component libraries
// (Material, AG-Grid, portals) and embedded widgets put the elements that
// break. This builds a detached clone in which:
// - every OPEN shadow root appears as declarative shadow DOM
//   (`<template shadowrootmode="open">…</template>`, the standard), and
// - every SAME-ORIGIN iframe's document appears as a sibling
//   `<template data-frame-content>` (templates cannot live inside
//   <iframe> — the parser reads them as text — so the sibling position is
//   the parse-safe convention; aria-snapshot's tooling understands it).
// Closed shadow roots and cross-origin frames stay unreachable — those
// walls are real and documented.

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
    if ((child as Element).nodeName === 'IFRAME') {
      const frameDoc = contentDocumentOrNull(child as HTMLIFrameElement);
      if (frameDoc?.documentElement) {
        const template = doc.createElement('template');
        template.setAttribute('data-frame-content', '');
        const src = (child as Element).getAttribute('src');
        if (src) template.setAttribute('data-frame-src', src);
        template.content.appendChild(cloneWithShadow(frameDoc.documentElement));
        clone.appendChild(template);
      }
    }
  }
  return clone;
}

function cloneNodeWithShadow(node: Node, doc: Document): Node {
  return node.nodeType === 1 ? cloneWithShadow(node as Element) : doc.importNode(node, true);
}

function contentDocumentOrNull(frame: HTMLIFrameElement): Document | null {
  try {
    return frame.contentDocument;
  } catch {
    return null; // cross-origin
  }
}
