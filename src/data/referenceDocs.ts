/**
 * The extended help behind each item of the Reference tab: the docs of the
 * functions an item names, or of its mini-notation symbols. No DOM.
 */

import { DOCS, GLOBAL_DOCS, MINI_DOCS, SOUND_DOCS, type Doc } from './docs.ts';
import type { DocLookup } from './referenceSearch.ts';
import { GLOBAL_SIGNATURES, METHOD_SIGNATURES, signatureLabel } from './signatures.ts';

export interface RefDoc {
    /** ".fast(factor)", "stack(patterns)", "sine" or a mini-notation symbol. */
    label: string;
    doc: Doc;
}

/** The mini-notation items of the Reference, by their term, and the symbols they show. */
const MINI_TERMS: Record<string, string[]> = {
    '"bd sn"': [],
    '"bd ~ sn"': ['~'],
    '"hh*4" "bd/2"': ['*n', '/n'],
    '"bd [sn sn]"': ['[ ]'],
    '"bd <sn cp>"': ['< >'],
    '"[bd, hh hh]"': [','],
    '"{a b, c d e}"': ['{ }', '%n'],
    '"bd(3,8,2)"': ['(k,n,r)'],
    '"bd? hh?0.3"': ['?'],
    '"bd!3" "bd !"': ['!n'],
    '"bd@3 sn" "bd _"': ['@n', '_'],
    '"[bd | sn]"': ['|'],
    '"bd . hh hh"': ['.'],
    '"0 .. 7"': ['..'],
};

export interface RefItem {
    term: string;
    refs: string[];
    section: string;
}

/** The docs of an item, without repeats. */
export function referenceDocs(item: RefItem): RefDoc[] {
    if (item.section === 'Mini-notation') {
        if (item.term.includes("'")) return [{ label: 'chord', doc: DOCS.chord }];
        return (MINI_TERMS[item.term] ?? []).filter((symbol) => MINI_DOCS[symbol]).map((symbol) => ({ label: symbol, doc: MINI_DOCS[symbol] }));
    }
    const out: RefDoc[] = [];
    const seen = new Set<Doc>();
    for (const ref of item.refs) {
        const name = ref.replace(/^\./, '');
        const method = ref.startsWith('.');
        const doc = item.section === 'Sounds'
            ? SOUND_DOCS[name] ?? DOCS[name]
            : method ? DOCS[name] ?? GLOBAL_DOCS[name] : GLOBAL_DOCS[name] ?? DOCS[name] ?? SOUND_DOCS[name];
        if (!doc || seen.has(doc)) continue;
        seen.add(doc);
        const sig = method ? METHOD_SIGNATURES[name] ?? GLOBAL_SIGNATURES[name] : GLOBAL_SIGNATURES[name] ?? METHOD_SIGNATURES[name];
        out.push({ label: (method ? '.' : '') + (sig ? signatureLabel(name, sig) : name), doc });
    }
    return out;
}

/** The text of an item's docs that search looks in: what they do and the tips, not the examples. */
export const referenceDocText: DocLookup = (item) =>
    referenceDocs(item).map(({ doc }) => doc.about + (doc.tip ? ' ' + doc.tip : '')).join('\n') || undefined;
