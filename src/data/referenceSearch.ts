/**
 * Search in the Reference tab: an index of its entries, ranking, the ranges
 * of text to highlight and a "did you mean" suggestion. No DOM, so the tests
 * run it in Node.
 */

import type { ReferenceSection, ReferenceTopic } from './reference.ts';

export interface RefEntry {
    /** Stable key: section title and position. */
    id: string;
    topicId: string;
    topic: string;
    section: string;
    /** A paragraph before the list, an item of the list, or the paragraph after it. */
    kind: 'note' | 'item' | 'after';
    /** The code column of an item, e.g. ".lpf(hz)". */
    term?: string;
    /** The description or the paragraph; text in `backticks` is code. */
    text: string;
    /** Functions and controls the entry is about, as written: ".lpf", "stack". */
    refs: string[];
    /** The same names in lower case, without the dot. */
    names: string[];
    /** Extended help of those names, searched with the lowest weight. */
    doc: string;
    /** Position in reading order, for ties. */
    order: number;
    termLower: string;
    textLower: string;
    docLower: string;
}

export interface RefMatch {
    entry: RefEntry;
    score: number;
    /** Every word was found in the term or the text, so the highlight shows why the entry matched. */
    visible: boolean;
}

/** Extended help of an item (of its names, or of its mini-notation symbols), as plain text. */
export type DocLookup = (item: { term: string; refs: string[]; section: string }) => string | undefined;

const lower = (text: string) => text.toLowerCase().replace(/`/g, '');

/**
 * Names in the code column of an item: ".delay(x) .delaytime(s)" gives
 * .delay and .delaytime, "scale(name, p)" gives scale. Arguments,
 * mini-notation strings and key names (Ctrl+Enter) give none.
 */
export function namesInTerm(term: string): string[] {
    if (/^\s*["']/.test(term)) return [];
    let text = term;
    for (let previous = ''; previous !== text;) {
        previous = text;
        text = text.replace(/\([^()]*\)/g, '');
    }
    const refs: string[] = [];
    for (const chunk of text.split(/[\s/,]+/)) {
        const m = /^\.?[a-z_$][\w$]*/.exec(chunk);
        if (m && !refs.includes(m[0])) refs.push(m[0]);
    }
    return refs;
}

/** Names in `backticks` in a paragraph: "`bd` kick, `sn` snare" gives bd and sn. */
function namesInText(text: string): string[] {
    const refs: string[] = [];
    for (const m of text.matchAll(/`(\.?[a-z_$][\w$]*)`/g)) if (!refs.includes(m[1])) refs.push(m[1]);
    return refs;
}

const bare = (ref: string) => ref.replace(/^\./, '').toLowerCase();

/** Every entry of the Reference, topic by topic, in reading order. */
export function buildReferenceIndex(sections: ReferenceSection[], topics: ReferenceTopic[], docFor?: DocLookup): RefEntry[] {
    const byTitle = new Map(sections.map((s) => [s.title, s]));
    const entries: RefEntry[] = [];
    const add = (topic: ReferenceTopic, section: ReferenceSection, id: string, kind: RefEntry['kind'], text: string, term?: string) => {
        const refs = term !== undefined ? namesInTerm(term) : namesInText(text);
        const doc = (term !== undefined && docFor?.({ term, refs, section: section.title })) || '';
        entries.push({
            id, topicId: topic.id, topic: topic.label, section: section.title, kind, term, text, refs,
            names: refs.map(bare), doc, order: entries.length,
            termLower: term ? lower(term) : '', textLower: lower(text), docLower: doc.toLowerCase(),
        });
    };
    for (const topic of topics) {
        for (const title of topic.sections) {
            const section = byTitle.get(title);
            if (!section) continue;
            (section.notes ?? []).forEach((note, i) => add(topic, section, `${title}#note${i}`, 'note', note));
            (section.items ?? []).forEach(([term, text], i) => add(topic, section, `${title}#${i}`, 'item', text, term));
            if (section.after) add(topic, section, `${title}#after`, 'after', section.after);
        }
    }
    return entries;
}

