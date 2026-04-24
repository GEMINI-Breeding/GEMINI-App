/**
 * Dialog for creating a new experiment. The caller is auto-associated
 * to the new experiment so it shows up in their "my experiments" list
 * without an admin intervening.
 */
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import { ExperimentsService, UsersService } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import { useExperimentScope } from "@/contexts/ExperimentContext"

const formSchema = z.object({
  experiment_name: z.string().min(1, "Name is required").max(255),
})

type FormData = z.infer<typeof formSchema>

export function CreateExperimentDialog() {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const { setExperimentId } = useExperimentScope()

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: { experiment_name: "" },
  })

  const mutation = useMutation({
    mutationFn: async (data: FormData) => {
      const created = await ExperimentsService.apiExperimentsCreateExperiment({
        requestBody: {
          experiment_name: data.experiment_name,
        },
      })
      if (created?.id) {
        // Associate the creator so it appears in their "my experiments" list.
        await UsersService.apiUsersMeExperimentsAssociateMyExperiment({
          requestBody: {
            experiment_id: String(created.id),
            role: "owner",
          },
        })
      }
      return created
    },
    onSuccess: async (created) => {
      toast.success(`Created "${created?.experiment_name}"`)
      await queryClient.invalidateQueries({ queryKey: ["experiments"] })
      await queryClient.invalidateQueries({
        queryKey: ["users", "me", "experiments"],
      })
      if (created?.id) setExperimentId(String(created.id))
      form.reset()
      setOpen(false)
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "Failed to create experiment",
      )
    },
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="Create experiment"
          data-testid="create-experiment-button"
        >
          <Plus className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create experiment</DialogTitle>
          <DialogDescription>
            You'll be associated as the owner automatically.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))}>
            <div className="grid gap-4 py-4">
              <FormField
                control={form.control}
                name="experiment_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Name <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. Corn 2026 — Site A"
                        autoFocus
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" disabled={mutation.isPending}>
                  Cancel
                </Button>
              </DialogClose>
              <LoadingButton type="submit" loading={mutation.isPending}>
                Create
              </LoadingButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
