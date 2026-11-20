/**
 * PanelBoundary — keeps an error in one panel inside that panel.
 *
 * Without it any render error reaches the route's error page ("Oops!") and
 * the whole page is lost, along with the way back. With it the panel says
 * what broke, in a sentence, and offers to try again; the rest of the page
 * keeps working.
 */
import { AlertTriangle } from "lucide-react"
import { Component, type ErrorInfo, type ReactNode } from "react"

import { Button } from "@/components/ui/button"

interface Props {
  /** What the panel is, for the message ("the plot boundary editor"). */
  what: string
  children: ReactNode
  /** Changing it clears the error (e.g. the run or step shown). */
  resetKey?: unknown
}

interface State {
  error: Error | null
  key: unknown
}

export class PanelBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  static getDerivedStateFromProps(
    props: Props,
    state: State,
  ): Partial<State> | null {
    return props.resetKey !== state.key
      ? { error: null, key: props.resetKey }
      : null
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `[PanelBoundary] ${this.props.what}:`,
      error,
      info.componentStack,
    )
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div
        className="flex flex-col items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
        data-testid="panel-error"
      >
        <div className="flex items-center gap-2 font-medium">
          <AlertTriangle className="h-4 w-4" />
          {`Something in ${this.props.what} went wrong; the rest of the page still works.`}
        </div>
        <p className="font-mono text-xs break-all">
          {this.state.error.message}
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => this.setState({ error: null })}
        >
          Try again
        </Button>
      </div>
    )
  }
}
