/**
 * Settings → Home: whether Home shows the agent, the dashboard, or both.
 * With the agent off, GEMI is used by hand: no agent tab, no "continue with
 * the agent" cards on runs, and no language model is needed.
 */
import { Checkbox } from "@/components/ui/checkbox"
import { setHomePrefs, useHomePrefs } from "@/lib/homePrefs"

function Choice({
  id,
  checked,
  disabled,
  onChange,
  title,
  detail,
}: {
  id: string
  checked: boolean
  disabled: boolean
  onChange: (v: boolean) => void
  title: string
  detail: string
}) {
  return (
    <div className="flex items-start gap-3">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onChange(v === true)}
        data-testid={id}
      />
      <label htmlFor={id} className="grid gap-0.5 text-sm">
        <span className="font-medium">{title}</span>
        <span className="text-muted-foreground">{detail}</span>
      </label>
    </div>
  )
}

export function HomeSettings() {
  const prefs = useHomePrefs()
  return (
    <div className="flex max-w-xl flex-col gap-5">
      <div>
        <h2 className="text-lg font-medium">Home</h2>
        <p className="text-muted-foreground text-sm">
          What the Home page shows. At least one stays on.
        </p>
      </div>
      <Choice
        id="home-show-dashboard"
        checked={prefs.dashboard}
        disabled={prefs.dashboard && !prefs.agent}
        onChange={(v) => setHomePrefs({ dashboard: v })}
        title="Dashboard"
        detail="An overview built from your trait data (traits over the season, which traits move together, heritability, the latest field map), plus your own tabs."
      />
      <Choice
        id="home-use-agent"
        checked={prefs.agent}
        disabled={prefs.agent && !prefs.dashboard}
        onChange={(v) => setHomePrefs({ agent: v, chosen: true })}
        title="Use the agent"
        detail="An assistant that uploads, processes and analyses on request. Turn it off to work by hand: the agent tab and its cards on runs are hidden, and no language model is needed. Runs it started keep their small agent mark."
      />
    </div>
  )
}
