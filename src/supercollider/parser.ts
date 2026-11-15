/**
 * A parser for SuperCollider's language. As in sclang, binary operators have
 * no precedence (they run left to right), method calls bind tighter than
 * them, and `Class(args)` is `Class.new(args)`.
 */
import { SCSyntaxError, tokenize, type Token } from "./lexer.ts";

export type Node =
  | { t: "num"; v: number; line: number; float?: boolean }
  | { t: "str"; v: string; line: number }
  | { t: "sym"; v: string; line: number }
  | { t: "char"; v: string; line: number }
  | { t: "bool"; v: boolean; line: number }
  | { t: "nil"; line: number }
  | { t: "var"; name: string; line: number }
  | { t: "env"; name: string; line: number }
  | { t: "class"; name: string; line: number }
  | { t: "array"; items: Node[]; line: number }
  | { t: "event"; pairs: [string, Node][]; line: number }
  | { t: "range"; from: Node; then: Node | null; to: Node | null; line: number }
  | { t: "call"; recv: Node; method: string; args: Node[]; kwargs: [string, Node][]; line: number }
  | { t: "binop"; op: string; a: Node; b: Node; line: number }
  | { t: "neg"; a: Node; line: number }
  | { t: "func"; params: Param[]; rest: string | null; vars: Param[]; body: Node[]; line: number }
  | { t: "assign"; target: Node; value: Node; line: number }
  | { t: "multi"; targets: Node[]; rest: Node | null; value: Node; line: number }
  | { t: "vars"; decls: Param[]; line: number }
  | { t: "block"; body: Node[]; line: number }
  | { t: "index"; recv: Node; index: Node; line: number }
  | { t: "slice"; recv: Node; from: Node | null; to: Node | null; line: number }
  | { t: "splat"; a: Node; line: number }
  | { t: "pair"; key: string; value: Node; line: number };

export interface Param {
  name: string;
  init: Node | null;
}

export function parse(src: string): Node[] {
  return new Parser(tokenize(src)).program();
}

class Parser {
  private toks: Token[];
  private i = 0;
  constructor(toks: Token[]) {
    this.toks = toks;
  }

  private get tok() { return this.toks[this.i]; }
  private peek(k = 1) { return this.toks[this.i + k]; }
  private is(type: Token["type"], value?: string) {
    const t = this.tok;
    return t.type === type && (value === undefined || t.value === value);
  }
  private eat(type: Token["type"], value?: string): Token {
    if (!this.is(type, value)) {
      const t = this.tok;
      throw new SCSyntaxError("Expected " + (value ?? type) + " but found " + (t.type === "eof" ? "the end" : JSON.stringify(t.value)), t.line);
    }
    return this.toks[this.i++];
  }
  private accept(type: Token["type"], value?: string) {
    if (this.is(type, value)) { this.i++; return true; }
    return false;
  }

  program(): Node[] {
    const out = this.statements(() => this.is("eof"));
    this.eat("eof");
    return out;
  }

  /** Statements separated by ; until `end()`. */
  private statements(end: () => boolean): Node[] {
    const out: Node[] = [];
    while (!end()) {
      if (this.accept("punc", ";")) continue;
      if (this.is("id", "var") || this.is("id", "classvar") || this.is("id", "const")) {
        out.push(this.varDecl());
        continue;
      }
      this.accept("punc", "^"); // ^value returns: the last value is returned anyway
      out.push(this.expr());
      if (!end() && !this.accept("punc", ";")) {
        // sclang needs ; between statements; be lenient after a block.
        if (end()) break;
        const prev = this.toks[this.i - 1];
        if (!(prev && prev.type === "punc" && (prev.value === ")" || prev.value === "}"))) {
          throw new SCSyntaxError("Expected ; but found " + JSON.stringify(this.tok.value), this.tok.line);
        }
      }
    }
    return out;
  }

  private varDecl(): Node {
    const line = this.tok.line;
    this.i++;
    const decls: Param[] = [];
    do {
      const name = this.eat("id").value;
      let init: Node | null = null;
      if (this.accept("op", "=")) init = this.expr();
      decls.push({ name, init });
    } while (this.accept("punc", ","));
    return { t: "vars", decls, line };
  }

