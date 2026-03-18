import { toast } from "sonner"

const useCustomToast = () => {
  const showSuccessToast = (description: string) => {
    toast.success("Success!", {
      description,
    })
  }

  const showErrorToast = (description: string) => {
    toast.error("Something went wrong!", {
      description,
    })
  }

  const showErrorToastWithCopy = (description: string) => {
    toast.error("Something went wrong!", {
      description,
      duration: Infinity,
      action: {
        label: "Copy",
        onClick: () => navigator.clipboard.writeText(description),
      },
    })
  }

  return { showSuccessToast, showErrorToast, showErrorToastWithCopy }
}

export default useCustomToast
