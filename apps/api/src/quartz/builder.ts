import fs from "node:fs/promises"
import path from "node:path"
import { spawn } from "node:child_process"
import { config } from "../config.js"
import { prisma } from "../db/prisma.js"
import { vaultRoot } from "../vault/paths.js"

let quartzBuildLock: Promise<unknown> = Promise.resolve()

async function copyDir(src: string, dst: string) {
  await fs.rm(dst, { recursive: true, force: true })
  await fs.mkdir(dst, { recursive: true })
  await fs.cp(src, dst, { recursive: true })
}

function run(command: string, args: string[], cwd: string) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: process.platform === "win32" })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (d) => { stdout += d })
    child.stderr.on("data", (d) => { stderr += d })
    child.on("exit", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr || stdout || `Command exited ${code}`)))
  })
}

export async function rebuildQuartzSite(workspaceId: string, userId: string) {
  const runBuild = async () => {
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })
    const job = await prisma.job.create({ data: { workspaceId, createdByUserId: userId, type: "quartz_build", status: "running", input: { workspaceSlug: workspace.slug }, startedAt: new Date() } })
    try {
      const buildRoot = path.join(config.dataDir, "quartz-build", workspace.slug)
      const contentDir = path.join(buildRoot, "content")
      await copyDir(vaultRoot(workspace.slug), contentDir)
      const outDir = path.join(config.dataDir, "quartz-sites", workspace.slug)
      await fs.rm(path.join(config.quartzDir, "content"), { recursive: true, force: true })
      await fs.cp(contentDir, path.join(config.quartzDir, "content"), { recursive: true })
      await run("npm", ["exec", "quartz", "build", "--", "--output", outDir], config.quartzDir)
      return prisma.job.update({ where: { id: job.id }, data: { status: "succeeded", output: { outDir }, finishedAt: new Date() } })
    } catch (error) {
      return prisma.job.update({ where: { id: job.id }, data: { status: "failed", error: error instanceof Error ? error.message : String(error), finishedAt: new Date() } })
    }
  }
  quartzBuildLock = quartzBuildLock.then(runBuild, runBuild)
  return quartzBuildLock
}

export async function getQuartzStatus(workspaceId: string) {
  return prisma.job.findFirst({ where: { workspaceId, type: "quartz_build" }, orderBy: { createdAt: "desc" } })
}
