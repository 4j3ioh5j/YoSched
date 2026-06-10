import "next-auth";

declare module "next-auth" {
  interface User {
    groupId?: string;
    groupName?: string;
    groupLevel?: number;
    permissions?: string[];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    groupId?: string;
    groupName?: string;
    groupLevel?: number;
    permissions?: string[];
  }
}
