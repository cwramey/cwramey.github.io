// Tiny syntax highlighter for Python, JSON and YAML snippets. Returns HTML-escaped markup with
// <span class="tk-*"> tokens; colours live in sandbox.css.
const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

const RULES = {
  python: [
    ['com', /#.*/y],
    ['str', /("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/y],
    ['kw', /\b(?:def|return|import|from|as|for|in|if|elif|else|with|try|except|finally|class|None|True|False|and|or|not|lambda|yield|raise|pass)\b/y],
    ['num', /\b\d+(?:\.\d+)?\b/y],
    ['fn', /\b[A-Za-z_]\w*(?=\()/y],
  ],
  json: [
    ['key', /"(?:\\.|[^"\\])*"(?=\s*:)/y],
    ['str', /"(?:\\.|[^"\\])*"/y],
    ['num', /-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/y],
    ['kw', /\b(?:true|false|null)\b/y],
  ],
  yaml: [
    ['com', /#.*/y],
    ['key', /^[ \t-]*[\w.]+(?=:)/my],
    ['str', /"(?:\\.|[^"\\])*"|'[^']*'/y],
    ['num', /\b\d+(?:\.\d+)?\b/y],
    ['kw', /\b(?:true|false|null)\b/y],
  ],
};

export function highlight(code, lang = 'python') {
  const rules = RULES[lang] ?? [];
  let out = '', i = 0, plain = '';
  const flush = () => { out += esc(plain); plain = ''; };
  while (i < code.length) {
    let hit = null;
    for (const [cls, re] of rules) {
      re.lastIndex = i;
      const m = re.exec(code);
      if (m && m.index === i && m[0]) { hit = [cls, m[0]]; break; }
    }
    if (hit) { flush(); out += `<span class="tk-${hit[0]}">${esc(hit[1])}</span>`; i += hit[1].length; }
    else plain += code[i++];
  }
  flush();
  return out;
}