  expr(): Node {
    const line = this.tok.line;
    // # a, b = array (multiple assignment)
    if (this.is("punc", "#") && (this.peek().type === "id" || this.peek().type === "env")) {
      const save = this.i;
      this.i++;
      const targets: Node[] = [];
      let rest: Node | null = null;
      try {
        do {
          if (this.accept("punc", "...")) { rest = this.primary(); break; }
          targets.push(this.primary());
        } while (this.accept("punc", ","));
        if (this.accept("op", "=")) return { t: "multi", targets, rest, value: this.expr(), line };
      } catch { /* not a multiple assignment */ }
      this.i = save;
    }
    const left = this.binary();
    if (this.is("op", "=")) {
      this.i++;
      const value = this.expr();
      if (left.t === "var" || left.t === "env") return { t: "assign", target: left, value, line };
      if (left.t === "call" && left.args.length === 0) {
        // a.b = c is a.b_(c)
        return { t: "call", recv: left.recv, method: left.method + "_", args: [value], kwargs: [], line };
      }
      if (left.t === "index") return { t: "call", recv: left.recv, method: "put", args: [left.index, value], kwargs: [], line };
      throw new SCSyntaxError("Cannot assign to this", line);
    }
    return left;
  }

  private binary(): Node {
    let left = this.unary();
    for (;;) {
      const t = this.tok;
      if (t.type === "op" && t.value !== "=") {
        // | closes argument lists; inside an expression it is a binary op.
        this.i++;
        const right = this.unary();
        left = { t: "binop", op: t.value, a: left, b: right, line: t.line };
        continue;
      }
      // a min: b (keyword binary operator) — only when followed by an operand on the same line.
      if (t.type === "label" && this.isBinaryKeyword(t.value)) {
        this.i++;
        const right = this.unary();
        left = { t: "binop", op: t.value, a: left, b: right, line: t.line };
        continue;
      }
      break;
    }
    return left;
  }

  private isBinaryKeyword(name: string) {
    return ["min", "max", "round", "trunc", "mod", "div", "pow", "clip2", "wrap2", "fold2", "atan2", "hypot", "bitAnd", "bitOr"].includes(name);
  }

  private unary(): Node {
    if (this.is("op", "-")) {
      const line = this.tok.line;
      this.i++;
      // -1.foo is (-1).foo: a negative literal.
      if (this.is("num")) {
        const t = this.eat("num");
        return this.postfix({ t: "num", v: -(t.num ?? 0), line, float: /[.eEp]/.test(t.value) });
      }
      return { t: "neg", a: this.unary(), line };
    }
    if (this.is("op", "`")) {
      this.i++;
      return this.unary();
    }
    return this.postfix(this.primary());
  }

  /** .method(args), .method, [index], .(args), and trailing { } blocks. */
  private postfix(node: Node): Node {
    for (;;) {
      if (this.is("punc", ".")) {
        const line = this.tok.line;
        this.i++;
        if (this.is("punc", "(")) {
          const { args, kwargs } = this.args();
          node = this.blocks({ t: "call", recv: node, method: "value", args, kwargs, line });
          continue;
        }
        const name = this.tok;
        if (name.type !== "id" && name.type !== "class") {
          // a.b: (keyword after the dot) — treat as method with a following argument.
          if (name.type === "label") {
            this.i++;
            const arg = this.unary();
            node = { t: "call", recv: node, method: name.value, args: [arg], kwargs: [], line };
            continue;
          }
          throw new SCSyntaxError("Expected a method name after .", line);
        }
        this.i++;
        let args: Node[] = [];
        let kwargs: [string, Node][] = [];
        if (this.is("punc", "(")) ({ args, kwargs } = this.args());
        node = this.blocks({ t: "call", recv: node, method: name.value, args, kwargs, line });
        continue;
      }
      if (this.is("punc", "[")) {
        const line = this.tok.line;
        this.i++;
        if (this.accept("punc", "..")) {
          const to = this.is("punc", "]") ? null : this.expr();
          this.eat("punc", "]");
          node = { t: "slice", recv: node, from: null, to, line };
          continue;
        }
        const index = this.expr();
        if (this.accept("punc", "..")) {
          const to = this.is("punc", "]") ? null : this.expr();
          this.eat("punc", "]");
          node = { t: "slice", recv: node, from: index, to, line };
          continue;
        }
        this.eat("punc", "]");
        node = { t: "index", recv: node, index, line };
        continue;
      }
      break;
    }
    return node;
  }

