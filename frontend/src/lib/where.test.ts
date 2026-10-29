import { describe, expect, it } from "vitest"

import { describeWhere } from "./where"

const base = { up: true as boolean | undefined }

describe("where the app's data is", () => {
  it("desktop app: the place it is set to, and it can switch", () => {
    const w = describeWhere({
      ...base,
      desktop: true,
      desktopMode: "local",
      agentCluster: "farm",
    })
    expect(w.place).toBe("computer")
    expect(w.label).toBe("This computer")
    expect(w.cluster).toBe("farm") // set up, not in use: offered as the other place
    expect(w.canSwitch).toBe(true)
    const c = describeWhere({
      ...base,
      desktop: true,
      desktopMode: "cluster",
      agentCluster: "farm",
    })
    expect(c.place).toBe("cluster")
    expect(c.label).toBe("Cluster farm")
  })

  it("a browser page: the place its agent service is connected to; no switch", () => {
    const w = describeWhere({
      ...base,
      desktop: false,
      desktopMode: "local",
      agentCluster: "farm",
    })
    expect(w.place).toBe("cluster")
    expect(w.canSwitch).toBe(false)
    expect(
      describeWhere({
        ...base,
        desktop: false,
        desktopMode: "local",
        agentCluster: null,
      }).place,
    ).toBe("computer")
    // Not known yet (the agent service has not answered).
    expect(
      describeWhere({
        ...base,
        desktop: false,
        desktopMode: "local",
        agentCluster: undefined,
      }).place,
    ).toBeNull()
  })

  it("a shared session: whose it is", () => {
    const member = describeWhere({
      ...base,
      desktop: true,
      desktopMode: "cluster",
      agentCluster: "farm",
      share: { owner: "ana", shared: true, role: "member" },
    })
    expect(member.sharedBy).toBe("ana")
    expect(member.detail).toBe("shared session of ana")
    const owner = describeWhere({
      ...base,
      desktop: true,
      desktopMode: "cluster",
      agentCluster: "farm",
      share: { owner: "ana", shared: true, role: "owner" },
    })
    expect(owner.sharingYours).toBe(true)
    expect(owner.detail).toBe("your session, shared with your group")
  })
})
