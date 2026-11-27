export const USER_REGISTERED = 'user.registered';
export const USER_EMAIL_VERIFIED = 'user.email_verified';
export const USER_PASSWORD_CHANGED = 'user.password_changed';

export type RegistrationMethod = 'password' | 'email_code' | 'google' | 'apple';

export interface UserRegisteredEvent {
  userId: string;
  method: RegistrationMethod;
}

export interface UserEventPayload {
  userId: string;
}
