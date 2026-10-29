import { USER_ROLES } from "app-types/roles";

export const getUserAvatar = (user: { image?: string | null }): string => {
  const disableDefaultAvatar = process.env.DISABLE_DEFAULT_AVATAR === "true";
  return user.image || (disableDefaultAvatar ? "" : "/pf.webp");
};

export const getIsUserAdmin = (user?: { role?: string | null }): boolean => {
  return user?.role?.split(",").includes(USER_ROLES.ADMIN) || false;
};
