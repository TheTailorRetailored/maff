export function bodyPreview(body: string, limit = 500) {
  return body.replace(/\s+/g, " ").trim().slice(0, limit)
}

export function appendToSection(markdown: string, sectionName: string, content: string) {
  const heading = `## ${sectionName}`
  const lines = markdown.split(/\r?\n/)
  const idx = lines.findIndex((line) => line.trim().toLowerCase() === heading.toLowerCase())
  if (idx === -1) return `${markdown.trimEnd()}\n\n${heading}\n\n${content.trim()}\n`
  let end = lines.length
  for (let i = idx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      end = i
      break
    }
  }
  const before = lines.slice(0, end).join("\n").trimEnd()
  const after = lines.slice(end).join("\n")
  return `${before}\n\n${content.trim()}\n${after ? `\n${after}` : ""}`.trimEnd() + "\n"
}

export function replaceSection(markdown: string, sectionName: string, content: string) {
  const heading = `## ${sectionName}`
  const lines = markdown.split(/\r?\n/)
  const idx = lines.findIndex((line) => line.trim().toLowerCase() === heading.toLowerCase())
  if (idx === -1) return `${markdown.trimEnd()}\n\n${heading}\n\n${content.trim()}\n`
  let end = lines.length
  for (let i = idx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      end = i
      break
    }
  }
  return [...lines.slice(0, idx), heading, "", content.trim(), "", ...lines.slice(end)].join("\n").trimEnd() + "\n"
}

