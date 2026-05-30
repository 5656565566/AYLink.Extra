export interface RoleSummary {
  Id: number;
  Name: string;
  Description: string;
}

export interface AuthUser {
  Id: number;
  Username: string;
  IsActive: boolean;
  LastLoginAt?: string | null;
  Roles: RoleSummary[];
  Permissions: string[];
}

export interface AuthResponsePayload {
  success?: boolean;
  accessToken?: string;
  accessTokenExpiresAt?: string;
  refreshToken?: string;
  refreshTokenExpiresAt?: string;
  user?: AuthUser;
  permissions?: string[];
}

export interface AuthMePayload {
  user?: AuthUser;
  permissions?: string[];
}
