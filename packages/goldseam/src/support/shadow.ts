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

export function cloneWithShadow(el: Element, seenDocs?: Set<Document>): Element {
  const doc = el.ownerDocument;
  const seen = seenDocs ?? new Set<Document>([doc]);
  const clone = el.cloneNode(false) as Element;

  if (el.shadowRoot) {
    const template = doc.createElement('template');
    template.setAttribute('shadowrootmode', 'open');
    for (const child of Array.from(el.shadowRoot.childNodes)) {
      appendWithFrames(template.content, child, doc, seen);
    }
    clone.appendChild(template);
  }
  for (const child of Array.from(el.childNodes)) {
    appendWithFrames(clone, child, doc, seen);
  }
  return clone;
}

/** Append a cloned child, and when it is a same-origin iframe, its
 * document as a sibling template — from BOTH light-DOM and shadow-root
 * child lists (red-team finding: a frame inside a shadow root was visible
 * to the aria walk but dropped from the DOM capture). `seen` guards
 * against frame graphs that reference an ancestor document. */
function appendWithFrames(target: ParentNode & Node, child: Node, doc: Document, seen: Set<Document>): void {
  target.appendChild(cloneNodeWithShadow(child, doc, seen));
  if ((child as Element).nodeName !== 'IFRAME') return;
  const frameDoc = contentDocumentOrNull(child as HTMLIFrameElement);
  if (!frameDoc?.documentElement || seen.has(frameDoc)) return;
  seen.add(frameDoc);
  const template = doc.createElement('template');
  template.setAttribute('data-frame-content', '');
  const src = (child as Element).getAttribute('src');
  if (src) template.setAttribute('data-frame-src', src);
  template.content.appendChild(cloneWithShadow(frameDoc.documentElement, seen));
  target.appendChild(template);
}

function cloneNodeWithShadow(node: Node, doc: Document, seen: Set<Document>): Node {
  return node.nodeType === 1 ? cloneWithShadow(node as Element, seen) : doc.importNode(node, true);
}

function contentDocumentOrNull(frame: HTMLIFrameElement): Document | null {
  try {
    return frame.contentDocument;
  } catch {
    return null; // cross-origin
  }
}
