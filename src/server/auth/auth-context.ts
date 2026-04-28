export interface AuthContext {
  mode: "user_jwt" | "internal";
  authorization?: string;
  cookie?: string;
  teamName?: string;
  regionName?: string;
  sourceSystem: string;
}

export interface AuthSubject {
  authMode: "user_jwt" | "internal";
  userId: string;
  username: string;
  enterpriseId?: string;
  tenantId: string;
  teamName?: string;
  sourceSystem: string;
  roles: string[];
}
