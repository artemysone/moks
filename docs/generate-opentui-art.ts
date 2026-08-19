import { fonts, measureText } from "../packages/tui/node_modules/@opentui/core"

type FontName = keyof typeof fonts

const FONT_ORDER = ["tiny", "slick", "pallet", "grid", "shade", "block", "huge"] as const satisfies FontName[]

const META: Record<
  FontName,
  { title: string; blurb: string; tags: string[]; use: string }
> = {
  tiny: {
    title: "Tiny",
    blurb: "Two rows. Half-block. The only font that can live in a status line, a toast, and a prompt prefix.",
    tags: ["2-row", "▀▄█", "micro"],
    use: "CLI chip · prompt · favicon-scale",
  },
  slick: {
    title: "Slick",
    blurb: "Rounded box-drawing with a slash gutter. The current between letters. Closest to a designed wordmark.",
    tags: ["box", "╱ gutter"],
    use: "home title · splash",
  },
  pallet: {
    title: "Pallet",
    blurb: "Double-line box. Passport-chop energy. Reads as a stamped form, not a FIGlet poster.",
    tags: ["double", "stamp"],
    use: "dossier header · seal",
  },
  grid: {
    title: "Grid",
    blurb: "Letters sit on a ledger. The ╋ gutter is the scorecard. A req is a table; the name is the table.",
    tags: ["╋", "ledger"],
    use: "icon · scorecard lockup",
  },
  shade: {
    title: "Shade",
    blurb: "Fill plus dust. Working copy vs carbon. The ░ field is the paper the letters were punched from.",
    tags: ["░", "dither"],
    use: "evidence · carbon copy",
  },
  block: {
    title: "Block",
    blurb: "Classic ANSI shadow. Terminal splash from 1994 that still works. Loud on purpose.",
    tags: ["ANSI", "shadow"],
    use: "CLI --help hero",
  },
  huge: {
    title: "Huge",
    blurb: "Eleven rows. Half-block plus shade. A courtyard you can walk through. Too big for home; right for a first-run.",
    tags: ["11-row", "hero"],
    use: "first-run · empty company",
  },
}

function strip(raw: string) {
  return raw.replace(/<\/?c[12]>/g, "")
}

function colorize(raw: string) {
  return raw
    .replace(/<c1>/g, '<span class="c1">')
    .replace(/<c2>/g, '<span class="c2">')
    .replace(/<\/c[12]>/g, "</span>")
}

function compose(font: FontName, text: string) {
  const f = fonts[font]
  const rows = Array.from({ length: f.lines }, () => "")
  const letters = [...text]
  for (const [i, ch] of letters.entries()) {
    const glyph = f.chars[ch as keyof typeof f.chars]
    if (!glyph) throw new Error(`missing ${ch} in ${font}`)
    for (let r = 0; r < f.lines; r++) rows[r] += glyph[r] ?? ""
    if (i < letters.length - 1) {
      for (let r = 0; r < f.lines; r++) rows[r] += f.letterspace[r] ?? " "
    }
  }
  return rows
}

function art(rows: string[], cls = "") {
  const body = rows.map((row) => colorize(row)).join("\n")
  return `<pre class="art ${cls}">${body}</pre>`
}

function plain(rows: string[], cls = "") {
  return `<pre class="art ${cls}">${rows.map(strip).join("\n")}</pre>`
}

function weather(rows: string[], letters: string[]) {
  const f = fonts.slick
  const colored: string[] = Array.from({ length: f.lines }, () => "")
  const classes = ["g", "b", "w", "a"]
  for (const [i, ch] of letters.entries()) {
    const glyph = fonts.slick.chars[ch as keyof typeof fonts.slick.chars]
    for (let r = 0; r < f.lines; r++) {
      colored[r] += `<span class="${classes[i]}">${strip(glyph[r] ?? "")}</span>`
      if (i < letters.length - 1) colored[r] += `<span class="d">${strip(fonts.slick.letterspace[r] ?? " ")}</span>`
    }
  }
  return `<pre class="art">${colored.join("\n")}</pre>`
}

function dusk(rows: string[]) {
  const classes = ["row-0", "row-1", "row-2", "row-3", "row-4", "row-5", "row-6", "row-7", "row-8", "row-9", "row-10"]
  return `<pre class="art">${rows.map((row, i) => `<span class="${classes[i] ?? "row-10"}">${strip(row)}</span>`).join("\n")}</pre>`
}

function stage(label: string, inner: string) {
  return `<div class="stage"><div class="label">${label}</div>${inner}</div>`
}

