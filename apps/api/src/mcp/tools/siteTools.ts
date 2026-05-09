import { getQuartzStatus, rebuildQuartzSite } from "../../quartz/builder.js"

export async function rebuildQuartz(workspaceId: string, userId: string) {
  return rebuildQuartzSite(workspaceId, userId)
}

export async function quartzStatus(workspaceId: string) {
  return getQuartzStatus(workspaceId)
}