/** The words of a query, in lower case. */
export function queryWords(query: string): string[] {
    return query.toLowerCase().replace(/`/g, '').split(/\s+/).filter(Boolean);
}

/**
 * How well an entry matches the words, or null when a word is missing. Per
 * word: the exact name 100, the start of a name 70, part of a name 50, the
 * code column 40, the description 20, only the extended help 5.
 */
export function scoreEntry(entry: RefEntry, words: string[]): RefMatch | null {
    let score = 0;
    let visible = true;
    for (const word of words) {
        const name = word.replace(/^\./, '').replace(/\(.*$/, '');
        let best = 0;
        if (name) {
            for (const n of entry.names) {
                if (n === name) best = Math.max(best, 100);
                else if (n.startsWith(name)) best = Math.max(best, 70);
                else if (n.includes(name)) best = Math.max(best, 50);
            }
        }
        if (best < 40 && entry.termLower.includes(word)) best = 40;
        if (best < 20 && entry.textLower.includes(word)) best = 20;
        if (!best && entry.docLower.includes(word)) {
            best = 5;
            visible = false;
        }
        if (!best) return null;
        score += best;
    }
    if (words.length > 1) {
        const phrase = words.join(' ');
        if (entry.termLower.includes(phrase) || entry.textLower.includes(phrase)) score += 15;
    }
    return { entry, score, visible };
}

/** Entries matching every word of the query, best first; ties keep reading order. */
export function searchReference(entries: RefEntry[], query: string): RefMatch[] {
    const words = queryWords(query);
    if (!words.length) return [];
    const matches: RefMatch[] = [];
    for (const entry of entries) {
        const match = scoreEntry(entry, words);
        if (match) matches.push(match);
    }
    return matches.sort((a, b) => b.score - a.score || a.entry.order - b.entry.order);
}

/** [start, end) ranges of the text where a word of the query occurs, sorted and merged. */
export function matchRanges(text: string, query: string): [number, number][] {
    const haystack = text.toLowerCase();
    const ranges: [number, number][] = [];
    for (const word of queryWords(query)) {
        for (let at = haystack.indexOf(word); at >= 0; at = haystack.indexOf(word, at + word.length)) {
            ranges.push([at, at + word.length]);
        }
    }
    ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged: [number, number][] = [];
    for (const range of ranges) {
        const last = merged[merged.length - 1];
        if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
        else merged.push([range[0], range[1]]);
    }
    return merged;
}

/** The part of a long text around the first word of the query found in it, with ellipses. */
export function excerpt(text: string, query: string, radius = 60): string {
    const flat = text.replace(/\s+/g, ' ').trim();
    const first = matchRanges(flat, query)[0];
    if (!first) return flat.length > radius * 2 ? flat.slice(0, radius * 2).trimEnd() + '…' : flat;
    let start = Math.max(0, first[0] - radius);
    let end = Math.min(flat.length, first[1] + radius);
    // Cut at spaces, not inside words.
    if (start > 0) {
        const space = flat.indexOf(' ', start);
        if (space >= 0 && space < first[0]) start = space + 1;
    }
    if (end < flat.length) {
        const space = flat.lastIndexOf(' ', end);
        if (space > first[1]) end = space;
    }
    return (start > 0 ? '…' : '') + flat.slice(start, end) + (end < flat.length ? '…' : '');
}

/** Edit distance where swapping two neighbouring letters counts as one edit. */
export function editDistance(a: string, b: string): number {
    const rows: number[][] = [];
    for (let i = 0; i <= a.length; i++) {
        rows.push([i]);
        for (let j = 1; j <= b.length; j++) {
            if (i === 0) {
                rows[0][j] = j;
                continue;
            }
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            let d = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, rows[i - 2][j - 2] + 1);
            rows[i][j] = d;
        }
    }
    return rows[a.length][b.length];
}

/** A name close to a one-word query that found nothing (a typo such as "revreb"), or undefined. */
export function suggestName(entries: RefEntry[], query: string): string | undefined {
    const words = queryWords(query);
    if (words.length !== 1) return undefined;
    const word = words[0].replace(/^\./, '').replace(/\(.*$/, '');
    if (word.length < 3) return undefined;
    const limit = word.length <= 5 ? 1 : 2;
    let best: string | undefined;
    let bestDistance = limit + 1;
    const seen = new Set<string>();
    for (const entry of entries) {
        entry.names.forEach((name, i) => {
            if (seen.has(name)) return;
            seen.add(name);
            if (Math.abs(name.length - word.length) > limit) return;
            // On a tie, a name with the same first letter wins: "lfp" is lpf rather than ifp.
            const d = editDistance(word, name) + (name[0] === word[0] ? 0 : 0.5);
            if (d < bestDistance) {
                bestDistance = d;
                best = entry.refs[i].replace(/^\./, '');
            }
        });
    }
    return best;
}