function card(id: string, num: string, font: FontName, extra = "") {
  const m = META[font]
  const word = compose(font, "MOKS")
  const mark = compose(font, "M")
  const size = measureText({ text: "MOKS", font })
  return `
      <article class="card" id="${id}">
        <div class="meta">
          <span class="num">${num}</span>
          <h2>${m.title}</h2>
          <div class="tags">${m.tags.map((t) => `<span class="tag">${t}</span>`).join("")}<span class="tag dim">${size.width}×${size.height}</span></div>
        </div>
        <p class="blurb">${m.blurb}</p>
        ${stage(`title · MOKS · ${m.use}`, art(word))}
        <div class="pair">
          ${stage("logo · M", art(mark, "mark"))}
          ${stage("no color", plain(word))}
        </div>
        ${extra}
      </article>`
}

const slick = compose("slick", "MOKS")
const tiny = compose("tiny", "MOKS")
const pallet = compose("pallet", "MOKS")
const grid = compose("grid", "MOKS")
const shade = compose("shade", "MOKS")
const block = compose("block", "MOKS")
const huge = compose("huge", "MOKS")
const slickM = compose("slick", "M")
const tinyM = compose("tiny", "M")
const gridM = compose("grid", "M")
const palletM = compose("pallet", "M")
const shadeM = compose("shade", "M")

const lockupSlickTiny = slickM.map((row, i) => {
  if (i === 2) return `${row}  <c1>${strip(tiny[0])}</c1>`
  if (i === 3) return `${row}  <c1>${strip(tiny[1])}</c1>`
  return row
})

const stampInner = strip(pallet[0]).length
const stampRule = "═".repeat(stampInner + 4)
const stamp = [
  `<c2>╔${stampRule}╗</c2>`,
  ...pallet.map((row) => `<c2>║</c2>  ${row}  <c2>║</c2>`),
  `<c2>╚${stampRule}╝</c2>`,
]