  /** Trailing function blocks: loop { }, 5.do { |i| }, if(c) { } { }. */
  private blocks(call: Extract<Node, { t: "call" }>): Node {
    while (this.is("punc", "{")) call.args.push(this.func());
    return call;
  }

  private args(): { args: Node[]; kwargs: [string, Node][] } {
    this.eat("punc", "(");
    const args: Node[] = [];
    const kwargs: [string, Node][] = [];
    while (!this.is("punc", ")")) {
      if (this.is("label")) {
        const key = this.eat("label").value;
        kwargs.push([key, this.expr()]);
      } else if (this.is("op", "*") && (this.peek().type === "punc" && this.peek().value === "[" || this.peek().type === "id" || this.peek().type === "env")) {
        const line = this.tok.line;
        this.i++;
        args.push({ t: "splat", a: this.expr(), line });
      } else {
        args.push(this.expr());
      }
      if (!this.accept("punc", ",")) break;
    }
    this.eat("punc", ")");
    return { args, kwargs };
  }

  private primary(): Node {
    const t = this.tok;
    const line = t.line;
    switch (t.type) {
      case "num": this.i++; return { t: "num", v: t.num ?? 0, line, float: /[.eEp]/.test(t.value) };
      case "str": {
        this.i++;
        let v = t.value;
        while (this.is("str")) v += this.eat("str").value;
        return { t: "str", v, line };
      }
      case "sym": this.i++; return { t: "sym", v: t.value, line };
      case "char": this.i++; return { t: "char", v: t.value, line };
      case "env": this.i++; return { t: "env", name: t.value, line };
      case "class": {
        this.i++;
        const node: Node = { t: "class", name: t.value, line };
        // List[1, 2], Array[...]: a collection literal.
        if (this.is("punc", "[")) return this.arrayLit();
        if (this.is("punc", "(")) {
          const { args, kwargs } = this.args();
          return this.blocks({ t: "call", recv: node, method: "new", args, kwargs, line });
        }
        if (this.is("punc", "{")) return this.blocks({ t: "call", recv: node, method: "new", args: [], kwargs: [], line });
        return node;
      }
      case "id": {
        this.i++;
        switch (t.value) {
          case "true": return { t: "bool", v: true, line };
          case "false": return { t: "bool", v: false, line };
          case "nil": return { t: "nil", line };
          case "inf": return { t: "num", v: Infinity, line };
          case "pi": return { t: "num", v: Math.PI, line };
        }
        // f(x) where f is a function name: sclang calls the method on the first argument.
        if (this.is("punc", "(")) {
          const { args, kwargs } = this.args();
          if (args.length === 0) return this.blocks({ t: "call", recv: { t: "nil", line }, method: t.value, args, kwargs, line });
          const [recv, ...rest] = args;
          return this.blocks({ t: "call", recv, method: t.value, args: rest, kwargs, line });
        }
        if (this.is("punc", "{") && ["loop", "fork", "while", "if", "r", "protect"].includes(t.value)) {
          const fn = this.func();
          return this.blocks({ t: "call", recv: fn, method: t.value, args: [], kwargs: [], line });
        }
        return { t: "var", name: t.value, line };
      }
      case "punc":
        if (t.value === "(") return this.paren();
        if (t.value === "[") return this.arrayLit();
        if (t.value === "{") return this.func();
        if (t.value === "#") {
          this.i++;
          if (this.is("punc", "[")) return this.arrayLit();
          if (this.is("punc", "{")) return this.func();
        }
        break;
      case "label": {
        // A stray keyword (e.g. inside an array): key: value pair.
        this.i++;
        return { t: "pair", key: t.value, value: this.expr(), line };
      }
    }
    throw new SCSyntaxError("Unexpected " + (t.type === "eof" ? "end of file" : JSON.stringify(t.value)), line);
  }

