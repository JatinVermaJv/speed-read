export interface JwtPayload {
  userId: string;
  email: string;
}

export interface GoogleUserInfo {
  sub: string;
  email: string;
  name: string;
  picture?: string;
  email_verified?: boolean;
}
