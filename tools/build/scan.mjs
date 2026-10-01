// A small JavaScript scanner for the single-file build: it walks source text knowing what is a comment, a string, a
// template literal and a regex literal, so that rewriting never touches text inside the wrong one. It is not a parser:
// regex-vs-division is decided from the previous significant token, which is right for ordinary code.
//
//   transformJs(source, { stripComments, rewriteString(value, info) -> string | undefined, importMetaUrl })
//     info.isStatic: the string follows `from` or a side-effect `import` (so a missing target is a build error);
//     info.callee: the identifier directly before the "(" the string is the first argument of (e.g. 'URL', 'optional');
//     rewriteString returns the new string content (no quotes) or undefined to keep it.
//     importMetaUrl: when set, `import.meta.url` outside strings/comments is replaced by that string literal.
//     Returns the rewritten source.

const REGEX_AFTER_WORD = new Set([
  'return', 'typeof', 'case', 'of', 'in', 'delete', 'void', 'throw', 'new', 'else', 'do', 'yield', 'await', 'instanceof',
]);
const REGEX_AFTER_CHAR = '(,=:[!&|?{};+-*%<>~^}';
const IDENT_START = /[A-Za-z_$\u0080-￿]/;
const IDENT_PART = /[A-Za-z0-9_$\u0080-￿]/;

export function transformJs(src, options = {}) {
  const { stripComments = false, rewriteString = null, importMetaUrl = null } = options;
  let i = 0;
  const n = src.length;

  // `prev` is the last significant character class ('' = start, a punctuation char, 'a' = word/number, '"' = literal),
  // `prevWord` the last identifier seen directly before.
  function scan(untilBrace) {
    const out = [];
    let depth = 0;
    let prev = '';
    let prevWord = '';
    let parenWord = ''; // the identifier before the last "(": the callee of a string argument
    while (i < n) {
      const c = src[i];
      const d = src[i + 1];
      if (c === '/' && d === '/') {
        let j = i;
        while (j < n && src[j] !== '\n') j++;
        if (!stripComments) out.push(src.slice(i, j));
        i = j;
        continue;
      }
      if (c === '/' && d === '*') {
        let j = src.indexOf('*/', i + 2);
        j = j < 0 ? n : j + 2;
        if (!stripComments) out.push(src.slice(i, j));
        else out.push(src.slice(i, j).includes('\n') ? '\n' : ' ');
        i = j;
        continue;
      }
      if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < n && src[j] !== c) {
          if (src[j] === '\\') j++;
          if (src[j] === '\n') break; // unterminated: let the engine complain, do not run away
          j++;
        }
        const body = src.slice(i + 1, j);
        let text = src.slice(i, j + 1);
        if (rewriteString && !body.includes('\\')) {
          const info = {
            isStatic: prev === 'a' && (prevWord === 'from' || prevWord === 'import'),
            callee: prev === '(' ? parenWord : '',
          };
          const next = rewriteString(body, info);
          if (next !== undefined && next !== body) text = c + next + c;
        }
        out.push(text);
        i = j + 1;
        prev = '"';
        prevWord = '';
        continue;
      }
      if (c === '`') {
        out.push(scanTemplate());
        prev = '"';
        prevWord = '';
        continue;
      }
      if (c === '/') {
        const regexOk = prev === '' || REGEX_AFTER_CHAR.includes(prev) || (prev === 'a' && REGEX_AFTER_WORD.has(prevWord));
        if (regexOk) {
          let j = i + 1;
          let inClass = false;
          let closed = false;
          while (j < n && src[j] !== '\n') {
            const ch = src[j];
            if (ch === '\\') j++;
            else if (ch === '[') inClass = true;
            else if (ch === ']') inClass = false;
            else if (ch === '/' && !inClass) {
              closed = true;
              break;
            }
            j++;
          }
          if (closed) {
            j++;
            while (j < n && IDENT_PART.test(src[j])) j++; // flags
            out.push(src.slice(i, j));
            i = j;
            prev = '"';
            prevWord = '';
            continue;
          }
        }
        out.push(c);
        i++;
        prev = '/';
        prevWord = '';
        continue;
      }
      if (IDENT_START.test(c) || /[0-9]/.test(c)) {
        let j = i + 1;
        while (j < n && IDENT_PART.test(src[j])) j++;
        const word = src.slice(i, j);
        if (importMetaUrl !== null && word === 'import' && src.startsWith('.meta.url', j) && prev !== '.') {
          out.push(JSON.stringify(importMetaUrl));
          i = j + '.meta.url'.length;
          prev = '"';
          prevWord = '';
          continue;
        }
        out.push(word);
        i = j;
        // a property name after "." is not a keyword (`x.return / 2`)
        prevWord = prev === '.' ? '' : word;
        prev = 'a';
        continue;
      }
      if (c === '(') parenWord = prevWord;
      if (c === '{') depth++;
      if (c === '}') {
        if (untilBrace && depth === 0) return out.join('');
        depth--;
      }
      out.push(c);
      i++;
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') continue;
      if (c === ')' || c === ']' || ((c === '+' || c === '-') && src[i - 2] === c)) prev = ')'; // `)`, `]`, `i++` end an operand
      else prev = c;
      prevWord = '';
    }
    return out.join('');
  }

  function scanTemplate() {
    const out = ['`'];
    i++;
    while (i < n) {
      const c = src[i];
      if (c === '\\') {
        out.push(src.slice(i, i + 2));
        i += 2;
        continue;
      }
      if (c === '`') {
        out.push('`');
        i++;
        return out.join('');
      }
      if (c === '$' && src[i + 1] === '{') {
        out.push('${');
        i += 2;
        out.push(scan(true));
        if (i < n) {
          out.push('}');
          i++;
        }
        continue;
      }
      out.push(c);
      i++;
    }
    return out.join('');
  }

  return scan(false);
}

/** Relative module specifiers the build rewrites: './x.js', '../y/z.mjs'. */
export const RELATIVE_MODULE = /^\.{1,2}\/[^\s'"`]*\.m?js$/;
