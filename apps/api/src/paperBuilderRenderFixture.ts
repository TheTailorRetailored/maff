import { writeFile } from "node:fs/promises"
import path from "node:path"
import { renderPaper } from "./research/paperBuilder.js"

const output = path.resolve(process.argv[2] ?? "paper-builder-fixture.tex")
const rendered = renderPaper({
  title: "A Deterministic Maff Paper",
  authors: ["Test Author"],
  abstractMarkdown: "We prove a compact identity for $x$.",
  keywords: ["deterministic build", "mathematics"],
  sections: [
    { stableKey: "introduction", revision: 1, ordinal: 1, kind: "section", title: "Introduction", contentMarkdown: "The argument uses **exact** structured content.", sourceFormat: "markdown", claimIds: [], citationKeys: [] },
    { stableKey: "theorem", revision: 1, ordinal: 2, kind: "proof", title: "Main result", contentMarkdown: "\\begin{theorem}For every $x$, $x=x$.\\end{theorem}\n\\begin{proof}Immediate.\\end{proof}", sourceFormat: "latex", claimIds: [], citationKeys: [] }
  ],
  papers: []
})
await writeFile(output, rendered.tex, "utf8")
console.log(output)