const gridLetters = ["M", "O", "K", "S"].map((ch) => fonts.grid.chars[ch as "M"])
const ledgerBody = [1, 2, 3, 4].map((r) => {
  const cells = gridLetters.map((glyph) => glyph[r] ?? "").join("<c2>┃</c2>")
  return `<c2>┃</c2>${cells}<c2>┃</c2>`
})
const ledger = [
  "<c2>┏━━━━┳━━━━┳━━━━┳━━━━┓</c2>",
  ...ledgerBody,
  "<c2>┣━━━━╋━━━━╋━━━━╋━━━━┫</c2>",
  "<c2>┃</c2> <c1>src</c1><c2>┃</c2> <c1>scr</c1><c2>┃</c2> <c1>int</c1><c2>┃</c2> <c1>dec</c1><c2>┃</c2>",
  "<c2>┗━━━━┻━━━━┻━━━━┻━━━━┛</c2>",
]

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>moks — OpenTUI fonts</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #0c0f0d;
      --bg2: #141a16;
      --panel: #1a221c;
      --line: #2a362e;
      --text: #e8efe9;
      --muted: #8a9a8e;
      --dim: #5c6b60;
      --green: #3dd68c;
      --green-dim: #1f6b47;
      --amber: #e6b84d;
      --amber-dim: #6b5420;
      --blue: #6db3f2;
      --red: #f07178;
      --ink: #c8d4cc;
      --font: "IBM Plex Sans", "Segoe UI", system-ui, sans-serif;
      --mono: "IBM Plex Mono", "Cascadia Code", "SF Mono", ui-monospace, monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }
    body {
      font-family: var(--font);
      background:
        radial-gradient(1200px 600px at 10% -10%, #1a3d2a 0%, transparent 55%),
        radial-gradient(900px 500px at 100% 0%, #1a2a3d 0%, transparent 50%),
        var(--bg);
      color: var(--text);
      line-height: 1.45;
      min-height: 100vh;
      padding: 32px 20px 80px;
    }
    .page { max-width: 1180px; margin: 0 auto; }
    header {
      border: 1px solid var(--line);
      background: linear-gradient(180deg, var(--panel), var(--bg2));
      border-radius: 16px;
      padding: 28px 32px 24px;
      margin-bottom: 20px;
      position: relative;
      overflow: hidden;
    }
    header::before {
      content: "";
      position: absolute;
      inset: 0 0 auto 0;
      height: 3px;
      background: linear-gradient(90deg, var(--green), var(--blue), var(--amber));
    }
    .kicker {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 12px;
      align-items: center;
      margin-bottom: 14px;
      font-family: var(--mono);
      font-size: 11px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1px solid var(--line);
      background: var(--bg);
      color: var(--green);
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 11px;
    }
    .pill::before {
      content: "";
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--green);
      box-shadow: 0 0 8px var(--green);
    }
    h1 {
      font-size: clamp(1.55rem, 3vw, 2rem);
      font-weight: 600;
      letter-spacing: -0.03em;
      line-height: 1.15;
      margin-bottom: 12px;
    }
    h1 span { color: var(--green); }
    .thesis {
      font-size: 1.05rem;
      color: var(--muted);
      max-width: 72ch;
    }
    .thesis strong { color: var(--text); font-weight: 600; }
    nav.jump {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 18px;
    }
    nav.jump a {
      font-family: var(--mono);
      font-size: 11px;
      color: var(--muted);
      text-decoration: none;
      border: 1px solid var(--line);
      padding: 3px 8px;
      border-radius: 999px;
      background: var(--bg);
    }
    nav.jump a:hover { color: var(--green); border-color: var(--green-dim); }
    .grid { display: grid; gap: 16px; margin-bottom: 16px; }
    @media (min-width: 900px) { .grid.two { grid-template-columns: 1fr 1fr; } }
    section, .card {
      border: 1px solid var(--line);
      background: linear-gradient(180deg, var(--panel), var(--bg2));
      border-radius: 14px;
      padding: 20px 22px 18px;
    }
    .card.wide { grid-column: 1 / -1; }
    .meta {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 8px 12px;
      margin-bottom: 8px;
    }
    .num {
      font-family: var(--mono);
      font-size: 11px;
      color: var(--green);
      letter-spacing: 0.06em;
    }
    h2 { font-size: 1.05rem; font-weight: 600; letter-spacing: -0.02em; }
    .tags { display: flex; flex-wrap: wrap; gap: 6px; margin-left: auto; }
    .tag {
      font-family: var(--mono);
      font-size: 10px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--dim);
      border: 1px solid var(--line);
      padding: 1px 7px;
      border-radius: 999px;
    }
    .tag.pick { color: var(--amber); border-color: var(--amber-dim); }
    .tag.dim { color: var(--dim); }
    .blurb { color: var(--muted); font-size: 0.92rem; margin-bottom: 14px; max-width: 72ch; }
    .stage {
      background: #0a0d0b;
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 18px 16px 16px;
      overflow-x: auto;
      position: relative;
    }
    .stage + .stage { margin-top: 10px; }
    .label {
      font-family: var(--mono);
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--dim);
      margin-bottom: 8px;
    }
    pre, .art {
      font-family: var(--mono);
      font-size: 13px;
      line-height: 1.18;
      letter-spacing: 0;
      font-variant-ligatures: none;
      font-feature-settings: "calt" 0, "liga" 0;
      color: var(--ink);
      white-space: pre;
    }
    .art .c1 { color: var(--green); }
    .art .c2 { color: var(--blue); }
    .art .g { color: var(--green); }
    .art .b { color: var(--blue); }
    .art .a { color: var(--amber); }
    .art .d { color: var(--dim); }
    .art .m { color: var(--muted); }
    .art .w { color: var(--text); }
    .art .r { color: var(--red); }
    .pair { display: grid; gap: 10px; margin-top: 10px; }
    @media (min-width: 720px) { .pair { grid-template-columns: 1fr 1fr; } }
    .row-0 { color: #b8ffd6; }
    .row-1 { color: #8af0b8; }
    .row-2 { color: #5ed99a; }
    .row-3 { color: #3dd68c; }
    .row-4 { color: #c8d4cc; }
    .row-5 { color: #a8b8ae; }
    .row-6 { color: #8a9a8e; }
    .row-7 { color: #e6b84d; }
    .row-8 { color: #c9a043; }
    .row-9 { color: #8a6e2c; }
    .row-10 { color: #5c6b60; }
    footer {
      margin-top: 8px;
      color: var(--dim);
      font-family: var(--mono);
      font-size: 12px;
    }
    code { font-family: var(--mono); color: var(--ink); }
  </style>
</head>
<body>
  <div class="page">
    <header>
      <div class="kicker">
        <span class="pill">opentui fonts</span>
        <span>docs/opentui-art.html</span>
        <span>not shipped</span>
      </div>
      <h1>Seven fonts, one name: <span>MOKS</span></h1>
      <p class="thesis">
        Rendered from <strong>@opentui/core</strong> ASCII fonts — <code>tiny</code> <code>slick</code> <code>pallet</code> <code>grid</code> <code>shade</code> <code>block</code> <code>huge</code>.
        Two channels: <strong>c1 fill</strong> and <strong>c2 gutter</strong>.
        Logo is the <em>M</em>. Title is the four letters. Silhouette must still say moks with no color.
      </p>
      <nav class="jump">
        <a href="#hero">hero</a>
        <a href="#tiny">tiny</a>
        <a href="#slick">slick</a>
        <a href="#pallet">pallet</a>
        <a href="#grid">grid</a>
        <a href="#shade">shade</a>
        <a href="#block">block</a>
        <a href="#huge">huge</a>
        <a href="#lockups">lockups</a>
        <a href="#scan">scan</a>
      </nav>
    </header>

    <section class="card wide" id="hero">
      <div class="meta">
        <span class="num">00</span>
        <h2>First look</h2>
        <div class="tags"><span class="tag pick">pick with your eyes</span></div>
      </div>
      <p class="blurb">Slick as the designed title. Tiny as the mark that can travel. Huge if we ever need a courtyard.</p>
      <div class="pair">
        ${stage("slick · title", art(slick))}
        ${stage("tiny · chip", art(tiny))}
      </div>
      ${stage("huge · dusk courtyard", dusk(huge))}
    </section>

    <div class="grid two">
      ${card("tiny", "01", "tiny", stage("micro · one line", `<pre class="art"><span class="c1">${strip(tiny[0])}</span>  moks</pre>`))}
      ${card("slick", "02", "slick", stage("per-letter weather · src / scrn / intv / decd", weather(slick, ["M", "O", "K", "S"])))}
      ${card("pallet", "03", "pallet", stage("requisition stamp", art(stamp)))}
      ${card("grid", "04", "grid", stage("the name is the form", art(ledger)))}
      ${card("shade", "05", "shade")}
      ${card("block", "06", "block")}
    </div>

    <section class="card wide" id="huge">
      <div class="meta">
        <span class="num">07</span>
        <h2>Huge</h2>
        <div class="tags"><span class="tag">11-row</span><span class="tag">hero</span><span class="tag dim">50×11</span></div>
      </div>
      <p class="blurb">${META.huge.blurb}</p>
      ${stage("title · two-channel", art(huge))}
      <div class="pair">
        ${stage("logo · M", art(compose("huge", "M")))}
        ${stage("dusk", dusk(huge))}
      </div>
    </section>

    <section class="card wide" id="lockups">
      <div class="meta">
        <span class="num">lockups</span>
        <h2>Creative pairings</h2>
        <div class="tags"><span class="tag pick">compositions</span></div>
      </div>
      <p class="blurb">Fonts talking to each other. Mark plus word. Form plus name. None of these are shipped — they are arguments.</p>
      <div class="grid two">
        ${stage("A · slick M + tiny word", art(lockupSlickTiny))}
        ${stage("B · pallet chop", art(stamp))}
        ${stage("C · grid as scorecard", art(ledger))}
        ${stage(
          "D · shade carbon",
          `<pre class="art">${shade.map(colorize).join("\n")}\n<span class="d">${shade.map(strip).join("\n").split("\n").map((l) => " " + l).join("\n")}</span></pre>`,
        )}
        ${stage("E · slick weather", weather(slick, ["M", "O", "K", "S"]))}
        ${stage(
          "F · quiet type under a courtyard M",
          `<pre class="art">${slickM.map(colorize).join("\n")}\n\n<span class="m">moks</span>  <span class="g">▰</span> <span class="b">▰</span> <span class="a">▰</span> <span class="d">▱</span></pre>`,
        )}
        ${stage(
          "G · three marks · icon tray",
          `<pre class="art">${[tinyM, gridM, palletM]
            .map((rows) => rows.map(colorize).join("\n"))
            .join("\n\n")}</pre>`,
        )}
        ${stage("H · block splash · CLI first paint", art(block))}
      </div>
    </section>

    <section class="card wide" id="scan">
      <div class="meta">
        <span class="num">scan</span>
        <h2>All titles, one glance</h2>
      </div>
      <p class="blurb">Same ink. Pick the silhouette, not the story.</p>
      <div class="grid two">
        ${stage("tiny", plain(tiny))}
        ${stage("slick", plain(slick))}
        ${stage("pallet", plain(pallet))}
        ${stage("grid", plain(grid))}
        ${stage("shade", plain(shade))}
        ${stage("block", plain(block))}
        <div class="card wide" style="padding:0;border:0;background:none">
          ${stage("huge", plain(huge))}
        </div>
      </div>
    </section>

    <footer>glyphs from <span style="color:var(--muted)">@opentui/core</span> · open <span style="color:var(--muted)">docs/opentui-art.html</span></footer>
  </div>
</body>
</html>
`

await Bun.write(new URL("./opentui-art.html", import.meta.url), html)
console.log("wrote docs/opentui-art.html")
