import "next-auth";

declare module "next-auth" {
  interface User {
    role?: string;
    groupId?: string;
    groupName?: string;
    groupLevel?: number;
    permissions?: string[];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: string;
    groupId?: string;
    groupName?: string;
    groupLevel?: number;
    permissions?: string[];
  }
}
