import { useQuery } from "@tanstack/react-query"

import { type UserPublic, UsersService } from "@/client"

const isLoggedIn = () => {
  return true
}

const useAuth = () => {
  const { data: user } = useQuery<UserPublic | null, Error>({
    queryKey: ["currentUser"],
    queryFn: UsersService.readUserMe,
  })

  const logout = () => {}

  return {
    logout,
    user,
  }
}

export { isLoggedIn }
export default useAuth