  private arrayLit(): Node {
    const line = this.tok.line;
    this.eat("punc", "[");
    const items: Node[] = [];
    while (!this.is("punc", "]")) {
      if (this.is("label")) {
        const key = this.eat("label").value;
        items.push({ t: "sym", v: key, line }, this.expr());
      } else if (this.is("sym") && this.peek().type === "punc" && this.peek().value === ":") {
        // \key: value
        const key = this.eat("sym").value;
        this.eat("punc", ":");
        items.push({ t: "sym", v: key, line }, this.expr());
      } else {
        items.push(this.expr());
      }
      if (!this.accept("punc", ",")) break;
    }
    this.eat("punc", "]");
    return { t: "array", items, line };
  }

  /** ( statements ), (expr), (key: value) events, (a..b) and (a, b..c) ranges. */
  private paren(): Node {
    const line = this.tok.line;
    this.eat("punc", "(");
    if (this.accept("punc", ")")) return { t: "event", pairs: [], line };
    // An event: (key: value, ...)
    if (this.is("label") || (this.is("sym") && this.peek().type === "punc" && this.peek().value === ":")) {
      const pairs: [string, Node][] = [];
      while (!this.is("punc", ")")) {
        let key: string;
        if (this.is("label")) key = this.eat("label").value;
        else { key = this.eat("sym").value; this.eat("punc", ":"); }
        pairs.push([key, this.expr()]);
        if (!this.accept("punc", ",")) break;
      }
      this.eat("punc", ")");
      return { t: "event", pairs, line };
    }
    if (this.is("id", "var")) {
      const body = this.statements(() => this.is("punc", ")"));
      this.eat("punc", ")");
      return { t: "block", body, line };
    }
    if (this.is("punc", "..")) {
      this.i++;
      const to = this.expr();
      this.eat("punc", ")");
      return { t: "range", from: { t: "num", v: 0, line }, then: null, to, line };
    }
    const first = this.expr();
    if (this.accept("punc", "..")) {
      const to = this.is("punc", ")") ? null : this.expr();
      this.eat("punc", ")");
      return { t: "range", from: first, then: null, to, line };
    }
    if (this.is("punc", ",")) {
      // (a, b..c)
      const save = this.i;
      this.i++;
      const second = this.expr();
      if (this.accept("punc", "..")) {
        const to = this.is("punc", ")") ? null : this.expr();
        this.eat("punc", ")");
        return { t: "range", from: first, then: second, to, line };
      }
      this.i = save;
    }
    if (this.accept("punc", ")")) return this.postfix(first);
    // ( stmt; stmt; ... )
    this.accept("punc", ";");
    const body = [first, ...this.statements(() => this.is("punc", ")"))];
    this.eat("punc", ")");
    return { t: "block", body, line };
  }

  private func(): Node {
    const line = this.tok.line;
    this.eat("punc", "{");
    const params: Param[] = [];
    let rest: string | null = null;
    // |a, b = 1 ... rest|
    if (this.is("op", "|") || this.is("op", "||")) {
      if (this.tok.value === "||") { this.i++; }
      else {
        this.i++;
        while (!this.is("op", "|")) {
          if (this.accept("punc", "...")) { rest = this.eat("id").value; continue; }
          const name = this.eat("id").value;
          let init: Node | null = null;
          if (this.accept("op", "=")) init = this.unary();
          params.push({ name, init });
          this.accept("punc", ",");
        }
        this.eat("op", "|");
      }
    } else if (this.is("id", "arg")) {
      this.i++;
      do {
        if (this.accept("punc", "...")) { rest = this.eat("id").value; break; }
        const name = this.eat("id").value;
        let init: Node | null = null;
        if (this.accept("op", "=")) init = this.unary();
        params.push({ name, init });
      } while (this.accept("punc", ","));
      this.accept("punc", ";");
    }
    const vars: Param[] = [];
    const body: Node[] = [];
    for (;;) {
      while (this.accept("punc", ";")) { /* skip */ }
      if (this.is("id", "var")) {
        const decl = this.varDecl() as Extract<Node, { t: "vars" }>;
        vars.push(...decl.decls);
        continue;
      }
      break;
    }
    body.push(...this.statements(() => this.is("punc", "}")));
    this.eat("punc", "}");
    return { t: "func", params, rest, vars, body, line };
  }
}
